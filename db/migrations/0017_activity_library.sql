-- L6: the topic catalog, batch generation, and the activity library.
--   catalog_topics: the learnable topics from the Academy Blueprint (reference/ascentra.html BLUEPRINTS), seeded here.
--     Existing courses (academies) appear in the catalog too, by slug.
--   catalog_jobs: the batch queue. A topic queued by the Owner or a Course Admin goes through the existing L2 steps
--     (research, Blueprint, lesson drafts) one course at a time, overnight, inside the L1 spend caps, and stops whenever a
--     person is needed (source approval, Blueprint approval, review). Results enter as Draft.
--   activity_items: practice items per lesson, AI-drafted from the lesson's approved sources, each with its citation.
--     Graded by code (an answer key a Reviewer approved): multiple choice, true/false, matching, ordering, flashcard
--     self-check. Feedback only, never a grade: the other seven types. Draft -> approved/rejected (Reviewer) ->
--     published (with the module, which needs at least 3 different activity types) -> archived when replaced. A
--     published item never changes; a refresh drafts a new item pointing at the one it would replace.
--   activity_attempts: a learner's attempts. Only code-graded attempts are counted toward progress; practice answers
--     are not stored. Kept as recorded.
-- Safe with the L5 code: nothing before L6 reads or writes these tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0016_mentor_allowance'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L5 (0016) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0017_activity_library');

-- ============ The topic catalog ============

