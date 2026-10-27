#!/bin/sh
# Local database stand-in for the Base44 sandbox (see docker-compose.base44.yml).
#
# Applies, against the compose "db" service:
#   1. db/test/supabase-shim.sql — Supabase's API roles and auth.jwt() on plain Postgres
#      (the same file the database tests use; never applied to a real Supabase project),
#   2. every migration in db/migrations, in order.
#   3. PostgREST's login role, which switches into the API role named in the JWT (as on Supabase).
#
# Safe to re-run: each migration records itself in private.schema_migrations, and an applied one is
# skipped here before it can refuse to run twice.
set -eu

DB_URI="${DB_URI:-postgresql://postgres:postgres@db:5432/postgres}"
REPO="${REPO:-/repo}"
PSQL="psql ${DB_URI} -v ON_ERROR_STOP=1 -q"

echo "applying ${REPO}/db/test/supabase-shim.sql"
$PSQL -f "${REPO}/db/test/supabase-shim.sql"

for file in $(ls "${REPO}"/db/migrations/*.sql | sort); do
  version=$(basename "$file" .sql)
  already=$($PSQL -tAc "select 1 from private.schema_migrations where version = '${version}'" 2>/dev/null) || already=""
  if [ "$already" = "1" ]; then
    echo "already applied: ${version}"
    continue
  fi
  echo "applying: ${version}"
  $PSQL -f "$file"
done

# The role PostgREST logs in as. Local-only credential; it grants no more than the API roles.
$PSQL -c "create role authenticator login noinherit password 'ascentra_local'" || true
$PSQL -c "alter role authenticator with login password 'ascentra_local'"
$PSQL -c "grant anon, authenticated, service_role to authenticator"

echo "database is ready"
