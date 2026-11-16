#!/usr/bin/env bash
# Installs SampForce on this server in one command: generates every secret, builds, starts, checks, and creates the
# first super admin (operator) login. Nothing needs to be typed into a settings file.
#
#   scripts/install.sh crm.company.com admin@company.com "Admin Name"
#
# Arguments: the domain pointing at this server, the email for the first super admin (also used for Let's Encrypt
# notices), and that person's name. It asks for the super admin password (or reads OPERATOR_PASSWORD).
# Add --insecure as a fourth argument only for a test install with a local certificate (the smoke test skips TLS checks).
#
# What goes where (ADR 0059):
#   deploy/.env     the database passwords, generated here; DOMAIN and ACME_EMAIL from the arguments
#   the database    every API key (entered afterwards in the operator console under Providers), and ENCRYPTION_KEY
#                   and the session signing secrets (created by the API on its first start)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

domain="${1:?usage: scripts/install.sh <domain> <admin email> [admin name] [--insecure]}"
email="${2:?usage: scripts/install.sh <domain> <admin email> [admin name] [--insecure]}"
name="${3:-$email}"
insecure="${4:-}"
command -v docker >/dev/null || { echo "Docker is needed first: SERVER_SETUP.md step 3." >&2; exit 1; }

if [ -e .env ]; then
  echo "deploy/.env already exists: keeping its secrets (the database was created with them)."
else
  "$DEPLOY_DIR/scripts/generate-secrets.sh" "$domain" "$email"
fi

echo "Building and starting SampForce (10 to 20 minutes the first time)..."
compose up -d --build

echo "Waiting for the API and the worker to be healthy..."
for i in $(seq 1 90); do
  ok=1
  for svc in mongo api worker web; do
    id="$(compose ps -q "$svc")"
    state="$( [ -n "$id" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    [ "$state" = healthy ] || ok=0
  done
  [ "$ok" = 1 ] && break
  sleep 5
done
"$DEPLOY_DIR/scripts/smoke-test.sh" $insecure

"$DEPLOY_DIR/scripts/create-operator.sh" "$email" "$name" ADMIN

cat <<MSG

SampForce is installed.

  1. Save deploy/.env and deploy/mongo/keyfile in a password manager. Keep backups private: they contain the key
     that opens every stored API key.
  2. Sign in at https://$(env_value DOMAIN)/operator/login as $email.
  3. Under Providers, add the API keys for the integrations you want (start with SMTP so password-reset email
     works). Each one has a setup guide and a Test connection button. Keys apply within seconds, no restart.
  4. Under Providers > Plans and online checkout, turn on "show final prices" once your rate card is final.
  5. Schedule the nightly backup (SERVER_SETUP.md step 9).
MSG
