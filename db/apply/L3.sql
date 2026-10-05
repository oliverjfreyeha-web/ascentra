-- ASCENTRA L3: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0013_course_generation (already applied). Applies: 0014_freshness_cycle.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0014_freshness_cycle.sql
-- ============================================================

-- L3: the freshness cycle. A refresh never changes what learners see by itself: it re-checks a course's approved
-- sources, researches what has changed in the field, and writes a change report for a Reviewer. Only the edits a
-- Reviewer approves go into a NEW Draft lesson version, which then follows Draft -> Review -> Published (L2).
--   course_refresh: per course, the refresh interval (default 42 days, 30 to 60; the Owner changes it), when the
--   course was last verified, and its place in the nightly queue (queued, running, waiting for the spend cap, failed).
--   refresh_runs: one change report per run: source checks (ok, changed, gone, unreachable), newly found sources
--   (PROPOSED), lessons whose claims are now doubtful, a "market signal" note (plain, cited, no predictions), cost.
--   refresh_edits: suggested edits, each with citations; a Reviewer approves or rejects each one.
--   lesson_versions gains the refresh it came from and a short summary of what changed (for the learner's notice).
--   research_runs can be started by the scheduled job (no account).
-- Safe with the L2 code: nothing before L3 reads or writes these columns or tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0013_course_generation'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L2 (0013) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0014_freshness_cycle');

-- ============ Refresh settings and the queue ============

create table public.course_refresh (
  id                      uuid primary key default gen_random_uuid(),
  academy_id              uuid not null unique references public.academies (id),
  refresh_days            integer not null default 42 check (refresh_days between 30 and 60),
  -- When a Reviewer last closed a change report (or, before any refresh, when the course was first published).
  last_verified_at        timestamptz,
  queue_status            text not null default 'idle' check (queue_status in ('idle', 'queued', 'running', 'waiting_cap', 'failed')),
  queue_note              text check (char_length(queue_note) <= 500),
  queued_at               timestamptz,
  queued_by_account_id    uuid references public.accounts (id),
  last_run_at             timestamptz,
  updated_by_account_id   uuid references public.accounts (id),
  retention_class         public.retention_class not null default 'content',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ============ Change reports ============

create table public.refresh_runs (
  id                      uuid primary key default gen_random_uuid(),
  academy_id              uuid not null references public.academies (id),
  course_id               uuid references public.courses (id),
  trigger                 text not null check (trigger in ('scheduled', 'manual')),
  status                  text not null default 'running' check (status in ('running', 'ready', 'failed', 'reviewed')),
  since                   timestamptz,
  -- [{ sourceId, title, url, result: ok | changed | gone | unreachable, detail }]
  source_checks           jsonb not null default '[]' check (jsonb_typeof(source_checks) = 'array'),
  research_run_id         uuid references public.research_runs (id),
  new_source_ids          uuid[] not null default '{}',
  -- { pace: quick | moderate | stable | unclear, notes: [{ text, sources: [{ url, title }] }] }: observations, no predictions.
  market_signal           jsonb not null default '{}' check (jsonb_typeof(market_signal) = 'object'),
  -- [{ lessonId, lessonTitle, versionId, paragraph, text, kind, reason }]
  doubtful                jsonb not null default '[]' check (jsonb_typeof(doubtful) = 'array'),
  cost_usd                numeric(12, 6) not null default 0 check (cost_usd >= 0),
  error                   text check (char_length(error) <= 1000),
  started_by_account_id   uuid references public.accounts (id),
  started_at              timestamptz not null default now(),
  finished_at             timestamptz,
  reviewed_by_account_id  uuid references public.accounts (id),
  reviewed_at             timestamptz,
  review_note             text check (char_length(review_note) <= 1000),
  retention_class         public.retention_class not null default 'content',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint refresh_runs_reviewed check (status <> 'reviewed' or (reviewed_by_account_id is not null and reviewed_at is not null))
);
-- One change report waiting for review per course at a time.
create unique index refresh_runs_one_open on public.refresh_runs (academy_id) where status in ('running', 'ready');

create table public.refresh_edits (
  id                      uuid primary key default gen_random_uuid(),
  refresh_run_id          uuid not null references public.refresh_runs (id),
  lesson_id               uuid not null references public.lessons (id),
  base_version_id         uuid not null references public.lesson_versions (id),
  -- Where in the published version: "S1.P2" (section 1, paragraph 2) or "T1" (takeaway 1).
  location                text not null check (location ~ '^(S[0-9]+\.P[0-9]+|T[0-9]+)$'),
  old_text                text not null,
  new_text                text not null check (char_length(new_text) between 1 and 2000),
  -- [{ sourceId, title, url }]: every suggested edit is cited.
  sources                 jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) >= 1),
  reason                  text not null check (char_length(reason) <= 500),
  status                  text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected')),
  decided_by_account_id   uuid references public.accounts (id),
  decided_at              timestamptz,
  draft_version_id        uuid references public.lesson_versions (id),
  retention_class         public.retention_class not null default 'content',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint refresh_edits_decided check (status = 'suggested' or (decided_by_account_id is not null and decided_at is not null)),
  constraint refresh_edits_not_attorney check (new_text !~* 'attorney[- ]?approved|lawyer[- ]?approved')
);

