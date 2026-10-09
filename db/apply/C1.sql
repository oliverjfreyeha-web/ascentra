-- ASCENTRA C1: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0019_topics_and_picks (already applied). Applies: 0020_course_structure.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0020_course_structure.sql
-- ============================================================

-- C1: course structure v2, the Owner course editor, video slots and the Owner's review.
--   courses: owner_review_required (set for every course version made through the v2 Blueprint or "new version"; the
--     Owner then approves each module before anything in it is published), and unpublishing (hidden from new learners,
--     progress kept).
--   modules: the module recipe (how many videos, quizzes, assignments, sandboxes and interactive sequences, and which
--     learning boosters) and the recommended pace (about one week; no time lock). Caps live in lib/courses/structure.ts.
--   booster_types: the learning boosters the Owner can pick from (an editable list), each with the activity types that
--     carry it. Boosters are activity items like any other: same source, citation and review rules.
--   activity_items: the recipe part an item fills (quiz, assignment, sandbox, sequence or booster).
--   video_slots + video_uploads: a place for each explainer video, with the brief of what it must cover, and the files
--     the Owner uploads (private bucket "course-videos"; learners get short-lived signed links only). Replacing a video
--     adds an upload record; the old one is kept.
--   module_reviews: the Owner's decision per module (approve, or send back with a note), insert-only. A lesson version or
--     activity item of such a course is published only when the module's latest decision approves exactly that version.
--   topics.catalog_slug: the one link between the L8 topics and the L6 catalog (and through it, the course).
--   catalog_jobs.structure: a job queued for a v2 course.
-- Safe with the L8 code: nothing before C1 reads or writes these tables or columns, and every existing course keeps
-- owner_review_required = false (its rules are unchanged).

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0019_topics_and_picks'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L8 (0019) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0020_course_structure');

-- ============ Courses and modules ============

alter table public.courses
  add column owner_review_required boolean not null default false,
  add column unpublished_at timestamptz,
  add column unpublished_by_account_id uuid references public.accounts (id),
  add column unpublish_note text check (char_length(unpublish_note) <= 500),
  add constraint courses_unpublished check ((unpublished_at is null) = (unpublished_by_account_id is null));

alter table public.modules
  -- { videos, quizzes, assignments, sandboxes, sequences, boosters: [key] }. Defaults and caps: lib/courses/structure.ts.
  add column recipe jsonb not null default '{}' check (jsonb_typeof(recipe) = 'object'),
  add column recommended_pace text not null default 'About 1 week' check (char_length(recommended_pace) between 1 and 60);

-- ============ Learning boosters ============

create table public.booster_types (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name             text not null check (char_length(name) between 3 and 80),
  description      text not null default '' check (char_length(description) <= 300),
  item_types       text[] not null check (cardinality(item_types) between 1 and 4 and item_types <@ array[
                     'multiple_choice', 'true_false', 'matching', 'ordering', 'flashcard',
                     'short_answer', 'build_it', 'branching_scenario', 'spot_the_mistake', 'case_teardown', 'teach_back', 'mini_project']),
  active           boolean not null default true,
  sort_order       integer not null default 0,
  retention_class  public.retention_class not null default 'content',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

insert into public.booster_types (key, name, description, item_types, sort_order) values
  ('real-world-teardown', 'Real-world teardown', 'Take apart a real example from the sources and say what works and what doesn''t.', array['case_teardown'], 10),
  ('common-mistakes-hunt', 'Common-mistakes hunt', 'Find the mistake in a short passage, the kind beginners make.', array['spot_the_mistake'], 20),
  ('checklist-or-template', 'Checklist or template', 'A checklist or template the learner fills in for their own work.', array['build_it', 'mini_project'], 30),
  ('tool-shortlist', 'Tool shortlist', 'Compare a few tools from the sources and pick one for a stated need.', array['short_answer', 'case_teardown'], 40),
  ('role-play-scenario', 'Role-play scenario', 'Choose what to say or do in a realistic conversation, and see the outcome.', array['branching_scenario'], 50),
  ('teach-it-back', 'Teach-it-back', 'Explain the idea in your own words, as if to a beginner.', array['teach_back'], 60),
  ('weekly-reflection', 'Weekly reflection', 'A short written reflection on what was tried this week and what comes next.', array['short_answer'], 70);

alter table public.activity_items
  add column recipe_part text check (recipe_part in ('quiz', 'assignment', 'sandbox', 'sequence', 'booster')),
  add column booster_key text references public.booster_types (key) on update cascade,
  add constraint activity_items_booster check ((recipe_part = 'booster') = (booster_key is not null));

-- The part an item fills is part of its content: fixed once it leaves Draft, like the rest.
create function private.activity_item_part_rules() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.recipe_part, new.booster_key) is distinct from (old.recipe_part, old.booster_key) then
    raise exception 'ASCENTRA: only a Draft activity item changes its recipe part.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.activity_item_part_rules() from public;
