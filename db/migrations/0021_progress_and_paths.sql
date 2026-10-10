-- C2: course sizes, side hustles, unlock rules, ranks, importance labels, the Notebook and progress.
--   topics: a third kind, side_hustle. Twelve L8 businesses move to it (slugs, publish state and teen_hidden kept).
--     Their picks move with them: learner_picks references (topic id, kind) "on update cascade", so each pick's kind
--     follows its topic in the same statement. An active, locked business pick of a moved topic becomes an active,
--     locked side-hustle pick; a paused one stays paused. Nothing is deleted. private.c2_moved_topics records what moved
--     (see the end of this file for how to move them back).
--     Businesses and side hustles also get cost-to-start and market-outlook fields (Owner-entered, with sources and a
--     "checked on" date; skills have none) and the skills their course already teaches (the overlap note).
--   The pick functions: Basic and trial: up to 3 skills, 1 business and an optional 1 side hustle, each locked once
--     picked (only the Owner changes them). Pro: unlimited skills, 1 active business and 1 active side hustle, switchable
--     (the old one is paused, with its progress). Pro to Basic: the active business, the active side hustle and 3 skills
--     stay active; the rest are paused.
--   courses: size_tier (compact 3-4 modules, standard 5-6, large 7-9) and two once-per-course notices.
--   activity_items and video_slots: an importance label (should_know, important, very_important), the Notebook note
--     ("Very important" items need one), and, for items, a real-world mission type.
--   item_completions: one row per learner and finished item (insert-only), with its points and the learner's local day.
--     Ranks and the streak are computed from it; nothing is sent by the browser.
--   trial_bonuses: a trial learner's earned half of module 3 (kept after they convert).
--   notebook_entries: auto-notes (private). notes: "My ideas" (kind 'idea', private).
--   account_regions: the learner's US state (private). mission_state_allowlist, mission_approvals: teen missions.
--   course_capstones (per course version) and capstones (per learner, the existing table) for the required capstone.
--   course_notice_views: each notice is shown once per course. community_settings: the Owner's community links.
--   profiles: time zone, leaderboard nickname and opt-out, the AI summary setting.
-- Safe with the C1 code: nothing before C2 reads or writes these columns or tables; existing courses keep size_tier null
-- (their rules are unchanged), and the moved topics keep their slugs.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0020_course_structure'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply C1 (0020) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0021_progress_and_paths');

-- ============ Side hustles ============

alter table public.topics drop constraint topics_kind_check;
alter table public.topics add constraint topics_kind_check check (kind in ('business', 'side_hustle', 'skill'));
alter table public.learner_picks drop constraint learner_picks_kind_check;
alter table public.learner_picks add constraint learner_picks_kind_check check (kind in ('business', 'side_hustle', 'skill'));
alter table public.learner_picks drop constraint learner_picks_lock;
alter table public.learner_picks add constraint learner_picks_lock
  check (not locked or (kind in ('business', 'side_hustle') and status = 'active'));
-- One active side hustle per learner, like the one active business.
create unique index learner_picks_one_side_hustle on public.learner_picks (user_id) where kind = 'side_hustle' and status = 'active';

create table private.c2_moved_topics (
  topic_id       uuid primary key,
  slug           text not null,
  previous_kind  text not null,
  moved_at       timestamptz not null default now()
);
revoke all on private.c2_moved_topics from public;

insert into private.c2_moved_topics (topic_id, slug, previous_kind)
  select id, slug, kind from public.topics
   where kind = 'business' and slug in ('website-design', 'shopify-store', 'amazon-fba', 'dropshipping', 'print-on-demand',
     'online-reselling', 'digital-products', 'ugc-content', 'affiliate-marketing', 'faceless-content', 'youtube-channel', 'newsletter');
-- The picks follow (on update cascade).
update public.topics set kind = 'side_hustle' where id in (select topic_id from private.c2_moved_topics);

-- Cost to start and market outlook (businesses and side hustles; Owner-entered, never invented), and the overlap note.
alter table public.topics
  add column cost_low            numeric(12, 2) check (cost_low >= 0),
  add column cost_high           numeric(12, 2) check (cost_high >= 0),
  add column cost_items          jsonb not null default '[]' check (jsonb_typeof(cost_items) = 'array'),
  add column cost_sources        jsonb not null default '[]' check (jsonb_typeof(cost_sources) = 'array'),
  add column cost_checked_on     date,
  add column outlook_label       text check (outlook_label in ('growing', 'steady', 'shrinking', 'unclear')),
  add column outlook_sources     jsonb not null default '[]' check (jsonb_typeof(outlook_sources) = 'array'),
  add column outlook_checked_on  date,
  add column difficulty          smallint check (difficulty between 1 and 5),
  add column risk_notes          text check (char_length(risk_notes) <= 600),
  add column teaches_skill_ids   uuid[] not null default '{}',
  add constraint topics_cost_range check (cost_low is null or cost_high is null or cost_low <= cost_high),
  -- A number is shown only with where it came from and when it was checked.
  add constraint topics_cost_sourced check (cost_low is null or (cost_checked_on is not null and jsonb_array_length(cost_sources) > 0)),
  add constraint topics_outlook_sourced check (outlook_label is null or (outlook_checked_on is not null and jsonb_array_length(outlook_sources) > 0)),
  add constraint topics_skill_fields check (kind <> 'skill' or (cost_low is null and cost_high is null and cost_items = '[]'
    and cost_sources = '[]' and cost_checked_on is null and outlook_label is null and outlook_sources = '[]'
    and outlook_checked_on is null and difficulty is null and risk_notes is null and teaches_skill_ids = '{}'));

