# DealFlow Implementation Plan and Feature Status

Each phase ends with a working application, green CI (build, lint, typecheck, unit, integration, e2e,
accessibility) and an updated status table. A feature is "Tested" only when its acceptance tests pass.

## Roadmap

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| **1. Product Foundation** | Monorepo, Next.js web, NestJS API, schema + RLS, auth, tenant isolation, RBAC, audit log, design system, navigation, Command Center foundation, CI, Docker, env config | Acceptance tests 1, 2, 8, 9, 11, 12, 14, 15 pass | **Complete (2026-10-30)** |
| 2. Core CRM | Leads, contacts, companies, accounts, deals, pipelines (Kanban/list/table), activities, tasks, search, custom fields, CSV/Excel import/export, duplicate detection, invitations | Tests 3, 4; RLS CI guard for new tables | **Complete (2026-10-30)**, with the deferrals listed below |
| 3. Automation & Communication | Outbox + worker, workflow engine, Automation Studio, approvals, notifications, Gmail/M365 + calendar adapters, sequences, webhooks | Tests 5, 7, 13 | **Complete (2026-10-30)**, with the deferrals listed below |
| 4. AI Intelligence | AI gateway, metering, Copilot, lead-qualification, deal-intelligence, meeting, proposal agents, forecasting + snapshots, AI workflow builder | Test 6; eval suites | **Complete (2026-10-30)**, with the deferrals listed below. Evals not yet run against the real model |
| 5. Advanced Revenue | Marketing automation, revenue analytics, customer success, quotes/proposals/contracts, multi-currency/FX, territories, localisation | Module acceptance tests | **Complete (2026-10-30)**, with the deferrals listed below (no email sending, no e-signature provider, no territories or localisation yet) |
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
| Copilot panel (explains Phase 4; no fake answers) | Implemented; replaced by the working Copilot in Phase 4 |
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

## Feature status (Phase 4 close)

| Feature | Status |
|---|---|
| AI gateway (ADR 0008): Claude through the official SDK, effort tiers, structured outputs, server-side model fallbacks, timeouts and retries | Implemented, tested **against a local Claude fixture only**. Not verified with a real Anthropic API key |
| Metering: credits per call from tokens and tier, plan allowance × active seats, optional admin cap, usage log that cannot be edited | Implemented, tested |
| Governance: workspace kill switch, per-agent switches, per-user rate limit, optional redaction of email, phone and card numbers, audit entries | Implemented, tested |
| Copilot: answers from permission-filtered read tools with citations; tasks, notes and stage moves are proposals the asker confirms; permission re-checked on confirm; warning when external content was read | Implemented, tested (API + e2e + axe) |
| Lead Qualification: rule-based score with explained signals, AI summary and next step; optional auto-qualify on new leads via the worker | Implemented, tested |
| Deal Intelligence: health and risk from activity, stage age, tasks and dates; recommended next step accepted as a task | Implemented, tested |
| Meeting notes: summary, decisions, action items to tasks, follow-up email draft (never sent automatically) from pasted notes | Implemented, tested |
| Proposal draft from deal data, with the facts it relies on and open questions | Implemented, tested |
| AI workflow builder: description to a validated `WorkflowDefinition` that opens in the Studio as an unsaved draft | Implemented, tested |
| Forecasting: weighted quarter forecast, categories, worst/base/best scenarios, by owner, exclusions stated | Implemented, tested (exact totals) |
| Forecast snapshots: immutable, store their lines, recompute check (acceptance test 9 for forecasts), deal-level comparison, AI explanation of the change | Implemented, tested |
| AI Agents page: provider status, credits, controls, per-agent can/cannot, usage and recent runs | Implemented, tested (e2e + axe) |
| Eval suites (Copilot tool choice and refusals, lead summary, workflow builder, meeting notes) with deterministic scorers | Harness implemented and tested against the fixture. **Not yet run against the real model** (`pnpm --filter @dealflow/api eval` with a key) |

### Deferred from the Phase 4 scope (not built)

- Streaming Copilot answers (answers arrive whole).
- Scheduled agents: nightly deal analysis and a weekly automatic forecast snapshot (both run on demand today).
- Retrieval over documents and email bodies (pgvector); Copilot reads structured records and email metadata only.
- Meeting recording and transcription; the meeting agent works from notes the person pastes.
- Proposal templates, product catalogue and pricing (Phase 5 quotes); drafts never change prices.
- A second model provider adapter; the gateway has a provider interface but only Anthropic is implemented.
- Historical (non-weighted) forecast methods and confidence intervals.

### Known limits

1. The per-user AI rate limit counts rows in Postgres, not a shared in-memory store; it is accurate but adds a query per call.
2. Credits are DealFlow's own unit for plan limits, not a statement of provider cost.
3. Redaction is pattern-based and optional; it does not catch names or free-text identifiers.
4. The fixture proves plumbing and safety rules. Answer quality depends on the real model and is what the evals measure.

## Feature status (Phase 5 close)

