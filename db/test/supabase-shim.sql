-- TEST ONLY. Never apply to Supabase: it already has all of this.
-- Recreates the parts of a Supabase database the migrations and RLS tests rely on, on plain Postgres:
--   * the API roles: anon and authenticated (no RLS bypass) and service_role (BYPASSRLS),
--   * auth.jwt(), read from the request.jwt.claims setting exactly as PostgREST sets it per request,
--   * Supabase's default grants: every new table in public is fully granted to all three roles.
-- A request through the Supabase Data API is: SET ROLE <role from the JWT>; SET request.jwt.claims = <JWT>;
-- then the query. The tests do the same.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
