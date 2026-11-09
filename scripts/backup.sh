#!/usr/bin/env bash
# Logical backup of the SampForce database: a gzipped mongodump archive, a SHA-256 checksum and a small manifest
# with the document count of every collection just before the dump (scripts/restore.sh checks the restored copy
# against it).
#
#   BACKUP_DATABASE_URL=mongodb://sampforce_backup:...@host:27017/?replicaSet=rs0&authSource=admin \
#     SAMPFORCE_DB=sampforce scripts/backup.sh [out-dir]
#
# Use a user with the built-in backup role (deploy/mongo/init-sampforce.js creates sampforce_backup). The dump reads
# one database collection by collection while SampForce keeps running, so it is consistent per collection, not as a
# single moment across collections (mongodump's --oplog option works only on whole-server dumps). Point-in-time
# recovery needs MongoDB's own tooling (Ops Manager, Atlas backups or filesystem snapshots with the oplog); it is not
# configured or tested by this repository.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL (a user with the backup role)}"
DB="${SAMPFORCE_DB:-sampforce}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/sampforce-$STAMP.archive.gz"

# Counts and versions, read with the same user (the backup role can read every collection), before the dump: the
# app keeps writing, so the dump may hold a few more documents than counted, never a collection fewer.
facts=$(mongosh "$BACKUP_DATABASE_URL" --quiet --eval "
  const d = db.getSiblingDB('$DB');
  const counts = {};
  for (const c of d.getCollectionNames().sort()) counts[c] = d.getCollection(c).countDocuments();
  print(JSON.stringify({ tenants: counts.tenants || 0, server: d.version(), collections: counts }));
")

started=$(date +%s)
mongodump --quiet --uri="$BACKUP_DATABASE_URL" --db="$DB" --archive="$FILE" --gzip
ended=$(date +%s)

( cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )

cat > "$FILE.json" <<JSON
{
  "file": "$(basename "$FILE")",
  "createdAt": "$STAMP",
  "database": "$DB",
  "bytes": $(stat -c %s "$FILE"),
  "seconds": $((ended - started)),
  "facts": $facts
}
JSON
echo "$FILE"