-- ============ The pick rules, with side hustles ============

create or replace function private.apply_plan_rules(p_account uuid, p_plan text, p_minor boolean) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare paused integer := 0; n integer;
begin
  update public.learner_picks p set status = 'paused', locked = false
    from public.topics t
   where p.topic_id = t.id and p.user_id = p_account and p.status = 'active'
     and (not t.published or (t.teen_hidden and p_minor));
  get diagnostics n = row_count; paused := paused + n;
  if p_plan = 'pro' then
    update public.learner_picks set locked = false where user_id = p_account and locked;
  else
    update public.learner_picks set status = 'paused'
     where id in (select id from public.learner_picks where user_id = p_account and kind = 'skill' and status = 'active'
                  order by picked_at desc, id offset 3);
    get diagnostics n = row_count; paused := paused + n;
    update public.learner_picks set locked = true
     where user_id = p_account and kind in ('business', 'side_hustle') and status = 'active' and not locked;
  end if;
  return paused;
end $$;
revoke all on function private.apply_plan_rules(uuid, text, boolean) from public;

-- As in L8, with a side hustle handled like the business: one active at a time; Basic and trial lock it once picked;
-- on Pro picking another pauses the current one (kept, with its progress).
create or replace function public.pick_topic(p_account uuid, p_topic uuid, p_plan text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minor boolean; v_status text;
  t public.topics%rowtype;
  v_pick uuid; v_pick_status text; v_used integer; v_current uuid;
begin
  perform private.check_plan(p_plan);
  perform private.lock_picks(p_account);
  select a.is_minor, a.status into v_minor, v_status from public.accounts a where a.id = p_account;
  if not found or v_status <> 'active' then return jsonb_build_object('result', 'no_account'); end if;
  select * into t from public.topics where id = p_topic;
  if not found or not t.published or (t.teen_hidden and v_minor) then return jsonb_build_object('result', 'not_available'); end if;
  perform private.apply_plan_rules(p_account, p_plan, v_minor);

  select id, status into v_pick, v_pick_status from public.learner_picks where user_id = p_account and topic_id = p_topic;
  if v_pick_status = 'active' then return jsonb_build_object('result', 'already', 'kind', t.kind); end if;

  if t.kind = 'skill' then
    if p_plan <> 'pro' then
      select count(*) into v_used from public.learner_picks where user_id = p_account and kind = 'skill' and status = 'active';
      if v_used >= 3 then return jsonb_build_object('result', 'limit', 'limit', 3, 'used', v_used); end if;
    end if;
  else
    select topic_id into v_current from public.learner_picks where user_id = p_account and kind = t.kind and status = 'active';
    if v_current is not null then
      if p_plan <> 'pro' then return jsonb_build_object('result', 'locked', 'kind', t.kind, 'current', v_current); end if;
      update public.learner_picks set status = 'paused', locked = false where user_id = p_account and topic_id = v_current;
    end if;
  end if;

  if v_pick is not null then
    update public.learner_picks set status = 'active', picked_at = now(), locked = (t.kind <> 'skill' and p_plan <> 'pro')
     where id = v_pick;
  else
    insert into public.learner_picks (user_id, topic_id, kind, status, locked)
    values (p_account, p_topic, t.kind, 'active', t.kind <> 'skill' and p_plan <> 'pro');
  end if;

  if not t.has_course then
    insert into public.topic_interest (topic_id, day) values (p_topic, private.us_today())
    on conflict (topic_id, day) do update set count = public.topic_interest.count + 1;
  end if;
  return jsonb_build_object('result', 'picked', 'kind', t.kind, 'previous', v_current, 'has_course', t.has_course);
end $$;

-- The Owner changes a learner's business or side hustle (p_topic), or releases it (p_topic null). The API checks the
-- caller is the Owner and records the change with its reason. Returns { result, previous, next }.
create function public.owner_set_pick(p_account uuid, p_kind text, p_topic uuid, p_plan text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_minor boolean; t public.topics%rowtype; v_current uuid;
begin
  perform private.check_plan(p_plan);
  if p_kind is null or p_kind not in ('business', 'side_hustle') then
    raise exception 'ASCENTRA: the Owner changes a business or a side hustle.' using errcode = 'check_violation';
  end if;
  perform private.lock_picks(p_account);
  select a.is_minor into v_minor from public.accounts a where a.id = p_account;
  if not found then return jsonb_build_object('result', 'no_account'); end if;
  perform private.apply_plan_rules(p_account, p_plan, v_minor);
  select topic_id into v_current from public.learner_picks where user_id = p_account and kind = p_kind and status = 'active';
  if p_topic is null then
    if v_current is null then return jsonb_build_object('result', 'unchanged', 'previous', null, 'next', null); end if;
    update public.learner_picks set status = 'paused', locked = false where user_id = p_account and topic_id = v_current;
    return jsonb_build_object('result', 'released', 'previous', v_current, 'next', null);
  end if;
  select * into t from public.topics where id = p_topic;
  -- The teen rule holds for the Owner too.
  if not found or t.kind <> p_kind or not t.published or (t.teen_hidden and v_minor) then
    return jsonb_build_object('result', 'not_available');
  end if;
  if v_current = p_topic then return jsonb_build_object('result', 'unchanged', 'previous', v_current, 'next', v_current); end if;
  if v_current is not null then
    update public.learner_picks set status = 'paused', locked = false where user_id = p_account and topic_id = v_current;
  end if;
  insert into public.learner_picks (user_id, topic_id, kind, status, locked)
  values (p_account, p_topic, p_kind, 'active', p_plan <> 'pro')
  on conflict (user_id, topic_id) do update set status = 'active', picked_at = now(), locked = excluded.locked;
  return jsonb_build_object('result', 'changed', 'previous', v_current, 'next', p_topic);
end $$;
revoke all on function public.owner_set_pick(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.owner_set_pick(uuid, text, uuid, text) to service_role;

create or replace function public.owner_set_business(p_account uuid, p_topic uuid, p_plan text) returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.owner_set_pick(p_account, 'business', p_topic, p_plan) $$;

-- ============ Course size tiers and notices ============

alter table public.courses
  add column size_tier        text check (size_tier in ('compact', 'standard', 'large')),
  add column license_notice   text check (char_length(license_notice) between 10 and 600),
  add column software_notice  text check (char_length(software_notice) between 10 and 600);

-- Each notice is shown once per course (any version), the first time the learner opens it.
create table public.course_notice_views (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  academy_id       uuid not null references public.academies (id),
  notice_kind      text not null check (notice_kind in ('license', 'software')),
  seen_at          timestamptz not null default now(),
  retention_class  public.retention_class not null default 'learning',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, academy_id, notice_kind)
);

-- ============ Importance labels, Notebook notes, mission types ============

alter table public.activity_items
  add column importance     text check (importance in ('should_know', 'important', 'very_important')),
  add column notebook_note  text check (char_length(notebook_note) between 20 and 800),
  -- A real-world mission (kept as text so new kinds can be added without a migration; the list is lib/progress/config.ts).
  add column mission_type   text check (mission_type ~ '^[a-z][a-z_]{2,39}$');
alter table public.video_slots
  add column importance     text check (importance in ('should_know', 'important', 'very_important')),
  add column notebook_note  text check (char_length(notebook_note) between 20 and 800);
-- A quiz's score (0 to 1) on code-graded attempts: 80% or more counts the item as done.
alter table public.activity_attempts add column score numeric(5, 4) check (score between 0 and 1);

-- The label, note and mission type are set while the item is a Draft. In a course that needs the Owner's review, an
-- item is approved only with a label, and a "Very important" one only with its Notebook note.
create function private.activity_item_label_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.importance, new.notebook_note, new.mission_type) is distinct from (old.importance, old.notebook_note, old.mission_type) then
    raise exception 'ASCENTRA: an item''s importance, Notebook note and mission type are set while it is a Draft.' using errcode = 'check_violation';
  end if;
  if new.status = 'approved' and old.status <> 'approved'
     and exists (select 1 from public.courses c where c.id = new.course_id and c.owner_review_required) then
    if new.importance is null then
      raise exception 'ASCENTRA: label this item (should know, important or very important) before approving it.' using errcode = 'check_violation';
    end if;
    if new.importance = 'very_important' and new.notebook_note is null then
      raise exception 'ASCENTRA: a "Very important" item needs its Notebook note before it is approved.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.activity_item_label_rules() from public;
create trigger activity_item_label_rules before update on public.activity_items
  for each row execute function private.activity_item_label_rules();

-- A video slot's label and note change only while its course version is a Draft.
create function private.video_slot_label_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.importance, new.notebook_note) is distinct from (old.importance, old.notebook_note)
     and exists (select 1 from public.modules m join public.courses c on c.id = m.course_id where m.id = new.module_id and c.status <> 'draft') then
    raise exception 'ASCENTRA: a video''s importance and Notebook note are set while its course version is a Draft.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.video_slot_label_rules() from public;
