-- L7: the interview and the personalized path.
--   learner_interviews: one per learner. Only learning goals, current level, time per week and topics/interests, each
--     from a fixed list (no free text, no personal data). Private to the learner; in their Privacy Center download.
--   learner_paths + learner_path_items: the learner's path, chosen only from Published courses: the courses in order,
--     why each was chosen, and whether practice items are picked for them or the default set is shown.
--   course_requests: the Course Admin queue of topics with no published course. Anonymous by design: topic and level
--     only, with a count of how often it was asked for. There is no column that could hold who asked.
-- Safe with the L6 code: nothing before L7 reads or writes these tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0017_activity_library'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L6 (0017) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0018_interview_and_path');

-- ============ The interview ============

create table public.learner_interviews (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null unique references public.accounts (id),
  goal               text check (goal in ('basics', 'apply', 'deeper')),
  level              text check (level in ('beginner', 'intermediate', 'advanced')),
  minutes_per_week   integer check (minutes_per_week in (60, 120, 180, 300, 480)),
  -- Slugs of catalog topics or courses, and interest tags: all from lists the app shows (checked by the API).
  topics             text[] not null default '{}' check (cardinality(topics) <= 10),
  interests          text[] not null default '{}' check (cardinality(interests) <= 10),
  completed_at       timestamptz,
  skipped_at         timestamptz,
  retention_class    public.retention_class not null default 'learning',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Either answered in full, or skipped (redoable), never half of each.
  constraint learner_interviews_state check (
    (completed_at is not null and goal is not null and level is not null and minutes_per_week is not null)
    or (completed_at is null and skipped_at is not null)),
  constraint learner_interviews_short_values check (
    coalesce(array_to_string(topics, ''), '') !~ '[^a-z0-9-]' and coalesce(array_to_string(interests, ''), '') !~ '[^a-z0-9-]')
);

-- ============ The path ============

create table public.learner_paths (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null unique references public.accounts (id),
  method             text not null check (method in ('rules', 'ai_ranked')),
  note               text,
  activity_mode      text not null default 'personal' check (activity_mode in ('personal', 'default')),
  built_at           timestamptz not null default now(),
  retention_class    public.retention_class not null default 'learning',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.learner_path_items (
  id                 uuid primary key default gen_random_uuid(),
  path_id            uuid not null references public.learner_paths (id) on delete cascade,
  account_id         uuid not null references public.accounts (id),
  academy_id         uuid not null references public.academies (id),
  position           integer not null check (position >= 1),
  reason             text not null check (char_length(reason) between 3 and 500),
  retention_class    public.retention_class not null default 'learning',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (path_id, academy_id)
);
create index on public.learner_path_items (account_id, position);

-- Only a course with a published lesson in a live course version goes on a path.
create function private.path_item_published() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.academy_id is distinct from old.academy_id) and not exists (
    select 1 from public.lesson_versions v join public.courses c on c.id = v.course_id
     where c.academy_id = new.academy_id and v.status = 'published' and c.status in ('published', 'restored')) then
    raise exception 'ASCENTRA: a path holds only published courses.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.academies a where a.id = new.academy_id and a.slug = 'gsa') then
    raise exception 'ASCENTRA: the Owner Academy is never on a learner path.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.path_item_published() from public;
create trigger path_item_published before insert or update on public.learner_path_items
  for each row execute function private.path_item_published();

-- ============ Requests for topics with no course (anonymous) ============

create table public.course_requests (
  id                     uuid primary key default gen_random_uuid(),
  topic                  text not null check (char_length(topic) between 3 and 80),
  topic_key              text not null check (topic_key ~ '^[a-z0-9-]{1,80}$'),
  level                  text not null check (level in ('beginner', 'intermediate', 'advanced')),
  request_count          integer not null default 1 check (request_count >= 1),
  status                 text not null default 'open' check (status in ('open', 'planned', 'dismissed')),
  decided_by_account_id  uuid references public.accounts (id),
  decided_at             timestamptz,
  decision_note          text,
  last_requested_at      timestamptz not null default now(),
  retention_class        public.retention_class not null default 'operational',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (topic_key, level),
  check ((status = 'open') = (decided_at is null))
);

-- Counts one more request for a topic and level, atomically (anonymous: nothing about who asked is passed or kept).
create function public.request_course(p_topic text, p_key text, p_level text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare rid uuid;
begin
  insert into public.course_requests (topic, topic_key, level) values (p_topic, p_key, p_level)
  on conflict (topic_key, level) do update
    set request_count = public.course_requests.request_count + 1, last_requested_at = now(),
        -- A dismissed topic asked for again goes back to the queue.
        status = case when public.course_requests.status = 'dismissed' then 'open' else public.course_requests.status end,
        decided_at = case when public.course_requests.status = 'dismissed' then null else public.course_requests.decided_at end
  returning id into rid;
  return rid;
end $$;
revoke all on function public.request_course(text, text, text) from public, anon, authenticated;
grant execute on function public.request_course(text, text, text) to service_role;

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['learner_interviews', 'learner_paths', 'learner_path_items', 'course_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;