create trigger activity_item_part_rules before update on public.activity_items
  for each row execute function private.activity_item_part_rules();

-- ============ Video slots and uploads ============

create table public.video_slots (
  id                       uuid primary key default gen_random_uuid(),
  module_id                uuid not null references public.modules (id) on delete cascade,
  lesson_id                uuid references public.lessons (id) on delete set null,   -- where it sits, when inside a lesson
  position                 integer not null check (position >= 1),
  title                    text not null check (char_length(title) between 3 and 200),
  -- { purpose, points: [{ text, sources: [{ sourceId, title }] }], targetMinutes, tone, onScreen: [], avoid: [] }.
  brief                    jsonb not null default '{}' check (jsonb_typeof(brief) = 'object'),
  brief_generated_by       text not null default 'person' check (brief_generated_by in ('ai', 'person')),
  brief_edited_by_account_id uuid references public.accounts (id),
  brief_edited_at          timestamptz,
  status                   text not null default 'waiting' check (status in ('waiting', 'uploaded', 'approved')),
  current_upload_id        uuid,
  -- Captions or a transcript, pasted as text: required before the video is approved (accessibility).
  transcript               text check (char_length(transcript) <= 100000),
  approved_by_account_id   uuid references public.accounts (id),
  approved_at              timestamptz,
  retention_class          public.retention_class not null default 'content',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (module_id, position),
  constraint video_slots_not_attorney check (brief::text !~* 'attorney[- ]?approved|lawyer[- ]?approved'),
  constraint video_slots_approved check ((status = 'approved') = (approved_at is not null and approved_by_account_id is not null)),
  constraint video_slots_has_file check (status = 'waiting' or current_upload_id is not null),
  constraint video_slots_transcript check (status <> 'approved' or char_length(btrim(coalesce(transcript, ''))) >= 20)
);
create index on public.video_slots (lesson_id);

create table public.video_uploads (
  id                     uuid primary key default gen_random_uuid(),
  slot_id                uuid not null references public.video_slots (id) on delete restrict,
  -- A new course version's slot gets its own record for the same file, so a path can appear once per slot.
  storage_path           text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm)$'),
  mime                   text not null check (mime in ('video/mp4', 'video/webm')),
  size_bytes             bigint not null check (size_bytes > 0),
  -- pending: a signed upload link was given; accepted: the file is there and its first bytes are a real mp4/webm;
  -- rejected: it wasn't (the file is removed); replaced: a newer accepted upload took its place (kept for the trail).
  status                 text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'replaced')),
  reject_reason          text check (char_length(reject_reason) <= 300),
  original_name          text check (char_length(original_name) <= 200),
  uploaded_by_account_id uuid not null references public.accounts (id),
  uploaded_at            timestamptz not null default now(),
  checked_at             timestamptz,
  replaced_at            timestamptz,
  retention_class        public.retention_class not null default 'content',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((status = 'rejected') = (reject_reason is not null)),
  check (status = 'pending' or checked_at is not null),
  unique (slot_id, storage_path)
);
create index on public.video_uploads (slot_id, uploaded_at desc);

