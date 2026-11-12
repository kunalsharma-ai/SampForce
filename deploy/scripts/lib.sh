# Shared by the deploy scripts: run from anywhere, always operate on deploy/.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"
# Installs from before the rename to SampForce keep their settings: dealflow.env becomes sampforce.env.
if [ -e dealflow.env ] && [ ! -e sampforce.env ]; then
  mv dealflow.env sampforce.env && echo "Renamed deploy/dealflow.env to deploy/sampforce.env (SampForce rename)." >&2
fi
# The backup container runs as the calling user (see the backup service).
export BACKUP_UID="$(id -u)" BACKUP_GID="$(id -g)"
compose() { docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" "$@"; }
env_value() { # env_value KEY  -> value from deploy/.env (empty if unset)
  sed -n "s/^$1=//p" "$DEPLOY_DIR/.env" 2>/dev/null | tail -n1
}
# require_database: stop with clear steps unless the MongoDB container is up and healthy (waits while it starts).
# Scripts that run a one-off api container use --no-deps, so they would otherwise fail with
# "Server selection timeout ... mongo ... Temporary failure in name resolution".
require_database() {
  local id state="missing" i
  for i in $(seq 1 30); do
    id="$(compose ps -q mongo 2>/dev/null || true)"
    state="$( [ -n "$id" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    [ "$state" = healthy ] && return 0
    [ "$state" = starting ] || break
    sleep 2
  done
  echo "The database (mongo container) is not running: state '$state'." >&2
  echo "Start the stack first, from $DEPLOY_DIR:" >&2
  echo "  docker compose -f docker-compose.prod.yml up -d" >&2
  echo "  docker compose -f docker-compose.prod.yml ps        # mongo should say (healthy)" >&2
  echo "If mongo keeps restarting: docker compose -f docker-compose.prod.yml logs --tail=50 mongo" >&2
  exit 1
}
