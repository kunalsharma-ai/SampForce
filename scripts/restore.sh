#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into a NEW database, then verifies it.
#
#   RESTORE_ADMIN_URL=postgresql://postgres:...@host:5432/postgres scripts/restore.sh <file.dump> <new-db-name>
#
# RESTORE_ADMIN_URL needs to create databases and to load rows into tables that force row-level security
# (a superuser, or a role with CREATEDB and BYPASSRLS). The roles dealflow_owner, dealflow_app and
# dealflow_backup must already exist on the target server (scripts/db-setup.sh creates them).
# The script never drops or overwrites an existing database: switching the app over is a separate,
# deliberate step (docs/runbooks/database-restore.md).
set -euo pipefail

FILE="${1:?usage: restore.sh <file.dump> <new-db-name>}"
TARGET="${2:?usage: restore.sh <file.dump> <new-db-name>}"
: "${RESTORE_ADMIN_URL:?Set RESTORE_ADMIN_URL}"
JOBS="${RESTORE_JOBS:-4}"
HERE="$(cd "$(dirname "$0")" && pwd)"
[[ "$TARGET" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "database name must be lower-case letters, digits and _" >&2; exit 2; }

if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum --check --quiet "$(basename "$FILE").sha256" ) || { echo "checksum mismatch: $FILE" >&2; exit 1; }
  echo "checksum ok"
else
  echo "warning: no checksum file next to $FILE" >&2
fi

# Same server and credentials, different database: replace the path of the URL.
TARGET_URL="$(printf '%s' "$RESTORE_ADMIN_URL" | sed -E "s#^(postgres(ql)?://[^/]*)/[^?]*#\1/$TARGET#")"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)

if [ "$("${PSQL[@]}" "$RESTORE_ADMIN_URL" -Atc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'")" = "1" ]; then
  echo "database $TARGET already exists; choose a new name" >&2
  exit 1
fi

started=$(date +%s)
"${PSQL[@]}" "$RESTORE_ADMIN_URL" -c "CREATE DATABASE \"$TARGET\" OWNER dealflow_owner"
trap 'echo "restore FAILED: database $TARGET is incomplete. Do not point the app at it; drop it before retrying." >&2' ERR
pg_restore --exit-on-error --jobs="$JOBS" --dbname="$TARGET_URL" "$FILE"
"${PSQL[@]}" "$TARGET_URL" -c "ANALYZE"
"${PSQL[@]}" "$TARGET_URL" -c "GRANT CONNECT ON DATABASE \"$TARGET\" TO dealflow_app, dealflow_backup"
restored=$(date +%s)

echo "verifying"
"${PSQL[@]}" "$TARGET_URL" -f "$HERE/check-rls.sql"
"${PSQL[@]}" "$TARGET_URL" -Atc "SELECT 'last migration: ' || migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1"
# The runtime role must still see nothing without a tenant context.
"${PSQL[@]}" "$TARGET_URL" -Atc "SET ROLE dealflow_app; SELECT CASE WHEN count(*) = 0 THEN 'runtime role sees no rows without a tenant: ok' ELSE 'FAIL: runtime role sees rows without a tenant' END FROM opportunities"
echo "restore seconds: $((restored - started))"
echo "restored into $TARGET"
