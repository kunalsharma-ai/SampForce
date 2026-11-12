#!/usr/bin/env bash
# Creates (or resets the password of) an operator-console account. There are no default operator credentials.
# ADMIN operators can enter provider keys, record offline payments and manage settings; SUPPORT is read-only.
#
#   scripts/create-operator.sh ops@example.com "Ops Name" ADMIN
#
# Asks for the password (at least 10 characters) without echoing it.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

email="${1:?usage: scripts/create-operator.sh <email> [name] [ADMIN|SUPPORT]}"
name="${2:-$email}"
role="${3:-ADMIN}"
require_database
if [ -n "${OPERATOR_PASSWORD:-}" ]; then password="$OPERATOR_PASSWORD"; else
  read -r -s -p "Password for $email: " password; echo
  read -r -s -p "Repeat it: " again; echo
  [ "$password" = "$again" ] || { echo "passwords differ" >&2; exit 1; }
fi
OPERATOR_EMAIL="$email" OPERATOR_NAME="$name" OPERATOR_ROLE="$role" OPERATOR_PASSWORD="$password" \
  compose run --rm -T --no-deps -e OPERATOR_EMAIL -e OPERATOR_NAME -e OPERATOR_ROLE -e OPERATOR_PASSWORD \
  api node dist/cli/create-operator.js
echo "Sign in at https://$(env_value DOMAIN)/operator/login"
