-- ASCENTRA S1: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0022_course_import (already applied). Applies: 0023_skill_tracks.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0023_skill_tracks.sql
-- ============================================================

-- S1 · Skill tracks. A skill's course becomes one track: 3 Rounds of 5 sections. The smallest change that fits:
--   courses.is_track: this course version is a track (skills only; never with a size tier).
--   modules.round: the Round (1 to 3) a section belongs to. A section is a module row, so lessons, lesson versions,
--     practice items, video slots, labels, Notebook notes, the Owner's per-module review and publishing all work as they
--     do today. Round r's sections sit at positions 5(r-1)+1 to 5r.
--   The importance-label rules that C2 applies to sized courses also apply to tracks (an item is approved, and a section
--     reviewed, only with its labels).
--   new_course_version also copies a module's Round and the track flag; the per-module copy is now one helper,
--     private.copy_module_into, used by it and by the track importer.
--   public.import_track: the v2 import of one or more Rounds for a skill, in one transaction. Rounds already stored that
--     the file doesn't replace are copied into the new Draft version; a published version is never touched; Round r is
--     refused unless Round r-1 is in the file or in the latest version.
-- Existing courses keep is_track false and round null: their behaviour is unchanged.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0022_course_import'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply I1 (0022) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0023_skill_tracks');

alter table public.courses
  add column is_track boolean not null default false,
  add constraint courses_track_no_tier check (not is_track or size_tier is null);
alter table public.modules
  add column round smallint check (round between 1 and 3);

-- ============ Labels: tracks follow the C2 rules ============

create or replace function private.activity_item_label_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.importance, new.notebook_note, new.mission_type) is distinct from (old.importance, old.notebook_note, old.mission_type) then
    raise exception 'ASCENTRA: an item''s importance, Notebook note and mission type are set while it is a Draft.' using errcode = 'check_violation';
  end if;
  if new.status = 'approved' and old.status <> 'approved'
     and exists (select 1 from public.courses c where c.id = new.course_id and (c.size_tier is not null or c.is_track)) then
    if new.importance is null then
      raise exception 'ASCENTRA: label this item (should know, important or very important) before approving it.' using errcode = 'check_violation';
    end if;
    if new.importance = 'very_important' and new.notebook_note is null then
      raise exception 'ASCENTRA: a "Very important" item needs its Notebook note before it is approved.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function private.module_review_labels() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'approved' and exists (select 1 from public.courses c where c.id = new.course_id and (c.size_tier is not null or c.is_track)) then
    if exists (select 1 from public.video_slots s where s.module_id = new.module_id
                 and (s.importance is null or (s.importance = 'very_important' and s.notebook_note is null)))
       or exists (select 1 from public.activity_items i where i.module_id = new.module_id and i.status in ('draft', 'approved', 'published')
                 and (i.importance is null or (i.importance = 'very_important' and i.notebook_note is null))) then
      raise exception 'ASCENTRA: every video and practice item in this module needs its importance label (and "Very important" ones their Notebook note) first.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- ============ Copying a module into a new version (one helper) ============

