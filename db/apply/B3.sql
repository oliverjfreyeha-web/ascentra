-- ASCENTRA B3: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0009_age_and_signup (already applied). Applies: 0010_guardians.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0010_guardians.sql
-- ============================================================

-- B3: Guardian verification and teen activation.
-- A Guardian is their own adult account (role guardian; the API requires a second factor). Stripe Identity checks
-- their identity and adult status: only the outcome is kept here (status and date), never the ID images or the date
-- of birth. A teen is activated only when their Guardian of record is verified, has agreed to the Teen Terms and the
-- Minor Privacy Notice (consent_records), and pays as the customer of record. Withdrawing consent pauses the teen
-- ('paused'): nothing is deleted.
--   - One Guardian can link several teens; a teen has exactly one Guardian of record (one open link).
--   - Only a guardian account that passed the identity check can be a teen's verified Guardian.
--   - Teen defaults (voice recordings off, uploads private) live on the Guardian link.
-- Safe with the B2 code: it never writes these columns, and every existing row already passes the checks.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0009_age_and_signup'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply B2 (0009) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0010_guardians');

-- ============ Accounts ============

alter table public.accounts drop constraint accounts_status_check;
alter table public.accounts drop constraint accounts_pending_is_learner;
alter table public.accounts
  add constraint accounts_status_check check (status in ('active', 'pending', 'paused', 'disabled')),
  -- Only a learner waits for, or loses, a Guardian. The Owner and admins are never pending or paused.
  add constraint accounts_pending_is_learner check (status not in ('pending', 'paused') or role = 'learner');

-- Stripe Identity: the outcome only. The session id ties a webhook to the session this account started.
alter table public.accounts
  add column identity_status text not null default 'none'
    check (identity_status in ('none', 'started', 'processing', 'requires_input', 'verified', 'failed', 'canceled')),
  add column identity_verified_at timestamptz,
  add column identity_session_id text,
  add constraint accounts_identity_guardian check (identity_status = 'none' or role = 'guardian'),
  add constraint accounts_identity_verified_at check ((identity_status = 'verified') = (identity_verified_at is not null));

comment on column public.accounts.identity_status is
  'Guardians only: the Stripe Identity outcome (document and adult check). No ID images or date of birth are kept.';

-- ============ Guardian links ============

alter table public.guardian_relationships
  add column clerk_invitation_id text,
  add column relationship text check (relationship in ('parent', 'legal_guardian')),
  -- Teen defaults, in force from activation (reference TEEN_DEFAULTS).
  add column voice_recordings text not null default 'off' check (voice_recordings in ('off', 'minimal')),
  add column uploads text not null default 'private' check (uploads in ('private', 'off')),
  add constraint guardian_relationships_verified_check
    check (verification_status <> 'verified' or (guardian_account_id is not null and authorized_at is not null)),
  add constraint guardian_relationships_withdrawal_check check ((withdrawn_at is null) = (withdrawal_reason is null));

-- A teen has exactly one Guardian of record: one open link (invited, pending or verified, and not withdrawn).
drop index public.guardian_relationships_one_open_invite;
create unique index guardian_relationships_one_of_record on public.guardian_relationships (teen_account_id)
  where withdrawn_at is null and verification_status <> 'failed';

create or replace function private.guardian_link_teen_is_minor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts a where a.id = new.teen_account_id and a.role = 'learner' and a.is_minor) then
    raise exception 'ASCENTRA: a Guardian link is only for a teen learner account.' using errcode = 'check_violation';
  end if;
  if new.guardian_account_id is not null
     and not exists (select 1 from public.accounts a where a.id = new.guardian_account_id and a.role = 'guardian') then
    raise exception 'ASCENTRA: only a Guardian account can be a teen''s Guardian.' using errcode = 'check_violation';
  end if;
  if new.verification_status = 'verified' and new.withdrawn_at is null
     and not exists (select 1 from public.accounts a where a.id = new.guardian_account_id and a.identity_status = 'verified') then
    raise exception 'ASCENTRA: a Guardian must pass the identity and adult check before authorizing a teen.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger guardian_link_teen_is_minor on public.guardian_relationships;
create trigger guardian_link_teen_is_minor before insert or update on public.guardian_relationships
  for each row execute function private.guardian_link_teen_is_minor();

-- ============ Teen documents (word for word as lib/teen-documents.ts) ============

insert into public.legal_document_versions (document_key, title, version, status, audience, summary, body, published_at)
values
  ('teen_terms', 'Teen Terms of Use', 'v0.2', 'published', array['guardian', 'teen'],
   'The rules for teens. The Guardian agrees to them for the teen before the account starts.',
   $doc$You need to be at least 14, and a parent or guardian sets up your plan with you. Your account is yours. Don't share your sign-in, and don't use anyone else's. Mentor helps you learn. It won't do your graded work, and it will tell you when it's not sure. There's no public profile and no chat with other learners. If something worries us, we might tell your Guardian what happened and why, but not share your private conversations. Your Guardian agrees to these terms for your account before it starts.$doc$,
   now()),
  ('minor_privacy_notice', 'Minor Privacy Notice', 'v0.2', 'published', array['guardian', 'teen'],
   'What ASCENTRA keeps about a teen, who can see it, and what it never does with it.',
   $doc$What we keep: your name, that you're a teen, your learning progress, your notes, your Mentor chats, and which devices you use. Your notes and Mentor chats are private, even from your Guardian. Your Guardian sees your progress, finished work, schedule, billing, and devices. We never sell or share your information, show you ads based on what you do, make you findable publicly, track your precise location, or identify you by your face or voice. You can ask to see or fix your data. Your Guardian handles export and deletion.$doc$,
   now())
on conflict (document_key, version) do nothing;

commit;
