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
# The super admin scripts run SampForce's command-line tools (node dist/cli/*.js) in the API.
# Preferred: exec into the api container that is already running from this folder. That works whatever compose
# file or project name started it, so it is on the right network. Otherwise: a one-off container from
# docker-compose.prod.yml, which needs the database container to be up first.
API_CONTAINER=""
find_api() { # sets API_CONTAINER, or checks the database is ready for a one-off container
  API_CONTAINER="$(docker ps -q --filter label=com.docker.compose.service=api \
    --filter "label=com.docker.compose.project.working_dir=$DEPLOY_DIR" | head -n1)"
  [ -n "$API_CONTAINER" ] || require_database
}
api_cli() { # api_cli <tool.js> [args...]  (env vars named in API_CLI_ENV are passed through)
  local tool="$1"; shift
  local envs=() name
  for name in ${API_CLI_ENV:-}; do envs+=(-e "$name"); done
  if [ -n "$API_CONTAINER" ]; then
    docker exec "${envs[@]}" "$API_CONTAINER" node "dist/cli/$tool" "$@" < /dev/null
  else
    compose run --rm -T --no-deps "${envs[@]}" api node "dist/cli/$tool" "$@" < /dev/null
  fi
}

# require_database: stop with clear steps unless the MongoDB container is up and healthy (waits while it starts).
# A one-off api container would otherwise fail with
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
  echo "SampForce is not running from $DEPLOY_DIR (no api container, database state '$state')." >&2
  echo "Start it first, from that folder:" >&2
  echo "  docker compose -f docker-compose.prod.yml up -d" >&2
  echo "  docker compose -f docker-compose.prod.yml ps        # api and mongo should say (healthy)" >&2
  echo "If you start SampForce with your own compose file, start it with that file, then run this script again." >&2
  echo "If mongo keeps restarting: docker compose -f docker-compose.prod.yml logs --tail=50 mongo" >&2
  exit 1
}
