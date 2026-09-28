-- Run in the Supabase SQL Editor after applying the migrations (F3, F4 and F5).
-- The first row is the verdict. The rest lists every expected table with whether it exists and
-- whether row-level security is on, then any other table in public (which should not exist).
with expected(table_name) as (values
  ('accounts'), ('profiles'), ('role_assignments'), ('guardian_relationships'), ('trusted_devices'),
  ('session_events'), ('subscriptions'), ('trial_consents'), ('entitlements'), ('academies'), ('courses'),
  ('academy_blueprints'), ('modules'), ('lessons'), ('skills'), ('sources'), ('source_claims'),
  ('source_conflicts'), ('authority_decisions'), ('learning_activities'), ('assessment_attempts'),
  ('assignments'), ('projects'), ('capstones'), ('review_items'), ('schedules'), ('progress_records'),
  ('mastery_records'), ('retention_signals'), ('mentor_threads'), ('notes'), ('uploads'),
  ('world_preferences'), ('notification_preferences'), ('legal_document_versions'), ('consent_records'),
  ('safety_events'), ('audit_events'), ('connection_statuses')
),
public_tables as (
  select c.relname as table_name, c.relrowsecurity as rls_on
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
),
report as (
  select e.table_name, p.table_name is not null as table_exists, coalesce(p.rls_on, false) as rls_on, true as expected
  from expected e left join public_tables p using (table_name)
  union all
  select p.table_name, true, p.rls_on, false
  from public_tables p where p.table_name not in (select table_name from expected)
),
insert_only as (
  select count(*) as triggers from pg_trigger t
  where t.tgname in ('reject_update_delete', 'reject_truncate')
    and t.tgrelid in ('public.audit_events'::regclass, 'public.consent_records'::regclass)
),
f4 as (
  select
    (select count(*) from pg_trigger where tgrelid = 'public.accounts'::regclass
       and tgname in ('protect_owner', 'protect_owner_truncate')) as owner_triggers,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'role_assignments' and column_name = 'expires_at') as invite_columns,
    exists (select 1 from private.schema_migrations where version = '0005_roles_and_invites') as recorded
),
f5 as (
  select
    exists (select 1 from private.schema_migrations where version = '0006_audit_store') as recorded,
    exists (select 1 from pg_trigger where tgrelid = 'public.audit_events'::regclass and tgname = 'audit_chain') as chain_trigger,
    to_regprocedure('public.audit_verify_chain()') is not null as verifier
)
select 0 as sort,
       case when (select count(*) from report where expected and table_exists and rls_on) = 39
             and not exists (select 1 from report where not expected)
             and (select triggers from insert_only) = 4
             and (select owner_triggers from f4) = 2 and (select invite_columns from f4) and (select recorded from f4)
             and (select recorded from f5) and (select chain_trigger from f5) and (select verifier from f5)
            then 'OK: all 39 tables exist with row-level security on; audit_events and consent_records are insert-only; F4 admin invites and Owner protections are in place; F5 audit chain is in place'
            else 'PROBLEM: ' || (select count(*) from report where expected and not table_exists) || ' missing, '
                 || (select count(*) from report where table_exists and not rls_on) || ' without RLS, '
                 || (select count(*) from report where not expected) || ' unexpected, '
                 || (select triggers from insert_only) || '/4 insert-only triggers, '
                 || (select owner_triggers from f4) || '/2 Owner protection triggers, F4 '
                 || case when (select recorded from f4) then 'applied' else 'NOT applied' end
                 || ', F5 ' || case when (select recorded from f5) and (select chain_trigger from f5) and (select verifier from f5)
                                    then 'applied' else 'NOT applied' end
       end as table_name,
       null::boolean as table_exists, null::boolean as rls_on
union all
select case when expected then 1 else 2 end, table_name, table_exists, rls_on from report
order by sort, table_name;
