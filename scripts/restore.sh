#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into a NEW database, then verifies it.
#
#   RESTORE_ADMIN_URL=mongodb://root:...@host:27017/?replicaSet=rs0&authSource=admin \
#     scripts/restore.sh <file.archive.gz> <new-db-name>
#
# RESTORE_ADMIN_URL needs to create databases and grant roles (the root user, or one with restore and
# userAdminAnyDatabase). The SampForce users (sampforce_app, sampforce_admin) must already exist on the target server
# (deploy/mongo/init-sampforce.js creates them); they are given access to the new database so that switching to it
# is only a configuration change.
# The script never drops or overwrites an existing database: switching the app over is a separate, deliberate step
# (docs/runbooks/database-restore.md).
set -euo pipefail

FILE="${1:?usage: restore.sh <file.archive.gz> <new-db-name>}"
TARGET="${2:?usage: restore.sh <file.archive.gz> <new-db-name>}"
: "${RESTORE_ADMIN_URL:?Set RESTORE_ADMIN_URL}"
[[ "$TARGET" =~ ^[a-z_][a-z0-9_]{0,40}$ ]] || { echo "database name must be lower-case letters, digits and _" >&2; exit 2; }

if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum --check --quiet "$(basename "$FILE").sha256" ) || { echo "checksum mismatch: $FILE" >&2; exit 1; }
  echo "checksum ok"
else
  echo "warning: no checksum file next to $FILE" >&2
fi

# The database the archive was taken from (from its manifest; older backups name none).
SOURCE="sampforce"
if [ -f "$FILE.json" ]; then
  SOURCE="$(sed -n 's/^  "database": "\([a-z0-9_]*\)",$/\1/p' "$FILE.json")"
  SOURCE="${SOURCE:-sampforce}"
fi
MONGOSH=(mongosh "$RESTORE_ADMIN_URL" --quiet)

if [ "$("${MONGOSH[@]}" --eval "print(db.getMongo().getDBNames().includes('$TARGET'))")" = "true" ]; then
  echo "database $TARGET already exists; choose a new name" >&2
  exit 1
fi

started=$(date +%s)
trap 'echo "restore FAILED: database $TARGET is incomplete. Do not point the app at it; drop it before retrying." >&2' ERR
# Documents and the index definitions stored in the archive, renamed from the source database to the target.
mongorestore --quiet --uri="$RESTORE_ADMIN_URL" --archive="$FILE" --gzip \
  --nsInclude="$SOURCE.*" --nsFrom="$SOURCE.*" --nsTo="$TARGET.*" --stopOnError
restored=$(date +%s)

"${MONGOSH[@]}" --eval "
  const admin = db.getSiblingDB('admin');
  for (const [user, roles] of [['sampforce_app', ['readWrite']], ['sampforce_admin', ['readWrite', 'dbAdmin']]]) {
    if (admin.getUser(user)) admin.grantRolesToUser(user, roles.map((role) => ({ role, db: '$TARGET' })));
    else print('warning: no user ' + user + ' on this server; create it before switching');
  }
"

echo "verifying"
if [ -f "$FILE.json" ]; then
  # Every collection the backup counted is there with its documents. The counts were taken just before the dump
  # while the app kept writing, so small differences are reported, not failed; a collection gone empty fails.
  expected="$(sed -n 's/^  "facts": //p' "$FILE.json")"
  "${MONGOSH[@]}" --eval "
    const want = ($expected).collections;
    const d = db.getSiblingDB('$TARGET');
    let bad = 0;
    for (const [c, n] of Object.entries(want)) {
      const got = d.getCollection(c).countDocuments();
      if (n > 0 && got === 0) { print('FAIL  ' + c + ': ' + n + ' documents before the backup, none restored'); bad++; }
      else if (got !== n) print('note  ' + c + ': ' + n + ' counted before the backup, ' + got + ' restored');
    }
    if (bad) quit(1);
    print('every collection restored (' + Object.keys(want).length + ' collections, ' + (d.tenants.countDocuments()) + ' workspaces)');
  "
else
  echo "warning: no manifest next to $FILE; document counts not checked" >&2
fi
# The indexes came with the archive; the unique ones on workspace data must be there.
"${MONGOSH[@]}" --eval "
  const d = db.getSiblingDB('$TARGET');
  const n = d.getCollectionNames().reduce((sum, c) => sum + d.getCollection(c).getIndexes().filter((i) => i.unique).length, 0);
  if (n === 0) { print('FAIL  no unique indexes restored'); quit(1); }
  print(n + ' unique indexes restored');
"
echo "restore seconds: $((restored - started))"
echo "restored into $TARGET"
