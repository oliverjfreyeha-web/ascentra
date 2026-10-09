-- ASCENTRA L8: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0018_interview_and_path (already applied). Applies: 0019_topics_and_picks.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0019_topics_and_picks.sql
-- ============================================================

-- L8: pick your path. A learner answers five short questions, then picks the business and skills they want.
--   topics: the businesses (24, all online and remote) and skills (16) a learner can pick, seeded here and managed by
--     the Owner and authorized staff. teen_hidden topics are never shown to, or pickable by, a learner under 18.
--     has_course says whether a course exists yet ("Course coming" when not).
--   learner_picks: one row per learner and topic. Written only by the functions below, which hold the plan rules
--     inside one transaction per learner, so parallel requests cannot go past a limit:
--       Basic and the trial: up to 3 active skills (swappable) and 1 business, locked once chosen (only the Owner
--         changes it, with a reason, audited by the API);
--       Pro: any number of skills, 1 active business at a time, switching allowed (the old one is paused, not deleted);
--       Pro to Basic: the active business and 3 skills stay active, the rest are paused. Nothing is deleted.
--   topic_interest: anonymous demand, a count per topic per day, added to when a learner picks a topic with no course
--     yet. There is no column that could hold who picked.
--   profiles: five short answer columns for the "Choose your path" questions (fixed lists, no free text).
-- Safe with the L7 code: nothing before L8 reads or writes these tables or columns.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0018_interview_and_path'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L7 (0018) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0019_topics_and_picks');

-- ============ The five answers, on the learner profile ============

alter table public.profiles
  add column path_goal        text check (path_goal in ('start', 'freelance', 'skills', 'explore')),
  add column path_hours       integer check (path_hours in (2, 5, 10, 15)),
  add column path_experience  text check (path_experience in ('none', 'some', 'experienced')),
  add column path_style       text check (path_style in ('build', 'sell', 'create')),
  add column path_camera      text check (path_camera in ('yes', 'sometimes', 'no')),
  add column path_answered_at timestamptz,
  add constraint profiles_path_answers check (
    (path_answered_at is null) = (path_goal is null)
    and (path_answered_at is null) = (path_hours is null)
    and (path_answered_at is null) = (path_experience is null)
    and (path_answered_at is null) = (path_style is null)
    and (path_answered_at is null) = (path_camera is null));

-- ============ Topics ============

create table public.topics (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('business', 'skill')),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  name             text not null check (char_length(name) between 2 and 80),
  blurb            text not null default '' check (char_length(blurb) <= 300),
  published        boolean not null default false,
  teen_hidden      boolean not null default false,
  has_course       boolean not null default false,
  sort_order       integer not null default 0,
  retention_class  public.retention_class not null default 'content',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, kind)
);
create index on public.topics (kind, sort_order);

-- ============ Picks ============

create table public.learner_picks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.accounts (id),
  topic_id         uuid not null,
  kind             text not null check (kind in ('business', 'skill')),
  status           text not null default 'active' check (status in ('active', 'paused')),
  locked           boolean not null default false,
  picked_at        timestamptz not null default now(),
  retention_class  public.retention_class not null default 'learning',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, topic_id),
  -- The pick's kind is always its topic's kind.
  foreign key (topic_id, kind) references public.topics (id, kind) on update cascade,
  -- Only an active business can be locked.
  constraint learner_picks_lock check (not locked or (kind = 'business' and status = 'active'))
);
-- One active business per learner, held by the database itself.
create unique index learner_picks_one_business on public.learner_picks (user_id) where kind = 'business' and status = 'active';
create index on public.learner_picks (topic_id);

-- ============ Anonymous demand ============

create table public.topic_interest (
  id               uuid primary key default gen_random_uuid(),
  topic_id         uuid not null references public.topics (id) on delete cascade,
  day              date not null,
  count            integer not null default 1 check (count >= 1),
  retention_class  public.retention_class not null default 'operational',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (topic_id, day)
);

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['topics', 'learner_picks', 'topic_interest'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- Picks and demand counts change only through the functions below (which run as their owner), never by a direct
-- write, the API's service role included. The API may read them; it may delete picks only for a privacy erasure.
revoke insert, update, truncate on public.learner_picks from service_role;
revoke insert, update, delete, truncate on public.topic_interest from service_role;

-- ============ Who may see what (a signed-in learner calling Supabase directly) ============

-- Whether the caller is under 18. No account (or an unknown one) counts as a teen, so hidden topics stay hidden.
create function private.current_is_minor() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.is_minor from public.accounts a where a.id = private.current_account_id()), true)
$$;
revoke all on function private.current_is_minor() from public;
grant execute on function private.current_is_minor() to authenticated;

