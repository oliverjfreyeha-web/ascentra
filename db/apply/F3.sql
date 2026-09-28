-- ASCENTRA F3: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0001_accounts (already applied). Applies: 0002_foundation, 0003_data_model, 0004_row_level_security.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0002_foundation.sql
-- ============================================================

-- F3: foundation for the data model.
-- Migration ledger, shared helpers, retention classes, and the identity-table changes
-- (accounts.is_minor, wider account roles, id/created_at/retention_class on the 0001 tables).
-- Requires 0001_accounts.sql.

do $$
begin
  if to_regclass('public.accounts') is null or to_regclass('public.profiles') is null then
    raise exception 'ASCENTRA: apply 0001_accounts.sql first (public.accounts and public.profiles are missing).';
  end if;
  if to_regclass('private.schema_migrations') is not null then
    raise exception 'ASCENTRA: migration 0002_foundation is already applied. Nothing was changed.';
  end if;
end $$;

-- Objects that must never be reachable through the Supabase Data API live in "private",
-- which is not an exposed schema.
create schema if not exists private;
revoke all on schema private from public;

create table private.schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);
revoke all on private.schema_migrations from public;

-- Every later migration starts with this. Re-running an applied migration stops with an
-- error before anything changes, so each migration can only ever apply once.
create function private.begin_migration(v text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from private.schema_migrations where version = v) then
    raise exception 'ASCENTRA: migration % is already applied. Nothing was changed.', v;
  end if;
  insert into private.schema_migrations (version) values (v);
end $$;
revoke all on function private.begin_migration(text) from public;

insert into private.schema_migrations (version) values ('0001_accounts');
select private.begin_migration('0002_foundation');

-- How long a row may be kept is decided per class. Durations are a counsel item and are
-- deliberately not set here; the class only groups rows that will share a rule.
create domain public.retention_class as text check (value in (
  'account',          -- identity, roles, preferences
  'security',         -- devices, sign-in and session activity
  'billing',          -- subscriptions, entitlements
  'legal_record',     -- consent, disclosures, legal document versions
  'minor_protection', -- guardian links and teen-specific records
  'content',          -- academies, courses, lessons, sources
  'learning',         -- progress, attempts, mastery, schedules
  'user_content',     -- notes, uploads, Mentor threads, submitted work
  'safety',           -- safety events
  'audit',            -- the audit trail
  'operational'       -- service status
));
comment on domain public.retention_class is
  'Retention category. Durations per class are set by counsel and are not defined yet.';

-- Keeps updated_at honest on every table.
create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.set_updated_at() from public;

-- Insert-only tables call this on UPDATE, DELETE and TRUNCATE. Triggers run for every role,
-- including service_role (which bypasses row-level security) and the table owner.
create function private.reject_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ASCENTRA: % is insert-only; % is not allowed.', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;
revoke all on function private.reject_change() from public;

-- accounts: minors, the wider set of account roles, retention class.
alter table public.accounts
  add column is_minor boolean not null default false,
  add column retention_class public.retention_class not null default 'account';

alter table public.accounts drop constraint accounts_role_check;
alter table public.accounts
  add constraint accounts_role_check check (role in ('owner', 'admin', 'learner', 'guardian')),
  -- Teen rules: a minor is never the Owner, an admin or a guardian.
  add constraint accounts_minor_role_check check (not is_minor or role = 'learner');

comment on column public.accounts.is_minor is 'True for teen learners (14 to 17). Teen rules key off this in queries.';
comment on column public.accounts.role is
  'owner: the one Owner. admin: invited staff; what they may do is in role_assignments. learner, guardian: F6+.';

-- profiles: an id and created_at like every other table. account_id stays the primary key.
alter table public.profiles
  add column id uuid not null default gen_random_uuid(),
  add column created_at timestamptz not null default now(),
  add column retention_class public.retention_class not null default 'account';
alter table public.profiles add constraint profiles_id_key unique (id);

