#!/usr/bin/env bash
# Logical backup of the SampForce database: pg_dump custom format, a SHA-256 checksum and a small manifest.
#
#   BACKUP_DATABASE_URL=postgresql://dealflow_backup:...@host:5432/dealflow scripts/backup.sh [out-dir]
#
# Use the dealflow_backup role (read-only, BYPASSRLS; see scripts/db-setup.sh). Every tenant table forces
# row-level security, so pg_dump refuses to run as the runtime or owner role.
# This is a logical backup. Point-in-time recovery needs WAL archiving on the server or your provider's PITR;
# it is not configured or tested by this repository.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL (dealflow_backup role)}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/sampforce-$STAMP.dump"

started=$(date +%s)
pg_dump --format=custom --compress=6 --no-comments --dbname="$BACKUP_DATABASE_URL" --file="$FILE"
ended=$(date +%s)

( cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )

migration=$(psql "$BACKUP_DATABASE_URL" -XAtc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1")
tenants=$(psql "$BACKUP_DATABASE_URL" -XAtc "SELECT count(*) FROM tenants")
cat > "$FILE.json" <<JSON
{
  "file": "$(basename "$FILE")",
  "createdAt": "$STAMP",
  "bytes": $(stat -c %s "$FILE"),
  "seconds": $((ended - started)),
  "lastMigration": "$migration",
  "tenants": $tenants,
  "server": "$(psql "$BACKUP_DATABASE_URL" -XAtc 'SHOW server_version')"
}
JSON
echo "$FILE"
