-- Run in the Supabase SQL Editor after applying the migrations (F3, F4, F5, F6, B1, B2, B3 and B4).
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
  ('safety_events'), ('audit_events'), ('connection_statuses'),
  -- F6: the sharing tracker and the graduated steps.
  ('sharing_signals'), ('sharing_flags'), ('enforcement_steps'), ('appeals'),
  -- B1: Stripe customers and processed Stripe events.
  ('billing_customers'), ('billing_events'),
  -- B4: notices sent and Privacy Center requests.
  ('notices'), ('privacy_requests')
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
),
f6 as (
  select
    exists (select 1 from private.schema_migrations where version = '0007_devices_and_sessions') as recorded,
    to_regprocedure('public.claim_device_slot(uuid, text, text, text, text, integer, uuid)') is not null as slot_claim,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.enforcement_steps') and tgname = 'protect_owner') as owner_guard,
    coalesce((select not has_function_privilege('anon', p, 'execute') and not has_function_privilege('authenticated', p, 'execute')
              from to_regprocedure('public.claim_device_slot(uuid, text, text, text, text, integer, uuid)') p where p is not null), false) as slot_claim_private,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'session_events' and column_name = 'last_heartbeat_at') as session_columns
),
b1 as (
  select
    exists (select 1 from private.schema_migrations where version = '0008_billing') as recorded,
    exists (select 1 from pg_constraint where conname = 'subscriptions_status_check'
       and pg_get_constraintdef(oid) like '%past_due%') as statuses,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'subscriptions' and column_name = 'processor_updated_at') as sync_columns,
    exists (select 1 from public.legal_document_versions
       where document_key = 'automatic_renewal_terms' and version = 'v0.1' and status = 'published') as renewal_terms
),
b2 as (
  select
    exists (select 1 from private.schema_migrations where version = '0009_age_and_signup') as recorded,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'accounts' and column_name = 'date_of_birth') as dob_column,
    exists (select 1 from pg_constraint where conname = 'accounts_pending_is_learner') as pending_rule,
    exists (select 1 from pg_trigger where tgrelid = 'public.accounts'::regclass and tgname = 'check_account_age') as age_trigger,
    coalesce((select has_function_privilege('service_role', p, 'execute') and not has_function_privilege('anon', p, 'execute')
                     and not has_function_privilege('authenticated', p, 'execute')
              from to_regprocedure('public.support_change_date_of_birth(uuid, date)') p where p is not null), false) as dob_change_private,
    coalesce((select not has_column_privilege('authenticated', 'public.accounts', 'date_of_birth', 'select')
              where exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'accounts' and column_name = 'date_of_birth')), false) as dob_hidden,
    -- B3 replaces this index with guardian_relationships_one_of_record.
    exists (select 1 from pg_indexes where schemaname = 'public'
       and indexname in ('guardian_relationships_one_open_invite', 'guardian_relationships_one_of_record')) as guardian_invites,
    not exists (select 1 from public.accounts where status = 'pending' and role <> 'learner')
      and not exists (select 1 from public.accounts a where a.role in ('owner', 'admin')
                      and (a.is_minor or to_jsonb(a) ->> 'date_of_birth' is not null)) as staff_never_minor
),
b3 as (
  select
    exists (select 1 from private.schema_migrations where version = '0010_guardians') as recorded,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'accounts' and column_name = 'identity_status') as identity_columns,
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'guardian_relationships_one_of_record') as one_guardian,
    exists (select 1 from pg_constraint where conname = 'accounts_status_check' and pg_get_constraintdef(oid) like '%paused%') as paused,
    (select count(*) from public.legal_document_versions where status = 'published'
       and (document_key, version) in (('teen_terms', 'v0.2'), ('minor_privacy_notice', 'v0.2'))) = 2 as teen_documents
),
b4 as (
  select
    exists (select 1 from private.schema_migrations where version = '0011_notices_and_privacy') as recorded,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.privacy_requests') and tgname = 'privacy_request_not_owner') as owner_guard
)
select 0 as sort,
       case when (select count(*) from report where expected and table_exists and rls_on) = 47
             and not exists (select 1 from report where not expected)
             and (select triggers from insert_only) = 4
             and (select owner_triggers from f4) = 2 and (select invite_columns from f4) and (select recorded from f4)
             and (select recorded from f5) and (select chain_trigger from f5) and (select verifier from f5)
             and (select recorded from f6) and (select slot_claim from f6) and (select owner_guard from f6)
             and (select slot_claim_private from f6) and (select session_columns from f6)
             and (select recorded from b1) and (select statuses from b1) and (select sync_columns from b1)
             and (select renewal_terms from b1)
             and (select recorded from b2) and (select dob_column from b2) and (select pending_rule from b2)
             and (select age_trigger from b2) and (select dob_change_private from b2) and (select dob_hidden from b2)
             and (select guardian_invites from b2) and (select staff_never_minor from b2)
             and (select recorded from b3) and (select identity_columns from b3) and (select one_guardian from b3)
             and (select paused from b3) and (select teen_documents from b3)
             and (select recorded from b4) and (select owner_guard from b4)
            then 'OK: all 47 tables exist with row-level security on; audit_events and consent_records are insert-only; F4 admin invites and Owner protections are in place; F5 audit chain is in place; F6 devices, sessions and safeguards are in place; B1 billing is in place; B2 age rules and sign-up are in place; B3 Guardians are in place; B4 notices and privacy requests are in place'
            else 'PROBLEM: ' || (select count(*) from report where expected and not table_exists) || ' missing, '
                 || (select count(*) from report where table_exists and not rls_on) || ' without RLS, '
                 || (select count(*) from report where not expected) || ' unexpected, '
                 || (select triggers from insert_only) || '/4 insert-only triggers, '
                 || (select owner_triggers from f4) || '/2 Owner protection triggers, F4 '
                 || case when (select recorded from f4) then 'applied' else 'NOT applied' end
                 || ', F5 ' || case when (select recorded from f5) and (select chain_trigger from f5) and (select verifier from f5)
                                    then 'applied' else 'NOT applied' end
                 || ', F6 ' || case when (select recorded from f6) and (select slot_claim from f6) and (select owner_guard from f6)
                                         and (select slot_claim_private from f6) and (select session_columns from f6)
                                    then 'applied' else 'NOT applied' end
                 || ', B1 ' || case when (select recorded from b1) and (select statuses from b1) and (select sync_columns from b1)
                                         and (select renewal_terms from b1)
                                    then 'applied' else 'NOT applied' end
                 || ', B2 ' || case when (select recorded from b2) and (select dob_column from b2) and (select pending_rule from b2)
                                         and (select age_trigger from b2) and (select dob_change_private from b2)
                                         and (select dob_hidden from b2) and (select guardian_invites from b2)
                                    then 'applied' else 'NOT applied' end
                 || ', B3 ' || case when (select recorded from b3) and (select identity_columns from b3) and (select one_guardian from b3)
                                         and (select paused from b3) and (select teen_documents from b3)
                                    then 'applied' else 'NOT applied' end
                 || ', B4 ' || case when (select recorded from b4) and (select owner_guard from b4) then 'applied' else 'NOT applied' end
                 || case when (select staff_never_minor from b2) then '' else ', an Owner or admin is marked minor or pending' end
       end as table_name,
       null::boolean as table_exists, null::boolean as rls_on
union all
select case when expected then 1 else 2 end, table_name, table_exists, rls_on from report
order by sort, table_name;