create trigger video_slot_label_rules before update on public.video_slots
  for each row execute function private.video_slot_label_rules();

-- The Owner approves a module only when every video and practice item in it has its label (and "Very important" ones
-- their note). Runs before module_review_rules (name order).
create function private.module_review_labels() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'approved' then
    if exists (select 1 from public.video_slots s where s.module_id = new.module_id
                 and (s.importance is null or (s.importance = 'very_important' and s.notebook_note is null)))
       or exists (select 1 from public.activity_items i where i.module_id = new.module_id and i.status in ('draft', 'approved', 'published')
                 and (i.importance is null or (i.importance = 'very_important' and i.notebook_note is null))) then
      raise exception 'ASCENTRA: every video and practice item in this module needs its importance label (and "Very important" ones their Notebook note) first.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.module_review_labels() from public;
create trigger a_module_review_labels before insert on public.module_reviews
  for each row execute function private.module_review_labels();

-- ============ The required capstone ============

-- What the course asks for (per course version; copied into a new version). Business courses add the "Automation with
-- AI" part: what gets automated, master prompts (the Owner writes them), and the AI plan note (the Owner enters the top 3
-- plans by value, each with a price, a source link and a "checked on" date; watched for freshness).
create table public.course_capstones (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null unique references public.courses (id) on delete cascade,
  title            text not null check (char_length(title) between 3 and 200),
  brief            text not null default '' check (char_length(brief) <= 2000),
  deliverables     jsonb not null default '[]' check (jsonb_typeof(deliverables) = 'array'),
  checklist        jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array'),
  automation       jsonb check (automation is null or jsonb_typeof(automation) = 'object'),
  plans_checked_on date,
  freshness_watch  boolean not null default true,
  retention_class  public.retention_class not null default 'content',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- A learner's own capstone (the table from the data model): the self-check, and when it was done.
alter table public.capstones
  add column course_capstone_id uuid references public.course_capstones (id),
  add column checked            jsonb not null default '{}' check (jsonb_typeof(checked) = 'object'),
  add column completed_at       timestamptz;
create unique index capstones_one_per_learner on public.capstones (account_id, course_capstone_id) where course_capstone_id is not null;

-- ============ Completions (ranks, streaks, progress) ============

alter table public.profiles
  add column time_zone              text,
  add column nickname               text check (nickname ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$'),
  add column nickname_set_at        timestamptz,
  add column nickname_removed_at    timestamptz,
  add column leaderboard_opt_out    boolean not null default false,
  add column notebook_ai_summaries  boolean not null default false;
create unique index profiles_nickname_unique on public.profiles (lower(nickname)) where nickname is not null;

create function private.profile_time_zone_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.time_zone is distinct from old.time_zone and new.time_zone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.time_zone) then
    raise exception 'ASCENTRA: unknown time zone.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.profile_time_zone_rules() from public;
create trigger profile_time_zone_rules before update on public.profiles
  for each row execute function private.profile_time_zone_rules();

create table public.item_completions (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  course_id        uuid not null references public.courses (id),
  module_id        uuid references public.modules (id),
  lesson_id        uuid references public.lessons (id),
  item_kind        text not null check (item_kind ~ '^[a-z][a-z_]{2,39}$'),   -- video, activity, capstone, and new types later
  item_id          uuid not null,
  importance       text check (importance in ('should_know', 'important', 'very_important')),
  points           integer not null check (points between 0 and 100),
  local_day        date not null,
  completed_at     timestamptz not null default now(),
  retention_class  public.retention_class not null default 'learning',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, item_kind, item_id)
);
create index on public.item_completions (account_id, local_day);
create index on public.item_completions (course_id);