alter table public.video_slots
  add constraint video_slots_current_upload foreign key (current_upload_id) references public.video_uploads (id);

create function private.video_slot_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare up public.video_uploads;
begin
  if new.lesson_id is not null and not exists (select 1 from public.lessons l where l.id = new.lesson_id and l.module_id = new.module_id) then
    raise exception 'ASCENTRA: a video slot sits in a lesson of its own module.' using errcode = 'check_violation';
  end if;
  if new.current_upload_id is not null then
    select * into up from public.video_uploads where id = new.current_upload_id;
    if up.slot_id is distinct from new.id or up.status <> 'accepted' then
      raise exception 'ASCENTRA: a slot shows only an accepted upload of its own.' using errcode = 'check_violation';
    end if;
  end if;
  -- Only the Owner approves a video (and a new file always needs approving again).
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved' or new.current_upload_id is distinct from old.current_upload_id) then
    if tg_op = 'UPDATE' and old.status = 'approved' and new.current_upload_id is distinct from old.current_upload_id then
      raise exception 'ASCENTRA: a new file needs approving again.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.accounts a where a.id = new.approved_by_account_id and a.role = 'owner' and a.status = 'active') then
      raise exception 'ASCENTRA: only the Owner approves a video.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.video_slot_rules() from public;
create trigger video_slot_rules before insert or update on public.video_slots
  for each row execute function private.video_slot_rules();

-- Upload records are kept: never deleted, and only their status moves forward.
create function private.video_upload_rules() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ASCENTRA: upload records are kept for the audit trail.' using errcode = 'insufficient_privilege';
  end if;
  if (new.slot_id, new.storage_path, new.mime, new.size_bytes, new.uploaded_by_account_id, new.uploaded_at)
     is distinct from (old.slot_id, old.storage_path, old.mime, old.size_bytes, old.uploaded_by_account_id, old.uploaded_at) then
    raise exception 'ASCENTRA: an upload record keeps what was uploaded, by whom and when.' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('accepted', 'rejected'))
    or (old.status = 'accepted' and new.status = 'replaced')) then
    raise exception 'ASCENTRA: an upload goes pending -> accepted or rejected, then accepted -> replaced.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.video_upload_rules() from public;
create trigger video_upload_rules before update or delete on public.video_uploads
  for each row execute function private.video_upload_rules();

