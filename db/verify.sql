-- Run in the Supabase SQL Editor after applying the migrations (F3, F4, F5, F6, B1, B2, B3, B4, L1, L2, L3, L4, L5, L6, L7, L8, C1, C2 and I1).
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
  ('notices'), ('privacy_requests'),
  -- L1: source chunks for search, the Owner's open-license list, the AI call log.
  ('source_chunks'), ('open_license_sources'), ('ai_calls'),
  -- L2: research runs and lesson versions.
  ('research_runs'), ('lesson_versions'),
  -- L3: refresh settings and queue, change reports, suggested edits.
  ('course_refresh'), ('refresh_runs'), ('refresh_edits'),
  -- L4: Mentor message counts per day.
  ('mentor_daily_usage'),
  -- L5: the Mentor allowance per billing period, and its ledger.
  ('mentor_allowance_periods'), ('mentor_allowance_usage'),
  -- L6: the topic catalog, the batch queue, the activity library and its attempts.
  ('catalog_topics'), ('catalog_jobs'), ('activity_items'), ('activity_attempts'),
  -- L7: the interview, the personalized path, and the anonymous course requests.
  ('learner_interviews'), ('learner_paths'), ('learner_path_items'), ('course_requests'),
  -- L8: topics to pick, learners' picks, anonymous demand per topic per day.
  ('topics'), ('learner_picks'), ('topic_interest'),
  -- C1: learning boosters, video slots and uploads, the Owner's module reviews.
  ('booster_types'), ('video_slots'), ('video_uploads'), ('module_reviews'),
  -- C2: notices seen, course capstones, completions, trial bonuses, the Notebook, state, missions, community links.
  ('course_notice_views'), ('course_capstones'), ('item_completions'), ('trial_bonuses'), ('notebook_entries'),
  ('account_regions'), ('mission_state_allowlist'), ('mission_approvals'), ('community_settings')
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
),
l1 as (
  select
    exists (select 1 from private.schema_migrations where version = '0012_source_library') as recorded,
    exists (select 1 from pg_extension where extname = 'vector') as pgvector,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'source_chunks' and column_name = 'embedding') as embeddings,
    coalesce((select not has_function_privilege('anon', p, 'execute') and not has_function_privilege('authenticated', p, 'execute')
              from to_regprocedure('public.match_source_chunks(text, text, integer)') p where p is not null), false) as retrieval_private,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.authority_decisions') and tgname = 'reject_update_delete') as decisions_insert_only
),
l2 as (
  select
    exists (select 1 from private.schema_migrations where version = '0013_course_generation') as recorded,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.lesson_versions') and tgname = 'lesson_version_rules') as review_rules,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.progress_records') and tgname = 'progress_version_rules') as progress_rule,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'academy_blueprints' and column_name = 'plan') as blueprint_plan
),
l3 as (
  select
    exists (select 1 from private.schema_migrations where version = '0014_freshness_cycle') as recorded,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.refresh_edits') and tgname = 'refresh_edit_rules') as edit_rules,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'lesson_versions' and column_name = 'change_summary') as change_summary
),
l4 as (
  select
    exists (select 1 from private.schema_migrations where version = '0015_mentor_and_safety') as recorded,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.safety_events') and tgname = 'safety_event_rules') as safety_rules,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'mentor_threads' and column_name = 'lesson_id') as mentor_threads
),
l5 as (
  select
    exists (select 1 from private.schema_migrations where version = '0016_mentor_allowance') as recorded,
    exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'subscriptions' and column_name = 'mentor_addon_cents') as addon_column,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.mentor_allowance_usage') and tgname = 'mentor_usage_is_kept') as ledger_kept,
    exists (select 1 from public.legal_document_versions where document_key = 'mentor_allowance_terms' and version = 'v0.1' and status = 'published') as terms
),
l6 as (
  select
    exists (select 1 from private.schema_migrations where version = '0017_activity_library') as recorded,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.activity_items') and tgname = 'activity_item_rules') as item_rules,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.activity_attempts') and tgname = 'activity_attempt_rules') as attempt_rules,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'publish_module_activities') as variety_rule
),
l7 as (
  select
    exists (select 1 from private.schema_migrations where version = '0018_interview_and_path') as recorded,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.learner_path_items') and tgname = 'path_item_published') as published_only,
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_requests'
                and column_name like '%account%' and column_name <> 'decided_by_account_id') as anonymous
),
l8 as (
  select
    exists (select 1 from private.schema_migrations where version = '0019_topics_and_picks') as recorded,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('pick_topic', 'pause_pick', 'reconcile_picks', 'owner_set_business')) = 4 as plan_rules,
    to_regclass('public.learner_picks_one_business') is not null as one_business,
    coalesce(not has_table_privilege('service_role', to_regclass('public.learner_picks'), 'INSERT')
      and not has_table_privilege('service_role', to_regclass('public.learner_picks'), 'UPDATE')
      and not has_table_privilege('service_role', to_regclass('public.topic_interest'), 'INSERT'), false) as functions_only,
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'topic_interest'
                and (column_name like '%account%' or column_name like '%user%')) as anonymous,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'path_style') as answers,
    -- Read through query_to_xml so this file still runs on a database without L8.
    case when to_regclass('public.topics') is null then false
         else (xpath('/row/n/text()', query_to_xml('select (count(*) filter (where kind in (''business'', ''side_hustle'')) >= 24
           and count(*) filter (where kind = ''skill'') >= 16)::int as n from public.topics', false, true, '')))[1]::text = '1' end as seeded
),
c1 as (
  select
    exists (select 1 from private.schema_migrations where version = '0020_course_structure') as recorded,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'courses' and column_name = 'owner_review_required') as owner_review,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.lesson_versions') and tgname = 'a_owner_review_lessons')
      and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.activity_items') and tgname = 'a_owner_review_items') as owner_gate,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.module_reviews') and tgname = 'reject_update_delete') as reviews_kept,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'topics' and column_name = 'catalog_slug') as topic_link,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('accept_video_upload', 'new_course_version', 'reorder_modules', 'reorder_lessons')) = 4 as editor
),
c2 as (
  select
    exists (select 1 from private.schema_migrations where version = '0021_progress_and_paths') as recorded,
    -- Read through query_to_xml so this file still runs on a database without C2.
    case when to_regclass('private.c2_moved_topics') is null then false
         else (xpath('/row/n/text()', query_to_xml('select (count(*) filter (where kind = ''side_hustle'') >= 12)::int as n from public.topics', false, true, '')))[1]::text = '1' end as side_hustles,
    to_regclass('public.learner_picks_one_side_hustle') is not null as one_side_hustle,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'courses' and column_name = 'size_tier') as size_tiers,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.module_reviews') and tgname = 'a_module_review_labels')
      and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.activity_items') and tgname = 'activity_item_label_rules') as labels,
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.item_completions') and tgname = 'item_completions_kept') as completions_kept,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('record_item_completion', 'leaderboard_adults', 'learner_progress_totals', 'owner_set_pick')) = 4 as functions
),
i1 as (
  select
    exists (select 1 from private.schema_migrations where version = '0022_course_import') as recorded,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'import_course'
              and p.prosecdef) as importer,
    -- Only the server may run it: not anon, not a signed-in browser.
    not coalesce((select has_function_privilege('authenticated', 'public.import_course(uuid, jsonb)', 'execute')
                  where to_regprocedure('public.import_course(uuid, jsonb)') is not null), false)
      and not coalesce((select has_function_privilege('anon', 'public.import_course(uuid, jsonb)', 'execute')
                  where to_regprocedure('public.import_course(uuid, jsonb)') is not null), false) as server_only
)
select 0 as sort,
       case when (select count(*) from report where expected and table_exists and rls_on) = 82
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
             and (select recorded from l1) and (select pgvector from l1) and (select embeddings from l1)
             and (select retrieval_private from l1) and (select decisions_insert_only from l1)
             and (select recorded from l2) and (select review_rules from l2) and (select progress_rule from l2) and (select blueprint_plan from l2)
             and (select recorded from l3) and (select edit_rules from l3) and (select change_summary from l3)
             and (select recorded from l4) and (select safety_rules from l4) and (select mentor_threads from l4)
             and (select recorded from l5) and (select addon_column from l5) and (select ledger_kept from l5) and (select terms from l5)
             and (select recorded from l6) and (select item_rules from l6) and (select attempt_rules from l6) and (select variety_rule from l6)
             and (select recorded from l7) and (select published_only from l7) and (select anonymous from l7)
             and (select recorded from l8) and (select plan_rules from l8) and (select one_business from l8)
             and (select functions_only from l8) and (select anonymous from l8) and (select answers from l8) and (select seeded from l8)
             and (select recorded from c1) and (select owner_review from c1) and (select owner_gate from c1) and (select reviews_kept from c1)
             and (select topic_link from c1) and (select editor from c1)
             and (select recorded from c2) and (select side_hustles from c2) and (select one_side_hustle from c2) and (select size_tiers from c2)
             and (select labels from c2) and (select completions_kept from c2) and (select functions from c2)
             and (select recorded from i1) and (select importer from i1) and (select server_only from i1)
            then 'OK: all 82 tables exist with row-level security on; audit_events and consent_records are insert-only; F4 admin invites and Owner protections are in place; F5 audit chain is in place; F6 devices, sessions and safeguards are in place; B1 billing is in place; B2 age rules and sign-up are in place; B3 Guardians are in place; B4 notices and privacy requests are in place; L1 source library is in place; L2 course generation and review are in place; L3 freshness cycle is in place; L4 Mentor and safety checks are in place; L5 Mentor allowance is in place; L6 topic catalog and activity library are in place; L7 interview and personalized path are in place; L8 topics and picks are in place; C1 course structure and Owner review are in place; C2 progress, side hustles and unlock rules are in place; I1 course import is in place'
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
                 || ', L1 ' || case when (select recorded from l1) and (select pgvector from l1) and (select embeddings from l1)
                                         and (select retrieval_private from l1) and (select decisions_insert_only from l1)
                                    then 'applied' else 'NOT applied' end
                 || ', L2 ' || case when (select recorded from l2) and (select review_rules from l2) and (select progress_rule from l2)
                                         and (select blueprint_plan from l2)
                                    then 'applied' else 'NOT applied' end
                 || ', L3 ' || case when (select recorded from l3) and (select edit_rules from l3) and (select change_summary from l3)
                                    then 'applied' else 'NOT applied' end
                 || ', L4 ' || case when (select recorded from l4) and (select safety_rules from l4) and (select mentor_threads from l4)
                                    then 'applied' else 'NOT applied' end
                 || ', L5 ' || case when (select recorded from l5) and (select addon_column from l5) and (select ledger_kept from l5)
                                         and (select terms from l5)
                                    then 'applied' else 'NOT applied' end
                 || ', L6 ' || case when (select recorded from l6) and (select item_rules from l6) and (select attempt_rules from l6)
                                         and (select variety_rule from l6)
                                    then 'applied' else 'NOT applied' end
                 || ', L7 ' || case when (select recorded from l7) and (select published_only from l7) and (select anonymous from l7)
                                    then 'applied' else 'NOT applied' end
                 || ', L8 ' || case when (select recorded from l8) and (select plan_rules from l8) and (select one_business from l8)
                                         and (select functions_only from l8) and (select anonymous from l8) and (select answers from l8)
                                         and (select seeded from l8)
                                    then 'applied' else 'NOT applied' end
                 || ', C1 ' || case when (select recorded from c1) and (select owner_review from c1) and (select owner_gate from c1)
                                         and (select reviews_kept from c1) and (select topic_link from c1) and (select editor from c1)
                                    then 'applied' else 'NOT applied' end
                 || ', C2 ' || case when (select recorded from c2) and (select side_hustles from c2) and (select one_side_hustle from c2)
                                         and (select size_tiers from c2) and (select labels from c2) and (select completions_kept from c2)
                                         and (select functions from c2)
                                    then 'applied' else 'NOT applied' end
                 || ', I1 ' || case when (select recorded from i1) and (select importer from i1) and (select server_only from i1)
                                    then 'applied' else 'NOT applied' end
                 || case when (select staff_never_minor from b2) then '' else ', an Owner or admin is marked minor or pending' end
       end as table_name,
       null::boolean as table_exists, null::boolean as rls_on
union all
select case when expected then 1 else 2 end, table_name, table_exists, rls_on from report
order by sort, table_name;
