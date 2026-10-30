# DealFlow Implementation Plan and Feature Status

Each phase ends with a working application, green CI (build, lint, typecheck, unit, integration, e2e,
accessibility) and an updated status table. A feature is "Tested" only when its acceptance tests pass.

## Roadmap

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| **1. Product Foundation** | Monorepo, Next.js web, NestJS API, schema + RLS, auth, tenant isolation, RBAC, audit log, design system, navigation, Command Center foundation, CI, Docker, env config | Acceptance tests 1, 2, 8, 9, 11, 12, 14, 15 pass | **Complete (2026-10-30)** |
| 2. Core CRM | Leads, contacts, companies, accounts, deals, pipelines (Kanban/list/table), activities, tasks, search, custom fields, CSV/Excel import/export, duplicate detection, invitations | Tests 3, 4; RLS CI guard for new tables | Next |
| 3. Automation & Communication | Outbox + worker, workflow engine, Automation Studio, approvals, notifications, Gmail/M365 + calendar adapters, sequences, webhooks | Tests 5, 7, 13 | Planned |
| 4. AI Intelligence | AI gateway, metering, Copilot, lead-qualification, deal-intelligence, meeting, proposal agents, forecasting + snapshots, AI workflow builder | Test 6; eval suites | Planned |
| 5. Advanced Revenue | Marketing automation, revenue analytics, customer success, quotes/proposals/contracts, multi-currency/FX, territories, localisation | Module acceptance tests | Planned |
| 6. Commercialization | Billing engine (Stripe/Razorpay adapters), entitlements enforcement, usage metering, operator console, onboarding, marketing site, custom roles | Test 10 | Planned |
| 7. Immersive Experience | Relationship Galaxy, Revenue Globe, animated pipeline intelligence, time-based replays, spatial dashboards | 60 FPS budget, fallbacks pass a11y | Planned |
| 8. Enterprise Readiness | SSO/SCIM/MFA, Kubernetes/Helm, observability, DR drills, perf tuning, pen-test prep, prod runbooks | Security review, load test targets | Planned |

## Feature status (Phase 1 close)

| Feature | Status |
|---|---|
| pnpm monorepo, strict TypeScript, shared Zod schemas | Tested |
| PostgreSQL schema (18 tables) and migrations | Tested (applied in CI) |
| Row-level security on all tenant tables, non-bypass runtime role | Tested |
| Registration → workspace provisioning (roles, pipeline, Free plan) | Tested |
| Sign-in, refresh rotation with reuse detection, sign-out | Tested |
| Workspace switching | Tested |
| RBAC (5 system roles, 25 permissions), owner protections | Tested |
| CSRF origin guard, rate limiting, Helmet headers | Tested (origin, limits configured) |
| Append-only audit log + API + UI | Tested |
| Command Center KPIs (13 live, 2 awaiting later phases) | Tested |
| Pipeline-by-stage chart with accessible table | Tested |
| Settings: workspace (role-gated), appearance/motion/low-power | Tested |
| Team management: members, role change | Tested (API); UI covered by smoke navigation |
| 26-module navigation, roadmap pages for unshipped modules | Tested |
| Global search palette (navigation) | Tested |
| Copilot panel (explains Phase 4; no fake answers) | Implemented |
| Billing page (read-only plan + proposed rate card) | Implemented |
| Integrations status board (all "Not connected") | Implemented |
| OpenAPI 3.1 spec + Swagger UI | Tested |
| Health endpoints (live/ready) | Tested |
| Demo seed (dev only, labelled) | Implemented |
| GitHub Actions CI | Written; runs when the repository is connected |
| Dockerfiles + docker-compose | Written; **image builds not verified in this sandbox** (network policy blocks package downloads inside containers); CI job builds them |
| Leads … Marketplace modules | Planned (see roadmap) |
| Every third-party integration | Requires credentials (none connected) |
| Marketing claims, competitor comparisons, compliance statements | Requires legal review |

## Known issues / follow-ups

1. Preferences (theme, motion) persist per device; move to the user profile in Phase 2.
2. Monetary KPIs include only deals in the workspace default currency until FX ships (Phase 5); the KPI
   tooltips say so.
3. Rate limiting is in-memory per API instance; switch the throttler storage to Redis before running more
   than one instance.
4. CSP is Helmet's default on the API; a strict CSP with nonces for the web app is a Phase 8 task.
5. pgvector is not used yet; the compose file already uses the pgvector Postgres image.
6. Account lockout after repeated failures and MFA are Phase 8 (rate limiting applies now).

## Continuation instructions (Phase 2)

1. Add Prisma models: `CustomField`, `FileAttachment`, `OpportunityContact`, `OpportunityLineItem`; migration
   with RLS blocks; add a CI SQL check that every table with `tenant_id` has `relforcerowsecurity = true`.
2. Build vertically, one module at a time (Leads → Companies/Contacts → Deals/Pipelines → Activities/Tasks):
   Zod schemas in `packages/types` → service using `prisma.run` → controller with `@RequirePermissions` →
   audit events → OpenAPI registration → web page (TanStack Table list + detail drawer) → Vitest API tests
   (including a cross-tenant test per resource) → Playwright flow.
3. Deals Kanban with keyboard-accessible drag and drop (dnd-kit) and stage-change audit events.
4. Postgres trigram search behind the existing command palette; OpenSearch adapter later.
5. CSV/Excel import as a background job with a mapping step and duplicate detection.
6. Invitations (email via SES adapter in dev-log mode until credentials are provided).
