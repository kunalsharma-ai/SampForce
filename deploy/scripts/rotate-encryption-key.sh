#!/usr/bin/env bash
# Rotates ENCRYPTION_KEY, which is stored in the database (ADR 0059): a new key is stored, every stored secret
# (API keys, sign-in secrets, MFA, SSO, webhooks, mailbox tokens) is re-sealed with it, the API and the worker are
# restarted, and the old key is forgotten. Nobody is signed out. Backups made before the rotation still contain the
# old key and keep working when restored.
#
#   scripts/rotate-encryption-key.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

find_api
api_cli rotate-encryption-key.js start
compose restart api worker
find_api
api_cli rotate-encryption-key.js finish
echo "Done. ENCRYPTION_KEY was rotated."