-- Accepting a checked upload, in one transaction: the slot's previous file is marked replaced (kept), and the slot
-- shows the new one, waiting for the Owner's approval again.
create function public.accept_video_upload(p_upload uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare up public.video_uploads; previous uuid;
begin
  select * into up from public.video_uploads where id = p_upload for update;
  if up.id is null or up.status <> 'pending' then
    raise exception 'ASCENTRA: no pending upload to accept.' using errcode = 'check_violation';
  end if;
  select current_upload_id into previous from public.video_slots where id = up.slot_id for update;
  update public.video_uploads set status = 'accepted', checked_at = now() where id = up.id;
  update public.video_slots set current_upload_id = up.id, status = 'uploaded', approved_at = null, approved_by_account_id = null where id = up.slot_id;
  if previous is not null then
    update public.video_uploads set status = 'replaced', replaced_at = now() where id = previous and status = 'accepted';
  end if;
  return previous;
end $$;
revoke all on function public.accept_video_upload(uuid) from public, anon, authenticated;
grant execute on function public.accept_video_upload(uuid) to service_role;

-- ============ The Owner's review ============

create table public.module_reviews (
  id                     uuid primary key default gen_random_uuid(),
  seq                    bigint generated always as identity unique,
  module_id              uuid not null references public.modules (id),
  course_id              uuid not null references public.courses (id),
  decision               text not null check (decision in ('approved', 'sent_back')),
  note                   text check (char_length(note) <= 1000),
  -- What was approved: one lesson version per lesson (verified in Review, or published), and the module's approved or
  -- published activity items. Anything else needs a new decision.
  lesson_version_ids     uuid[] not null default '{}',
  item_ids               uuid[] not null default '{}',
  decided_by_account_id  uuid not null references public.accounts (id),
  decided_at             timestamptz not null default now(),
  retention_class        public.retention_class not null default 'content',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (decision = 'approved' or char_length(btrim(coalesce(note, ''))) >= 5)
);
create index on public.module_reviews (module_id, seq desc);
create index on public.module_reviews (course_id);

create function private.module_review_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare bad integer; missing integer;
begin
  if not exists (select 1 from public.accounts a where a.id = new.decided_by_account_id and a.role = 'owner' and a.status = 'active') then
    raise exception 'ASCENTRA: only the Owner reviews a module.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.modules m where m.id = new.module_id and m.course_id = new.course_id) then
    raise exception 'ASCENTRA: that module isn''t in that course version.' using errcode = 'check_violation';
  end if;
  new.decided_at := now();
  if new.decision = 'approved' then
    -- Every listed version is a verified one in Review, or published, of a lesson in this module; one per lesson.
    select count(*) into bad from unnest(new.lesson_version_ids) vid
     where not exists (select 1 from public.lesson_versions v join public.lessons l on l.id = v.lesson_id
                       where v.id = vid and l.module_id = new.module_id
                         and ((v.status = 'review' and v.verified_by_account_id is not null) or v.status = 'published'));
    if bad > 0 then
      raise exception 'ASCENTRA: the Owner approves only Reviewer-verified or published lesson versions of this module.' using errcode = 'check_violation';
    end if;
    select count(*) into missing from public.lessons l
     where l.module_id = new.module_id
       and (select count(*) from public.lesson_versions v where v.lesson_id = l.id and v.id = any(new.lesson_version_ids)) <> 1;
    if missing > 0 then
      raise exception 'ASCENTRA: approve one verified version of every lesson in the module.' using errcode = 'check_violation';
    end if;
    select count(*) into bad from unnest(new.item_ids) iid
     where not exists (select 1 from public.activity_items i where i.id = iid and i.module_id = new.module_id and i.status in ('approved', 'published'));
    if bad > 0 then
      raise exception 'ASCENTRA: the Owner approves only reviewed activity items of this module.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.module_review_rules() from public;
create trigger module_review_rules before insert on public.module_reviews
  for each row execute function private.module_review_rules();

-- Sent back: the module's lesson versions in Review go back to Draft, with the Owner's note shown to the builders.
create function private.module_review_sent_back() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'sent_back' then
    update public.lesson_versions v set status = 'draft', returned_note = left('Sent back by the Owner: ' || new.note, 1000)
     from public.lessons l
     where l.id = v.lesson_id and l.module_id = new.module_id and v.status = 'review';
  end if;
  return null;
end $$;
revoke all on function private.module_review_sent_back() from public;
create trigger module_review_sent_back after insert on public.module_reviews
  for each row execute function private.module_review_sent_back();

-- Insert-only, for everyone (the API's service role included).
create trigger reject_update_delete before update or delete on public.module_reviews
  for each row execute function private.reject_change();
create trigger reject_truncate before truncate on public.module_reviews
  for each statement execute function private.reject_change();

-- The module's current decision approves this exact version, made after it was last submitted and verified.
create function private.owner_approved(p_module uuid, p_version uuid, p_after timestamptz) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.decision = 'approved' and p_version = any(r.lesson_version_ids) and r.decided_at >= coalesce(p_after, '-infinity'::timestamptz)
      from public.module_reviews r where r.module_id = p_module order by r.seq desc limit 1), false)
$$;
revoke all on function private.owner_approved(uuid, uuid, timestamptz) from public;

