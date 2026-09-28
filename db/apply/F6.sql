-- ASCENTRA F6: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0006_audit_store (already applied). Applies: 0007_devices_and_sessions.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0007_devices_and_sessions.sql
-- ============================================================

-- F6: trusted devices, sessions, and the account-sharing tracker.
-- trusted_devices (F3) gains a device key (the SHA-256 of a random cookie value; the cookie itself is
-- never stored) and a slot claim that counts and inserts under one lock, so parallel sign-ins can't
-- go past the limit. session_events (F3) gains one row per session: device, start, last heartbeat,
-- end, and whether it is active or paused. Four new tables hold the tracker's signals, the flags it
-- raises, the graduated steps (Notice, Verify, Limit, Suspend) and appeals.
-- No IP address is stored anywhere: only an approximate region and whole-degree coordinates.
-- Safe with the F5 code: nothing before F6 reads or writes these tables or columns.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0006_audit_store'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply F5 (0006) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0007_devices_and_sessions');

-- ============ Trusted devices ============

alter table public.trusted_devices
  add column device_key_hash  text check (device_key_hash ~ '^[0-9a-f]{64}$'),
  add column trusted_at       timestamptz,
  add column revoked_reason   text,
  add column replaced_by_id   uuid references public.trusted_devices (id);

-- One trusted row per device key per account.
create unique index trusted_devices_one_key on public.trusted_devices (account_id, device_key_hash)
  where trust_state = 'trusted';
create index trusted_devices_account_state on public.trusted_devices (account_id, trust_state);

-- Registers a device, or replaces one, under a per-account lock. The limit comes from the app's
-- config (DEVICE_LIMIT) so there is one place to change it. Outcomes:
--   existing   the key is already trusted (nothing changes)
--   registered a free slot was used
--   replaced   p_replace was revoked and the new device took its slot
--   full       every slot is taken; nothing changes
--   not_found  p_replace isn't one of this account's trusted devices; nothing changes
create function public.claim_device_slot(
  p_account uuid, p_key_hash text, p_name text, p_kind text, p_region text, p_limit integer,
  p_replace uuid default null
) returns table (outcome text, device_id uuid, replaced_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('trusted_devices:' || p_account::text, 0));

  select d.id into v_id from public.trusted_devices d
   where d.account_id = p_account and d.device_key_hash = p_key_hash and d.trust_state = 'trusted';
  if v_id is not null then
    update public.trusted_devices set last_seen_at = now() where id = v_id;
    return query select 'existing'::text, v_id, null::uuid;
    return;
  end if;

  if p_replace is not null then
    if not exists (select 1 from public.trusted_devices d
                    where d.id = p_replace and d.account_id = p_account and d.trust_state = 'trusted') then
      return query select 'not_found'::text, null::uuid, null::uuid;
      return;
    end if;
  else
    select count(*) into v_count from public.trusted_devices d
     where d.account_id = p_account and d.trust_state = 'trusted';
    if v_count >= p_limit then
      return query select 'full'::text, null::uuid, null::uuid;
      return;
    end if;
  end if;

  insert into public.trusted_devices (account_id, name, kind, trust_state, approx_region, last_seen_at, device_key_hash, trusted_at)
  values (p_account, p_name, p_kind, 'trusted', p_region, now(), p_key_hash, now())
  returning id into v_id;

  if p_replace is not null then
    update public.trusted_devices
       set trust_state = 'revoked', revoked_at = now(), revoked_reason = 'replaced', replaced_by_id = v_id
     where id = p_replace;
    return query select 'replaced'::text, v_id, p_replace;
    return;
  end if;
  return query select 'registered'::text, v_id, null::uuid;
