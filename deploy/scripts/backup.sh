#!/usr/bin/env bash
# Takes a database backup (pg_dump custom format + SHA-256 checksum + manifest) into BACKUP_DIR and deletes
# backups older than BACKUP_KEEP_DAYS. Safe while SampForce is running.
#
#   scripts/backup.sh
#
# Schedule it daily with cron (see SERVER_SETUP.md) and copy BACKUP_DIR off the server.
# The backup does not contain ENCRYPTION_KEY; keep that separately or the restored secrets cannot be opened.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

dir="$(env_value BACKUP_DIR)"; dir="${dir:-./backups}"
keep="$(env_value BACKUP_KEEP_DAYS)"; keep="${keep:-14}"
mkdir -p "$dir" && chmod 700 "$dir"
file="$(compose --profile tools run --rm -T backup | tail -n1)"
echo "backup written: $dir/$(basename "$file")"
find "$dir" -maxdepth 1 \( -name 'sampforce-*.dump*' -o -name 'dealflow-*.dump*' \) -mtime "+$keep" -print -delete | sed 's/^/deleted old: /'