-- Fires before lesson_version_rules (triggers run in name order): a course that needs the Owner's review publishes a
-- lesson version only with the module's current approval of that version; and the course's first publication needs
-- every module approved.
create function private.a_owner_review_lessons() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare req boolean; course_status text; mod uuid;
begin
  if new.status = 'published' and old.status <> 'published' then
    select c.owner_review_required, c.status into req, course_status from public.courses c where c.id = new.course_id;
    if req then
      select l.module_id into mod from public.lessons l where l.id = new.lesson_id;
      if not private.owner_approved(mod, new.id, greatest(new.submitted_at, new.verified_at)) then
        raise exception 'ASCENTRA: the Owner approves this module (with this lesson version) before it is published.' using errcode = 'check_violation';
      end if;
      if course_status not in ('published', 'restored') and exists (
        select 1 from public.modules m where m.course_id = new.course_id
          and coalesce((select r.decision from public.module_reviews r where r.module_id = m.id order by r.seq desc limit 1), 'none') <> 'approved') then
        raise exception 'ASCENTRA: a course is published only when the Owner has approved every module.' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.a_owner_review_lessons() from public;
create trigger a_owner_review_lessons before update on public.lesson_versions
  for each row execute function private.a_owner_review_lessons();

create function private.a_owner_review_items() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare req boolean; ok boolean;
begin
  if new.status = 'published' and old.status <> 'published' then
    select c.owner_review_required into req from public.courses c where c.id = new.course_id;
    if req then
      select coalesce((select r.decision = 'approved' and new.id = any(r.item_ids) and r.decided_at >= coalesce(new.reviewed_at, '-infinity'::timestamptz)
                         from public.module_reviews r where r.module_id = new.module_id order by r.seq desc limit 1), false) into ok;
      if not ok then
        raise exception 'ASCENTRA: the Owner approves this module (with this activity item) before it is published.' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.a_owner_review_items() from public;
create trigger a_owner_review_items before update on public.activity_items
  for each row execute function private.a_owner_review_items();

-- ============ The topic link ============

alter table public.topics
  add column catalog_slug text unique references public.catalog_topics (slug) on update cascade;

alter table public.catalog_jobs
  add column structure smallint not null default 1 check (structure in (1, 2));

-- ============ The v2 Blueprint ============

-- Approving a course Blueprint, as in L2, plus for a v2 plan (plan.structure = 2): 5 or 6 modules, each module's
-- recipe and pace, its video slots with their briefs, and the Owner's review required for this course version.
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
  if v2 and n_modules not between 5 and 6 then
    raise exception 'ASCENTRA: a course has 5 or 6 modules (this outline has %).', n_modules using errcode = 'check_violation';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.courses where academy_id = bp.academy_id;
  insert into public.courses (academy_id, version, status, summary, created_by_account_id, owner_review_required)
    values (bp.academy_id, next_version, 'draft', bp.plan ->> 'outcome', p_actor, v2) returning id into new_course;
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
revoke all on function public.approve_course_blueprint(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_course_blueprint(uuid, uuid) to service_role;

-- ============ The editor: a new Draft course version, and reordering ============

-- An edit to a published course starts here: the next course version, as a Draft copy of the latest one (modules,
-- recipes, lessons, skills, video slots and briefs, the lesson text as new Draft versions, the practice items as new
-- Draft items). Everything in it goes through review and the Owner's approval again. Refused while a Draft version exists.
create function public.new_course_version(p_academy uuid, p_actor uuid) returns uuid
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
  insert into public.courses (academy_id, version, status, summary, created_by_account_id, owner_review_required)
    values (p_academy, src.version + 1, 'draft', src.summary, p_actor, true) returning id into new_course;
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
                                         recipe_part, booster_key)
        select nl, nm, new_course, i.idea_key, 1, 'draft', i.item_type, i.grading, i.level, i.goal, i.interests,
               i.prompt, i.content, i.answer_key, i.explanation, i.citation, i.generated_by, i.model, p_actor, i.recipe_part, i.booster_key
          from public.activity_items i where i.lesson_id = ol.id and i.status in ('approved', 'published');
    end loop;
    insert into public.skills (course_id, module_id, key, name)
      select new_course, nm, s.key, s.name from public.skills s where s.course_id = src.id and s.module_id = om.id
      on conflict (course_id, key) do nothing;
    for vs in select * from public.video_slots where module_id = om.id order by position loop
      -- The brief and transcript carry over; a file carries over as uploaded (the Owner approves it again), with its
      -- own upload record for the new slot (the original record stays with the original slot).
      insert into public.video_slots (module_id, lesson_id, position, title, brief, brief_generated_by, status, transcript)
        values (nm, (lesson_map ->> vs.lesson_id::text)::uuid, vs.position, vs.title, vs.brief, vs.brief_generated_by, 'waiting', vs.transcript)
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
  return new_course;
