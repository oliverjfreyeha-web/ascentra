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