create trigger set_updated_at before update on public.accounts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- ============================================================
-- 0003_data_model.sql
-- ============================================================

-- F3: the rest of the prototype's data model (reference/ascentra.html, DATA_MODEL, spec §18).
-- 37 tables. With accounts and profiles from 0001 that makes the prototype's 39 entities.
-- Every table: id, created_at, updated_at, retention_class. Row-level security is switched on
-- for all of them in 0004; until then nothing here is reachable through the Data API.
-- Values in check constraints come from the prototype (roles, plans, states, activity types).

select private.begin_migration('0003_data_model');

-- ============ Identity, roles and devices ============

create table public.role_assignments (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid references public.accounts (id),
  invited_email           text,
  role                    text not null check (role in ('course_admin', 'reviewer', 'support', 'super_admin')),
  -- Academy ids, 'all_learners' or 'platform', as in the prototype's scope lists.
  scope                   text[] not null default '{}',
  status                  text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  assigned_by_account_id  uuid not null references public.accounts (id),
  invited_at              timestamptz,
  accepted_at             timestamptz,
  revoked_at              timestamptz,
  retention_class         public.retention_class not null default 'account',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (account_id is not null or invited_email is not null)
);

create table public.guardian_relationships (
  id                    uuid primary key default gen_random_uuid(),
  guardian_account_id   uuid not null references public.accounts (id),
  teen_account_id       uuid not null references public.accounts (id),
  verification_status   text not null default 'pending' check (verification_status in ('pending', 'verified', 'failed')),
  authorized_at         timestamptz,
  withdrawn_at          timestamptz,
  withdrawal_reason     text,
  retention_class       public.retention_class not null default 'minor_protection',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (guardian_account_id, teen_account_id),
  check (guardian_account_id <> teen_account_id)
);

