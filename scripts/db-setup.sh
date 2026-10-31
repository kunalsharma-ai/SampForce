#!/usr/bin/env bash
# Creates the DealFlow database roles and databases for local development and CI.
#
#   dealflow_owner  owns the schema and runs migrations (MIGRATION_DATABASE_URL)
#   dealflow_app    runtime role WITHOUT BYPASSRLS, so row-level security always applies (DATABASE_URL)
#   dealflow_backup read-only role WITH BYPASSRLS for pg_dump (BACKUP_DATABASE_URL). Forced RLS makes pg_dump
#                   refuse to run as any other non-superuser role, the schema owner included.
#
# Usage: PGHOST=localhost PGUSER=postgres scripts/db-setup.sh [db names...]
# Passwords default to development values; override with DEALFLOW_OWNER_PASSWORD / DEALFLOW_APP_PASSWORD.
set -euo pipefail

OWNER_PW="${DEALFLOW_OWNER_PASSWORD:-dealflow_owner_dev}"
APP_PW="${DEALFLOW_APP_PASSWORD:-dealflow_app_dev}"
BACKUP_PW="${DEALFLOW_BACKUP_PASSWORD:-dealflow_backup_dev}"
DBS=("$@")
[ ${#DBS[@]} -eq 0 ] && DBS=(dealflow dealflow_test)

PSQL=(psql -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -d postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_owner') THEN
    CREATE ROLE dealflow_owner LOGIN PASSWORD '${OWNER_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_app') THEN
    CREATE ROLE dealflow_app LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_backup') THEN
    CREATE ROLE dealflow_backup LOGIN PASSWORD '${BACKUP_PW}' NOSUPERUSER BYPASSRLS;
  END IF;
END \$\$;
SQL

for db in "${DBS[@]}"; do
  if ! "${PSQL[@]}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
    "${PSQL[@]}" -d postgres -c "CREATE DATABASE \"${db}\" OWNER dealflow_owner"
  fi
  "${PSQL[@]}" -d "${db}" <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT CONNECT ON DATABASE "${db}" TO dealflow_app, dealflow_backup;
GRANT USAGE ON SCHEMA public TO dealflow_app, dealflow_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dealflow_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dealflow_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE dealflow_owner IN SCHEMA public GRANT SELECT ON TABLES TO dealflow_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE dealflow_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO dealflow_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE dealflow_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dealflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dealflow_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dealflow_app;
SQL
  echo "database ${db} ready"
done
