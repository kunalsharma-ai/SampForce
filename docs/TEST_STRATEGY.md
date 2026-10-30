# DealFlow Test Strategy

**Rule:** a feature is not "complete" until its acceptance tests pass in CI.

## Test layers

| Layer | Tooling | Location | Runs |
|---|---|---|---|
| Unit | Vitest | `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts` | Every push |
| API integration (real Postgres, real RLS) | Vitest + Supertest + SWC | `apps/api/test/*.e2e.test.ts` | Every push |
| Database security | Vitest against the runtime role | `apps/api/test/tenancy.e2e.test.ts` | Every push |
| End-to-end (production builds) | Playwright (Chromium desktop + Pixel 7) | `apps/web/e2e` | Every push |
| Accessibility | axe-core via Playwright, WCAG 2.0/2.1/2.2 A+AA tags, light and dark | `apps/web/e2e/app.spec.ts` | Every push |
| Migration | `prisma migrate deploy` on an empty DB | CI step | Every push |
| Performance | k6 API load tests; Lighthouse CI budgets | Phase 2+ | Nightly |
| Security | CodeQL, dependency audit, ZAP baseline | Phase 2/8 | Nightly |
| AI evaluation | Golden datasets per prompt with deterministic scorers (`pnpm --filter @dealflow/api eval`, needs a real key; `--fixture` checks the harness only) | `apps/api/evals` | On prompt change |
| AI plumbing | API and browser tests against a local Claude Messages API fixture | `apps/api/test/fixtures/ai-fixture.ts`, `apps/api/test/ai*.e2e.test.ts`, `apps/web/e2e/ai.spec.ts` | Every push |
| Workflow execution | Pure engine unit tests; API tests drive the worker with `WorkerService.drain()`; providers replaced by a local HTTP fixture | `apps/api/src/automation/*.test.ts`, `apps/api/test/automation*.e2e.test.ts` | Every push |
| Billing | Provider sandbox + webhook fixtures, proration math unit tests | Phase 6 | Every push |
| Backup restore | Restore latest snapshot into a scratch DB and run smoke tests | Phase 8 | Weekly |

## Phase 1 results (2026-10-30)

| Suite | Result |
|---|---|
| `packages/types` unit | 7 passed |
| `packages/config` unit | 3 passed |
| `apps/api` unit + integration | 32 passed |
| `apps/web` unit | 2 passed |
| `apps/web` Playwright e2e + accessibility | 11 passed |

## Phase 2 results (2026-10-30)

| Suite | Result |
|---|---|
| `packages/types` unit | 7 passed |
| `packages/config` unit | 3 passed |
| `apps/api` unit + integration | 67 passed (incl. CSV parser, cross-tenant checks for every CRM resource) |
| `apps/web` unit | 2 passed |
| `apps/web` Playwright e2e + accessibility | 19 passed (8 new CRM flows; axe on CRM lists, record pages, board) |
| `scripts/check-rls.sql` | Passes on both databases |

## Phase 3 results (2026-10-30)

| Suite | Result |
|---|---|
| `packages/types` unit | 7 passed |
| `packages/config` unit | 4 passed |
| `apps/api` unit + integration | 112 passed in 16 files (engine, domain events, SSRF guard, workflows, approvals, webhooks, notifications, integrations, RLS for every Phase 3 table) |
| `apps/web` unit | 5 passed |
| `apps/web` Playwright e2e + accessibility | 22 passed (3 new automation and integration flows with axe) |

Provider tests use `apps/api/test/fixtures/provider-fixture.ts`, a local server that imitates the Google and
Microsoft OAuth, mail and calendar endpoints. They prove our code paths, not the real providers.

## Phase 4 results (2026-10-30)