-- Records a finished item once. The day is the learner's own (their time zone, else US Eastern). The item must be
-- what the API says it is (a published item, an approved video or the course's capstone, in that module and course).
-- Returns { created, local_day }.
create function public.record_item_completion(p_account uuid, p_kind text, p_item uuid, p_course uuid, p_module uuid, p_lesson uuid,
                                              p_importance text, p_points integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare tz text; d date; n integer;
begin
  if p_kind = 'activity' then
    if not exists (select 1 from public.activity_items i where i.id = p_item and i.status = 'published' and i.course_id = p_course and i.module_id = p_module) then
      raise exception 'ASCENTRA: no such published item in that module.' using errcode = 'check_violation';
    end if;
  elsif p_kind = 'video' then
    if not exists (select 1 from public.video_slots s join public.modules m on m.id = s.module_id
                    where s.id = p_item and s.status = 'approved' and s.module_id = p_module and m.course_id = p_course) then
      raise exception 'ASCENTRA: no such approved video in that module.' using errcode = 'check_violation';
    end if;
  elsif p_kind = 'capstone' then
    if not exists (select 1 from public.course_capstones c where c.id = p_item and c.course_id = p_course) then
      raise exception 'ASCENTRA: no such capstone in that course.' using errcode = 'check_violation';
    end if;
  else
    raise exception 'ASCENTRA: unknown kind of item.' using errcode = 'check_violation';
  end if;
  select coalesce(p.time_zone, 'America/New_York') into tz from public.profiles p where p.account_id = p_account;
  d := (now() at time zone coalesce(tz, 'America/New_York'))::date;
  insert into public.item_completions (account_id, course_id, module_id, lesson_id, item_kind, item_id, importance, points, local_day)
    values (p_account, p_course, p_module, p_lesson, p_kind, p_item, p_importance, p_points, d)
    on conflict (account_id, item_kind, item_id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('created', n > 0, 'local_day', d);
end $$;
revoke all on function public.record_item_completion(uuid, text, uuid, uuid, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_item_completion(uuid, text, uuid, uuid, uuid, uuid, text, integer) to service_role;

-- A trial learner's earned half of module 3 (Standard and Large courses), kept after they convert.
create table public.trial_bonuses (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  academy_id       uuid not null references public.academies (id),
  course_id        uuid not null references public.courses (id),
  earned_at        timestamptz not null default now(),
  retention_class  public.retention_class not null default 'learning',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, academy_id)
);

-- ============ The Notebook ============

create table public.notebook_entries (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  academy_id       uuid not null references public.academies (id),
  course_id        uuid not null references public.courses (id),
  item_kind        text not null check (item_kind ~ '^[a-z][a-z_]{2,39}$'),
  item_id          uuid not null,
  category         text not null check (category in ('videos', 'assignments', 'tasks', 'quizzes', 'key_terms')),
  importance       text not null check (importance in ('should_know', 'important', 'very_important')),
  title            text not null check (char_length(title) between 1 and 300),
  note             text not null check (char_length(note) between 1 and 800),
  retention_class  public.retention_class not null default 'user_content',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, item_kind, item_id)
);
create index on public.notebook_entries (account_id, created_at desc);

-- "My ideas": the learner's own journal, in the data model's notes table.
alter table public.notes drop constraint notes_kind_check;
alter table public.notes add constraint notes_kind_check check (kind in ('note', 'highlight', 'bookmark', 'saved_explanation', 'idea'));
alter table public.notes add constraint notes_idea_body check (kind <> 'idea' or char_length(body) between 1 and 5000);
create index on public.notes (account_id, kind, created_at desc);

-- ============ State, and teen real-world missions ============

create table public.account_regions (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null unique references public.accounts (id) on delete cascade,
  state_code       text not null check (state_code in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY')),
  set_at           timestamptz not null default now(),
  retention_class  public.retention_class not null default 'account',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Off for teens in every state until the Owner turns a mission type on for a state (with their lawyer).
create table public.mission_state_allowlist (
  id                    uuid primary key default gen_random_uuid(),
  mission_type          text not null check (mission_type ~ '^[a-z][a-z_]{2,39}$'),
  state_code            text not null check (state_code in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY')),
  teens_allowed         boolean not null default false,
  updated_by_account_id uuid references public.accounts (id),
  retention_class       public.retention_class not null default 'operational',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (mission_type, state_code)
);

-- A Guardian's approvals: once per course (scope 'course'), and each time for a mission that contacts someone (scope
-- 'contact', used once).
create table public.mission_approvals (
  id                   uuid primary key default gen_random_uuid(),
  teen_account_id      uuid not null references public.accounts (id) on delete cascade,
  guardian_account_id  uuid not null references public.accounts (id),
  academy_id           uuid not null references public.academies (id),
  item_id              uuid references public.activity_items (id),
  scope                text not null check (scope in ('course', 'contact')),
  status               text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'used')),
  requested_at         timestamptz not null default now(),
  decided_at           timestamptz,
  used_at              timestamptz,
  retention_class      public.retention_class not null default 'account',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((scope = 'contact') = (item_id is not null)),
  check ((status in ('approved', 'declined', 'used')) = (decided_at is not null)),
  check ((status = 'used') = (used_at is not null))
);
create unique index mission_approvals_one_open on public.mission_approvals (teen_account_id, academy_id, scope, coalesce(item_id, '00000000-0000-0000-0000-000000000000'))
  where status in ('requested', 'approved');
create index on public.mission_approvals (guardian_account_id, status);

-- ============ Community links ============

create table public.community_settings (
  id                    smallint primary key default 1 check (id = 1),
  discord_url           text check (discord_url ~ '^https://'),
  social_links          jsonb not null default '[]' check (jsonb_typeof(social_links) = 'array'),
  hide_from_teens       boolean not null default false,
  updated_by_account_id uuid references public.accounts (id),
  retention_class       public.retention_class not null default 'operational',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
insert into public.community_settings (id) values (1);

-- ============ The leaderboard (a server-side view of nickname, rank and streak) ============

-- Each learner's points, current streak and longest streak, from their completions. The current streak counts a run of
-- days ending today or yesterday in the learner's own time zone; a missed full day ends it.
create function private.learner_streaks(p_account uuid default null)
returns table (account_id uuid, points bigint, current_streak integer, longest_streak integer)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select distinct c.account_id, c.local_day from public.item_completions c where p_account is null or c.account_id = p_account
  ), runs as (
    select d.account_id, d.local_day, d.local_day - (row_number() over (partition by d.account_id order by d.local_day))::integer as grp from days d
  ), islands as (
    select r.account_id, r.grp, count(*)::integer as len, max(r.local_day) as last_day from runs r group by r.account_id, r.grp
  ), today as (
    select p.account_id, (now() at time zone coalesce(p.time_zone, 'America/New_York'))::date as d from public.profiles p
  ), pts as (
    select c.account_id, sum(c.points)::bigint as points from public.item_completions c where p_account is null or c.account_id = p_account group by c.account_id
  )
  select pts.account_id, pts.points,
         coalesce((select i.len from islands i join today t on t.account_id = i.account_id
                    where i.account_id = pts.account_id and i.last_day >= t.d - 1 order by i.last_day desc limit 1), 0),
         coalesce((select max(i.len) from islands i where i.account_id = pts.account_id), 0)
    from pts
$$;
revoke all on function private.learner_streaks(uuid) from public;

-- The adult board: active adult learners with a nickname that wasn't removed and who didn't opt out. Never a teen, never
-- a name or email. p_thresholds are the rank thresholds from lib/progress/config.ts (the rank is computed here so the
-- board can be sorted).
create function public.leaderboard_adults(p_thresholds integer[], p_limit integer default 50)
returns table (nickname text, points bigint, rank_index integer, current_streak integer, longest_streak integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.nickname, s.points,
         (select count(*)::integer from unnest(p_thresholds) t where t <= s.points),
         s.current_streak, s.longest_streak
    from private.learner_streaks() s
    join public.accounts a on a.id = s.account_id
    join public.profiles p on p.account_id = a.id
   where a.role = 'learner' and not a.is_minor and a.status = 'active'
     and p.nickname is not null and p.nickname_removed_at is null and not p.leaderboard_opt_out
   order by s.points desc, s.current_streak desc, p.nickname
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- One learner's own points and streaks (for "My progress" and their own leaderboard row).
create function public.learner_progress_totals(p_account uuid)
returns table (points bigint, current_streak integer, longest_streak integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.points, 0), coalesce(s.current_streak, 0), coalesce(s.longest_streak, 0)
    from (select 1) one left join private.learner_streaks(p_account) s on true
$$;

do $$
declare f text;
begin
  foreach f in array array['public.leaderboard_adults(integer[], integer)', 'public.learner_progress_totals(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ============ New course versions and Blueprints carry the C2 fields ============

-- As in C1, with the size tier (and its module count) for a v2 plan: plan.sizeTier, standard when not given.
create or replace function public.approve_course_blueprint(p_blueprint uuid, p_actor uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  bp public.academy_blueprints;
  new_course uuid;
  next_version integer;
  m jsonb; mi bigint; l jsonb; li bigint; sk jsonb; vd jsonb; vi bigint;
  module_id uuid;
  v2 boolean;
  n_modules integer;
  tier text; lo integer; hi integer;
begin
  select * into bp from public.academy_blueprints where id = p_blueprint for update;
  if bp.id is null or bp.kind <> 'course' then
    raise exception 'ASCENTRA: no such course blueprint.' using errcode = 'no_data_found';
  end if;
  if bp.status <> 'draft' then
    raise exception 'ASCENTRA: this blueprint is already %.', bp.status using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_path_query(bp.plan, '$.modules[*].lessons[*].keyClaims[*].sourceId') sid
    where jsonb_typeof(sid) = 'string'
      and not exists (select 1 from public.sources s where s.id = (sid #>> '{}')::uuid and s.academy_id is null and s.status = 'approved')) then
    raise exception 'ASCENTRA: a source this blueprint cites is no longer approved.' using errcode = 'check_violation';
  end if;
  v2 := coalesce(bp.plan ->> 'structure', '1') = '2';
  n_modules := jsonb_array_length(coalesce(bp.plan -> 'modules', '[]'));
  tier := case when v2 then coalesce(bp.plan ->> 'sizeTier', 'standard') end;
  if v2 then
    if tier not in ('compact', 'standard', 'large') then
      raise exception 'ASCENTRA: the course size is compact, standard or large.' using errcode = 'check_violation';
    end if;
    lo := case tier when 'compact' then 3 when 'standard' then 5 else 7 end;
    hi := case tier when 'compact' then 4 when 'standard' then 6 else 9 end;
    if n_modules not between lo and hi then
      raise exception 'ASCENTRA: a % course has % to % modules (this outline has %). A Standard course has 5 or 6 modules.', initcap(tier), lo, hi, n_modules
        using errcode = 'check_violation';
    end if;
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.courses where academy_id = bp.academy_id;
  insert into public.courses (academy_id, version, status, summary, created_by_account_id, owner_review_required, size_tier)
    values (bp.academy_id, next_version, 'draft', bp.plan ->> 'outcome', p_actor, v2, tier) returning id into new_course;
  for m, mi in select * from jsonb_array_elements(coalesce(bp.plan -> 'modules', '[]')) with ordinality loop
    insert into public.modules (course_id, position, code, title, stage, recipe)
      values (new_course, mi, 'm' || mi, coalesce(nullif(m ->> 'title', ''), 'Module ' || mi), nullif(m ->> 'stage', ''),
              case when v2 and jsonb_typeof(m -> 'recipe') = 'object' then m -> 'recipe' else '{}'::jsonb end)
      returning id into module_id;
    for l, li in select * from jsonb_array_elements(coalesce(m -> 'lessons', '[]')) with ordinality loop
      insert into public.lessons (module_id, position, title, minutes, objectives, content)
        values (module_id, li, coalesce(nullif(l ->> 'title', ''), 'Lesson ' || li),
                nullif(greatest(coalesce((l ->> 'minutes')::integer, 0), 0), 0),
                array(select jsonb_array_elements_text(coalesce(l -> 'objectives', '[]'))),
                jsonb_build_object('keyClaims', coalesce(l -> 'keyClaims', '[]'), 'blueprintId', bp.id));
    end loop;
    for sk in select * from jsonb_array_elements(coalesce(m -> 'skills', '[]')) loop
      insert into public.skills (course_id, module_id, key, name)
        values (new_course, module_id, sk ->> 'key', sk ->> 'name')
        on conflict (course_id, key) do nothing;
    end loop;
    if v2 then
      for vd, vi in select * from jsonb_array_elements(coalesce(m -> 'videos', '[]')) with ordinality loop
        insert into public.video_slots (module_id, position, title, brief, brief_generated_by)
          values (module_id, vi, coalesce(nullif(left(vd ->> 'title', 200), ''), 'Explainer video ' || vi),
                  coalesce(vd -> 'brief', '{}'::jsonb), case when bp.generated_by = 'ai' and bp.edited_at is null then 'ai' else 'person' end);
      end loop;
    end if;
  end loop;
  update public.academy_blueprints
    set status = 'approved', approved_at = now(), approved_by_account_id = p_actor, course_id = new_course
    where id = bp.id;
  return new_course;
end $$;

-- As in C1, also carrying the size tier, the notices, the labels, Notebook notes and mission types, and the capstone.
create or replace function public.new_course_version(p_academy uuid, p_actor uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.courses;
  new_course uuid;
  om public.modules; nm uuid;
  ol public.lessons; nl uuid;
  lv public.lesson_versions;
  vs public.video_slots;
  ns uuid; nu uuid;
  lesson_map jsonb := '{}';
begin
  if not exists (select 1 from public.accounts a where a.id = p_actor and a.role in ('owner', 'admin') and a.status = 'active') then
    raise exception 'ASCENTRA: a new course version is started by the Owner or a course builder.' using errcode = 'check_violation';
  end if;
  select * into src from public.courses where academy_id = p_academy order by version desc limit 1 for update;
  if src.id is null then
    raise exception 'ASCENTRA: no course to start a new version of.' using errcode = 'no_data_found';
  end if;
  if src.status = 'draft' then
    raise exception 'ASCENTRA: version % is still a Draft. Edit that one.', src.version using errcode = 'check_violation';
  end if;
  insert into public.courses (academy_id, version, status, summary, created_by_account_id, owner_review_required, size_tier, license_notice, software_notice)
    values (p_academy, src.version + 1, 'draft', src.summary, p_actor, true, src.size_tier, src.license_notice, src.software_notice) returning id into new_course;
  for om in select * from public.modules where course_id = src.id order by position loop
    insert into public.modules (course_id, position, code, title, stage, prerequisite_module_ids, unlock_threshold_percent, recipe, recommended_pace)
      values (new_course, om.position, om.code, om.title, om.stage, '{}', om.unlock_threshold_percent, om.recipe, om.recommended_pace)
      returning id into nm;
    for ol in select * from public.lessons where module_id = om.id order by position loop
      insert into public.lessons (module_id, position, title, minutes, objectives, content)
        values (nm, ol.position, ol.title, ol.minutes, ol.objectives, ol.content) returning id into nl;
      lesson_map := lesson_map || jsonb_build_object(ol.id::text, nl::text);
      select * into lv from public.lesson_versions where lesson_id = ol.id and status <> 'archived'
        order by (status = 'published') desc, version desc limit 1;
      if lv.id is not null then
        insert into public.lesson_versions (lesson_id, course_id, version, status, title, body, citations, uncited_count, checks,
                                            last_verified_on, generated_by, model, blueprint_id, created_by_account_id)
          values (nl, new_course, 1, 'draft', lv.title, lv.body, lv.citations, lv.uncited_count, lv.checks,
                  lv.last_verified_on, lv.generated_by, lv.model, lv.blueprint_id, p_actor);
      end if;
      insert into public.activity_items (lesson_id, module_id, course_id, idea_key, version, status, item_type, grading, level, goal, interests,
                                         prompt, content, answer_key, explanation, citation, generated_by, model, created_by_account_id,
                                         recipe_part, booster_key, importance, notebook_note, mission_type)
        select nl, nm, new_course, i.idea_key, 1, 'draft', i.item_type, i.grading, i.level, i.goal, i.interests,
               i.prompt, i.content, i.answer_key, i.explanation, i.citation, i.generated_by, i.model, p_actor, i.recipe_part, i.booster_key,
               i.importance, i.notebook_note, i.mission_type
          from public.activity_items i where i.lesson_id = ol.id and i.status in ('approved', 'published');
    end loop;
    insert into public.skills (course_id, module_id, key, name)
      select new_course, nm, s.key, s.name from public.skills s where s.course_id = src.id and s.module_id = om.id
      on conflict (course_id, key) do nothing;
    for vs in select * from public.video_slots where module_id = om.id order by position loop
      insert into public.video_slots (module_id, lesson_id, position, title, brief, brief_generated_by, status, transcript, importance, notebook_note)
        values (nm, (lesson_map ->> vs.lesson_id::text)::uuid, vs.position, vs.title, vs.brief, vs.brief_generated_by, 'waiting', vs.transcript,
                vs.importance, vs.notebook_note)
        returning id into ns;
      if vs.current_upload_id is not null then
        insert into public.video_uploads (slot_id, storage_path, mime, size_bytes, status, original_name, uploaded_by_account_id, uploaded_at, checked_at)
          select ns, u.storage_path, u.mime, u.size_bytes, 'accepted', u.original_name, u.uploaded_by_account_id, u.uploaded_at, now()
            from public.video_uploads u where u.id = vs.current_upload_id
          returning id into nu;
        update public.video_slots set current_upload_id = nu, status = 'uploaded' where id = ns;
      end if;
    end loop;
  end loop;
  insert into public.course_capstones (course_id, title, brief, deliverables, checklist, automation, plans_checked_on, freshness_watch)
    select new_course, c.title, c.brief, c.deliverables, c.checklist, c.automation, c.plans_checked_on, c.freshness_watch
      from public.course_capstones c where c.course_id = src.id;
  return new_course;
end $$;

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['course_notice_views', 'course_capstones', 'item_completions', 'trial_bonuses', 'notebook_entries',
                           'account_regions', 'mission_state_allowlist', 'mission_approvals', 'community_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- Completions and earned bonuses are kept: written once, through the function above (or the API for a bonus).
revoke insert, update, truncate on public.item_completions from service_role;
revoke update, truncate on public.trial_bonuses from service_role;
create trigger item_completions_kept before update or delete on public.item_completions
  for each row execute function private.reject_change();
create trigger trial_bonuses_kept before update or delete on public.trial_bonuses
  for each row execute function private.reject_change();

-- Private: like most tables here, nothing is granted to anon or authenticated, so no one can read these rows by calling
-- Supabase directly. Only the API (the service role) reads them, and it returns a learner's rows to that learner alone.

create index on public.course_notice_views (academy_id);
create index on public.course_capstones (course_id);
create index on public.capstones (course_capstone_id);
create index on public.item_completions (module_id);
create index on public.item_completions (lesson_id);
create index on public.trial_bonuses (academy_id);
create index on public.trial_bonuses (course_id);
create index on public.notebook_entries (academy_id);
create index on public.notebook_entries (course_id);
create index on public.mission_state_allowlist (updated_by_account_id);
create index on public.mission_approvals (teen_account_id);
create index on public.mission_approvals (academy_id);
create index on public.mission_approvals (item_id);
create index on public.community_settings (updated_by_account_id);

-- ============ Moving the side hustles back (not run; for reference) ============
-- A learner may now have an active business and an active side hustle; moving a topic back to business would give
-- them two active businesses. To undo, first pause the side-hustle pick of anyone who also has an active business,
-- then move the topics back (their picks follow, as here):
--   update public.learner_picks p set status = 'paused', locked = false
--    where p.kind = 'side_hustle' and p.status = 'active' and p.topic_id in (select topic_id from private.c2_moved_topics)
--      and exists (select 1 from public.learner_picks b where b.user_id = p.user_id and b.kind = 'business' and b.status = 'active');
--   update public.topics t set kind = m.previous_kind from private.c2_moved_topics m where t.id = m.topic_id;
