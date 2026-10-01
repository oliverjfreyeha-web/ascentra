-- ASCENTRA ops: create ONE adult test learner for an existing Clerk user. Owner only (run it yourself
-- in the Supabase SQL Editor, which only the Owner can open). Until sign-up opens (B2), this is the only
-- way a learner account exists. It never creates or changes an admin or the Owner.
--
-- Before running: the Clerk user must exist, and must have a password AND an authenticator app set up
-- (ASCENTRA refuses a password without a second factor). See db/README.md, "A test learner".
--
-- Edit the three values below, then paste the whole file and click Run, once. One transaction: if any
-- check fails, nothing is changed. The last result row shows the new account.

begin;

create temporary table test_learner_input on commit drop as
select
  'user_PASTE_THE_CLERK_USER_ID'::text                      as clerk_user_id,  -- Clerk → Users → the user → User ID
  'paste.the.email@example.com'::text                        as email,          -- that user's primary email, exactly
  'B1 live check: a learner account to test billing'::text   as reason;         -- recorded in the audit log

do $$
declare
  i record;
  v_owner public.accounts;
  v_id uuid;
begin
  select * into i from test_learner_input;
  i.email := lower(btrim(i.email));
  i.clerk_user_id := btrim(i.clerk_user_id);

  if i.clerk_user_id !~ '^user_[A-Za-z0-9]{10,}$' or i.clerk_user_id = 'user_PASTE_THE_CLERK_USER_ID' then
    raise exception 'ASCENTRA: set clerk_user_id to the Clerk User ID (user_…). Nothing was changed.';
  end if;
  if i.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or i.email = 'paste.the.email@example.com' then
    raise exception 'ASCENTRA: set email to the Clerk user''s primary email. Nothing was changed.';
  end if;
  if length(btrim(i.reason)) < 5 then
    raise exception 'ASCENTRA: give a reason (5+ characters). It is recorded in the audit log. Nothing was changed.';
  end if;

  select * into v_owner from public.accounts where role = 'owner';
  if v_owner.id is null then
    raise exception 'ASCENTRA: no Owner account exists. Nothing was changed.';
  end if;
  if i.clerk_user_id = v_owner.clerk_user_id or i.email = lower(v_owner.email) then
    raise exception 'ASCENTRA: that is the Owner. The Owner is never changed. Nothing was changed.';
  end if;
  -- Only a brand-new account: an existing one (an admin, a disabled account, anything) is never converted.
  if exists (select 1 from public.accounts where clerk_user_id = i.clerk_user_id or lower(email) = i.email) then
    raise exception 'ASCENTRA: an account with that Clerk user or email already exists. It is not changed. Use a new Clerk user. Nothing was changed.';
  end if;
  if exists (select 1 from public.role_assignments where lower(invited_email) = i.email and status in ('invited', 'claimed', 'active')) then
    raise exception 'ASCENTRA: that email has an admin invite or role. Use a different email. Nothing was changed.';
  end if;

  -- An adult learner (is_minor = false: 18+, above the minimum age of 14). clerk_updated_at is set to the
  -- epoch so the next Clerk webhook for this user always applies Clerk's real sign-in state over this row.
  insert into public.accounts (clerk_user_id, email, email_verified, role, status, password_enabled, two_factor_enabled, is_minor, clerk_updated_at)
  values (i.clerk_user_id, i.email, true, 'learner', 'active', true, true, false, 'epoch')
  returning id into v_id;

  insert into public.profiles (account_id, display_name) values (v_id, 'TEST Learner');

  insert into public.audit_events (actor_account_id, actor_label, actor_role, action, context, target_type, target_id, target_label,
                                   previous_value, new_value, reason, result, status, is_sensitive)
  values (v_owner.id, 'Owner (Owner) · Supabase SQL Editor', 'owner', 'accounts.create_test_learner',
          'Created an adult test learner by hand (db/ops/create-test-learner.sql) for the B1 billing check. Sign-up is closed until B2.',
          'account', v_id::text, i.email, 'none', 'learner (adult, test)', btrim(i.reason), 'completed', 'Recorded', true);
end $$;

select a.id, a.email, a.role, a.is_minor, a.status, p.display_name,
       (select action || ' #' || seq from public.audit_events where target_id = a.id::text order by seq desc limit 1) as audit_event
from public.accounts a join public.profiles p on p.account_id = a.id
where a.clerk_user_id = (select btrim(clerk_user_id) from test_learner_input);

commit;
