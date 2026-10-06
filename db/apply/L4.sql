-- ASCENTRA L4: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0014_freshness_cycle (already applied). Applies: 0015_mentor_and_safety.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0015_mentor_and_safety.sql
-- ============================================================

-- L4: the Mentor and safety checks.
--   mentor_threads (F3) become the learner's private Mentor conversations: tied to a lesson of a course, paused after
--   a safety response. The conversation text lives ONLY here (messages). Nothing else stores it: not the AI call log,
--   not the audit log, not safety events. Learners can delete their own threads.
--   mentor_daily_usage: how many Mentor messages an account sent each day (for the daily cap). Counts only.
--   safety_events (F3) become the safety review queue: where the check fired (input or output), the category, what was
--   done, the Guardian-alert policy applied (a counsel placeholder), and the review. Never the message text. A teen's
--   urgent event goes to the front of the queue. Events are kept: only the review fields change, once.
-- Safe with the L3 code: nothing before L4 reads or writes these columns or tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0014_freshness_cycle'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L3 (0014) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0015_mentor_and_safety');

-- ============ Mentor threads ============

alter table public.mentor_threads
  add column lesson_id uuid references public.lessons (id),
  add column course_id uuid references public.courses (id),
  add column title text check (char_length(title) <= 120),
  add column status text not null default 'open' check (status in ('open', 'paused')),
  add column message_count integer not null default 0 check (message_count >= 0),
  add column last_message_at timestamptz,
  add constraint mentor_threads_messages_array check (jsonb_typeof(messages) = 'array');
create index on public.mentor_threads (account_id, lesson_id);
create index on public.mentor_threads (lesson_id);
create index on public.mentor_threads (course_id);

-- ============ Daily message counts ============

create table public.mentor_daily_usage (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  day               date not null,
  messages          integer not null default 0 check (messages >= 0),
  retention_class   public.retention_class not null default 'operational',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (account_id, day)
);

-- Counts one message, atomically, and returns the day's new total. Only the API (service_role) calls it.
create function public.count_mentor_message(p_account uuid, p_day date) returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.mentor_daily_usage (account_id, day, messages) values (p_account, p_day, 1)
  on conflict (account_id, day) do update set messages = public.mentor_daily_usage.messages + 1, updated_at = now()
  returning messages;
$$;
revoke all on function public.count_mentor_message(uuid, date) from public, anon, authenticated;
grant execute on function public.count_mentor_message(uuid, date) to service_role;

-- ============ Safety events: the review queue ============

alter table public.safety_events
  add column source text not null default 'mentor' check (source in ('mentor')),
  add column stage text check (stage in ('input', 'output')),
  add column is_minor boolean not null default false,
  -- 0: a teen's urgent event (front of the queue), 1: urgent, 2: standard.
  add column priority integer not null default 2 check (priority between 0 and 2),
  add column thread_id uuid references public.mentor_threads (id) on delete set null,
  add column guardian_policy text,
  add column status text not null default 'open' check (status in ('open', 'reviewed')),
  add column review_note text check (char_length(review_note) <= 1000),
  add constraint safety_events_reviewed check (status <> 'reviewed' or (acknowledged_by_account_id is not null and acknowledged_at is not null)),
  add constraint safety_events_category check (category in ('self_harm', 'abuse', 'threat', 'sexual_content', 'violence', 'hate', 'other_harm', 'personal_data'));
create index safety_events_queue on public.safety_events (status, priority, created_at);
create index on public.safety_events (thread_id);
create index on public.safety_events (subject_account_id);
create index on public.safety_events (acknowledged_by_account_id);

-- An event is kept as recorded; only the review (once, by the Owner or a Super Admin's admin account) is added.
create function private.safety_event_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ASCENTRA: safety events are kept.' using errcode = 'insufficient_privilege';
  end if;
  if (new.subject_account_id, new.category, new.reason, new.actions_taken, new.severity, new.source, new.stage, new.is_minor, new.priority, new.guardian_policy, new.created_at)
     is distinct from (old.subject_account_id, old.category, old.reason, old.actions_taken, old.severity, old.source, old.stage, old.is_minor, old.priority, old.guardian_policy, old.created_at) then
    raise exception 'ASCENTRA: a safety event is kept as recorded; only its review is added.' using errcode = 'check_violation';
  end if;
  if old.status = 'reviewed' and (new.status, new.review_note, new.acknowledged_by_account_id, new.acknowledged_at)
     is distinct from (old.status, old.review_note, old.acknowledged_by_account_id, old.acknowledged_at) then
    raise exception 'ASCENTRA: this safety event was already reviewed.' using errcode = 'check_violation';
  end if;
  if new.status = 'reviewed' and old.status <> 'reviewed' and not exists (
    select 1 from public.accounts a where a.id = new.acknowledged_by_account_id and a.role in ('owner', 'admin') and a.status = 'active') then
    raise exception 'ASCENTRA: only the Owner or a Super Admin reviews a safety event.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.safety_event_rules() from public;
create trigger safety_event_rules before update or delete on public.safety_events
  for each row execute function private.safety_event_rules();

-- ============ Same rules as every other table ============

alter table public.mentor_daily_usage enable row level security;
revoke all on public.mentor_daily_usage from anon, authenticated;
create trigger set_updated_at before update on public.mentor_daily_usage
  for each row execute function private.set_updated_at();

commit;
