#!/usr/bin/env bash
# Updates DealFlow to the latest code: backup, pull, rebuild, migrate, restart.
#
#   scripts/update.sh            # pulls the current branch with git
#   scripts/update.sh --no-pull  # rebuild what is already on disk (for example after copying a new release zip)
#
# Migrations run before the new API starts; if one fails, the old containers keep serving.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

"$DEPLOY_DIR/scripts/backup.sh"
if [ "${1:-}" != "--no-pull" ]; then git -C "$DEPLOY_DIR/.." pull --ff-only; fi
compose build
compose up -d --remove-orphans
"$DEPLOY_DIR/scripts/smoke-test.sh"
docker image prune -f >/dev/null
