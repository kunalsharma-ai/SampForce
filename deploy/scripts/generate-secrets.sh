#!/usr/bin/env bash
# Creates deploy/.env and deploy/dealflow.env from the examples and fills every blank secret with a random value.
#
#   scripts/generate-secrets.sh crm.example.com admin@example.com
#
# Refuses to overwrite an existing .env: the database roles were created with the passwords in it.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DOMAIN="${1:-}"
ACME_EMAIL="${2:-}"
if [ -e .env ]; then
  echo "deploy/.env already exists; not overwriting it (the database was set up with its passwords)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is needed (sudo apt-get install -y openssl)" >&2; exit 1; }

umask 077
cp .env.example .env
# Hex only, so every value is safe inside a postgresql:// URL and in YAML.
for key in POSTGRES_PASSWORD DEALFLOW_OWNER_PASSWORD DEALFLOW_APP_PASSWORD DEALFLOW_BACKUP_PASSWORD \
           JWT_ACCESS_SECRET ENCRYPTION_KEY OPERATOR_JWT_SECRET; do
  sed -i "s/^${key}=$/${key}=$(openssl rand -hex 32)/" .env
done
[ -n "$DOMAIN" ] && sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env
[ -n "$ACME_EMAIL" ] && sed -i "s/^ACME_EMAIL=.*/ACME_EMAIL=${ACME_EMAIL}/" .env
chmod 600 .env

if [ ! -e dealflow.env ]; then cp dealflow.env.example dealflow.env; chmod 600 dealflow.env; fi

echo "Created deploy/.env (secrets) and deploy/dealflow.env (application settings)."
echo "DOMAIN=$(env_value DOMAIN)  ACME_EMAIL=$(env_value ACME_EMAIL)"
echo
echo "IMPORTANT: copy ENCRYPTION_KEY to your password manager now. Backups are useless without it:"
echo "  $(env_value ENCRYPTION_KEY)"
