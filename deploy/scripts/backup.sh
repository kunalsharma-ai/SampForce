#!/usr/bin/env bash
# Takes a database backup (gzipped mongodump archive + SHA-256 checksum + manifest) into BACKUP_DIR and deletes
# backups older than BACKUP_KEEP_DAYS. Safe while SampForce is running.
#
#   scripts/backup.sh
#
# Schedule it daily with cron (see SERVER_SETUP.md) and copy BACKUP_DIR off the server.
# The backup contains ENCRYPTION_KEY (it is stored in the database, ADR 0059), so it can open every stored API key:
# keep backup files private and encrypted. In return a backup restores on any server without a separate key.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

dir="$(env_value BACKUP_DIR)"; dir="${dir:-./backups}"
keep="$(env_value BACKUP_KEEP_DAYS)"; keep="${keep:-14}"
mkdir -p "$dir" && chmod 700 "$dir"
file="$(compose --profile tools run --rm -T backup | tail -n1)"
echo "backup written: $dir/$(basename "$file")"
find "$dir" -maxdepth 1 \( -name 'sampforce-*.archive.gz*' -o -name 'sampforce-*.dump*' -o -name 'dealflow-*.dump*' \) -mtime "+$keep" -print -delete | sed 's/^/deleted old: /'