| Feature | Status |
|---|---|
| Catalogue: products, price books per currency (one default each), tax rates, quote rules (discount approval threshold, validity) | Implemented, tested |
| Quotes: unit prices always read from the price book (clients cannot send a price), per-line rounding to cents, exact totals, numbering `Q-0001 v2`, edit only while draft or rejected | Implemented, tested (exact totals in API and e2e) |
| Discount approvals: any line discount above the threshold goes to the existing approvals inbox (`quote_discount`, `quotes:approve`), approvers notified, no self-approval, 7-day expiry returns the quote to draft | Implemented, tested |
| Quote lifecycle: submit, mark sent, accept (optionally sets the deal amount, same currency only, audited), decline, revise into a new version at current prices; superseded versions are locked | Implemented, tested |
| Quote PDF (pdfkit, Helvetica) | Implemented, tested (content type and PDF header). Latin-1 text only, see known limits |
| Contracts: from an accepted quote (net value, quote currency) or by hand; recorded signature (who, when, how); signed value, terms and start date locked; terminate with reason; linked renewal; renewal reminder once per term and automatic expiry from the worker | Implemented, tested |
| Marketing consent on leads and contacts (opted in, opted out, not asked; source and date recorded) | Implemented, tested |
| Segments: rule builder over leads or contacts (all/any), validated per field, live preview with consent counts, CSV export that never includes opted-out people and is audited | Implemented, tested (API + e2e + axe) |
| Hosted lead forms: public page `/f/:token`, embeddable (only route that allows framing), server validates exactly the fields asked, unticked box is not consent, consent text stored with the submission, honeypot, 5 submissions per address per 10 minutes (address stored as an HMAC), dedupe against open leads, message becomes a note | Implemented, tested (API + e2e + axe) |
| Campaigns with first-touch attribution (form, manual link or UTM value), leads, conversions, pipeline, won, cost per lead, won ÷ budget; other-currency deals left out and counted | Implemented, tested |
| Multi-currency: manually entered exchange rates (latest per currency), used by revenue analytics and the forecast; amounts with no rate are left out and counted | Implemented, tested |
| Revenue analytics per quarter: won, win rate, average deal and cycle, by month, by owner with personal targets and attainment, by source, by product (accepted quotes), loss reasons, velocity, team target and coverage, lead funnel, forecast against actual from snapshots | Implemented, tested (exact numbers) |
| Customer success: customers are companies with an active contract; rule-based health (activity, escalations, renewal window, overdue tasks) with every point explained; escalations; one churn alert per drop into "at risk"; hourly sweep in the worker | Implemented, tested |
| Proposal agent uses the latest quote's lines and totals instead of only the deal amount | Implemented, tested against the fixture only (prompt `proposal-draft@1.1.0`) |
| Deal page quotes section; company page contracts, health and escalations; approvals inbox shows quote discounts | Implemented, tested (e2e) |
| Demo seed adds clearly marked sample catalogue, quote, contracts, campaign, form, target and escalation (development only) | Implemented |

### Deferred from the Phase 5 scope (not built)

- Sending marketing email, visual journeys, landing-page builder, A/B tests and surveys. DealFlow has no system email sender yet; segments export to CSV instead.
- E-signature provider adapters (DocuSign and similar need provider accounts and credentials). Signatures are recorded by a person.
- Contract documents and file attachments, clause libraries and redlining.
- Territories and territory-based routing.
- A localisation framework (UI strings are English only; dates and money use en-US formatting).
- Automatic exchange-rate feeds; rates are entered by a person.
- Report builder and custom dashboards (moved to Phase 6 with commercialisation, see the Reports module page).
- Onboarding plans, success playbooks and upsell recommendations in customer success.
- Quote templates and branded PDFs; usage-based or recurring price models.

### Known limits

1. The quote PDF uses a built-in PDF font, so characters outside Latin-1 (for example Hindi or Chinese product names) do not render. A Unicode font needs to be bundled before this is used with such data.
2. A custom role that has `quotes:approve` but not `automation:manage` cannot open the approvals inbox; the system roles that approve quotes (owner, admin, manager) have both.
3. Campaign attribution is first touch only; leads created before a campaign existed can be linked by UTM value but not by date range.
4. Customer health is recomputed when the customer pages load and at most hourly by the worker, so a churn alert can lag a change by up to an hour.
5. Analytics convert with the latest rate per currency, not the rate on the close date.
6. Tax rates are whatever the workspace enters; DealFlow does not determine or validate tax for any country.

## Continuation instructions (Phase 6)

Follow the roadmap row for Phase 6 (billing engine with Stripe/Razorpay adapters, entitlement enforcement, usage
metering, operator console, onboarding, marketing site, custom roles). Payment providers must be tested against their
sandbox APIs before any claim that they work, card details must never touch DealFlow's database, and the rate card stays
labelled as proposed until confirmed. Also in scope: the report builder deferred from Phase 5, and the custom-role editor
(which should let a role hold `quotes:approve` without `automation:manage`, see Phase 5 known limit 2).

## Original continuation instructions (Phase 5, done)

Follow the roadmap row for Phase 5 (marketing automation, revenue analytics, customer success, quotes/proposals/contracts,
multi-currency/FX, territories, localisation). Before starting, run `pnpm --filter @dealflow/api eval` with a real key and
record the results in TEST_STRATEGY.md. The proposal agent should move onto the quote catalogue, and any price it
mentions must come from a price book, never from the model.

## Original continuation instructions (Phase 4, done)

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
