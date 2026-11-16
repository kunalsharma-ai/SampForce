#!/usr/bin/env bash
# Replaces the session signing secrets stored in the database (ADR 0059) and restarts the API and the worker.
# Everyone's access token fails once and is refreshed automatically; operators sign in again. Unsubscribe and
# tracking links in emails already sent stop working, because they are signed with a key derived from it.
#
#   scripts/rotate-signing-secrets.sh                        # both
#   scripts/rotate-signing-secrets.sh OPERATOR_JWT_SECRET     # only the operator console's
set -euo pipefail
source "$(dirname "$0")/lib.sh"

find_api
api_cli rotate-signing-secrets.js "$@"
compose restart api worker
echo "Done. The API and the worker now sign with the new secrets."
