-- I1 · Import course. One function, no new tables: the Owner's finished course file (checked first by the app,
-- lib/courses/import-format.ts) becomes a new Draft version in the existing tables, in one transaction (all or nothing):
--   sources: each cited source in the library (academy_id null) by its link; a link already there is reused, a new one
--     is added as "proposed" (a Reviewer or the Owner approves it as usual; nothing is approved here).
--   academy_blueprints: the import record (kind 'course', generated_by 'person', approved by the Owner) holding the
--     plan in the same v2 shape the editor reads, plus what the file has that has no other home (the course guide,
--     resources, freshness watch list, module details). No file contents are logged anywhere.
--   courses (a new Draft version, owner_review_required, size_tier, notices), modules (with recipes), lessons and
--     lesson_versions (Draft), video_slots (waiting for video, labelled), activity_items (Draft, labelled), and the
--     course_capstones row.
-- The topic is linked to the catalog the way "Start course" links it (topics.catalog_slug). Topic cost, outlook and
-- teen settings are never written. A topic whose course has ever been published is refused: a published version is
-- never touched. An existing Draft stays as it is; the import becomes the next version.
-- Only the Owner may call it (checked here as well as by the API). Safe with the C2 code: nothing else calls it.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0021_progress_and_paths'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply C2 (0021) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0022_course_import');

create function public.import_course(p_actor uuid, p_plan jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.topics;
  cslug text;
  acad public.academies;
  tier text; lo integer; hi integer; n integer;
  doc text; p jsonb;
  s jsonb; sid uuid; src_ids uuid[] := '{}'; new_sources integer := 0;
  next_version integer; new_course uuid; bp uuid;
  m jsonb; mid uuid; l jsonb; lid uuid; lessons jsonb; v jsonb; it jsonb;
  n_lessons integer := 0; n_videos integer := 0; n_items integer := 0;
begin
  if not exists (select 1 from public.accounts a where a.id = p_actor and a.role = 'owner' and a.status = 'active') then
    raise exception 'ASCENTRA: only the Owner imports a course.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_plan -> 'modules') <> 'array' or jsonb_typeof(p_plan -> 'sources') <> 'array' then
    raise exception 'ASCENTRA: the import plan is incomplete.' using errcode = 'check_violation';
  end if;

  select * into t from public.topics where slug = p_plan ->> 'topicSlug' for update;
  if t.id is null then
    raise exception 'ASCENTRA: unknown topic "%".', p_plan ->> 'topicSlug' using errcode = 'no_data_found';
  end if;
  tier := p_plan ->> 'sizeTier';
  if tier is null or tier not in ('compact', 'standard', 'large') then
    raise exception 'ASCENTRA: the course size is compact, standard or large.' using errcode = 'check_violation';
  end if;
  lo := case tier when 'compact' then 3 when 'standard' then 5 else 7 end;
  hi := case tier when 'compact' then 4 when 'standard' then 6 else 9 end;
  n := jsonb_array_length(p_plan -> 'modules');
  if n not between lo and hi then
    raise exception 'ASCENTRA: a % course has % to % modules (this file has %).', initcap(tier), lo, hi, n using errcode = 'check_violation';
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
  if exists (select 1 from public.courses c where c.academy_id = acad.id and c.published_at is not null) then
    raise exception 'ASCENTRA: "%" already has a published course. An import never changes it; start a new version from the course editor instead.', t.name
      using errcode = 'check_violation';
  end if;

  -- Sources: the file's ids become library sources (reused by link, or added as proposed).
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

  -- The new Draft version (an earlier Draft is left as it is).
  select coalesce(max(version), 0) + 1 into next_version from public.courses where academy_id = acad.id;
  insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by, source_ids)
    values (p_actor, acad.id, 'course', left(p ->> 'title', 200), coalesce(p ->> 'audienceLevel', 'beginner'), p -> 'blueprint', 'person', src_ids)
    returning id into bp;
  insert into public.courses (academy_id, version, status, summary, created_by_account_id, owner_review_required, size_tier, license_notice, software_notice)
    values (acad.id, next_version, 'draft', p ->> 'summary', p_actor, true, tier, p #>> '{notices,license}', p #>> '{notices,software}')
    returning id into new_course;

  for m in select * from jsonb_array_elements(p -> 'modules') loop
    insert into public.modules (course_id, position, code, title, stage, recipe)
      values (new_course, (m ->> 'position')::integer, 'm' || (m ->> 'position'), m ->> 'title', null, m -> 'recipe')
      returning id into mid;
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
        raise exception 'ASCENTRA: an item points to a lesson the module doesn''t have.' using errcode = 'check_violation';
      end if;
      insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, content, answer_key,
                                         explanation, citation, generated_by, created_by_account_id, recipe_part, booster_key, importance, notebook_note)
        values ((lessons ->> (it ->> 'lessonPosition'))::uuid, mid, new_course, it ->> 'ideaKey', it ->> 'itemType', it ->> 'grading', it ->> 'level',
                it ->> 'goal', it ->> 'prompt', coalesce(it -> 'content', '{}'), case when jsonb_typeof(it -> 'answerKey') = 'object' then it -> 'answerKey' end,
                it ->> 'explanation', it -> 'citation', 'person', p_actor, it ->> 'part', it ->> 'booster', it ->> 'importance', it ->> 'notebookNote');
      n_items := n_items + 1;
    end loop;
  end loop;

  insert into public.course_capstones (course_id, title, brief, deliverables, checklist, automation, plans_checked_on)
    values (new_course, p #>> '{capstone,title}', coalesce(p #>> '{capstone,brief}', ''), coalesce(p #> '{capstone,deliverables}', '[]'),
            coalesce(p #> '{capstone,checklist}', '[]'),
            case when jsonb_typeof(p #> '{capstone,automation}') = 'object' then p #> '{capstone,automation}' end,
            (p #>> '{capstone,plansCheckedOn}')::date);

  update public.academy_blueprints set status = 'approved', approved_at = now(), approved_by_account_id = p_actor, course_id = new_course where id = bp;

  return jsonb_build_object(
    'courseId', new_course, 'academySlug', cslug, 'version', next_version, 'blueprintId', bp,
    'counts', jsonb_build_object('modules', n, 'lessons', n_lessons, 'videoSlots', n_videos, 'items', n_items,
                                 'sources', jsonb_array_length(p_plan -> 'sources'), 'newSources', new_sources));
end $$;
revoke all on function public.import_course(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_course(uuid, jsonb) to service_role;

-- To undo: drop function public.import_course(uuid, jsonb); delete from private.schema_migrations where version = '0022_course_import';
-- Courses already imported stay as ordinary Draft (or later) versions.
