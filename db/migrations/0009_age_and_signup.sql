-- B2: date of birth and open sign-up. US only; minimum age 14; ages 14 to 17 wait for a verified Guardian.
-- accounts gains the date of birth (learners only; never the Owner or an admin), the moment US residence was
-- confirmed, and a 'pending' status for a teen waiting for their Guardian. The age rules are enforced here as
-- well as in the API:
--   - nobody under 14 is ever stored;
--   - is_minor must match the date of birth when the account is created;
--   - a minor is never active without a verified Guardian;
--   - only a learner can be pending or have a date of birth (the Owner and admins: never);
--   - a date of birth, once set, changes only through public.support_change_date_of_birth (Support, audited by the API).
-- Ages are counted on today's date in the westernmost US time zone (UTC-11), so a birthday never counts
-- early anywhere in the US.
-- guardian_relationships can now hold an invitation to a Guardian who has no account yet (B3 sends it).
-- Safe with the B1 code: it never writes these columns, and every existing row already passes the checks.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0008_billing'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply B1 (0008) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0009_age_and_signup');

-- ============ Age ============

create function private.us_today() returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Pacific/Pago_Pago')::date $$;

create function private.age_on(dob date, on_day date) returns integer
language sql immutable
set search_path = ''
as $$ select extract(year from age(on_day::timestamp, dob::timestamp))::integer $$;

revoke all on function private.us_today() from public;
revoke all on function private.age_on(date, date) from public;

-- ============ Accounts ============

alter table public.accounts
  add column date_of_birth date,
  add column us_resident_confirmed_at timestamptz;

comment on column public.accounts.date_of_birth is
  'Learners only, set once at sign-up (14 or older). Changed only by Support, with a reason (audited). Never readable by the account itself through the Data API.';

alter table public.accounts drop constraint accounts_status_check;
alter table public.accounts
  add constraint accounts_status_check check (status in ('active', 'pending', 'disabled')),
  -- Only a learner waits (a teen, for their Guardian). The Owner and admins are never pending.
  add constraint accounts_pending_is_learner check (status <> 'pending' or role = 'learner'),
  -- The Owner and admins never have a date of birth, so nothing can make them a minor by age.
  add constraint accounts_date_of_birth_role check (date_of_birth is null or role in ('learner', 'guardian'));

-- Security definer: it runs for the API's service_role, which has no access to the private schema.
create function private.check_account_age() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_age integer;
  v_dob_changed boolean := tg_op = 'INSERT' or new.date_of_birth is distinct from old.date_of_birth;
begin
  if tg_op = 'UPDATE' and old.date_of_birth is not null and v_dob_changed
     and coalesce(current_setting('ascentra.dob_change', true), '') <> 'support' then
    raise exception 'ASCENTRA: a date of birth can''t be changed once it''s set. Support can correct it, with a reason.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.date_of_birth is not null and v_dob_changed then
    if new.date_of_birth > private.us_today() or new.date_of_birth < date '1900-01-01' then
      raise exception 'ASCENTRA: that isn''t a real date of birth.' using errcode = 'check_violation';
    end if;
    v_age := private.age_on(new.date_of_birth, private.us_today());
    if v_age < 14 then
      raise exception 'ASCENTRA: ASCENTRA is for learners 14 and older.' using errcode = 'check_violation';
    end if;
    if new.is_minor <> (v_age < 18) then
      raise exception 'ASCENTRA: is_minor must match the date of birth.' using errcode = 'check_violation';
    end if;
  end if;
  if new.is_minor and new.role = 'learner' and new.status = 'active'
     and (tg_op = 'INSERT' or old.status <> 'active' or not old.is_minor)
     and not exists (select 1 from public.guardian_relationships g
                     where g.teen_account_id = new.id and g.verification_status = 'verified' and g.withdrawn_at is null) then
    raise exception 'ASCENTRA: a teen account stays pending until a verified Guardian authorizes it.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.check_account_age() from public;

create trigger check_account_age before insert or update on public.accounts
  for each row execute function private.check_account_age();

-- Support's correction (the API checks the capability and the reason, and writes the audit event).
-- It never moves an account between adult and teen, and never below 14.
create function public.support_change_date_of_birth(p_account uuid, p_dob date) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts;
  v_age integer;
begin
  select * into a from public.accounts where id = p_account for update;
  if a.id is null then return 'not_found'; end if;
  if a.role <> 'learner' or a.date_of_birth is null then return 'no_date_of_birth'; end if;
  if p_dob = a.date_of_birth then return 'unchanged'; end if;
  if p_dob > private.us_today() or p_dob < date '1900-01-01' then return 'invalid'; end if;
  v_age := private.age_on(p_dob, private.us_today());
  if v_age < 14 or (v_age < 18) <> a.is_minor then return 'changes_age_group'; end if;
  perform set_config('ascentra.dob_change', 'support', true);
  update public.accounts set date_of_birth = p_dob where id = p_account;
  perform set_config('ascentra.dob_change', '', true);
  return 'changed';
end $$;
revoke all on function public.support_change_date_of_birth(uuid, date) from public, anon, authenticated;
grant execute on function public.support_change_date_of_birth(uuid, date) to service_role;

-- ============ Guardian invitations ============

-- A teen invites a Guardian by email before the Guardian has an account. Nothing wrote this table before B2.
alter table public.guardian_relationships
  alter column guardian_account_id drop not null,
  add column invited_email text,
  add column invited_at timestamptz;

alter table public.guardian_relationships drop constraint guardian_relationships_verification_status_check;
alter table public.guardian_relationships
  add constraint guardian_relationships_verification_status_check
    check (verification_status in ('invited', 'pending', 'verified', 'failed')),
  add constraint guardian_relationships_invited_check
    check (guardian_account_id is not null or (verification_status = 'invited' and invited_email is not null));

-- One open invitation per teen.
create unique index guardian_relationships_one_open_invite on public.guardian_relationships (teen_account_id)
  where verification_status = 'invited';

create function private.guardian_link_teen_is_minor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts a where a.id = new.teen_account_id and a.role = 'learner' and a.is_minor) then
    raise exception 'ASCENTRA: a Guardian link is only for a teen learner account.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.guardian_link_teen_is_minor() from public;

create trigger guardian_link_teen_is_minor before insert or update of teen_account_id on public.guardian_relationships
  for each row execute function private.guardian_link_teen_is_minor();