-- A suggestion is decided once, by the Owner or a Reviewer; its text never changes.
create function private.refresh_edit_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ASCENTRA: suggested edits are kept.' using errcode = 'insufficient_privilege';
  end if;
  if (new.refresh_run_id, new.lesson_id, new.base_version_id, new.location, new.old_text, new.new_text, new.sources, new.reason)
     is distinct from (old.refresh_run_id, old.lesson_id, old.base_version_id, old.location, old.old_text, old.new_text, old.sources, old.reason) then
    raise exception 'ASCENTRA: a suggested edit isn''t changed; reject it instead.' using errcode = 'check_violation';
  end if;
  if old.status <> 'suggested' and new.status is distinct from old.status then
    raise exception 'ASCENTRA: this edit was already %.', old.status using errcode = 'check_violation';
  end if;
  if new.status <> old.status and not exists (
    select 1 from public.accounts a where a.id = new.decided_by_account_id and a.role in ('owner', 'admin') and a.status = 'active') then
    raise exception 'ASCENTRA: only the Owner or a Reviewer decides a suggested edit.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.refresh_edit_rules() from public;
create trigger refresh_edit_rules before update or delete on public.refresh_edits
  for each row execute function private.refresh_edit_rules();

-- ============ Lesson versions and research runs ============

alter table public.lesson_versions
  add column refresh_run_id uuid references public.refresh_runs (id),
  add column change_summary text check (char_length(change_summary) <= 500);

-- A refresh draft is rebuilt while it is a Draft; the L2 rules still hold (content fixed once it leaves Draft).
alter table public.research_runs
  alter column created_by_account_id drop not null,
  add column refresh_run_id uuid references public.refresh_runs (id);

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['course_refresh', 'refresh_runs', 'refresh_edits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

create index on public.course_refresh (queue_status);
create index on public.course_refresh (queued_by_account_id);
create index on public.course_refresh (updated_by_account_id);
create index on public.refresh_runs (course_id);
create index on public.refresh_runs (research_run_id);
create index on public.refresh_runs (started_by_account_id);
create index on public.refresh_runs (reviewed_by_account_id);
create index on public.refresh_edits (refresh_run_id);
create index on public.refresh_edits (lesson_id);
create index on public.refresh_edits (base_version_id);
create index on public.refresh_edits (decided_by_account_id);
create index on public.refresh_edits (draft_version_id);
create index on public.lesson_versions (refresh_run_id);
create index on public.research_runs (refresh_run_id);

commit;
