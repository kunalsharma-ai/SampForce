# Observability

## Metrics

Served by the API and by the worker on `METRICS_PORT` (default 9464 in the chart) at `/metrics`. This port is
separate from the public API port and the chart's NetworkPolicy only admits the monitoring namespace.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `dealflow_http_request_duration_seconds` | histogram | `method`, `route` (route template, e.g. `/api/v1/deals/:id`), `status` (`2xx`…`5xx`) | API latency and volume. Raw URLs are never used as labels |
| `dealflow_auth_events_total` | counter | `event`: `login_success`, `login_failure`, `mfa_failure`, `lockout`, `sso_success`, `sso_failure` | Sign-in health and attack signals |
| `dealflow_worker_ticks_total` | counter | `outcome`: `ok`, `error` | Worker polling cycles |
| `dealflow_worker_items_total` | counter | `queue` | Jobs processed per queue |
| `dealflow_worker_last_tick_timestamp_seconds` | gauge | none | Unix time of the last completed cycle |
| `dealflow_process_*`, `dealflow_nodejs_*` | various | | Node.js defaults (CPU, memory, event-loop lag, GC) |

Alert rules ship in the chart (`metrics.prometheusRule.enabled`) with starting thresholds that have not been tuned
against production traffic. Each has a section in [runbooks/alerts.md](runbooks/alerts.md).

## Traces

OpenTelemetry tracing starts only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `…_TRACES_ENDPOINT`) is set. It
instruments inbound and outbound HTTP, Express routing, Prisma queries and Pino logs. Health checks are not traced.
URLs in spans have tokens, `code`, `state` and form tokens removed. `scripts/verify-tracing.mjs` checks this
against a local collector (Phase 8 run: 45 spans from the http, express and prisma scopes, no secrets found).

## Logs

JSON (Pino) to stdout. Request logs include the request id, method, redacted URL and status; `authorization`,
`cookie` and `set-cookie` headers are replaced with `[redacted]`. With tracing on, each line has `trace_id` and
`span_id`. Failed sign-ins appear in logs (no tenant to attribute them to); everything tenant-scoped is also in the
workspace audit log.

## Health endpoints

| Endpoint | Component | Use |
|---|---|---|
| `GET /api/v1/health/live` | API | Liveness, no dependencies |
| `GET /api/v1/health/ready` | API | Readiness, checks the database |
| `GET /healthz` (metrics port) | Worker | Fails when no cycle completed in 5 minutes |
| `GET /healthz` | Web | Liveness and readiness |
