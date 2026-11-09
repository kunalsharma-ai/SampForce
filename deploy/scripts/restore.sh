#!/usr/bin/env bash
# Restores a backup into a NEW database on this server and verifies it (checksum, every collection and its
# indexes). With --switch it then makes the restored copy the live database:
#
#   scripts/restore.sh backups/sampforce-20261102T120000Z.archive.gz           # restore and verify only
#   scripts/restore.sh backups/sampforce-20261102T120000Z.archive.gz --switch  # ... then switch SampForce over to it
#
# MongoDB cannot rename a database, so switching points SampForce at the restored copy instead: it stops the API,
# worker and web app (a few seconds of downtime), sets SAMPFORCE_DB in .env to the restored database and starts
# them again. The previous database is kept, not dropped.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

file="${1:?usage: scripts/restore.sh <backup.archive.gz> [--switch]}"
switch="${2:-}"
dir="$(env_value BACKUP_DIR)"; dir="${dir:-./backups}"
dir_abs="$(cd "$dir" && pwd)"
file_abs="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
case "$file_abs" in "$dir_abs"/*) ;; *) echo "the backup must be inside $dir (BACKUP_DIR); copy it there first" >&2; exit 2;; esac
[ -f "$file_abs" ] || { echo "no such file: $file" >&2; exit 2; }

stamp="$(date -u +%Y%m%d%H%M%S)"
target="sampforce_restore_${stamp}"
live="$(env_value SAMPFORCE_DB)"; live="${live:-sampforce}"
compose --profile tools run --rm -T --entrypoint bash backup \
  /sampforce/scripts/restore.sh "/backups/${file_abs#"$dir_abs"/}" "$target" < /dev/null

if [ "$switch" != "--switch" ]; then
  echo
  echo "Restored into database $target (SampForce is still using the live database)."
  echo "To switch over:  scripts/restore.sh $file --switch   (restores again, then switches)"
  echo "To discard it:   docker compose -f docker-compose.prod.yml exec mongo bash -c 'mongosh -u root -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin --quiet --eval \"db.getSiblingDB(\\\"$target\\\").dropDatabase()\"'"
  exit 0
fi

answer=""
read -r -p "Switch SampForce to the restored data? Changes since the backup will no longer be live. Type SWITCH: " answer || true
[ "$answer" = "SWITCH" ] || { echo "not switched; $target is left in place"; exit 1; }
compose stop caddy web worker api
if grep -q '^SAMPFORCE_DB=' .env; then sed -i "s/^SAMPFORCE_DB=.*/SAMPFORCE_DB=${target}/" .env; else echo "SAMPFORCE_DB=${target}" >> .env; fi
compose up -d
echo "Switched to $target. The previous live database is kept as $live; drop it once you are sure:"
echo "  docker compose -f docker-compose.prod.yml exec mongo bash -c 'mongosh -u root -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin --quiet --eval \"db.getSiblingDB(\\\"$live\\\").dropDatabase()\"'"