-- Learners read published topics only; teens never see teen_hidden ones.
grant select on public.topics to authenticated;
create policy topics_select_visible on public.topics
  for select to authenticated
  using (published and (select private.current_account_id()) is not null
         and (not teen_hidden or not (select private.current_is_minor())));

-- Learners read their own picks only. Nothing is granted for writing: picks change only through the API's functions.
grant select on public.learner_picks to authenticated;
create policy learner_picks_select_own on public.learner_picks
  for select to authenticated
  using (user_id = (select private.current_account_id()));

-- ============ The plan rules ============

-- One learner's picks are changed by one transaction at a time: parallel requests for the same learner wait here.
create function private.lock_picks(p_account uuid) returns void
language sql
set search_path = ''
as $$ select pg_advisory_xact_lock(hashtextextended('learner_picks:' || p_account::text, 0)) $$;
revoke all on function private.lock_picks(uuid) from public;

-- Brings the picks in line with the plan (the caller holds the lock). Returns how many picks it paused.
--   - a pick on a topic the learner can no longer see (unpublished, or teen_hidden for a teen) is paused;
--   - Basic and the trial: 3 active skills at most (the most recently picked stay active), and the active business is
--     locked;
--   - Pro: nothing is locked.
-- Nothing is ever deleted.
create function private.apply_plan_rules(p_account uuid, p_plan text, p_minor boolean) returns integer
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
    update public.learner_picks set locked = true where user_id = p_account and kind = 'business' and status = 'active' and not locked;
  end if;
  return paused;
end $$;
revoke all on function private.apply_plan_rules(uuid, text, boolean) from public;

create function private.check_plan(p_plan text) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_plan is null or p_plan not in ('trial', 'basic', 'pro') then
    raise exception 'ASCENTRA: picks need a plan: trial, basic or pro.' using errcode = 'check_violation';
  end if;
end $$;
revoke all on function private.check_plan(text) from public;

