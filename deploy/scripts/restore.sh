#!/usr/bin/env bash
# Restores a backup into a NEW database on this server and verifies it (checksum, row-level security, last
# migration). With --switch it then makes the restored copy the live database:
#
#   scripts/restore.sh backups/dealflow-20261102T120000Z.dump            # restore and verify only
#   scripts/restore.sh backups/dealflow-20261102T120000Z.dump --switch   # ... then switch SampForce over to it
#
# Switching stops the API, worker and web app (a few seconds of downtime), renames the live database to
# dealflow_before_<time> (kept, not dropped) and renames the restored copy to dealflow.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

file="${1:?usage: scripts/restore.sh <backup.dump> [--switch]}"
switch="${2:-}"
dir="$(env_value BACKUP_DIR)"; dir="${dir:-./backups}"
dir_abs="$(cd "$dir" && pwd)"
file_abs="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
case "$file_abs" in "$dir_abs"/*) ;; *) echo "the backup must be inside $dir (BACKUP_DIR); copy it there first" >&2; exit 2;; esac
[ -f "$file_abs" ] || { echo "no such file: $file" >&2; exit 2; }

stamp="$(date -u +%Y%m%d%H%M%S)"
target="dealflow_restore_${stamp}"
compose --profile tools run --rm -T --entrypoint bash backup \
  /dealflow/scripts/restore.sh "/backups/${file_abs#"$dir_abs"/}" "$target" < /dev/null

if [ "$switch" != "--switch" ]; then
  echo
  echo "Restored into database $target (SampForce is still using the live database)."
  echo "To switch over:  scripts/restore.sh $file --switch   (restores again, then switches)"
  echo "To discard it:   docker compose -f docker-compose.prod.yml exec postgres dropdb -U postgres $target"
  exit 0
fi

answer=""
read -r -p "Switch SampForce to the restored data? Changes since the backup will no longer be live. Type SWITCH: " answer || true
[ "$answer" = "SWITCH" ] || { echo "not switched; $target is left in place"; exit 1; }
compose stop caddy web worker api
compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -X -q -d postgres <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'dealflow' AND pid <> pg_backend_pid();
ALTER DATABASE dealflow RENAME TO dealflow_before_${stamp};
ALTER DATABASE ${target} RENAME TO dealflow;
SQL
compose up -d
echo "Switched. The previous live database is kept as dealflow_before_${stamp}; drop it once you are sure:"
echo "  docker compose -f docker-compose.prod.yml exec postgres dropdb -U postgres dealflow_before_${stamp}"
