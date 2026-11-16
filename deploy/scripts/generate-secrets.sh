#!/usr/bin/env bash
# Creates deploy/.env and deploy/sampforce.env from the examples and fills every blank secret with a random value.
#
#   scripts/generate-secrets.sh crm.example.com admin@example.com
#
# Refuses to overwrite an existing .env: the database users were created with the passwords in it.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DOMAIN="${1:-}"
ACME_EMAIL="${2:-}"
if [ -e .env ]; then
  echo "deploy/.env already exists; not overwriting it (the database users were created with its passwords)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is needed (sudo apt-get install -y openssl)" >&2; exit 1; }

umask 077
cp .env.example .env
# Hex only, so every value is safe inside a mongodb:// URL and in YAML.
# Only the database passwords: ENCRYPTION_KEY and the session signing secrets are created by the API in the database
# on its first start (ADR 0059).
for key in MONGO_ROOT_PASSWORD SAMPFORCE_ADMIN_PASSWORD SAMPFORCE_APP_PASSWORD SAMPFORCE_BACKUP_PASSWORD; do
  sed -i "s/^${key}=$/${key}=$(openssl rand -hex 32)/" .env
done
[ -n "$DOMAIN" ] && sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env
[ -n "$ACME_EMAIL" ] && sed -i "s/^ACME_EMAIL=.*/ACME_EMAIL=${ACME_EMAIL}/" .env
chmod 600 .env
# The replica set's internal authentication key (mongo/start.sh copies it with the mode mongod needs).
if [ ! -e mongo/keyfile ]; then openssl rand -base64 756 > mongo/keyfile; chmod 600 mongo/keyfile; fi

if [ ! -e sampforce.env ]; then cp sampforce.env.example sampforce.env; chmod 600 sampforce.env; fi

echo "Created deploy/.env (database passwords) and deploy/sampforce.env (optional limits)."
echo "API keys are not put in any file: enter them in the operator console under Providers after the install."
echo "DOMAIN=$(env_value DOMAIN)  ACME_EMAIL=$(env_value ACME_EMAIL)"
echo
echo "IMPORTANT: copy deploy/.env and deploy/mongo/keyfile to your password manager. Database backups now hold"
echo "the encryption key for every stored API key, so keep backup files as private as the keys themselves."