-- Applies the plan rules for a learner (e.g. after a Pro to Basic change). Returns how many picks were paused.
create function public.reconcile_picks(p_account uuid, p_plan text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_minor boolean;
begin
  perform private.check_plan(p_plan);
  perform private.lock_picks(p_account);
  select a.is_minor into v_minor from public.accounts a where a.id = p_account;
  if not found then return 0; end if;
  return private.apply_plan_rules(p_account, p_plan, v_minor);
end $$;

-- A learner picks (or picks again) a topic. Returns { result, ... }:
--   picked | already | not_available (unpublished, hidden for a teen, or no such topic) | no_account
--   | limit (Basic and trial: 3 skills; with limit and used) | locked (Basic and trial: the business is locked).
-- On Pro, picking a business pauses the current one (kept, with its progress). A topic with no course yet still saves
-- the pick and adds one to that day's anonymous demand count.
create function public.pick_topic(p_account uuid, p_topic uuid, p_plan text) returns jsonb
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
    select topic_id into v_current from public.learner_picks where user_id = p_account and kind = 'business' and status = 'active';
    if v_current is not null then
      if p_plan <> 'pro' then return jsonb_build_object('result', 'locked', 'current', v_current); end if;
      update public.learner_picks set status = 'paused', locked = false where user_id = p_account and topic_id = v_current;
    end if;
  end if;

  if v_pick is not null then
    update public.learner_picks set status = 'active', picked_at = now(), locked = (t.kind = 'business' and p_plan <> 'pro')
     where id = v_pick;
  else
    insert into public.learner_picks (user_id, topic_id, kind, status, locked)
    values (p_account, p_topic, t.kind, 'active', t.kind = 'business' and p_plan <> 'pro');
  end if;

  if not t.has_course then
    insert into public.topic_interest (topic_id, day) values (p_topic, private.us_today())
    on conflict (topic_id, day) do update set count = public.topic_interest.count + 1;
  end if;
  return jsonb_build_object('result', 'picked', 'kind', t.kind, 'previous', v_current, 'has_course', t.has_course);
end $$;

-- A learner sets a pick aside (paused, kept). Returns { result }: paused | not_picked | locked (Basic and trial business).
create function public.pause_pick(p_account uuid, p_topic uuid, p_plan text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_minor boolean; v_kind text; v_status text; v_locked boolean;
begin
  perform private.check_plan(p_plan);
  perform private.lock_picks(p_account);
  select a.is_minor into v_minor from public.accounts a where a.id = p_account;
  if not found then return jsonb_build_object('result', 'not_picked'); end if;
  perform private.apply_plan_rules(p_account, p_plan, v_minor);
  select kind, status, locked into v_kind, v_status, v_locked from public.learner_picks where user_id = p_account and topic_id = p_topic;
  if not found or v_status <> 'active' then return jsonb_build_object('result', 'not_picked'); end if;
  if v_locked then return jsonb_build_object('result', 'locked'); end if;
  update public.learner_picks set status = 'paused' where user_id = p_account and topic_id = p_topic;
  return jsonb_build_object('result', 'paused', 'kind', v_kind);
end $$;

-- The Owner changes a learner's business (p_topic) or releases it (p_topic null) so the learner may choose again.
-- The API checks the caller is the Owner and records the change, with its reason, in the audit log.
-- Returns { result, previous, next }: changed | released | unchanged | not_available | no_account.
create function public.owner_set_business(p_account uuid, p_topic uuid, p_plan text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_minor boolean; t public.topics%rowtype; v_current uuid;
begin
  perform private.check_plan(p_plan);
  perform private.lock_picks(p_account);
  select a.is_minor into v_minor from public.accounts a where a.id = p_account;
  if not found then return jsonb_build_object('result', 'no_account'); end if;
  perform private.apply_plan_rules(p_account, p_plan, v_minor);
  select topic_id into v_current from public.learner_picks where user_id = p_account and kind = 'business' and status = 'active';
  if p_topic is null then
    if v_current is null then return jsonb_build_object('result', 'unchanged', 'previous', null, 'next', null); end if;
    update public.learner_picks set status = 'paused', locked = false where user_id = p_account and topic_id = v_current;
    return jsonb_build_object('result', 'released', 'previous', v_current, 'next', null);
  end if;
  select * into t from public.topics where id = p_topic;
  -- The teen rule holds for the Owner too.
  if not found or t.kind <> 'business' or not t.published or (t.teen_hidden and v_minor) then
    return jsonb_build_object('result', 'not_available');
  end if;
  if v_current = p_topic then return jsonb_build_object('result', 'unchanged', 'previous', v_current, 'next', v_current); end if;
  if v_current is not null then
    update public.learner_picks set status = 'paused', locked = false where user_id = p_account and topic_id = v_current;
  end if;
  insert into public.learner_picks (user_id, topic_id, kind, status, locked)
  values (p_account, p_topic, 'business', 'active', p_plan <> 'pro')
  on conflict (user_id, topic_id) do update set status = 'active', picked_at = now(), locked = excluded.locked;
  return jsonb_build_object('result', 'changed', 'previous', v_current, 'next', p_topic);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.reconcile_picks(uuid, text)', 'public.pick_topic(uuid, uuid, text)',
                           'public.pause_pick(uuid, uuid, text)', 'public.owner_set_business(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ============ The seeded topics (the Owner reviews them in /admin/topics) ============

insert into public.topics (kind, slug, name, blurb, published, teen_hidden, sort_order) values
  ('business', 'ai-automation-agency', 'AI automation agency', 'Set up AI tools and simple automations that save small businesses time.', true, false, 10),
  ('business', 'website-design', 'Website design and building for businesses', 'Design and build clear, fast websites for local and online businesses.', true, false, 20),
  ('business', 'social-media-marketing-agency', 'Social media marketing agency', 'Plan, post and report on social media for businesses.', true, false, 30),
  ('business', 'seo-services', 'SEO services', 'Help businesses get found in search with better pages and content.', true, false, 40),
  ('business', 'ai-content-copywriting', 'AI content and copywriting services', 'Write and edit web copy, emails and posts, using AI tools with care.', true, false, 50),
  ('business', 'video-editing', 'Video editing for creators and brands', 'Edit short and long videos for creators and companies.', true, false, 60),
  ('business', 'graphic-design', 'Freelance graphic design', 'Make logos, social graphics and simple brand kits for clients.', true, false, 70),
  ('business', 'ugc-content', 'UGC content creation', 'Film short, honest product videos that brands use in their marketing.', true, false, 80),
  ('business', 'virtual-assistant', 'Virtual assistant services', 'Handle inboxes, calendars, research and admin work remotely.', true, false, 90),
  ('business', 'lead-generation', 'Lead generation for online businesses', 'Find and qualify potential customers for online businesses.', true, false, 100),
  ('business', 'online-tutoring', 'Online tutoring and test prep', 'Tutor students online in subjects and tests you know well.', true, false, 110),
  ('business', 'online-coaching', 'Online coaching and consulting', 'Coach or advise clients online in an area you have real experience in.', true, true, 120),
  ('business', 'no-code-apps', 'No-code and simple app building', 'Build simple apps and internal tools with no-code platforms.', true, false, 130),
  ('business', 'podcast-editing-voiceover', 'Podcast editing and voiceover', 'Edit podcast audio and record clear voiceovers.', true, false, 140),
  ('business', 'shopify-store', 'E-commerce store with Shopify', 'Plan, build and run an online store on Shopify.', true, false, 150),
  ('business', 'amazon-fba', 'Amazon FBA', 'Learn how selling through Amazon''s fulfillment program works. Seller accounts require adults.', true, true, 160),
  ('business', 'dropshipping', 'Dropshipping', 'Learn how stores sell products shipped directly by a supplier, and the risks involved.', true, true, 170),
  ('business', 'print-on-demand', 'Print on demand', 'Design products that a print partner makes and ships when ordered.', true, false, 180),
  ('business', 'digital-products', 'Digital products and templates', 'Create templates, guides and other digital products.', true, false, 190),
  ('business', 'online-reselling', 'Online reselling and flipping', 'Learn how buying and reselling items online works. Marketplace accounts require adults.', true, true, 200),
  ('business', 'youtube-channel', 'YouTube channel', 'Plan, film and publish videos on a channel of your own.', true, false, 210),
  ('business', 'faceless-content', 'Faceless content channels', 'Make videos and posts without appearing on camera.', true, false, 220),
  ('business', 'newsletter', 'Newsletter business', 'Write a regular email newsletter for a clear audience.', true, false, 230),
  ('business', 'affiliate-marketing', 'Affiliate marketing', 'Learn how product referrals work, including the disclosure rules.', true, true, 240),
  ('skill', 'sales-fundamentals', 'Sales fundamentals', 'How a sale works, from first hello to a clear yes or no.', true, false, 10),
  ('skill', 'cold-outreach', 'Cold outreach', 'Reach people who don''t know you yet, politely and within the rules.', true, false, 20),
  ('skill', 'discovery-calls', 'Discovery calls', 'Ask good questions to understand what a client needs.', true, false, 30),
  ('skill', 'negotiation', 'Negotiation', 'Reach fair agreements on price, scope and timing.', true, false, 40),
  ('skill', 'marketing-basics', 'Marketing basics', 'Who you serve, what you offer and how they hear about it.', true, false, 50),
  ('skill', 'copywriting', 'Copywriting', 'Write clear words that help people decide.', true, false, 60),
  ('skill', 'social-media-content', 'Social media content', 'Plan and make posts people want to read and share.', true, false, 70),
  ('skill', 'short-form-video', 'Short-form video', 'Film and edit short vertical videos.', true, false, 80),
  ('skill', 'personal-branding', 'Personal branding', 'Show your work and what you stand for, consistently.', true, false, 90),
  ('skill', 'pricing-your-work', 'Pricing your work', 'Set prices you can explain, and adjust them over time.', true, false, 100),
  ('skill', 'customer-service', 'Customer service', 'Help customers well, including when something goes wrong.', true, false, 110),
  ('skill', 'email-marketing', 'Email marketing', 'Build a list with permission and write emails people open.', true, false, 120),
  ('skill', 'time-management', 'Time management', 'Plan your week and protect time for the work that matters.', true, false, 130),
  ('skill', 'public-speaking', 'Public speaking', 'Speak clearly to a group, in person or on a call.', true, false, 140),
  ('skill', 'ai-tools-for-business', 'AI tools for business', 'Use AI tools for everyday business tasks, and check their work.', true, false, 150),
  ('skill', 'project-management', 'Project management', 'Break work into steps, track it and deliver on time.', true, false, 160);

commit;
