-- F3: foundation for the data model.
-- Migration ledger, shared helpers, retention classes, and the identity-table changes
-- (accounts.is_minor, wider account roles, id/created_at/retention_class on the 0001 tables).
-- Requires 0001_accounts.sql.

do $$
begin
  if to_regclass('public.accounts') is null or to_regclass('public.profiles') is null then
    raise exception 'ASCENTRA: apply 0001_accounts.sql first (public.accounts and public.profiles are missing).';
  end if;
  if to_regclass('private.schema_migrations') is not null then
    raise exception 'ASCENTRA: migration 0002_foundation is already applied. Nothing was changed.';
  end if;
end $$;

-- Objects that must never be reachable through the Supabase Data API live in "private",
-- which is not an exposed schema.
create schema if not exists private;
revoke all on schema private from public;

create table private.schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);
revoke all on private.schema_migrations from public;

-- Every later migration starts with this. Re-running an applied migration stops with an
-- error before anything changes, so each migration can only ever apply once.
create function private.begin_migration(v text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from private.schema_migrations where version = v) then
    raise exception 'ASCENTRA: migration % is already applied. Nothing was changed.', v;
  end if;
  insert into private.schema_migrations (version) values (v);
end $$;
revoke all on function private.begin_migration(text) from public;

insert into private.schema_migrations (version) values ('0001_accounts');
select private.begin_migration('0002_foundation');

-- How long a row may be kept is decided per class. Durations are a counsel item and are
-- deliberately not set here; the class only groups rows that will share a rule.
create domain public.retention_class as text check (value in (
  'account',          -- identity, roles, preferences
  'security',         -- devices, sign-in and session activity
  'billing',          -- subscriptions, entitlements
  'legal_record',     -- consent, disclosures, legal document versions
  'minor_protection', -- guardian links and teen-specific records
  'content',          -- academies, courses, lessons, sources
  'learning',         -- progress, attempts, mastery, schedules
  'user_content',     -- notes, uploads, Mentor threads, submitted work
  'safety',           -- safety events
  'audit',            -- the audit trail
  'operational'       -- service status
));
comment on domain public.retention_class is
  'Retention category. Durations per class are set by counsel and are not defined yet.';

-- Keeps updated_at honest on every table.
create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.set_updated_at() from public;

-- Insert-only tables call this on UPDATE, DELETE and TRUNCATE. Triggers run for every role,
-- including service_role (which bypasses row-level security) and the table owner.
create function private.reject_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ASCENTRA: % is insert-only; % is not allowed.', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;
revoke all on function private.reject_change() from public;

-- accounts: minors, the wider set of account roles, retention class.
alter table public.accounts
  add column is_minor boolean not null default false,
  add column retention_class public.retention_class not null default 'account';

alter table public.accounts drop constraint accounts_role_check;
alter table public.accounts
  add constraint accounts_role_check check (role in ('owner', 'admin', 'learner', 'guardian')),
  -- Teen rules: a minor is never the Owner, an admin or a guardian.
  add constraint accounts_minor_role_check check (not is_minor or role = 'learner');

comment on column public.accounts.is_minor is 'True for teen learners (14 to 17). Teen rules key off this in queries.';
comment on column public.accounts.role is
  'owner: the one Owner. admin: invited staff; what they may do is in role_assignments. learner, guardian: F6+.';

-- profiles: an id and created_at like every other table. account_id stays the primary key.
alter table public.profiles
  add column id uuid not null default gen_random_uuid(),
  add column created_at timestamptz not null default now(),
  add column retention_class public.retention_class not null default 'account';
alter table public.profiles add constraint profiles_id_key unique (id);

create trigger set_updated_at before update on public.accounts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