end;
$$;
revoke all on function public.claim_device_slot(uuid, text, text, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_device_slot(uuid, text, text, text, text, integer, uuid) to service_role;

-- ============ Sessions ============
-- event_type 'session' rows are sessions (one per Clerk session and period of activity); the other
-- types stay point events (sign_in_held, device_added, device_revoked, ...).

alter table public.session_events drop constraint session_events_event_type_check;
alter table public.session_events add constraint session_events_event_type_check check (event_type in (
  'sign_in', 'sign_out', 'sign_in_held', 'device_added', 'device_revoked',
  'password_changed', 'second_factor_changed', 'recovery',
  'session', 'device_replaced'));

alter table public.session_events
  add column clerk_session_id   text,
  add column state              text check (state in ('active', 'paused', 'ended')),
  add column started_at         timestamptz,
  add column activated_at       timestamptz,
  add column last_heartbeat_at  timestamptz,
  add column ended_at           timestamptz,
  add column end_reason         text check (end_reason in ('signed_out', 'signed_out_remotely', 'device_removed', 'timed_out', 'suspended')),
  -- Another live session exists: both devices show "ASCENTRA is open on another device."
  add column conflict           boolean not null default false,
  -- Whole degrees only (about 100 km): enough to tell sign-ins far apart, never a precise location.
  add column approx_lat         smallint check (approx_lat between -90 and 90),
  add column approx_lon         smallint check (approx_lon between -180 and 180),
  add constraint session_rows_complete check (
    event_type <> 'session'
    or (clerk_session_id is not null and state is not null and started_at is not null
        and activated_at is not null and last_heartbeat_at is not null and trusted_device_id is not null
        and ((state = 'ended') = (ended_at is not null)))
  );

-- At most one open session row per Clerk session.
create unique index session_events_one_open on public.session_events (clerk_session_id)
  where event_type = 'session' and ended_at is null;
create index session_events_account_open on public.session_events (account_id, last_heartbeat_at)
  where event_type = 'session' and ended_at is null;
create index session_events_account_time on public.session_events (account_id, occurred_at desc);

-- ============ The sharing tracker ============

create table public.sharing_signals (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id),
  kind              text not null check (kind in ('device_replacement', 'overlapping_sessions', 'distant_sign_ins')),
  points            integer not null check (points > 0),
  detail            text not null,
  session_event_id  uuid references public.session_events (id),
  occurred_at       timestamptz not null default now(),
  retention_class   public.retention_class not null default 'security',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.sharing_flags (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id),
  score            integer not null,
  threshold        integer not null,
  kinds            text[] not null,
  signal_ids       uuid[] not null,
  -- The automatic step it started, if any (Notice or Verify). Later steps need a person.
  step_applied     text check (step_applied in ('notice', 'verify')),
  raised_at        timestamptz not null default now(),
  retention_class  public.retention_class not null default 'security',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (cardinality(kinds) >= 2)
);

-- The graduated steps. The latest row is the account's current step; 'cleared' ends them.
create table public.enforcement_steps (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts (id),
  step                   text not null check (step in ('notice', 'verify', 'limit', 'suspend', 'cleared')),
  automatic              boolean not null,
  applied_by_account_id  uuid references public.accounts (id),
  reason                 text not null check (length(btrim(reason)) >= 5),
  flag_id                uuid references public.sharing_flags (id),
  limit_until            timestamptz,
  -- Notice: when the person read it. Verify: when they re-verified.
  acknowledged_at        timestamptz,
  retention_class        public.retention_class not null default 'security',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Only Notice and Verify are ever automatic; Limit and Suspend always name the person who applied them.
  check (not automatic or step in ('notice', 'verify')),
  check (automatic or applied_by_account_id is not null),
  check ((step = 'limit') = (limit_until is not null))
);
create index enforcement_steps_account_time on public.enforcement_steps (account_id, created_at desc);

-- Limit and Suspend are never applied to the Owner, by anyone.
create function private.protect_owner_from_enforcement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.step in ('limit', 'suspend')
     and exists (select 1 from public.accounts a where a.id = new.account_id and a.role = 'owner') then
    raise exception 'The Owner can''t be limited or suspended.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_owner_from_enforcement() from public;
create trigger protect_owner before insert or update on public.enforcement_steps
  for each row execute function private.protect_owner_from_enforcement();

create sequence public.appeal_reference_seq start 201;

create table public.appeals (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique default ('AP-' || nextval('public.appeal_reference_seq')),
  account_id             uuid not null references public.accounts (id),
  enforcement_step_id    uuid not null references public.enforcement_steps (id),
  step                   text not null check (step in ('notice', 'verify', 'limit', 'suspend')),
  text                   text not null check (length(btrim(text)) between 20 and 2000),
  status                 text not null default 'under_review' check (status in ('under_review', 'accepted', 'declined')),
  decided_by_account_id  uuid references public.accounts (id),
  decision_reason        text,
  decided_at             timestamptz,
  retention_class        public.retention_class not null default 'security',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((status = 'under_review') = (decided_at is null)),
  check (status = 'under_review' or (decided_by_account_id is not null and decision_reason is not null))
);
-- One open appeal per account at a time.
create unique index appeals_one_open on public.appeals (account_id) where status = 'under_review';

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['sharing_signals', 'sharing_flags', 'enforcement_steps', 'appeals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;
revoke all on sequence public.appeal_reference_seq from anon, authenticated;

create index on public.sharing_signals (account_id, occurred_at desc);
create index on public.sharing_signals (session_event_id);
create index on public.sharing_flags (account_id, raised_at desc);
create index on public.enforcement_steps (applied_by_account_id);
create index on public.enforcement_steps (flag_id);
create index on public.appeals (enforcement_step_id);
create index on public.appeals (decided_by_account_id);
create index on public.appeals (status, created_at);
create index on public.trusted_devices (replaced_by_id);

commit;
