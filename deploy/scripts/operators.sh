#!/usr/bin/env bash
# Lists and manages operator-console (super admin) accounts. Create one first with scripts/create-operator.sh.
#
#   scripts/operators.sh list
#   scripts/operators.sh disable ops@example.com     # signs them out at once
#   scripts/operators.sh enable ops@example.com
#   scripts/operators.sh role ops@example.com SUPPORT   # or ADMIN
#
# The last active ADMIN cannot be disabled or demoted. Every change is written to the operator audit log.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ $# -ge 1 ] || { echo "usage: scripts/operators.sh <list | disable <email> | enable <email> | role <email> ADMIN|SUPPORT>" >&2; exit 2; }
compose run --rm -T --no-deps api node dist/cli/operators.js "$@" < /dev/null