create table public.catalog_topics (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name             text not null check (char_length(name) between 3 and 200),
  outcome          text check (char_length(outcome) <= 500),
  audience_level   text not null check (audience_level in ('beginner', 'intermediate', 'advanced')),
  origin           text not null default 'academy_blueprint' check (origin in ('academy_blueprint', 'owner')),
  retention_class  public.retention_class not null default 'content',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- From the Academy Blueprint in reference/ascentra.html (the Owner Academy, gsa, is never generated).
insert into public.catalog_topics (slug, name, outcome, audience_level) values
  ('mkt', 'Client Acquisition Systems', 'Turn more inquiries into booked jobs with a clear offer, fast response, planned follow-up, and a cost per booked job you can defend.', 'intermediate'),
  ('sales', 'Sales Systems for Founders', 'Run a repeatable sales process from first call to signed agreement.', 'intermediate'),
  ('ecom', 'E-commerce Operations', 'Run inventory, fulfillment, and margin reviews for a small online store.', 'beginner'),
  ('content', 'Content Engine', 'Publish a weekly content system that feeds the sales pipeline.', 'intermediate'),
  ('creator', 'Content Creation Foundations', 'Plan, script, and edit a month of short videos.', 'beginner')
on conflict (slug) do nothing;

-- ============ The batch queue ============

create table public.catalog_jobs (
  id                     uuid primary key default gen_random_uuid(),
  batch_id               uuid not null,
  topic_slug             text not null check (topic_slug ~ '^[a-z0-9][a-z0-9-]{1,39}$' and topic_slug <> 'gsa'),
  topic_name             text not null,
  audience_level         text not null check (audience_level in ('beginner', 'intermediate', 'advanced')),
  status                 text not null default 'queued' check (status in (
                           'queued', 'researching', 'waiting', 'blueprinting', 'drafting', 'done', 'canceled', 'failed')),
  -- What it is waiting for while status = 'waiting', or why a queued job hasn't run yet.
  waiting_for            text check (waiting_for in ('source_approval', 'blueprint_approval', 'review', 'spend_cap', 'run_time')),
  note                   text,
  research_run_id        uuid references public.research_runs (id),
  blueprint_id           uuid references public.academy_blueprints (id),
  academy_id             uuid references public.academies (id),
  estimate_usd           numeric(10, 2) not null check (estimate_usd >= 0),
  queued_by_account_id   uuid not null references public.accounts (id),
  queued_at              timestamptz not null default now(),
  last_step_at           timestamptz,
  finished_at            timestamptz,
  retention_class        public.retention_class not null default 'operational',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Waiting for a person: source approval, Blueprint approval or review. Held by the spend cap or the night's run time:
  -- only a job whose next step is the AI's (queued: research; blueprinting; drafting).
  constraint catalog_jobs_waiting check ((status = 'waiting') = coalesce(waiting_for in ('source_approval', 'blueprint_approval', 'review'), false)),
  constraint catalog_jobs_held check (coalesce(waiting_for not in ('spend_cap', 'run_time'), true) or status in ('queued', 'blueprinting', 'drafting'))
);
-- One open job per topic.
create unique index catalog_jobs_one_open on public.catalog_jobs (topic_slug) where status not in ('done', 'canceled', 'failed');
create index on public.catalog_jobs (status, queued_at);

-- ============ Activity items ============

create table public.activity_items (
  id                     uuid primary key default gen_random_uuid(),
  lesson_id              uuid not null references public.lessons (id),
  module_id              uuid not null references public.modules (id),
  course_id              uuid not null references public.courses (id),
  idea_key               text not null check (idea_key ~ '^[a-z0-9-]{1,60}$'),   -- variants of one idea share it
  version                integer not null default 1 check (version >= 1),
  previous_item_id       uuid references public.activity_items (id),            -- the item a refreshed draft would replace
  status                 text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'published', 'archived')),
  item_type              text not null check (item_type in (
                           'multiple_choice', 'true_false', 'matching', 'ordering', 'flashcard',
                           'short_answer', 'build_it', 'branching_scenario', 'spot_the_mistake', 'case_teardown', 'teach_back', 'mini_project')),
  grading                text not null check (grading in ('code', 'feedback')),
  level                  text not null check (level in ('beginner', 'intermediate')),
  goal                   text not null check (char_length(goal) between 3 and 300),
  interests              text[] not null default '{}',
  prompt                 text not null check (char_length(prompt) between 3 and 2000),
  content                jsonb not null default '{}' check (jsonb_typeof(content) = 'object'),
  answer_key             jsonb,
  explanation            text not null check (char_length(explanation) between 3 and 2000),
  citation               jsonb not null check (jsonb_typeof(citation) = 'object' and citation ? 'sourceId'),
  generated_by           text not null default 'ai' check (generated_by in ('ai', 'person')),
  model                  text,
  created_by_account_id  uuid references public.accounts (id),
  edited_by_account_id   uuid references public.accounts (id),
  edited_at              timestamptz,
  reviewed_by_account_id uuid references public.accounts (id),
  reviewed_at            timestamptz,
  review_note            text,
  published_by_account_id uuid references public.accounts (id),
  published_at           timestamptz,
  archived_at            timestamptz,
  retention_class        public.retention_class not null default 'content',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Graded by code: exactly the five types, always against an answer key. Feedback only: never a key, never a grade.
  constraint activity_items_grading check (
    (grading = 'code') = (item_type in ('multiple_choice', 'true_false', 'matching', 'ordering', 'flashcard'))
    and (grading = 'code') = (answer_key is not null)),
  constraint activity_items_reviewed check (status not in ('approved', 'rejected', 'published', 'archived') or reviewed_by_account_id is not null),
  constraint activity_items_published check (status not in ('published', 'archived') or published_at is not null)
);
create index on public.activity_items (lesson_id, status);
create index on public.activity_items (module_id, status);
create index on public.activity_items (course_id);

