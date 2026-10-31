# Alerts

Thresholds are starting points from the chart (`templates/prometheusrule.yaml`), not tuned on production traffic.

## DealFlowApiErrorRate

More than 2% of API requests answered 5xx for 10 minutes.
1. Group by route: `sum by (route) (rate(dealflow_http_request_duration_seconds_count{status="5xx"}[5m]))`.
2. Search logs for `level 50` around the start time. "Unable to start a transaction in the given time" means the
   connection pool is exhausted: look for a slow query (below) or raise `connection_limit` within database limits.
3. If it started with a deploy, roll back (`deploy.md`).

## DealFlowApiLatencyHigh

p95 above 1.5 s for 15 minutes.
1. Find the route: `histogram_quantile(0.95, sum by (le, route) (rate(dealflow_http_request_duration_seconds_bucket[5m])))`.
2. Check database load (`pg_stat_activity`, slow query log). Known heavy routes at very large workspaces: forecast and
   pipeline flow (`docs/perf/README.md`).
3. Scale the API (HPA max) if CPU-bound.

## DealFlowWorkerStalled

No worker finished a cycle for 5 minutes. Automations, emails, webhooks and AI jobs queue up but do not run; nothing
is lost.
1. `kubectl -n dealflow get pods -l app.kubernetes.io/component=worker`; the liveness probe restarts a stuck worker.
2. Logs: `worker tick failed` with the reason (database unreachable, pool exhausted).
3. After recovery, the backlog drains on its own; watch `dealflow_worker_items_total`.

## DealFlowWorkerErrors

Worker cycles failing repeatedly. Read the `worker tick failed` log lines; usually the database or one bad job.

## DealFlowLockoutSpike

More than 20 accounts locked in 15 minutes: likely password guessing. Accounts unlock after 15 minutes on their own.
1. Look at `login_failure` by source IP in logs; block abusive ranges at the ingress or WAF.
2. Lower `AUTH_RATE_LIMIT_PER_MINUTE` if it is raised. Consider asking affected workspaces to require two-step
   verification.

## DealFlowSsoFailures

More than 20 failed SSO sign-ins in 15 minutes. Logs carry the reason code (`sso_error`), e.g. `invalid_response`
(token did not verify: the provider changed keys, issuer or client settings), `provider_error`, `domain_not_allowed`,
`no_seats`. Contact the workspace admin if it is one
workspace; check provider status if it is all of them.

## DealFlowPodsNotReady

A Deployment had unavailable pods for 10 minutes (needs kube-state-metrics). `kubectl describe pod` for image pull,
probe or scheduling errors. Readiness depends on the database for the API.
