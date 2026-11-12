# Deploying SampForce

There are two supported ways to run SampForce:

- **One Linux server with Docker Compose**: `deploy/` holds the compose file, Caddy (automatic HTTPS), settings
  templates and backup/restore/update scripts. Follow [deploy/SERVER_SETUP.md](../deploy/SERVER_SETUP.md).
- **Kubernetes with the Helm chart** in `infrastructure/helm/dealflow`: the rest of this document.

This is how SampForce is meant to run in production. The Helm chart and images are built and checked in CI
(`helm lint --strict`, `helm template | kubeconform`, image builds); the chart has **not** yet been installed on a
real cluster. Treat the first staging install as part of acceptance.

## 1. What runs

| Component | Image | Command | Scales | Notes |
|---|---|---|---|---|
| API | `dealflow-api` | `node dist/main.js` | HPA on CPU (2–10) | Port 4000, metrics on 9464 |
| Worker | `dealflow-api` | `node dist/worker.js` | Fixed replicas (2) | Queue claims use `FOR UPDATE SKIP LOCKED`, so copies are safe. `/healthz` on the metrics port fails after 5 minutes without a completed cycle |
| Web | `dealflow-web` | `node apps/web/server.js` | HPA on CPU (2–6) | Port 3000, `/healthz`; proxies `/api/*` to `API_INTERNAL_URL` |
| Database set-up | `dealflow-migrate` | `node node_modules/@dealflow/database/dist/setup-cli.js` (collections, indexes, plans; idempotent) | Helm pre-install/pre-upgrade Job | Uses `MIGRATION_DATABASE_URL` |

Dependencies you provide: MongoDB 7.0 or newer as a replica set (managed, such as Atlas, or your own; transactions need a replica set), an ingress controller with TLS, a secret store, and optionally
Prometheus (Operator) and an OpenTelemetry collector. Redis is not required by the current code.

## 2. Database

1. Use a MongoDB 7.0 or newer **replica set** (see DATABASE.md before choosing 8) (three members in production; Atlas clusters are replica sets). SampForce uses
   multi-document transactions, which a standalone server does not support.
2. Create three users on the SampForce database, with real passwords from your secret store
   (`deploy/mongo/init-sampforce.js` shows the exact roles):
   - `sampforce_app`: the API and the worker. Give it a custom role, `sampforce_runtime`, with the actions
     find, insert, update, remove, createCollection, listCollections, listIndexes, collStats, dbStats, killCursors on the database. Do not use the built-in `readWrite`: it can also drop indexes and collections, and the
     unique indexes are part of how SampForce keeps data consistent. (Atlas: Database Access, Custom Roles.)
     Workspace isolation is enforced by SampForce's database client (ADR 0058), so this user must not be shared
     with other tools.
   - `sampforce_admin`: `readWrite` and `dbAdmin`. The set-up Job, which creates and drops indexes.
   - `sampforce_backup`: MongoDB's built-in `backup` role, used only by `scripts/backup.sh`.
3. Size the connection pool with `maxPoolSize` on `DATABASE_URL` (the driver's default is 100 per process) so that
   (API pods + worker pods) × pool stays well under what your cluster tier allows.
4. Busy documents make transactions retry rather than wait (MongoDB aborts a conflicting transaction at once;
   `withDbContext` retries up to 12 times). Retries appear as `WriteConflict` in debug logs; a steady stream of them
   on one workspace points at a hot document.

## 3. Secrets

Create one Secret (or sync it from your secret manager) and name it in `secrets.existingSecret`:

| Key | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `mongodb://` or `mongodb+srv://` URL for `sampforce_app`, naming the database |
| `MIGRATION_DATABASE_URL` | yes | Same database, `sampforce_admin`; used by the set-up Job only |
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
- Database set-up (new collections and indexes) runs before the new pods start. A failed set-up fails the release
  and leaves the old pods serving.
- Keep schema changes backwards compatible with the previous release (add, back-fill, then remove in a later
  release), because old pods keep serving during a rolling update. Removing a field from the schema leaves it in old
  documents; drop it with a script once no release reads it.
- `metrics.serviceMonitor.enabled` and `metrics.prometheusRule.enabled` need the Prometheus Operator CRDs.

## 5. Security settings in the chart

Pods run as UID 1000, non-root, read-only root filesystem, all capabilities dropped, seccomp `RuntimeDefault`, no
service-account token. NetworkPolicies allow web traffic only from the ingress namespace, API traffic from the ingress
namespace and the web pods, and metrics scrapes only from the monitoring namespace. **Egress is not restricted**,
because the API calls identity providers, payment providers, mail providers and the AI provider; restrict it with
your own policy if you can enumerate them. The API's own private-network guard still blocks webhooks and OIDC
discovery to private addresses unless `ALLOW_PRIVATE_NETWORK_TARGETS=true` (never set this in production).

## 6. After the first install

1. Create the first operator-console admin (there are no default credentials):
   `kubectl -n dealflow exec -it deploy/dealflow-api -- env OPERATOR_EMAIL=you@example.com OPERATOR_ROLE=ADMIN OPERATOR_PASSWORD='…' node dist/cli/create-operator.js`.
   Then enter provider keys under Providers in the console. List, disable, re-enable or change the role of
   operators with `node dist/cli/operators.js list | disable <email> | enable <email> | role <email> ADMIN|SUPPORT`
   in the same pod; the last active ADMIN cannot be disabled or demoted.
2. Sign up, enable two-step verification, sign out and back in.
3. Confirm `/metrics` is reachable from Prometheus and not from the internet.
4. Take a backup with `scripts/backup.sh` and restore it into a scratch database with `scripts/restore.sh`
   (docs/runbooks/database-restore.md). Record the times.
5. Fire a test alert (scale the worker to 0 for 10 minutes and watch `SampForceWorkerStalled`).

See also: [OBSERVABILITY.md](OBSERVABILITY.md), [runbooks](runbooks/README.md), [perf](perf/README.md).
