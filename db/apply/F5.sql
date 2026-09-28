-- ASCENTRA F5: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0005_roles_and_invites (already applied). Applies: 0006_audit_store.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0006_audit_store.sql
-- ============================================================

-- F5: the append-only audit store.
-- audit_events (insert-only since 0004) gains the prototype's remaining fields (actor role, target label),
-- request and device ids, and a hash chain: every row stores the previous row's hash and its own.
-- The chain is built here, in a BEFORE INSERT trigger, so no writer can skip or forge it; verification
-- (public.audit_verify_chain) recomputes it and reports the first break.
-- Safe with the F4 code: nothing before F5 writes or reads audit_events.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0005_roles_and_invites'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply F4 (0005) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0006_audit_store');

alter table public.audit_events
  add column actor_role    text,
  add column target_label  text,
  add column request_id    text,
  add column device_id     uuid references public.trusted_devices (id),
  add column seq           bigint,
  add column prev_hash     text,
  add column row_hash      text;

-- ============ The chain ============

-- The canonical content of a row, hashed with the previous row's hash. Times are hashed as
-- microseconds since the epoch so the result doesn't depend on the session's time zone.
create function private.audit_row_hash(e public.audit_events) returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(jsonb_build_array(
    e.seq, e.prev_hash, e.id,
    (extract(epoch from e.occurred_at) * 1000000)::bigint,
    e.actor_account_id, e.actor_label, e.actor_role,
    e.action, e.context, e.target_type, e.target_id, e.target_label,
    e.previous_value, e.new_value, e.reason, e.result, e.status, e.is_sensitive,
    e.request_id, e.device_id
  )::text, 'UTF8')), 'hex')
$$;
revoke all on function private.audit_row_hash(public.audit_events) from public;

-- Every insert takes the chain lock, so rows are chained in commit order even under concurrent writes.
create function private.audit_chain() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare last record;
begin
  perform pg_advisory_xact_lock(hashtext('ascentra.audit_events.chain'));
  select seq, row_hash into last from public.audit_events order by seq desc limit 1;
  new.seq := coalesce(last.seq, 0) + 1;
  new.prev_hash := coalesce(last.row_hash, repeat('0', 64));
  new.occurred_at := coalesce(new.occurred_at, now());
  new.created_at := now();
  new.updated_at := new.created_at;
  new.row_hash := private.audit_row_hash(new);
  return new;
end $$;
revoke all on function private.audit_chain() from public;

-- Rows written before F5 (if any) join the chain in time order. They can only be touched here,
-- inside this migration, with the insert-only trigger briefly off; it is back on before commit.
alter table public.audit_events disable trigger reject_update_delete;
do $$
declare r record; prev text := repeat('0', 64); n bigint := 0;
begin
  for r in select id from public.audit_events order by occurred_at, created_at, id loop
    n := n + 1;
    update public.audit_events set seq = n, prev_hash = prev where id = r.id;
    update public.audit_events e set row_hash = private.audit_row_hash(e) where e.id = r.id returning e.row_hash into prev;
  end loop;
end $$;
alter table public.audit_events enable trigger reject_update_delete;

alter table public.audit_events
  alter column seq set not null,
  alter column prev_hash set not null,
  alter column row_hash set not null,
  add constraint audit_events_seq_key unique (seq);

create trigger audit_chain before insert on public.audit_events
  for each row execute function private.audit_chain();

-- ============ Verification ============

-- Walks the chain in order and reports the first break: a missing or reordered row (seq gap or a
-- prev_hash that isn't the previous row's hash), or a row whose content no longer matches its hash.
-- Callable only by the API's service role (and the database owner).
create function public.audit_verify_chain()
returns table (ok boolean, checked bigint, broken_at_seq bigint, problem text, head_seq bigint, head_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r public.audit_events; expected_prev text := repeat('0', 64); expected_seq bigint := 1; n bigint := 0;
begin
  for r in select * from public.audit_events order by seq loop
    n := n + 1;
    if r.seq <> expected_seq then
      return query select false, n, r.seq, format('Row %s is missing (found %s next).', expected_seq, r.seq), null::bigint, null::text;
      return;
    end if;
    if r.prev_hash <> expected_prev then
      return query select false, n, r.seq, format('Row %s does not follow row %s (previous hash differs).', r.seq, r.seq - 1), null::bigint, null::text;
      return;
    end if;
    if r.row_hash <> private.audit_row_hash(r) then
      return query select false, n, r.seq, format('Row %s was changed after it was written (hash differs).', r.seq), null::bigint, null::text;
      return;
    end if;
    expected_prev := r.row_hash;
    expected_seq := r.seq + 1;
  end loop;
  return query select true, n, null::bigint, null::text, nullif(expected_seq - 1, 0), case when n = 0 then null else expected_prev end;
end $$;
revoke all on function public.audit_verify_chain() from public, anon, authenticated;
grant execute on function public.audit_verify_chain() to service_role;

-- ============ Search ============

create index audit_events_occurred_at_idx on public.audit_events (occurred_at desc);
create index audit_events_action_idx on public.audit_events (action);

commit;
