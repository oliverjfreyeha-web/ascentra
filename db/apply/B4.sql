-- ASCENTRA B4: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0010_guardians (already applied). Applies: 0011_notices_and_privacy.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0011_notices_and_privacy.sql
-- ============================================================

-- B4: notices and the Privacy Center.
--   notices: every billing or consent email ASCENTRA sends (through Resend), one row per notice. The dedupe key
--   makes each notice go out once however many times a webhook or the daily job sees the same moment; the row
--   also records whether it was sent, skipped (email not configured) or failed. Only who, what and when: the
--   email's text is built from code and isn't stored.
--   privacy_requests: data export and deletion requests, each with a due date. The Owner's account can't be
--   the subject of a deletion request.
-- Safe with the B3 code: nothing before B4 reads or writes these tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0010_guardians'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply B3 (0010) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0011_notices_and_privacy');

-- ============ Notices ============

create table public.notices (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts (id),   -- who it was sent to
  about_account_id     uuid references public.accounts (id),            -- the teen, when it is about one
  subscription_id      uuid references public.subscriptions (id),
  kind                 text not null check (kind in (
                         'trial_ending', 'renewal_upcoming', 'payment_failed', 'subscription_canceled',
                         'subscription_ended', 'guardian_consent_withdrawn')),
  dedupe_key           text not null unique,
  channel              text not null default 'email' check (channel = 'email'),
  status               text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  provider_message_id  text,
  error                text,
  sent_at              timestamptz,
  retention_class      public.retention_class not null default 'operational',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((status = 'sent') = (sent_at is not null))
);
create index notices_account on public.notices (account_id, created_at desc);

-- ============ Privacy requests ============

create table public.privacy_requests (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts (id),   -- whose data
  requested_by_account_id  uuid not null references public.accounts (id),   -- the person, or a teen's Guardian
  kind                     text not null check (kind in ('export', 'deletion')),
  status                   text not null default 'open' check (status in ('open', 'completed', 'canceled')),
  due_at                   timestamptz not null,
  completed_at             timestamptz,
  note                     text,
  retention_class          public.retention_class not null default 'legal_record',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);
-- One open deletion request per account.
create unique index privacy_requests_one_open_deletion on public.privacy_requests (account_id)
  where kind = 'deletion' and status = 'open';

create function private.privacy_request_not_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'deletion' and exists (select 1 from public.accounts a where a.id = new.account_id and a.role = 'owner') then
    raise exception 'ASCENTRA: the Owner account can''t be deleted, so it can''t have a deletion request.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function private.privacy_request_not_owner() from public;
create trigger privacy_request_not_owner before insert or update on public.privacy_requests
  for each row execute function private.privacy_request_not_owner();

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['notices', 'privacy_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

create index on public.notices (about_account_id);
create index on public.notices (subscription_id);
create index on public.privacy_requests (requested_by_account_id);

commit;
