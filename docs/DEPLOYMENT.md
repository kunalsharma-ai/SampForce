# Deploying DealFlow

There are two supported ways to run DealFlow:

- **One Linux server with Docker Compose**: `deploy/` holds the compose file, Caddy (automatic HTTPS), settings
  templates and backup/restore/update scripts. Follow [deploy/SERVER_SETUP.md](../deploy/SERVER_SETUP.md).
- **Kubernetes with the Helm chart** in `infrastructure/helm/dealflow`: the rest of this document.

This is how DealFlow is meant to run in production. The Helm chart and images are built and checked in CI
(`helm lint --strict`, `helm template | kubeconform`, image builds); the chart has **not** yet been installed on a
real cluster. Treat the first staging install as part of acceptance.

## 1. What runs

| Component | Image | Command | Scales | Notes |
|---|---|---|---|---|
| API | `dealflow-api` | `node dist/main.js` | HPA on CPU (2–10) | Port 4000, metrics on 9464 |
| Worker | `dealflow-api` | `node dist/worker.js` | Fixed replicas (2) | Queue claims use `FOR UPDATE SKIP LOCKED`, so copies are safe. `/healthz` on the metrics port fails after 5 minutes without a completed cycle |
| Web | `dealflow-web` | `node apps/web/server.js` | HPA on CPU (2–6) | Port 3000, `/healthz`; proxies `/api/*` to `API_INTERNAL_URL` |
| Migrations | `dealflow-migrate` | `prisma migrate deploy` | Helm pre-install/pre-upgrade Job | Uses `MIGRATION_DATABASE_URL` |

Dependencies you provide: PostgreSQL 16 (managed), an ingress controller with TLS, a secret store, and optionally
Prometheus (Operator) and an OpenTelemetry collector. Redis is not required by the current code.

## 2. Database

1. Create the roles and grants with `scripts/db-setup.sh` (as an admin), using real passwords from your secret
   store (`DEALFLOW_OWNER_PASSWORD`, `DEALFLOW_APP_PASSWORD`, `DEALFLOW_BACKUP_PASSWORD`):
   - `dealflow_owner` owns the schema and runs migrations.
   - `dealflow_app` is the runtime role, **without BYPASSRLS**. Row-level security depends on this.
   - `dealflow_backup` is read-only **with BYPASSRLS**, used only by backups.
   On a managed service, check how it lets you grant BYPASSRLS before relying on the backup role.
2. Size the connection pool: Prisma defaults to `2 × CPUs + 1` connections per process. Set
   `?connection_limit=` on `DATABASE_URL` so that (API pods + worker pods) × limit stays under the server's
   `max_connections` with headroom. Under the Phase 8 load test, pool exhaustion showed up as
   "Unable to start a transaction in the given time" before the fix to slow queries.
3. The application sets `plan_cache_mode = force_custom_plan` and `jit = off` per transaction (ADR 0012); no server
   change is needed. Setting `jit = off` server-wide is also reasonable for this workload.

## 3. Secrets

Create one Secret (or sync it from your secret manager) and name it in `secrets.existingSecret`:

| Key | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `dealflow_app` |
| `MIGRATION_DATABASE_URL` | yes | `dealflow_owner`; used by the migration Job only |
| `JWT_ACCESS_SECRET` | yes | ≥ 32 random characters |
| `ENCRYPTION_KEY` | yes | 32 random bytes, base64 or hex. Losing it makes MFA secrets, SSO client secrets, webhook secrets and mailbox tokens unreadable |
| `OPERATOR_JWT_SECRET` | no | Enables the operator console |
| `SMTP_URL` | no | Account email (password reset). `smtps://user:pass@host:465`. Set `config.MAIL_FROM` with it. Without it, reset requests answer that email is not set up |
| `ANTHROPIC_API_KEY`, `STRIPE_*`, `RAZORPAY_*`, `GOOGLE_*`, `MICROSOFT_*` | no | Features stay "not configured" without them |

Provider keys (Apollo, Hunter, Deepgram, Google, Microsoft, Slack, Zoom, DocuSign, Anthropic, SMTP, Zapier, Stripe,
Razorpay) can instead be entered in the operator console under Providers. They are sealed with `ENCRYPTION_KEY`,
override the Secret, and reach the API and worker within `PROVIDER_KEYS_REFRESH_SECONDS` (default 10) without a
restart (ADR 0051). The secrets above `OPERATOR_JWT_SECRET` can only come from the Secret.

The console also holds the checkout settings (`ONLINE_PAYMENTS_ENABLED`, `STRIPE_PRICES`, `STRIPE_AUTOMATIC_TAX`,
`RAZORPAY_PLANS`, `PRICING_PUBLISHED`, `SALES_CONTACT_EMAIL`) and `AI_MODEL`, a setup guide per provider with the
redirect and webhook URLs to paste into it, and whether each provider's signed webhooks arrive (ADR 0053). Only
`DATABASE_URL`, `ENCRYPTION_KEY`, the two JWT secrets, `PUBLIC_WEB_URL` and `WEB_ORIGINS` must come from the
deployment; the console lists them with the reason.

The chart never writes secrets into ConfigMaps or values. Back up `ENCRYPTION_KEY` separately from database backups.

## 4. Install

```bash
helm upgrade --install dealflow infrastructure/helm/dealflow \
  --namespace dealflow --create-namespace \
  --set image.registry=ghcr.io/your-org --set image.tag=<git-sha> \
  --set publicUrl=https://crm.example.com --set ingress.host=crm.example.com \
  --set networkPolicy.ingressNamespaceSelector.kubernetes\.io/metadata\.name=ingress-nginx
```

- Use an immutable image tag (the commit SHA), never `latest`.
- Migrations run before the new pods start. A failed migration fails the release and leaves the old pods serving.
- Keep migrations backwards compatible with the previous release (add, backfill, then remove in a later release),
  because old pods keep serving during a rolling update.
- `metrics.serviceMonitor.enabled` and `metrics.prometheusRule.enabled` need the Prometheus Operator CRDs.

## 5. Security settings in the chart

Pods run as UID 1000, non-root, read-only root filesystem, all capabilities dropped, seccomp `RuntimeDefault`, no
service-account token. NetworkPolicies allow web traffic only from the ingress namespace, API traffic from the ingress
namespace and the web pods, and metrics scrapes only from the monitoring namespace. **Egress is not restricted**,
because the API calls identity providers, payment providers, mail providers and the AI provider; restrict it with
your own policy if you can enumerate them. The API's own private-network guard still blocks webhooks and OIDC
discovery to private addresses unless `ALLOW_PRIVATE_NETWORK_TARGETS=true` (never set this in production).

## 6. After the first install

1. Run `scripts/check-rls.sql` against the database as the owner role.
1. Create the first operator-console admin (there are no default credentials):
   `kubectl -n dealflow exec -it deploy/dealflow-api -- env OPERATOR_EMAIL=you@example.com OPERATOR_ROLE=ADMIN OPERATOR_PASSWORD='…' node dist/cli/create-operator.js`.
   Then enter provider keys under Providers in the console.
2. Sign up, enable two-step verification, sign out and back in.
3. Confirm `/metrics` is reachable from Prometheus and not from the internet.
4. Take a backup with `scripts/backup.sh` and restore it into a scratch database with `scripts/restore.sh`
   (docs/runbooks/database-restore.md). Record the times.
5. Fire a test alert (scale the worker to 0 for 10 minutes and watch `DealFlowWorkerStalled`).

See also: [OBSERVABILITY.md](OBSERVABILITY.md), [runbooks](runbooks/README.md), [perf](perf/README.md).
