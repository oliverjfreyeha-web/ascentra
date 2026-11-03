-- S2 · The 18th-birthday switch. A teen learner becomes an adult learner on the day they turn 18.
-- Until now nothing changed accounts.is_minor after sign-up, so a learner who joined at 17 stayed a teen for good.
--   accounts.aged_up_at           when the switch ran (null for everyone who has not been switched).
--   accounts.adult_agreement_due  true after the switch until the learner has agreed to the adult documents.
--                                 RECORDED ONLY for now: nothing blocks the learner yet (see docs/AGE-UP.md).
--   public.age_up_candidates()    active teens who turn 18 within the next 30 days (the daily job sends the warnings).
--   public.age_up_account(uuid)   the ONLY place is_minor goes from true to false. It refuses unless the learner is an
--                                 active teen whose date of birth makes them 18 today (US date, same rule as sign-up),
--                                 ends the Guardian link, and returns what it did. Calling it twice changes nothing.
--   notices.kind                  two new kinds: turning_18_notice, turned_18.
-- A teen who is pending (no verified Guardian yet) or paused (the Guardian withdrew) is NOT switched automatically:
-- the function returns 'held_status' and the daily job records it for a person to look at.
-- Billing is not touched here: the app cancels a Guardian-paid plan at the period end (lib/age-up.ts).

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0023_skill_tracks'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply S1 (0023) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0024_age_up');

alter table public.accounts
  add column aged_up_at timestamptz,
  add column adult_agreement_due boolean not null default false,
  add constraint accounts_aged_up_is_adult check (aged_up_at is null or not is_minor);

comment on column public.accounts.aged_up_at is 'When the 18th-birthday switch ran for this learner. Set only by public.age_up_account.';
comment on column public.accounts.adult_agreement_due is 'True after the 18th-birthday switch until the learner agrees to the adult documents. Not enforced yet.';

-- ============ Who is coming up ============

create function public.age_up_candidates() returns table (account_id uuid, date_of_birth date)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.date_of_birth
    from public.accounts a
   where a.role = 'learner' and a.is_minor and a.status = 'active' and a.date_of_birth is not null
     and private.age_on(a.date_of_birth, private.us_today() + 30) >= 18
$$;
revoke all on function public.age_up_candidates() from public, anon, authenticated;
grant execute on function public.age_up_candidates() to service_role;

-- ============ The switch ============

create function public.age_up_account(p_account uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts;
begin
  select * into a from public.accounts where id = p_account for update;
  if a.id is null then return 'not_found'; end if;
  if a.role <> 'learner' or not a.is_minor then return 'not_a_teen'; end if;
  if a.date_of_birth is null then return 'no_date_of_birth'; end if;
  if private.age_on(a.date_of_birth, private.us_today()) < 18 then return 'not_yet'; end if;
  if a.status <> 'active' then return 'held_status'; end if;

  -- The Guardian's role ends first: the link rule (0010) refuses any change to a link once its teen is an adult.
  -- Their consent records stay as they are (insert-only); only the link is closed.
  update public.guardian_relationships
     set withdrawn_at = now(), withdrawal_reason = 'learner_turned_18'
   where teen_account_id = p_account and withdrawn_at is null and verification_status <> 'failed';

  update public.accounts
     set is_minor = false, aged_up_at = now(), adult_agreement_due = true, updated_at = now()
   where id = p_account;

  return 'aged_up';
end $$;
revoke all on function public.age_up_account(uuid) from public, anon, authenticated;
grant execute on function public.age_up_account(uuid) to service_role;

-- ============ Notices ============

alter table public.notices drop constraint notices_kind_check;
alter table public.notices add constraint notices_kind_check check (kind in (
  'trial_ending', 'renewal_upcoming', 'payment_failed', 'subscription_canceled',
  'subscription_ended', 'guardian_consent_withdrawn', 'mentor_allowance_80', 'mentor_allowance_100',
  'turning_18_notice', 'turned_18'));

-- To undo (only safe before any learner has been switched): drop function public.age_up_account(uuid);
-- drop function public.age_up_candidates(); restore notices_kind_check from 0016; alter table public.accounts drop
-- constraint accounts_aged_up_is_adult, drop column adult_agreement_due, drop column aged_up_at;
-- delete from private.schema_migrations where version = '0024_age_up'.