| Suite | Result |
|---|---|
| `packages/types` unit | 14 passed (forecast maths) |
| `packages/config` unit | 4 passed |
| `apps/api` unit + integration | 152 passed in 22 files (gateway, credits, kill switches, redaction, Copilot loop and proposals, agents, forecasting and snapshots, acceptance test 6, RLS for every Phase 4 table, eval scorers and harness) |
| `apps/web` unit | 5 passed |
| `apps/web` Playwright e2e + accessibility | 26 passed (4 new AI flows with axe: Copilot confirm, AI Agents controls, record AI cards, forecasting and AI workflow draft) |
| `scripts/check-rls.sql` | Passes on both databases |
| Eval suites against the real model | **Not run yet** (no API key in this environment). `--fixture` run confirms the harness only; the fixture fails most cases by design because it is not a model |

AI tests use `apps/api/test/fixtures/ai-fixture.ts`, a local server that returns responses in the Claude Messages API
shape. They prove the gateway, tool loop, permissions and safety rules. They say nothing about answer quality.

## Critical acceptance tests (from the brief) and where they live

| # | Acceptance criterion | Status | Test |
|---|---|---|---|
| 1 | Users can register and create organizations | **Pass** | `auth.e2e.test.ts` "registers a user…", e2e "signs up and shows…" |
| 2 | Tenant data cannot be accessed by another tenant | **Pass** | `tenancy.e2e.test.ts` (API, forged token, RLS read/write/leak) |
| 3 | Leads created, updated, assigned, converted | **Pass** | `crm.e2e.test.ts` (leads), `crm-isolation.e2e.test.ts`, e2e `crm.spec.ts` "works a lead…" |
| 4 | Pipelines support functional deal movement | **Pass** | `crm.e2e.test.ts` (pipelines and deals), e2e "moves a deal on the board with the keyboard" |
| 5 | Automation triggers execute correctly | **Pass** | `automation.e2e.test.ts`, `engine.test.ts`, e2e `automation.spec.ts` |
| 6 | AI actions respect authorization | **Pass** (against the AI fixture) | `ai-authorization.e2e.test.ts` (tools filtered by role, proposals re-checked on confirm, only the asker can confirm, kill switch and agent switches, cross-tenant reads, RLS on AI tables), e2e `ai.spec.ts` |
| 7 | Email integrations synchronize when configured | **Pass against a provider fixture** (real credentials untested) | `integrations.e2e.test.ts` |
| 8 | Dashboards display real data | **Pass** | `dashboard.e2e.test.ts` (exact KPI values from fixtures), e2e KPI check |
| 9 | Forecast calculations are reproducible | **Pass** | `dashboard.e2e.test.ts` "is reproducible", `forecast.e2e.test.ts` (exact totals, snapshot recompute, comparisons), `forecast.test.ts` |
| 10 | Billing enforces plan entitlements | Phase 6 | — |
| 11 | API endpoints enforce permissions | **Pass** | `rbac-audit.e2e.test.ts`, `auth.e2e.test.ts` unauthenticated checks |
| 12 | Sensitive actions generate audit logs | **Pass (Phase 1 actions)** | `rbac-audit.e2e.test.ts` |
| 13 | Failed integrations recover safely | **Pass** | `webhooks-notifications.e2e.test.ts` (retry, backoff, auto-disable), `integrations.e2e.test.ts` (revoked access marks the connection for reconnection) |
| 14 | Application works without optional 3D effects | **Pass** (no 3D yet; low-power and motion-off paths tested) | e2e preferences test |
| 15 | Application works on mobile devices | **Pass** | `mobile.spec.ts` (drawer nav, no horizontal overflow) |

## Running locally

```bash
pnpm db:setup                     # roles + dealflow, dealflow_test databases (needs a superuser PG connection)
pnpm db:migrate                   # dev database
MIGRATION_DATABASE_URL=…/dealflow_test DATABASE_URL=…/dealflow_test pnpm db:migrate
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e                     # starts the built API and web app
```

## Test data

Integration tests create their own tenants with random emails and truncate tables before each run.
The demo seed (`pnpm db:seed`) is for development only, refuses to run with `NODE_ENV=production`, and marks
its workspace `is_demo`, which the UI labels with a banner.
