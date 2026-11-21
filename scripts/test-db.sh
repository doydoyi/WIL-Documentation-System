#!/usr/bin/env bash
# Applies the Supabase migrations to a scratch database on a local PostgreSQL
# server (with stand-ins for Supabase's auth and vault schemas) and runs the
# schema tests.
#
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB_NAME:-wil_dms_test}"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
for role in anon authenticated service_role; do
  psql -q -d postgres -c "do \$\$ begin if exists (select 1 from pg_roles where rolname = '${role}') then execute 'drop owned by ${role} cascade'; end if; end \$\$" >/dev/null 2>&1 || true
done
psql -v ON_ERROR_STOP=1 -q -d "${DB}" -c "drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;" >/dev/null 2>&1 || true

psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "${ROOT}/supabase/tests/local/supabase_stubs.sql"
for migration in "${ROOT}"/supabase/migrations/*.sql; do
  echo "Applying $(basename "${migration}")"
  psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "${migration}"
done
psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "${ROOT}/supabase/tests/local/schema_test.sql"
