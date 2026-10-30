# DealFlow Implementation Plan and Feature Status

Each phase ends with a working application, green CI (build, lint, typecheck, unit, integration, e2e,
accessibility) and an updated status table. A feature is "Tested" only when its acceptance tests pass.

## Roadmap

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| **1. Product Foundation** | Monorepo, Next.js web, NestJS API, schema + RLS, auth, tenant isolation, RBAC, audit log, design system, navigation, Command Center foundation, CI, Docker, env config | Acceptance tests 1, 2, 8, 9, 11, 12, 14, 15 pass | **Complete (2026-10-30)** |
| 2. Core CRM | Leads, contacts, companies, accounts, deals, pipelines (Kanban/list/table), activities, tasks, search, custom fields, CSV/Excel import/export, duplicate detection, invitations | Tests 3, 4; RLS CI guard for new tables | **Complete (2026-10-30)**, with the deferrals listed below |
| 3. Automation & Communication | Outbox + worker, workflow engine, Automation Studio, approvals, notifications, Gmail/M365 + calendar adapters, sequences, webhooks | Tests 5, 7, 13 | **Complete (2026-10-30)**, with the deferrals listed below |
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

## Feature status (Phase 2 close)

| Feature | Status |
|---|---|
| Leads: create, edit, assign, status, tags, owner, soft delete | Tested (API + e2e) |
| Duplicate detection (email, phone digits, name + company) and merge | Tested (API + e2e) |
| BANT / MEDDICC qualification checklist on leads | Tested (e2e) |
| Lead conversion → contact, matched-or-new company, optional deal; activities and tasks move over | Tested (API + e2e) |
| Contacts and companies (parent company, counts), Accounts view (companies with a won deal) | Tested (API + e2e) |
| Pipelines: create (plan limit), edit stages, reorder, default, delete rules | Tested (API); UI covered by a11y scan |
| Deals: list, Kanban board, stage path, move with loss reason, clone, bulk update | Tested (API + e2e) |
| Kanban keyboard drag and drop with screen-reader announcements, plus a Move menu | Tested (e2e) |
| Activities timeline (call, email, meeting, note) and tasks (mine/all, due, overdue, complete) | Tested (API + e2e) |
| Record search (Postgres trigram) in the command palette, scoped to readable record types | Tested (API + e2e) |
| Custom fields (text, number, date, yes/no, dropdown; required) in forms, pages, import, export | Tested (API + e2e) |
| CSV import with mapping, dry run, row errors and duplicate skipping (≤ 2 MB / 5,000 rows, synchronous) | Tested (API + e2e) |
| CSV export (data:export permission, audited, formula-injection safe) | Tested (API) |
| Invitations: link-based, 7-day, single use, hashed token, existing users confirm password, plan seat limit | Tested (API + e2e) |
| Quick create (lead, contact, company, deal, task) from the topbar and palette | Implemented; flows tested via list pages |
| Cross-tenant tests for every new resource; CI fails if a tenant table lacks forced RLS | Tested |
| Invitation **email delivery** | Not configured: the inviter copies the link. Needs an email provider (Phase 3) |

### Deferred from the Phase 2 scope (not built)

- Excel (.xlsx) import, and background import jobs for files over 5,000 rows.
- Deal line items, multiple contacts per deal (buying committee) and file attachments.
- Deal table, timeline and calendar views (list and Kanban ship); column chooser.
- Lead routing rules (territory, round-robin) and web-form capture (Phase 3 with automation).
- Moving display preferences from the device to the user profile.

## Known issues / follow-ups

1. Preferences (theme, motion) persist per device; moving them to the user profile was deferred again.
2. Monetary KPIs include only deals in the workspace default currency until FX ships (Phase 5); the KPI
   tooltips say so.
3. Rate limiting is in-memory per API instance; switch the throttler storage to Redis before running more
   than one instance.
4. CSP is Helmet's default on the API; a strict CSP with nonces for the web app is a Phase 8 task.
5. pgvector is not used yet; the compose file already uses the pgvector Postgres image.
6. Account lockout after repeated failures and MFA are Phase 8 (rate limiting applies now).

## Phase 2 notes

- `invitations` uses a narrow `invitation_token_lookup` RLS policy (migration `20261030010100`), because FORCE RLS also applies to SECURITY DEFINER functions owned by the table owner.
- Page transitions are enter-only: an exit animation remounted the new route and discarded typed input.

## Feature status (Phase 3 close)

| Feature | Status |
|---|---|
| Transactional outbox (domain events written in the same transaction as the audit entry) | Implemented, tested |
| Postgres job queue worker (`SKIP LOCKED` leases; in-process or `node dist/worker.js`), ADR 0007 | Implemented, tested |
| Workflow engine: conditions, actions, delays, approvals, versioning, loop protection (depth 5, no self-trigger) | Implemented, tested |
| Actions: create task, assign owner (fixed or round robin), update field, add tag, notify, log note | Implemented, tested |
| External actions (send webhook, send email) always pause for a human approval | Implemented, tested |
| Automation Studio: builder, templates, simulation against a real record, run history with step detail | Implemented, tested (e2e + axe) |
| Approvals inbox with expiry | Implemented, tested |
| In-app notifications (personal by RLS) and bell menu | Implemented, tested |
| Signed outbound webhooks (HMAC), retries with backoff, auto-disable, SSRF guard | Implemented, tested |
| Plan limit on automation runs per month | Implemented, tested |
| Google (Gmail + Calendar) and Microsoft 365 (Outlook Inbox + Calendar) adapters, OAuth, encrypted tokens | Implemented, tested **against a local provider fixture only**. Not verified with real Google or Microsoft credentials |
| Email sync, matching to contacts and leads, send from the owner’s mailbox with a daily cap | Implemented, tested against the fixture |
| Meetings sync for contacts | Implemented, tested against the fixture |
| Integrations page that states when a provider is not configured | Implemented, tested |

### Deferred from the Phase 3 scope (not built)

- Sequences (multi-step outreach cadences) move to Phase 5 with marketing automation.
- Slack, Teams and Zoom are listed on the integrations page as planned only.
- Invitation email delivery is still not configured (the mailbox integration is per user, not a system sender).
- Web-form lead capture.
- Webhooks are not plan-gated yet (Phase 6 entitlements).

### Known limits

1. The SSRF guard checks resolved addresses before each request but does not pin them, so DNS rebinding is not mitigated.
2. Microsoft sync reads the Inbox folder only; sent mail is recorded when sent from DealFlow.
3. `ALLOW_PRIVATE_NETWORK_TARGETS` exists for tests and is refused when `NODE_ENV=production`.
4. Production requires `ENCRYPTION_KEY`; development derives a key from the JWT secret.

## Continuation instructions (Phase 4)

Follow the roadmap row for Phase 4 (AI gateway with metering, Copilot, agents, forecasting snapshots, AI workflow builder).
AI agents must reuse the workflow approval path for anything external, and must never send mass communications,
change prices, export sensitive data or modify security settings. The AI workflow builder should emit the same
`WorkflowDefinition` the Studio edits, validated by the shared Zod schema.

## Original continuation instructions (Phase 2, done)

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
