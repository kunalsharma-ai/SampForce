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