create function private.activity_item_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare src text;
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'archived') then
      raise exception 'ASCENTRA: a published activity item is kept; it is archived when replaced.' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'ASCENTRA: an activity item enters as Draft.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- A published item never changes; it can only be archived when a newer one replaces it.
  if old.status in ('published', 'archived') then
    if (new.item_type, new.grading, new.level, new.goal, new.interests, new.prompt, new.content, new.answer_key, new.explanation, new.citation, new.lesson_id)
       is distinct from (old.item_type, old.grading, old.level, old.goal, old.interests, old.prompt, old.content, old.answer_key, old.explanation, old.citation, old.lesson_id)
       or not (new.status = old.status or (old.status = 'published' and new.status = 'archived')) then
      raise exception 'ASCENTRA: a published activity item is not edited; a refresh drafts a new one.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- Only a Draft is edited; approving, rejecting and publishing follow the review order.
  if old.status in ('approved', 'rejected') and new.status = old.status
     and (new.prompt, new.content, new.answer_key, new.explanation, new.citation, new.item_type, new.level)
         is distinct from (old.prompt, old.content, old.answer_key, old.explanation, old.citation, old.item_type, old.level) then
    raise exception 'ASCENTRA: only a Draft activity item is edited.' using errcode = 'check_violation';
  end if;
  if new.status in ('approved', 'rejected') and old.status <> new.status then
    if old.status <> 'draft' then
      raise exception 'ASCENTRA: only a Draft activity item is approved or rejected.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.accounts a where a.id = new.reviewed_by_account_id and a.role in ('owner', 'admin') and a.status = 'active') then
      raise exception 'ASCENTRA: an activity item is reviewed by the Owner or a Reviewer.' using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'published' and old.status <> 'published' then
    if old.status <> 'approved' then
      raise exception 'ASCENTRA: only an approved activity item is published.' using errcode = 'check_violation';
    end if;
    src := new.citation ->> 'sourceId';
    if not exists (select 1 from public.sources s where s.id::text = src and s.status = 'approved') then
      raise exception 'ASCENTRA: the source this item cites is no longer approved.' using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'draft' and old.status <> 'draft' and old.status <> 'rejected' then
    raise exception 'ASCENTRA: an approved activity item goes back to Draft only by drafting a new one.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.activity_item_rules() from public;
create trigger activity_item_rules before insert or update or delete on public.activity_items
  for each row execute function private.activity_item_rules();

-- Publishing a module's approved items: all at once, only if the module then has at least 3 different activity types
-- (the variety rule). An approved refresh draft archives the published item it replaces.
create function public.publish_module_activities(p_module uuid, p_actor uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare types integer; n integer;
begin
  if not exists (select 1 from public.accounts a where a.id = p_actor and a.role in ('owner', 'admin') and a.status = 'active') then
    raise exception 'ASCENTRA: activity items are published by the Owner or a course builder.' using errcode = 'check_violation';
  end if;
  perform 1 from public.activity_items where module_id = p_module for update;
  select count(distinct item_type) into types from public.activity_items
   where module_id = p_module and (status = 'approved' or (status = 'published' and id not in (
     select previous_item_id from public.activity_items where module_id = p_module and status = 'approved' and previous_item_id is not null)));
  if types < 3 then
    raise exception 'ASCENTRA: a module needs at least 3 different activity types to be published (this one has %).', types using errcode = 'check_violation';
  end if;
  update public.activity_items set status = 'archived', archived_at = now()
   where status = 'published' and id in (select previous_item_id from public.activity_items where module_id = p_module and status = 'approved' and previous_item_id is not null);
  update public.activity_items set status = 'published', published_at = now(), published_by_account_id = p_actor
   where module_id = p_module and status = 'approved';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.publish_module_activities(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_module_activities(uuid, uuid) to service_role;

-- ============ Attempts ============

create table public.activity_attempts (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.activity_items (id),
  account_id          uuid not null references public.accounts (id),
  lesson_version_id   uuid references public.lesson_versions (id),
  graded_by           text not null check (graded_by in ('code', 'none')),
  correct             boolean,
  counted             boolean not null default false,
  answer              jsonb,   -- the choice made, for code-graded items only (common misses); practice text is never stored
  retention_class     public.retention_class not null default 'learning',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((graded_by = 'code') = (correct is not null)),
  check (not counted or graded_by = 'code'),
  check (graded_by = 'code' or answer is null)
);
create index on public.activity_attempts (item_id);
create index on public.activity_attempts (account_id, created_at desc);

create function private.activity_attempt_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare g text; st text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'ASCENTRA: an attempt is kept as recorded.' using errcode = 'insufficient_privilege';
  end if;
  select grading, status into g, st from public.activity_items where id = new.item_id;
  if st is distinct from 'published' then
    raise exception 'ASCENTRA: attempts are made only on published activity items.' using errcode = 'check_violation';
  end if;
  -- Only code grading is a grade; anything else is practice.
  if (g = 'code') <> (new.graded_by = 'code') then
    raise exception 'ASCENTRA: only a code-graded item is graded.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.activity_attempt_rules() from public;
create trigger activity_attempt_rules before insert or update or delete on public.activity_attempts
  for each row execute function private.activity_attempt_rules();

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['catalog_topics', 'catalog_jobs', 'activity_items', 'activity_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;
