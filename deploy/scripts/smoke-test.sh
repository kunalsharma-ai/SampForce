#!/usr/bin/env bash
# Checks a running SampForce from the outside: HTTPS, the redirect from HTTP, the web app, the API and its database,
# and the health of every container.
#
#   scripts/smoke-test.sh             # uses https://DOMAIN from .env
#   scripts/smoke-test.sh --insecure  # skip certificate checks (only for a test install with a local certificate)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

domain="$(env_value DOMAIN)"
curl_opts=(-sS --max-time 15 --resolve "$domain:443:127.0.0.1" --resolve "$domain:80:127.0.0.1")
[ "${1:-}" = "--insecure" ] && curl_opts+=(-k)
fail=0
check() { # check <label> <expected> <actual>
  if [ "$3" = "$2" ]; then echo "ok    $1"; else echo "FAIL  $1 (expected $2, got $3)"; fail=1; fi
}
code() { curl "${curl_opts[@]}" -o /dev/null -w '%{http_code}' "$@" || echo 000; }

check "http redirects to https"      308 "$(code "http://$domain/")"
check "web /healthz"                 200 "$(code "https://$domain/healthz")"
check "login page"                   200 "$(code "https://$domain/login")"
check "pricing page"                 200 "$(code "https://$domain/pricing")"
check "api ready (database reachable)" 200 "$(code "https://$domain/api/v1/health/ready")"
check "metrics not public"           404 "$(code "https://$domain/metrics")"
for svc in postgres api worker web; do
  id="$(compose ps -q "$svc")"
  state="$( [ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" || echo missing)"
  check "container $svc healthy" healthy "$state"
done
[ "$fail" = 0 ] && echo "All checks passed." || { echo "Some checks failed: docker compose -f docker-compose.prod.yml logs --tail=100"; exit 1; }
