-- F3: row-level security.
-- Deny is the default everywhere: RLS on for every table in public, nothing granted to anon or
-- authenticated. The only policies are for the identity tables in use now (accounts, profiles):
-- a signed-in person may read their own rows, and nothing else. Every other table stays
-- deny-all until its phase adds policies.
-- consent_records and audit_events are insert-only for everyone, service_role included.

select private.begin_migration('0004_row_level_security');

-- ============ Deny by default ============

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Supabase grants anon and authenticated full access to new tables by default. Remove that for
-- tables and sequences this role creates later, so a future table starts with no access at all.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ============ Who is asking ============

-- The caller's Account, from the Supabase JWT. With Clerk as Supabase's third-party auth
-- provider, "sub" is the Clerk user id. Security definer so it can look up accounts without
-- opening accounts to the caller; it only ever returns the caller's own id (or null).
create function private.current_account_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.accounts a
  where a.clerk_user_id = (auth.jwt() ->> 'sub')
    and a.status = 'active'
$$;
revoke all on function private.current_account_id() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_account_id() to authenticated;

-- ============ Identity tables: read your own row ============

-- Only these accounts columns are readable, and only in the caller's own row.
grant select (id, email, email_verified, role, is_minor, status, created_at, updated_at)
  on public.accounts to authenticated;
create policy accounts_select_own on public.accounts
  for select to authenticated
  using (id = (select private.current_account_id()));

grant select on public.profiles to authenticated;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- ============ Insert-only records ============
-- Three layers, so each holds on its own:
--   1. no UPDATE, DELETE or TRUNCATE privilege for any API role, service_role included;
--   2. restrictive policies that refuse every UPDATE and DELETE;
--   3. triggers that raise on UPDATE, DELETE and TRUNCATE. Triggers fire for service_role
--      (which bypasses RLS) and for the table owner too.

do $$
declare t text;
begin
  foreach t in array array['consent_records', 'audit_events'] loop
    execute format('revoke update, delete, truncate on public.%I from anon, authenticated, service_role', t);
    execute format('create policy %I on public.%I as restrictive for update using (false) with check (false)',
                   t || '_no_update', t);
    execute format('create policy %I on public.%I as restrictive for delete using (false)', t || '_no_delete', t);
    execute format('create trigger reject_update_delete before update or delete on public.%I
                    for each row execute function private.reject_change()', t);
    execute format('create trigger reject_truncate before truncate on public.%I
                    for each statement execute function private.reject_change()', t);
  end loop;
end $$;