-- Copies one module (same position and Round) with its lessons, its latest lesson version (as a Draft), its reviewed
-- practice items (as Drafts), its skills and its video slots (an uploaded video is carried, waiting for approval again).
create function private.copy_module_into(p_module uuid, p_course uuid, p_actor uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  om public.modules; nm uuid;
  ol public.lessons; nl uuid;
  lv public.lesson_versions;
  vs public.video_slots;
  ns uuid; nu uuid;
  lesson_map jsonb := '{}';
begin
  select * into om from public.modules where id = p_module;
  insert into public.modules (course_id, position, code, title, stage, prerequisite_module_ids, unlock_threshold_percent, recipe, recommended_pace, round)
    values (p_course, om.position, om.code, om.title, om.stage, '{}', om.unlock_threshold_percent, om.recipe, om.recommended_pace, om.round)
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
        values (nl, p_course, 1, 'draft', lv.title, lv.body, lv.citations, lv.uncited_count, lv.checks,
                lv.last_verified_on, lv.generated_by, lv.model, lv.blueprint_id, p_actor);
    end if;
    insert into public.activity_items (lesson_id, module_id, course_id, idea_key, version, status, item_type, grading, level, goal, interests,
                                       prompt, content, answer_key, explanation, citation, generated_by, model, created_by_account_id,
                                       recipe_part, booster_key, importance, notebook_note, mission_type)
      select nl, nm, p_course, i.idea_key, 1, 'draft', i.item_type, i.grading, i.level, i.goal, i.interests,
             i.prompt, i.content, i.answer_key, i.explanation, i.citation, i.generated_by, i.model, p_actor, i.recipe_part, i.booster_key,
             i.importance, i.notebook_note, i.mission_type
        from public.activity_items i where i.lesson_id = ol.id
          -- What the module holds: its reviewed items (a published version) or, in a Draft, its drafts too.
          and (i.status in ('approved', 'published')
               or (i.status = 'draft' and exists (select 1 from public.courses c where c.id = om.course_id and c.status = 'draft')));
  end loop;
  insert into public.skills (course_id, module_id, key, name)
    select p_course, nm, s.key, s.name from public.skills s where s.course_id = om.course_id and s.module_id = om.id
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
  return nm;
end $$;
revoke all on function private.copy_module_into(uuid, uuid, uuid) from public;

-- As before (C1, C2), also carrying the track flag and each module's Round. A published version is copied, never edited.
create or replace function public.new_course_version(p_academy uuid, p_actor uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.courses;
  new_course uuid;
  om public.modules;
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
  insert into public.courses (academy_id, version, status, summary, created_by_account_id, owner_review_required, size_tier, license_notice, software_notice, is_track)
    values (p_academy, src.version + 1, 'draft', src.summary, p_actor, true, src.size_tier, src.license_notice, src.software_notice, src.is_track)
    returning id into new_course;
  for om in select * from public.modules where course_id = src.id order by position loop
    perform private.copy_module_into(om.id, new_course, p_actor);
  end loop;
  insert into public.course_capstones (course_id, title, brief, deliverables, checklist, automation, plans_checked_on, freshness_watch)
    select new_course, c.title, c.brief, c.deliverables, c.checklist, c.automation, c.plans_checked_on, c.freshness_watch
      from public.course_capstones c where c.course_id = src.id;
  return new_course;
end $$;

-- ============ The track importer (format v2, skills only) ============

create function public.import_track(p_actor uuid, p_plan jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.topics;
  cslug text;
  acad public.academies;
  base public.courses;
  rounds integer[]; r integer; carried integer[] := '{}';
  doc text; p jsonb;
  s jsonb; sid uuid; src_ids uuid[] := '{}'; new_sources integer := 0;
  next_version integer; new_course uuid; bp uuid;
  om public.modules;
  m jsonb; mid uuid; l jsonb; lid uuid; lessons jsonb; v jsonb; it jsonb;
  n_sections integer := 0; n_lessons integer := 0; n_videos integer := 0; n_items integer := 0; n_carried integer := 0;
begin
  if not exists (select 1 from public.accounts a where a.id = p_actor and a.role = 'owner' and a.status = 'active') then
    raise exception 'ASCENTRA: only the Owner imports a course.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_plan -> 'modules') <> 'array' or jsonb_typeof(p_plan -> 'rounds') <> 'array'
     or jsonb_typeof(p_plan -> 'sources') <> 'array' then
    raise exception 'ASCENTRA: the import plan is incomplete.' using errcode = 'check_violation';
  end if;
  select * into t from public.topics where slug = p_plan ->> 'topicSlug' for update;
  if t.id is null then
    raise exception 'ASCENTRA: unknown topic "%".', p_plan ->> 'topicSlug' using errcode = 'no_data_found';
  end if;
  if t.kind <> 'skill' then
    raise exception 'ASCENTRA: "%" is a %; a track (format 2) is for skills only.', t.name, replace(t.kind, '_', ' ') using errcode = 'check_violation';
  end if;
  rounds := array(select (x ->> 'roundNumber')::integer from jsonb_array_elements(p_plan -> 'rounds') x order by 1);
  if cardinality(rounds) = 0 or exists (select 1 from unnest(rounds) u where u not between 1 and 3)
     or cardinality(rounds) <> (select count(distinct u) from unnest(rounds) u) then
    raise exception 'ASCENTRA: the file''s Rounds are 1, 2 or 3, each once.' using errcode = 'check_violation';
  end if;
  foreach r in array rounds loop
    if (select count(*) from jsonb_array_elements(p_plan -> 'modules') x where (x ->> 'round')::integer = r) <> 5 then
      raise exception 'ASCENTRA: Round % has % sections; a Round has 5.', r,
        (select count(*) from jsonb_array_elements(p_plan -> 'modules') x where (x ->> 'round')::integer = r) using errcode = 'check_violation';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_plan -> 'modules') x
             where (x ->> 'position')::integer not between ((x ->> 'round')::integer - 1) * 5 + 1 and (x ->> 'round')::integer * 5) then
    raise exception 'ASCENTRA: a section is out of its Round.' using errcode = 'check_violation';
  end if;

  -- The one link to the catalog, as "Start course" makes it.
  cslug := coalesce(t.catalog_slug, nullif(regexp_replace(left(t.slug, 40), '-+$', ''), ''), 'topic');
  if t.catalog_slug is null then
    if exists (select 1 from public.topics o where o.catalog_slug = cslug and o.id <> t.id) then
      raise exception 'ASCENTRA: the catalog topic "%" is already linked to another topic.', cslug using errcode = 'unique_violation';
    end if;
    insert into public.catalog_topics (slug, name, outcome, audience_level, origin)
      values (cslug, t.name, nullif(left(t.blurb, 500), ''), coalesce(p_plan ->> 'audienceLevel', 'beginner'), 'owner')
      on conflict (slug) do nothing;
    update public.topics set catalog_slug = cslug where id = t.id;
  end if;
  select * into acad from public.academies where slug = cslug for update;
  if acad.id is null then
    insert into public.academies (slug, name, outcome) values (cslug, left(p_plan ->> 'title', 200), left(p_plan ->> 'summary', 2000)) returning * into acad;
  end if;
  if acad.is_protected_owner then
    raise exception 'ASCENTRA: the Owner Academy is never imported into.' using errcode = 'insufficient_privilege';
  end if;

  -- Round r needs Round r-1: in the file, or in the latest version (Draft or Published).
  select * into base from public.courses where academy_id = acad.id order by version desc limit 1;
  foreach r in array rounds loop
    if r > 1 and not (r - 1 = any(rounds))
       and not (base.id is not null and base.is_track and exists (select 1 from public.modules mm where mm.course_id = base.id and mm.round = r - 1)) then
      raise exception 'ASCENTRA: Round % can''t be added before Round % exists (as a Draft or Published).', r, r - 1 using errcode = 'check_violation';
    end if;
  end loop;

  -- Sources: reused by link, or added as proposed.
  doc := p_plan::text;
  for s in select * from jsonb_array_elements(p_plan -> 'sources') loop
    if (s ->> 'key') !~ '^[A-Za-z0-9_-]{1,40}$' or (s ->> 'url') !~ '^https://' then
      raise exception 'ASCENTRA: a source in the file has a bad id or link.' using errcode = 'check_violation';
    end if;
    select id into sid from public.sources where academy_id is null and lower(url) = lower(s ->> 'url') limit 1;
    if sid is null then
      insert into public.sources (title, source_type, url, kind, license_class, status, added_by_account_id)
        values (left(s ->> 'title', 300), s ->> 'sourceType', s ->> 'url', 'url', s ->> 'licenseClass', 'proposed', p_actor)
        returning id into sid;
      new_sources := new_sources + 1;
    end if;
    src_ids := src_ids || sid;
    doc := replace(doc, '"@@src:' || (s ->> 'key') || '@@"', '"' || sid::text || '"');
  end loop;
  if position('@@src:' in doc) > 0 then
    raise exception 'ASCENTRA: something in the file cites a source that isn''t in its sources list.' using errcode = 'check_violation';
  end if;
  p := doc::jsonb;

  -- The new Draft version: the stored Rounds the file doesn't replace, then the file's Rounds.
  select coalesce(max(version), 0) + 1 into next_version from public.courses where academy_id = acad.id;
  insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by, source_ids)
    values (p_actor, acad.id, 'course', left(p ->> 'title', 200), coalesce(p ->> 'audienceLevel', 'beginner'), p -> 'blueprint', 'person', src_ids)
    returning id into bp;
  insert into public.courses (academy_id, version, status, summary, created_by_account_id, owner_review_required, is_track)
    values (acad.id, next_version, 'draft', p ->> 'summary', p_actor, true, true)
    returning id into new_course;
  if base.id is not null and base.is_track then
    for om in select * from public.modules where course_id = base.id and round is not null and not (round = any(rounds)) order by position loop
      perform private.copy_module_into(om.id, new_course, p_actor);
      n_carried := n_carried + 1;
      if not (om.round = any(carried)) then carried := carried || om.round::integer; end if;
    end loop;
  end if;

  for m in select * from jsonb_array_elements(p -> 'modules') loop
    insert into public.modules (course_id, position, code, title, stage, recipe, round)
      values (new_course, (m ->> 'position')::integer, 'r' || (m ->> 'round') || 's' || ((m ->> 'position')::integer - ((m ->> 'round')::integer - 1) * 5),
              m ->> 'title', null, m -> 'recipe', (m ->> 'round')::smallint)
      returning id into mid;
    n_sections := n_sections + 1;
    lessons := '{}';
    for l in select * from jsonb_array_elements(m -> 'lessons') loop
      insert into public.lessons (module_id, position, title, minutes, objectives, content)
        values (mid, (l ->> 'position')::integer, l ->> 'title', (l ->> 'minutes')::integer,
                array(select jsonb_array_elements_text(coalesce(l -> 'objectives', '[]'))),
                jsonb_build_object('keyClaims', '[]'::jsonb, 'blueprintId', bp))
        returning id into lid;
      insert into public.lesson_versions (lesson_id, course_id, version, status, title, body, citations, uncited_count, generated_by, blueprint_id, created_by_account_id)
        values (lid, new_course, 1, 'draft', l ->> 'title', l -> 'body', l -> 'citations', coalesce((l ->> 'uncited')::integer, 0), 'person', bp, p_actor);
      lessons := lessons || jsonb_build_object(l ->> 'position', lid);
      n_lessons := n_lessons + 1;
    end loop;
    for v in select * from jsonb_array_elements(coalesce(m -> 'videos', '[]')) loop
      insert into public.video_slots (module_id, lesson_id, position, title, brief, brief_generated_by, importance, notebook_note)
        values (mid, (lessons ->> (v ->> 'lessonPosition'))::uuid, (v ->> 'position')::integer, v ->> 'title', v -> 'brief', 'person',
                v ->> 'importance', v ->> 'notebookNote');
      n_videos := n_videos + 1;
    end loop;
    for it in select * from jsonb_array_elements(coalesce(m -> 'items', '[]')) loop
      if lessons ->> (it ->> 'lessonPosition') is null then
        raise exception 'ASCENTRA: an item points to a lesson the section doesn''t have.' using errcode = 'check_violation';
      end if;
      insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, content, answer_key,
                                         explanation, citation, generated_by, created_by_account_id, recipe_part, booster_key, importance, notebook_note)
        values ((lessons ->> (it ->> 'lessonPosition'))::uuid, mid, new_course, it ->> 'ideaKey', it ->> 'itemType', it ->> 'grading', it ->> 'level',
                it ->> 'goal', it ->> 'prompt', coalesce(it -> 'content', '{}'), case when jsonb_typeof(it -> 'answerKey') = 'object' then it -> 'answerKey' end,
                it ->> 'explanation', it -> 'citation', 'person', p_actor, it ->> 'part', it ->> 'booster', it ->> 'importance', it ->> 'notebookNote');
      n_items := n_items + 1;
    end loop;
  end loop;

  update public.academy_blueprints set status = 'approved', approved_at = now(), approved_by_account_id = p_actor, course_id = new_course where id = bp;

  return jsonb_build_object(
    'courseId', new_course, 'academySlug', cslug, 'version', next_version, 'blueprintId', bp, 'rounds', to_jsonb(rounds), 'carriedRounds', to_jsonb(carried),
    'counts', jsonb_build_object('sections', n_sections, 'lessons', n_lessons, 'videoSlots', n_videos, 'items', n_items, 'carriedSections', n_carried,
                                 'sources', jsonb_array_length(p_plan -> 'sources'), 'newSources', new_sources));
end $$;
revoke all on function public.import_track(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_track(uuid, jsonb) to service_role;

-- To undo: drop function public.import_track(uuid, jsonb); drop function private.copy_module_into(uuid, uuid, uuid) after
-- re-creating new_course_version from 0021; alter table public.modules drop column round; alter table public.courses drop
-- column is_track; delete from private.schema_migrations where version = '0023_skill_tracks'. Only safe before any track exists.

commit;