end $$;
revoke all on function public.new_course_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.new_course_version(uuid, uuid) to service_role;

-- Reorders the modules of a Draft course version, or the lessons of a module in one, in one step (positions are unique).
create function public.reorder_modules(p_course uuid, p_ids uuid[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare st text;
begin
  select status into st from public.courses where id = p_course for update;
  if st is distinct from 'draft' then
    raise exception 'ASCENTRA: only a Draft course version is reordered. Start a new version first.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.modules where course_id = p_course) <> cardinality(p_ids)
     or exists (select 1 from public.modules where course_id = p_course and not (id = any(p_ids))) then
    raise exception 'ASCENTRA: send every module of the course, in the new order.' using errcode = 'check_violation';
  end if;
  -- Positions and codes are unique per course: move them out of the way first.
  update public.modules set position = position + 1000, code = 'tmp-' || id::text where course_id = p_course;
  update public.modules m set position = o.n, code = 'm' || o.n from unnest(p_ids) with ordinality o(id, n) where m.id = o.id;
end $$;
revoke all on function public.reorder_modules(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_modules(uuid, uuid[]) to service_role;

create function public.reorder_lessons(p_module uuid, p_ids uuid[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare st text;
begin
  select c.status into st from public.modules m join public.courses c on c.id = m.course_id where m.id = p_module for update of c;
  if st is distinct from 'draft' then
    raise exception 'ASCENTRA: only a Draft course version is reordered. Start a new version first.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.lessons where module_id = p_module) <> cardinality(p_ids)
     or exists (select 1 from public.lessons where module_id = p_module and not (id = any(p_ids))) then
    raise exception 'ASCENTRA: send every lesson of the module, in the new order.' using errcode = 'check_violation';
  end if;
  update public.lessons set position = position + 1000 where module_id = p_module;
  update public.lessons l set position = o.n from unnest(p_ids) with ordinality o(id, n) where l.id = o.id;
end $$;
revoke all on function public.reorder_lessons(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_lessons(uuid, uuid[]) to service_role;

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['booster_types', 'video_slots', 'video_uploads', 'module_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    if t <> 'module_reviews' then
      execute format('create trigger set_updated_at before update on public.%I
                      for each row execute function private.set_updated_at()', t);
    end if;
  end loop;
end $$;

revoke update, delete, truncate on public.module_reviews from service_role;
revoke delete, truncate on public.video_uploads from service_role;
create index on public.video_slots (current_upload_id);
create index on public.video_slots (approved_by_account_id);
create index on public.video_slots (brief_edited_by_account_id);
create index on public.video_uploads (uploaded_by_account_id);
create index on public.module_reviews (decided_by_account_id);
create index on public.courses (unpublished_by_account_id);
create index on public.activity_items (booster_key);

-- ============ Storage: a private bucket for course videos (Supabase only) ============
-- 50 MB per file (the Supabase Free plan's upload limit; see lib/courses/structure.ts VIDEO_MAX_BYTES), mp4 and webm.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('course-videos', 'course-videos', false, 52428800, array['video/mp4', 'video/webm'])
    on conflict (id) do nothing;
  end if;
end $$;

commit;
