# DealFlow by Sampledge

**The Autonomous Revenue Intelligence Platform.** Close Smarter. Grow Faster. Flow Beyond Limits.

AI-native sales CRM: a multi-tenant SaaS built with Next.js, NestJS, PostgreSQL (row-level security) and
TypeScript. All eight roadmap phases are complete; the last was **Phase 8 (Enterprise Readiness)**. See
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for exactly what works today and what is next.

## What works today

- Sign up → a workspace is provisioned with five roles, a default sales pipeline and the Free plan
- Sign in/out, rotating refresh sessions with theft detection, multiple workspaces per user
- Tenant isolation enforced by PostgreSQL row-level security, with tests
- Role-based permissions on every endpoint; append-only audit log with UI
- Command Center with 15 KPIs computed from live data (formulas shown, no placeholder numbers)
- Dark/light themes, tenant brand colour, motion controls (system/full/reduced/off), low-power mode
- Core CRM: leads, contacts, companies, deals with pipelines and Kanban, activities, tasks, custom fields, import/export
- Automation Studio, approvals inbox, notifications, webhooks, Gmail/Microsoft 365 mail and calendar sync (needs OAuth app credentials)
- AI agents and Copilot through Claude (needs `ANTHROPIC_API_KEY`; tested against a local fixture), rule-based forecasting with snapshots
- Quotes priced from price books with discount approvals, versions and PDFs; contracts with renewals and reminders
- Segments with consent-aware export, hosted lead forms, campaign attribution, revenue analytics, customer health
- Billing: plans enforced through one entitlement rule, free trial, usage meters, and payment by invoice (bank transfer recorded by an operator). Stripe and Razorpay checkout is built but switched off (`ONLINE_PAYMENTS_ENABLED`; tested against local fixtures only, see [docs/BILLING.md](docs/BILLING.md))
- Custom roles (Professional and above), onboarding checklist, owner-granted support access
- Operator console at `/operator` for platform staff (enable with `OPERATOR_JWT_SECRET`; create operators with `pnpm --filter @dealflow/api operator:create`, or `node dist/cli/create-operator.js` in the API image)
- Public landing page and `/pricing`, labelled a launch preview until `PRICING_PUBLISHED=true` (set in the Helm chart: the rate card is approved)
- Report builder (validated definitions, no raw SQL) with templates, CSV export (audited) and shared dashboards
- Relationship Galaxy and Revenue Globe in 3D (lazy-loaded) with 2D and table equivalents; pipeline flow and replay from recorded stage history
- Two-step verification (authenticator app, recovery codes), account lockout, signed-in device list with remote sign-out
- Single sign-on with OpenID Connect and SCIM 2.0 provisioning on every plan, including Free (tested against a local provider only)
- Strict content security policy with nonces; Prometheus metrics, OpenTelemetry traces, redacted logs
- Helm chart (CI-checked, not yet installed on a cluster), backup/restore scripts with drilled times, runbooks in [docs/runbooks](docs/runbooks/README.md)
- 26-module navigation; the one unscheduled module (Marketplace) says so instead of leading to a dead end
- OpenAPI 3.1 at `/api/v1/openapi.json`, Swagger UI at `/api/v1/docs`

## Quick start

Requirements: Node 26 (LTS), pnpm 10, PostgreSQL 16 (or Docker).

```bash
pnpm install
cp .env.example .env                      # then set JWT_ACCESS_SECRET (openssl rand -base64 48)

# Databases: either use Docker…
docker compose up -d postgres redis       # runs scripts/db-setup.sh on first start
# …or a local Postgres superuser:
PGUSER=postgres pnpm db:setup

pnpm build                                # builds packages and generates the Prisma client
MIGRATION_DATABASE_URL=postgresql://dealflow_owner:dealflow_owner_dev@localhost:5432/dealflow \
DATABASE_URL=postgresql://dealflow_owner:dealflow_owner_dev@localhost:5432/dealflow pnpm db:migrate
pnpm db:seed                              # optional: labelled demo workspace (demo@dealflow.local)
pnpm dev                                  # web on :3000, API on :4000
```

## Quality gates

```bash
pnpm lint && pnpm typecheck
pnpm test        # unit + API integration (needs the dealflow_test database migrated)
pnpm test:e2e    # Playwright e2e + axe accessibility on production builds
```

## Repository map

| Path | What |
|---|---|
| `apps/api` | NestJS REST API |
| `apps/web` | Next.js CRM application |
| `packages/types` | Zod schemas, permissions, plans, shared types |
| `packages/database` | Prisma schema, migrations (RLS), tenant-context helper |
| `packages/ui` | Design tokens, Tailwind preset, accessible components |
| `packages/config` | Validated environment configuration |
| `infrastructure/helm/dealflow` | Helm chart (API, worker, web, migrations, autoscaling, policies, alerts) |
| `deploy/` | Self-hosting on one Linux server: Docker Compose, Caddy HTTPS, settings templates, backup/restore/update scripts ([guide](deploy/SERVER_SETUP.md)) |
| `scripts/` | Database setup, RLS check, backup, restore, load-test runner |
| `docs/` | PRD, architecture, ERD, AI/automation, security, tests, UI spec, pricing, feature matrix, ADRs, deployment, runbooks |

## Documentation

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md) · [Database & ERD](docs/DATABASE.md) · [ADRs](docs/adr)
- [AI agents & automation](docs/AI_AND_AUTOMATION.md)
- [Security model](docs/SECURITY_MODEL.md) · [Test strategy](docs/TEST_STRATEGY.md)
- [UI/UX design system](docs/UI_DESIGN_SYSTEM.md)
- [Competitive feature matrix](docs/FEATURE_MATRIX.md) · [Pricing & unit economics](docs/PRICING_STRATEGY.md)
- [Implementation plan & feature status](docs/IMPLEMENTATION_PLAN.md) · [Billing setup](docs/BILLING.md)
- [Self-host on one server](deploy/SERVER_SETUP.md) · [Deployment (Kubernetes)](docs/DEPLOYMENT.md) · [Observability](docs/OBSERVABILITY.md) · [Runbooks](docs/runbooks/README.md) · [Performance](docs/perf/README.md) · [Pen-test brief](docs/security/PENTEST_PREP.md)

## Credentials required for live integrations

None are configured. Each needs provider credentials and, in some cases, provider review before it can be
enabled: Google Workspace, Microsoft 365, Slack, Zoom, Twilio, WhatsApp Business, Stripe, Razorpay,
DocuSign, and AI providers (Anthropic, OpenAI, Google). See [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) §2E.

AI features use Anthropic's Claude when `ANTHROPIC_API_KEY` is set on the API and worker. They have been tested
against a local stand-in for the API only; run `pnpm --filter @dealflow/api eval` with a real key to measure them.

© Sampledge. All rights reserved.
