-- ASCENTRA F4: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0004_row_level_security (already applied). Applies: 0005_roles_and_invites.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0005_roles_and_invites.sql
-- ============================================================

-- F4: admin roles, invites and Owner protections.
-- role_assignments holds both open invites and the role an admin holds (accounts.role stays 'admin').
-- Invite lifecycle: invited → claimed (the invited person signed up with that email) → active (they
-- have a second factor). Any of these → revoked. An invite past expires_at can no longer be claimed
-- or activated.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0004_row_level_security'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply F3 (0002-0004) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0005_roles_and_invites');

alter table public.role_assignments
  add column expires_at               timestamptz,
  add column clerk_invitation_id      text unique,
  add column claimed_by_clerk_user_id text,
  add column claimed_at               timestamptz;

alter table public.role_assignments drop constraint role_assignments_status_check;
alter table public.role_assignments
  add constraint role_assignments_status_check
    check (status in ('invited', 'claimed', 'active', 'revoked')),
  -- An invite is tied to one lower-cased email and always expires.
  add constraint role_assignments_invite_check
    check (status <> 'invited' or (invited_email is not null and expires_at is not null and account_id is null)),
  add constraint role_assignments_email_lowercase
    check (invited_email is null or invited_email = lower(invited_email)),
  add constraint role_assignments_claimed_check
    check (status not in ('claimed', 'active') or account_id is not null),
  -- Nobody but the Owner reaches the protected Owner Academy, so it can never be assigned.
  add constraint role_assignments_no_owner_academy
    check (not ('gsa' = any (scope)));

-- One live role per admin, and one open invite per email.
create unique index role_assignments_one_live_per_account
  on public.role_assignments (account_id) where status in ('claimed', 'active');
create unique index role_assignments_one_open_invite_per_email
  on public.role_assignments (invited_email) where status in ('invited', 'claimed');

-- A role assignment only ever belongs to an admin account.
create function private.role_assignment_account_is_admin() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.account_id is not null
     and (select a.role from public.accounts a where a.id = new.account_id) is distinct from 'admin' then
    raise exception 'ASCENTRA: role assignments are only for admin accounts.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.role_assignment_account_is_admin() from public;
create trigger role_assignment_account_is_admin before insert or update on public.role_assignments
  for each row execute function private.role_assignment_account_is_admin();

-- ============ Owner protections ============
-- The Owner can't be demoted, suspended or deleted, and nobody can be promoted to Owner, by any
-- role: the API (service_role), the SQL Editor, anyone. Transferring ownership will be its own,
-- deliberate migration.
create function private.protect_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'ASCENTRA: accounts can''t be truncated (it would delete the Owner).' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      raise exception 'ASCENTRA: the Owner account can''t be deleted.' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active') then
    raise exception 'ASCENTRA: the Owner can''t be demoted or suspended.' using errcode = 'insufficient_privilege';
  end if;
  if new.role = 'owner' and old.role <> 'owner' then
    raise exception 'ASCENTRA: no account can be promoted to Owner.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function private.protect_owner() from public;
create trigger protect_owner before update or delete on public.accounts
  for each row execute function private.protect_owner();
create trigger protect_owner_truncate before truncate on public.accounts
  for each statement execute function private.protect_owner();

commit;