create table public.trusted_devices (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id),
  name             text not null,
  kind             text not null check (kind in ('laptop', 'desktop', 'phone', 'tablet', 'other')),
  trust_state      text not null default 'pending_verification'
                   check (trust_state in ('trusted', 'pending_verification', 'revoked')),
  approx_region    text,
  last_seen_at     timestamptz,
  revoked_at       timestamptz,
  retention_class  public.retention_class not null default 'security',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.session_events (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts (id),
  trusted_device_id  uuid references public.trusted_devices (id),
  event_type         text not null check (event_type in (
                       'sign_in', 'sign_out', 'sign_in_held', 'device_added', 'device_revoked',
                       'password_changed', 'second_factor_changed', 'recovery')),
  description        text not null,
  approx_region      text,
  occurred_at        timestamptz not null default now(),
  retention_class    public.retention_class not null default 'security',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ============ Billing ============

create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  payer_account_id          uuid not null references public.accounts (id),
  -- The learner who uses the plan; differs from the payer when a guardian pays for a teen.
  beneficiary_account_id    uuid not null references public.accounts (id),
  plan                      text not null check (plan in ('trial', 'basic', 'pro')),
  status                    text not null check (status in (
                              'trialing', 'active', 'downgrade_scheduled', 'payment_failed', 'canceled', 'expired')),
  pending_plan              text check (pending_plan in ('basic', 'pro')),
  started_at                timestamptz not null,
  trial_ends_at             timestamptz,
  first_charge_at           timestamptz,
  renews_at                 timestamptz,
  paid_through_at           timestamptz,
  canceled_at               timestamptz,
  -- The payment processor's id. Card details stay with the processor.
  processor_subscription_id text unique,
  retention_class           public.retention_class not null default 'billing',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table public.legal_document_versions (
  id               uuid primary key default gen_random_uuid(),
  document_key     text not null,   -- e.g. 'general_terms', 'trial_disclosure', 'guardian_consent'
  title            text not null,
  version          text not null,   -- e.g. 'v0.1'
  status           text not null default 'draft' check (status in ('draft', 'counsel_review', 'published', 'superseded')),
  audience         text[] not null default '{}',
  summary          text,
  body             text,
  published_at     timestamptz,
  retention_class  public.retention_class not null default 'legal_record',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (document_key, version)
);

create table public.trial_consents (
  id                                 uuid primary key default gen_random_uuid(),
  subscription_id                    uuid not null references public.subscriptions (id),
  account_id                         uuid not null references public.accounts (id),
  disclosure_document_version_id     uuid not null references public.legal_document_versions (id),
  -- What the renewal disclosure said, as shown.
  trial_ends_at                      timestamptz not null,
  first_charge_at                    timestamptz not null,
  first_charge_amount_cents          integer not null check (first_charge_amount_cents >= 0),
  currency                           text not null default 'USD',
  disclosed_at                       timestamptz not null,
  reminder_scheduled_for             timestamptz,
  reminder_sent_at                   timestamptz,
  retention_class                    public.retention_class not null default 'legal_record',
  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now()
);

-- The result of the prototype's entitlement(): what an account may use, and why.
create table public.entitlements (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  source            text not null check (source in ('subscription', 'owner', 'admin_designated', 'guardian_paid')),
  subscription_id   uuid references public.subscriptions (id),
  tier              text not null check (tier in ('trial', 'basic', 'pro', 'full')),
  valid_from        timestamptz not null,
  valid_until       timestamptz,
  computed_at       timestamptz not null default now(),
  retention_class   public.retention_class not null default 'billing',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((source in ('subscription', 'guardian_paid')) = (subscription_id is not null))
);

-- ============ Content ============

create table public.academies (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  name                 text not null,
  parent_name          text,             -- e.g. 'Founders Academy'
  owner_account_id     uuid references public.accounts (id),
  is_learner_built     boolean not null default false,
  is_protected_owner   boolean not null default false,
  import_state         text not null default 'native' check (import_state in ('native', 'represented', 'imported')),
  outcome              text,
  estimate             text,
  cadence              text,
  grouping             text check (grouping in ('week', 'module')),
  retention_class      public.retention_class not null default 'content',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One row per course version. States from the prototype's course builder.
create table public.courses (
  id                        uuid primary key default gen_random_uuid(),
  academy_id                uuid not null references public.academies (id),
  version                   integer not null check (version >= 1),
  status                    text not null default 'draft'
                            check (status in ('draft', 'review', 'published', 'archived', 'restored')),
  summary                   text,
  restored_from_version     integer,
  created_by_account_id     uuid references public.accounts (id),
  submitted_for_review_at   timestamptz,
  published_at              timestamptz,
  archived_at               timestamptz,
  retention_class           public.retention_class not null default 'content',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (academy_id, version),
  check ((status = 'restored') = (restored_from_version is not null)),
  check (restored_from_version is null or restored_from_version < version)
);

create table public.academy_blueprints (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts (id),
  academy_id           uuid references public.academies (id),
  status               text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  onboarding_answers   jsonb not null default '{}',
  outcome              text,
  rationale            text,
  starting_point       text,
  schedule_summary     text,
  projects             text[] not null default '{}',
  capstone_summary     text,
  sources_summary      text,
  alternates           text[] not null default '{}',
  approved_at          timestamptz,
  retention_class      public.retention_class not null default 'learning',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.modules (
  id                       uuid primary key default gen_random_uuid(),
  course_id                uuid not null references public.courses (id) on delete cascade,
  position                 integer not null check (position >= 1),
  code                     text not null,   -- e.g. 'k1'
  title                    text not null,
  stage                    text,            -- e.g. 'Foundations', 'Application'
  prerequisite_module_ids  uuid[] not null default '{}',
  -- A module opens at this score on the previous module's check (prototype: 80%).
  unlock_threshold_percent integer not null default 80 check (unlock_threshold_percent between 0 and 100),
  retention_class          public.retention_class not null default 'content',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (course_id, position),
  unique (course_id, code)
);

create table public.lessons (
  id                uuid primary key default gen_random_uuid(),
  module_id         uuid not null references public.modules (id) on delete cascade,
  position          integer not null check (position >= 1),
  title             text not null,
  minutes           integer check (minutes > 0),
  objectives        text[] not null default '{}',
  content           jsonb not null default '{}',   -- explanation, checks, cards
  retention_class   public.retention_class not null default 'content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (module_id, position)
);

create table public.skills (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references public.courses (id) on delete cascade,
  module_id         uuid references public.modules (id),
  key               text not null,   -- e.g. 'response'
  name              text not null,
  retention_class   public.retention_class not null default 'content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (course_id, key)
);

create table public.sources (
  id                uuid primary key default gen_random_uuid(),
  academy_id        uuid not null references public.academies (id),
  title             text not null,
  source_type       text not null,           -- e.g. 'Primary · operator survey'
  published_year    smallint,
  url               text,
  health            text not null default 'current' check (health in ('current', 'dated', 'retired')),
  indicators        text[] not null default '{}',
  is_sample         boolean not null default false,
  retention_class   public.retention_class not null default 'content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.source_claims (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.sources (id),
  lesson_id         uuid references public.lessons (id),
  claim             text not null,
  state             text not null default 'proposed' check (state in ('approved', 'proposed', 'prohibited', 'expired')),
  expires_at        timestamptz,
  retention_class   public.retention_class not null default 'content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.source_conflicts (
  id                      uuid primary key default gen_random_uuid(),
  academy_id              uuid not null references public.academies (id),
  lesson_id               uuid references public.lessons (id),
  claim_a_id              uuid not null references public.source_claims (id),
  claim_b_id              uuid not null references public.source_claims (id),
  reasons                 text[] not null default '{}',   -- why the claims disagree
  recommended_claim_id    uuid references public.source_claims (id),
  recommendation_rationale text,
  status                  text not null default 'open' check (status in ('open', 'resolved')),
  retention_class         public.retention_class not null default 'content',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (claim_a_id <> claim_b_id)
);

-- Versioned: a changed decision is a new row with the next version, never an edit.
create table public.authority_decisions (
  id                     uuid primary key default gen_random_uuid(),
  source_conflict_id     uuid not null references public.source_conflicts (id),
  version                integer not null check (version >= 1),
  chosen_claim_id        uuid references public.source_claims (id),
  decision               text not null,
  rationale              text not null,
  decided_by_account_id  uuid not null references public.accounts (id),
  decided_at             timestamptz not null default now(),
  retention_class        public.retention_class not null default 'content',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (source_conflict_id, version)
);

-- ============ Learning ============

create table public.learning_activities (
  id                       uuid primary key default gen_random_uuid(),
  lesson_id                uuid not null references public.lessons (id) on delete cascade,
  position                 integer not null check (position >= 1),
  activity_type            text not null check (activity_type in (
                             'explainer', 'watch', 'quiz', 'lab', 'assignment', 'flashcards', 'review')),
  pass_threshold_percent   integer check (pass_threshold_percent between 0 and 100),
  content                  jsonb not null default '{}',
  retention_class          public.retention_class not null default 'content',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (lesson_id, position)
);

create table public.assessment_attempts (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts (id),
  learning_activity_id   uuid not null references public.learning_activities (id),
  attempt_number         integer not null check (attempt_number >= 1),
  answers                jsonb not null default '{}',
  score_percent          integer check (score_percent between 0 and 100),
  passed                 boolean,
  submitted_at           timestamptz not null default now(),
  retention_class        public.retention_class not null default 'learning',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (account_id, learning_activity_id, attempt_number)
);

create table public.assignments (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts (id),
  learning_activity_id   uuid not null references public.learning_activities (id),
  version                integer not null check (version >= 1),
  status                 text not null default 'draft' check (status in ('draft', 'submitted', 'passed', 'needs_revision')),
  content                jsonb not null default '{}',
  results                jsonb,
  submitted_at           timestamptz,
  retention_class        public.retention_class not null default 'user_content',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (account_id, learning_activity_id, version)
);

create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  academy_id        uuid not null references public.academies (id),
  title             text not null,
  is_major          boolean not null default false,
  status            text not null default 'not_started'
                    check (status in ('not_started', 'in_progress', 'submitted', 'complete')),
  content           jsonb not null default '{}',
  submitted_at      timestamptz,
  retention_class   public.retention_class not null default 'user_content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.capstones (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts (id),
  academy_id           uuid not null references public.academies (id),
  title                text not null,
  status               text not null default 'draft' check (status in ('draft', 'submitted', 'scored')),
  draft                jsonb not null default '{}',
  submitted_at         timestamptz,
  rubric_scores        jsonb,          -- per criterion, from the six-part rubric
  total_score          integer check (total_score between 0 and 100),
  -- Mentor hints on the capstone lower the independence score.
  mentor_hint_count    integer not null default 0 check (mentor_hint_count >= 0),
  scored_at            timestamptz,
  retention_class      public.retention_class not null default 'user_content',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.review_items (
  id                         uuid primary key default gen_random_uuid(),
  subject_type               text not null check (subject_type in ('assignment', 'project', 'capstone', 'course_version')),
  subject_id                 uuid not null,
  submitted_by_account_id    uuid not null references public.accounts (id),
  reviewer_account_id        uuid references public.accounts (id),
  decision                   text not null default 'pending'
                             check (decision in ('pending', 'approved', 'changes_requested', 'rejected')),
  feedback                   text,
  criteria                   jsonb,
  decided_at                 timestamptz,
  retention_class            public.retention_class not null default 'learning',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table public.schedules (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id),
  academy_id            uuid not null references public.academies (id),
  sessions_per_week     integer check (sessions_per_week between 1 and 14),
  minutes_per_session   integer check (minutes_per_session > 0),
  availability          jsonb not null default '{}',
  target_finish_on      date,
  state                 text not null default 'on_track'
                        check (state in ('on_track', 'missed_three_days', 'missed_week', 'overloaded')),
  catch_up_choice       text check (catch_up_choice in ('extend', 'reduce', 'redistribute', 'pause')),
  retention_class       public.retention_class not null default 'learning',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (account_id, academy_id)
);

create table public.progress_records (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  module_id         uuid not null references public.modules (id),
  lesson_id         uuid references public.lessons (id),
  status            text not null default 'locked' check (status in ('locked', 'available', 'in_progress', 'complete')),
  percent           integer not null default 0 check (percent between 0 and 100),
  completed_at      timestamptz,
  retention_class   public.retention_class not null default 'learning',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The five mastery measures.
create table public.mastery_records (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  skill_id          uuid not null references public.skills (id),
  exposure          integer not null default 0 check (exposure between 0 and 100),
  recall            integer not null default 0 check (recall between 0 and 100),
  application       integer not null default 0 check (application between 0 and 100),
  retention         integer not null default 0 check (retention between 0 and 100),
  independence      integer not null default 0 check (independence between 0 and 100),
  measured_at       timestamptz not null default now(),
  retention_class   public.retention_class not null default 'learning',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (account_id, skill_id)
);

-- Spaced-review card state.
create table public.retention_signals (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts (id),
  lesson_id           uuid not null references public.lessons (id),
  card_key            text not null,
  interval_days       integer not null default 1 check (interval_days >= 0),
  due_at              timestamptz not null,
  last_reviewed_at    timestamptz,
  last_result         text check (last_result in ('again', 'hard', 'good', 'easy')),
  review_count        integer not null default 0 check (review_count >= 0),
  retention_class     public.retention_class not null default 'learning',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (account_id, lesson_id, card_key)
);

-- ============ Learner content ============

-- Private to the learner: never shown to guardians or staff.
create table public.mentor_threads (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  academy_id        uuid references public.academies (id),
  context           text,
  messages          jsonb not null default '[]',
  retention_class   public.retention_class not null default 'user_content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.notes (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  lesson_id         uuid references public.lessons (id),
  kind              text not null check (kind in ('note', 'highlight', 'bookmark', 'saved_explanation')),
  body              text,
  anchor            jsonb,
  retention_class   public.retention_class not null default 'user_content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.uploads (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  purpose           text not null,
  file_name         text not null,
  content_type      text not null,
  size_bytes        bigint not null check (size_bytes >= 0),
  storage_path      text unique,
  status            text not null default 'pending' check (status in ('pending', 'stored', 'failed', 'removed')),
  visibility        text not null default 'private' check (visibility in ('private')),
  retention_class   public.retention_class not null default 'user_content',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.world_preferences (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null unique references public.accounts (id),
  world             text not null default 'observatory'
                    check (world in ('observatory', 'library', 'citadel', 'rainlit', 'forest', 'aurora', 'obsidian')),
  motion            text not null default 'balanced' check (motion in ('full', 'balanced', 'low', 'static')),
  sound_on          boolean not null default false,
  high_contrast     boolean not null default false,
  auto_calm         boolean not null default true,
  retention_class   public.retention_class not null default 'account',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.notification_preferences (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null unique references public.accounts (id),
  in_app                boolean not null default true,
  email                 boolean not null default false,
  weekly_reminder       boolean not null default true,
  reminder_before_due   boolean not null default false,
  retention_class       public.retention_class not null default 'account',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============ Records that must not change ============

-- Insert-only (0004). Withdrawing consent is a new row with status 'withdrawn'.
create table public.consent_records (
  id                           uuid primary key default gen_random_uuid(),
  account_id                   uuid not null references public.accounts (id),          -- whose consent this is
  actor_account_id             uuid not null references public.accounts (id),          -- who acted (a guardian for a teen)
  relation                     text not null check (relation in ('self', 'guardian_for_teen')),
  legal_document_version_id    uuid not null references public.legal_document_versions (id),
  status                       text not null check (status in ('given', 'withdrawn')),
  method                       text not null,   -- e.g. 'Checkbox and Start trial button'
  consented_at                 timestamptz not null default now(),
  retention_class              public.retention_class not null default 'legal_record',
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check ((relation = 'self') = (account_id = actor_account_id))
);

-- Category, reason and actions only. Conversation content is never stored here.
create table public.safety_events (
  id                            uuid primary key default gen_random_uuid(),
  subject_account_id            uuid not null references public.accounts (id),
  category                      text not null,
  reason                        text not null,
  actions_taken                 text[] not null default '{}',
  severity                      text not null default 'standard' check (severity in ('standard', 'urgent')),
  guardian_disclosed_at         timestamptz,
  acknowledged_by_account_id    uuid references public.accounts (id),
  acknowledged_at               timestamptz,
  retention_class               public.retention_class not null default 'safety',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- Insert-only (0004). Mirrors the prototype's audit timeline columns.
create table public.audit_events (
  id                 uuid primary key default gen_random_uuid(),
  occurred_at        timestamptz not null default now(),
  actor_account_id   uuid references public.accounts (id),   -- null for the system
  actor_label        text not null,                          -- e.g. 'Oliver (Owner)', 'Trust and Safety'
  action             text not null,
  context            text,
  target_type        text,
  target_id          text,
  previous_value     text,
  new_value          text,
  reason             text,
  result             text not null default 'completed' check (result in ('completed', 'blocked')),
  status             text not null default 'recorded',
  is_sensitive       boolean not null default false,
  retention_class    public.retention_class not null default 'audit',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ============ Operations ============

create table public.connection_statuses (
  id                uuid primary key default gen_random_uuid(),
  service           text not null unique,
  status            text not null default 'disconnected' check (status in ('disconnected', 'connected', 'verified')),
  evidence          text,
  reason            text,
  checked_at        timestamptz,
  retention_class   public.retention_class not null default 'operational',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Connected or Verified only with evidence from a real check.
  check (status = 'disconnected' or (evidence is not null and checked_at is not null))
);

-- ============ Shared behaviour ============

-- updated_at on every new table.
do $$
declare t text;
begin
  foreach t in array array[
    'role_assignments', 'guardian_relationships', 'trusted_devices', 'session_events', 'subscriptions',
    'legal_document_versions', 'trial_consents', 'entitlements', 'academies', 'courses', 'academy_blueprints', 'modules',
    'lessons', 'skills', 'sources', 'source_claims', 'source_conflicts', 'authority_decisions',
    'learning_activities', 'assessment_attempts', 'assignments', 'projects', 'capstones', 'review_items',
    'schedules', 'progress_records', 'mastery_records', 'retention_signals', 'mentor_threads', 'notes',
    'uploads', 'world_preferences', 'notification_preferences', 'consent_records', 'safety_events',
    'audit_events', 'connection_statuses'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- An index for every foreign key column that doesn't already lead an index.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col, c.conrelid as relid, c.conkey[1] as attnum
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
  loop
    if not exists (select 1 from pg_index i where i.indrelid = r.relid and i.indkey[0] = r.attnum) then
      execute format('create index on %s (%I)', r.tbl, r.col);
    end if;
  end loop;
end $$;

-- ============================================================
-- 0004_row_level_security.sql
-- ============================================================

-- F3: row-level security.
-- Deny is the default everywhere: RLS on for every table in public, nothing granted to anon or
-- authenticated. The only policies are for the identity tables in use now (accounts, profiles):
-- a signed-in person may read their own rows, and nothing else. Every other table stays
-- deny-all until its phase adds policies.
-- consent_records and audit_events are insert-only for everyone, service_role included.

select private.begin_migration('0004_row_level_security');

-- ============ Deny by default ============

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Supabase grants anon and authenticated full access to new tables by default. Remove that for
-- tables and sequences this role creates later, so a future table starts with no access at all.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ============ Who is asking ============

-- The caller's Account, from the Supabase JWT. With Clerk as Supabase's third-party auth
-- provider, "sub" is the Clerk user id. Security definer so it can look up accounts without
-- opening accounts to the caller; it only ever returns the caller's own id (or null).
create function private.current_account_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.accounts a
  where a.clerk_user_id = (auth.jwt() ->> 'sub')
    and a.status = 'active'
$$;
revoke all on function private.current_account_id() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_account_id() to authenticated;

-- ============ Identity tables: read your own row ============

-- Only these accounts columns are readable, and only in the caller's own row.
grant select (id, email, email_verified, role, is_minor, status, created_at, updated_at)
  on public.accounts to authenticated;
create policy accounts_select_own on public.accounts
  for select to authenticated
  using (id = (select private.current_account_id()));

grant select on public.profiles to authenticated;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- ============ Insert-only records ============
-- Three layers, so each holds on its own:
--   1. no UPDATE, DELETE or TRUNCATE privilege for any API role, service_role included;
--   2. restrictive policies that refuse every UPDATE and DELETE;
--   3. triggers that raise on UPDATE, DELETE and TRUNCATE. Triggers fire for service_role
--      (which bypasses RLS) and for the table owner too.

do $$
declare t text;
begin
  foreach t in array array['consent_records', 'audit_events'] loop
    execute format('revoke update, delete, truncate on public.%I from anon, authenticated, service_role', t);
    execute format('create policy %I on public.%I as restrictive for update using (false) with check (false)',
                   t || '_no_update', t);
    execute format('create policy %I on public.%I as restrictive for delete using (false)', t || '_no_delete', t);
    execute format('create trigger reject_update_delete before update or delete on public.%I
                    for each row execute function private.reject_change()', t);
    execute format('create trigger reject_truncate before truncate on public.%I
                    for each statement execute function private.reject_change()', t);
  end loop;
end $$;

commit;
