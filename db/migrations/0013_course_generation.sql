-- L2: course generation with live research. AI drafts, people approve.
--   research_runs: an admin researches a topic (audience level, freshness question). Claude's web search finds
--   candidate sources and claims, added to the L1 ledger as PROPOSED (unusable until a Reviewer approves them), and
--   a list of practices, tools or terms that have been replaced (outdated notes the Reviewer sees).
--   academy_blueprints (F3) gains course blueprints: modules, lessons and skills proposed from APPROVED sources only,
--   each lesson's key claims linked to citations. A person edits or approves it before any lesson is written;
--   approving it creates a Draft course version with its modules, lessons and skills.
--   lesson_versions: each drafted lesson is a Draft version with its citations and a "last verified" date taken
--   from its sources. Draft -> Review -> Published, with a Reviewer's verification before publishing. A published
--   version is never edited: a change is a new version. Only published versions reach learners.
--   progress_records gains the lesson version studied (always a published one).
--   ai_calls gains the number of web searches a call made (they are billed per search).
-- Safe with the L1 code: nothing before L2 reads or writes these columns or tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0012_source_library'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L1 (0012) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0013_course_generation');

-- ============ Research runs ============

create table public.research_runs (
  id                     uuid primary key default gen_random_uuid(),
  topic                  text not null check (char_length(topic) between 3 and 200),
  audience_level         text not null check (audience_level in ('beginner', 'intermediate', 'advanced')),
  freshness_question     text not null check (char_length(freshness_question) <= 500),
  status                 text not null check (status in ('completed', 'failed')),
  model                  text not null,
  search_count           integer not null default 0 check (search_count >= 0),
  source_count           integer not null default 0 check (source_count >= 0),
  claim_count            integer not null default 0 check (claim_count >= 0),
  -- [{ item, replacedBy, note, sources: [{ url, title }] }]: what has been replaced, for the Reviewer.
  outdated_notes         jsonb not null default '[]' check (jsonb_typeof(outdated_notes) = 'array'),
  error                  text,
  cost_usd               numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_by_account_id  uuid not null references public.accounts (id),
  retention_class        public.retention_class not null default 'content',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.sources
  add column research_run_id uuid references public.research_runs (id),
  add column page_age text check (char_length(page_age) <= 100);

alter table public.source_claims
  add column research_run_id uuid references public.research_runs (id);

alter table public.ai_calls
  add column web_search_requests integer not null default 0 check (web_search_requests >= 0);

-- ============ Course blueprints ============

alter table public.academy_blueprints
  add column kind text not null default 'learner' check (kind in ('learner', 'course')),
  add column topic text check (char_length(topic) <= 200),
  add column audience_level text check (audience_level in ('beginner', 'intermediate', 'advanced')),
  -- { title, outcome, modules: [{ title, stage, lessons: [{ title, minutes, objectives, keyClaims: [{ claim, sourceId?, claimId?, quote? }] }],
  --   skills: [{ key, name }] }] }. A key claim without a sourceId is marked as having no source.
  add column plan jsonb check (plan is null or jsonb_typeof(plan) = 'object'),
  add column outdated_notes jsonb not null default '[]' check (jsonb_typeof(outdated_notes) = 'array'),
  add column source_ids uuid[] not null default '{}',
  add column research_run_ids uuid[] not null default '{}',
  add column generated_by text not null default 'person' check (generated_by in ('ai', 'person')),
  add column model text,
  add column edited_by_account_id uuid references public.accounts (id),
  add column edited_at timestamptz,
  add column approved_by_account_id uuid references public.accounts (id),
  add column course_id uuid references public.courses (id),
  add constraint academy_blueprints_course_shape
    check (kind <> 'course' or (academy_id is not null and plan is not null and topic is not null and audience_level is not null)),
  add constraint academy_blueprints_course_approved
    check (kind <> 'course' or status <> 'approved' or (approved_by_account_id is not null and approved_at is not null and course_id is not null)),
  add constraint academy_blueprints_not_attorney check (plan is null or plan::text !~* 'attorney[- ]?approved|lawyer[- ]?approved');

-- A course blueprint is edited only while it is a draft; once approved or discarded it stays as it was.
create function private.course_blueprint_rules() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.kind = 'course' and old.status <> 'draft' then
    raise exception 'ASCENTRA: an approved or discarded course blueprint can''t be changed. Generate a new one.' using errcode = 'check_violation';
  end if;
  if old.kind = 'course' and new.kind <> 'course' then
    raise exception 'ASCENTRA: a course blueprint stays a course blueprint.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.course_blueprint_rules() from public;
create trigger course_blueprint_rules before update on public.academy_blueprints
  for each row execute function private.course_blueprint_rules();

-- Approving a course blueprint creates, in one transaction, the next Draft course version with its modules, lessons
-- and skills. Every key claim's source must still be approved. Only the API (service_role) calls it.
create function public.approve_course_blueprint(p_blueprint uuid, p_actor uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  bp public.academy_blueprints;
  new_course uuid;
  next_version integer;
  m jsonb; mi bigint; l jsonb; li bigint; sk jsonb;
  module_id uuid;
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
  select coalesce(max(version), 0) + 1 into next_version from public.courses where academy_id = bp.academy_id;
  insert into public.courses (academy_id, version, status, summary, created_by_account_id)
    values (bp.academy_id, next_version, 'draft', bp.plan ->> 'outcome', p_actor) returning id into new_course;
  for m, mi in select * from jsonb_array_elements(coalesce(bp.plan -> 'modules', '[]')) with ordinality loop
    insert into public.modules (course_id, position, code, title, stage)
      values (new_course, mi, 'm' || mi, coalesce(nullif(m ->> 'title', ''), 'Module ' || mi), nullif(m ->> 'stage', ''))
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
  end loop;
  update public.academy_blueprints
    set status = 'approved', approved_at = now(), approved_by_account_id = p_actor, course_id = new_course
    where id = bp.id;
  return new_course;
end $$;
revoke all on function public.approve_course_blueprint(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_course_blueprint(uuid, uuid) to service_role;

-- ============ Lesson versions ============

create table public.lesson_versions (
  id                        uuid primary key default gen_random_uuid(),
  lesson_id                 uuid not null references public.lessons (id),
  course_id                 uuid not null references public.courses (id),
  version                   integer not null check (version >= 1),
  status                    text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  title                     text not null check (char_length(title) between 1 and 300),
  -- { summary, sections: [{ heading, paragraphs: [{ text, refs: [n] }] }], takeaways: [{ text, refs: [n] }] }.
  -- A paragraph with no refs is shown as having no source.
  body                      jsonb not null check (jsonb_typeof(body) = 'object'),
  -- [{ ref, sourceId, title, url, license, lastChecked }]: what the refs point to.
  citations                 jsonb not null default '[]' check (jsonb_typeof(citations) = 'array'),
  uncited_count             integer not null default 0 check (uncited_count >= 0),
  -- Automatic checks at drafting (e.g. passages removed for copying a source too closely).
  checks                    jsonb not null default '{}' check (jsonb_typeof(checks) = 'object'),
  -- The oldest "last checked" date among the sources it cites: the lesson is no fresher than that.
  last_verified_on          date,
  generated_by              text not null default 'ai' check (generated_by in ('ai', 'person')),
  model                     text,
  blueprint_id              uuid references public.academy_blueprints (id),
  created_by_account_id     uuid not null references public.accounts (id),
  submitted_at              timestamptz,
  submitted_by_account_id   uuid references public.accounts (id),
  verified_at               timestamptz,
  verified_by_account_id    uuid references public.accounts (id),
  verification_note         text check (char_length(verification_note) <= 1000),
  returned_note             text check (char_length(returned_note) <= 1000),
  published_at              timestamptz,
  published_by_account_id   uuid references public.accounts (id),
  archived_at               timestamptz,
  retention_class           public.retention_class not null default 'content',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (lesson_id, version),
  constraint lesson_versions_submitted check (status = 'draft' or (submitted_at is not null and submitted_by_account_id is not null)),
  constraint lesson_versions_verified check (status not in ('published', 'archived')
    or (verified_at is not null and verified_by_account_id is not null and published_at is not null and published_by_account_id is not null)),
  constraint lesson_versions_not_attorney check (body::text !~* 'attorney[- ]?approved|lawyer[- ]?approved')
);
-- One open version (draft or in review) per lesson, and one published.
create unique index lesson_versions_one_open on public.lesson_versions (lesson_id) where status in ('draft', 'review');
create unique index lesson_versions_one_published on public.lesson_versions (lesson_id) where status = 'published';
create index on public.lesson_versions (course_id, status);

create function private.lesson_version_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lesson_course uuid;
  next_version integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'ASCENTRA: lesson versions are kept; archive one instead.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    select m.course_id into lesson_course from public.lessons l join public.modules m on m.id = l.module_id where l.id = new.lesson_id;
    if lesson_course is distinct from new.course_id then
      raise exception 'ASCENTRA: the lesson isn''t in that course version.' using errcode = 'check_violation';
    end if;
    if new.status <> 'draft' or new.submitted_at is not null or new.verified_at is not null or new.published_at is not null then
      raise exception 'ASCENTRA: a new lesson version starts as a Draft.' using errcode = 'check_violation';
    end if;
    select coalesce(max(version), 0) + 1 into next_version from public.lesson_versions where lesson_id = new.lesson_id;
    if new.version <> next_version then
      raise exception 'ASCENTRA: the next version of this lesson is %.', next_version using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- The content is fixed once the version leaves Draft; a change is a new version.
  if (new.title, new.body, new.citations, new.uncited_count, new.last_verified_on, new.lesson_id, new.course_id, new.version, new.generated_by)
     is distinct from (old.title, old.body, old.citations, old.uncited_count, old.last_verified_on, old.lesson_id, old.course_id, old.version, old.generated_by)
     and old.status <> 'draft' then
    raise exception 'ASCENTRA: only a Draft can be changed. Draft a new version instead.' using errcode = 'check_violation';
  end if;
  if (new.lesson_id, new.course_id, new.version) is distinct from (old.lesson_id, old.course_id, old.version) then
    raise exception 'ASCENTRA: a lesson version keeps its lesson and number.' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'review')
         or (old.status = 'review' and new.status in ('draft', 'published'))
         or (old.status = 'published' and new.status = 'archived')) then
      raise exception 'ASCENTRA: a lesson version goes Draft -> Review -> Published (or back to Draft from Review); % -> % isn''t allowed.', old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status = 'draft' then
      -- Returned to its author: the verification no longer holds.
      new.verified_at := null;
      new.verified_by_account_id := null;
      new.verification_note := null;
      new.submitted_at := null;
      new.submitted_by_account_id := null;
    end if;
    if new.status = 'published' then
      if new.verified_by_account_id is null or not exists (
        select 1 from public.accounts a where a.id = new.verified_by_account_id and a.role in ('owner', 'admin') and a.status = 'active') then
        raise exception 'ASCENTRA: a lesson is published only after a Reviewer verifies it.' using errcode = 'check_violation';
      end if;
      if exists (
        select 1 from jsonb_array_elements(new.citations) c
        where not exists (select 1 from public.sources s
                          where s.id = (c ->> 'sourceId')::uuid and s.academy_id is null and s.status = 'approved')) then
        raise exception 'ASCENTRA: a source this lesson cites is no longer approved. Re-approve it or draft a new version.' using errcode = 'check_violation';
      end if;
      -- The version it replaces stays for history (and for learners' progress on it).
      update public.lesson_versions set status = 'archived', archived_at = now()
        where lesson_id = new.lesson_id and status = 'published' and id <> new.id;
      -- The course version goes live with its first published lesson.
      update public.courses set status = 'published', published_at = coalesce(published_at, now())
        where id = new.course_id and status in ('draft', 'review');
    end if;
  elsif old.status <> 'review' and (new.verified_at, new.verified_by_account_id) is distinct from (old.verified_at, old.verified_by_account_id) then
    raise exception 'ASCENTRA: a lesson version is verified while it is in Review.' using errcode = 'check_violation';
  end if;
  if new.verified_by_account_id is not null and new.verified_by_account_id is distinct from old.verified_by_account_id
     and not exists (select 1 from public.accounts a where a.id = new.verified_by_account_id and a.role in ('owner', 'admin') and a.status = 'active') then
    raise exception 'ASCENTRA: only the Owner or a Reviewer verifies a lesson.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.lesson_version_rules() from public;
create trigger lesson_version_rules before insert or update or delete on public.lesson_versions
  for each row execute function private.lesson_version_rules();

-- ============ Progress points to the version studied ============

alter table public.progress_records
  add column lesson_version_id uuid references public.lesson_versions (id);
create unique index progress_records_one_per_version on public.progress_records (account_id, lesson_version_id)
  where lesson_version_id is not null;

create function private.progress_version_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lesson_version_id is not null and (tg_op = 'INSERT' or new.lesson_version_id is distinct from old.lesson_version_id) then
    if not exists (select 1 from public.lesson_versions v
                   where v.id = new.lesson_version_id and v.lesson_id = new.lesson_id and v.status = 'published') then
      raise exception 'ASCENTRA: progress is recorded only on a published lesson version.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.progress_version_rules() from public;
create trigger progress_version_rules before insert or update on public.progress_records
  for each row execute function private.progress_version_rules();

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['research_runs', 'lesson_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

create index on public.research_runs (created_by_account_id);
create index on public.sources (research_run_id);
create index on public.source_claims (research_run_id);
create index on public.academy_blueprints (course_id);
create index on public.academy_blueprints (approved_by_account_id);
create index on public.academy_blueprints (edited_by_account_id);
create index on public.lesson_versions (blueprint_id);
create index on public.lesson_versions (created_by_account_id);
create index on public.lesson_versions (submitted_by_account_id);
create index on public.lesson_versions (verified_by_account_id);
create index on public.lesson_versions (published_by_account_id);
create index on public.progress_records (lesson_version_id);
