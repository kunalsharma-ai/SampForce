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
| **6. Commercialization** | Billing engine (Stripe/Razorpay adapters), entitlements enforcement, usage metering, operator console, onboarding, marketing site, custom roles | Test 10 | **Complete (2026-10-30)**, with the deferrals listed below. Payment providers tested against local fixtures only |
| **7. Immersive Experience** | Report builder and custom dashboards (moved from Phase 6), Relationship Galaxy, Revenue Globe, animated pipeline intelligence, time-based replays, spatial dashboards | 60 FPS budget, fallbacks pass a11y | **Complete (2026-10-30)**, with the deferrals listed below. Fallbacks pass axe; 60 FPS not measurable here (software renderer only) |
| **8. Enterprise Readiness** | SSO/SCIM/MFA, Kubernetes/Helm, observability, DR drills, perf tuning, pen-test prep, prod runbooks | Security review, load test targets | **Complete (2026-10-31)**, with the deferrals listed below. Helm chart checked in CI only (not installed on a cluster); no external pen test yet |

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
4. CSP is Helmet's default on the API; a strict CSP with nonces for the web app is a Phase 8 task (done in Phase 8).
5. pgvector is not used yet; the compose file already uses the pgvector Postgres image.
6. Account lockout after repeated failures and MFA are Phase 8 (rate limiting applies now; both done in Phase 8).

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
- Report builder and custom dashboards (moved to Phase 6, then to Phase 7).
- Onboarding plans, success playbooks and upsell recommendations in customer success.
- Quote templates and branded PDFs; usage-based or recurring price models.

### Known limits

1. The quote PDF uses a built-in PDF font, so characters outside Latin-1 (for example Hindi or Chinese product names) do not render. A Unicode font needs to be bundled before this is used with such data.
2. ~~A custom role that has `quotes:approve` but not `automation:manage` cannot open the approvals inbox.~~ Fixed in Phase 6.
3. Campaign attribution is first touch only; leads created before a campaign existed can be linked by UTM value but not by date range.
4. Customer health is recomputed when the customer pages load and at most hourly by the worker, so a churn alert can lag a change by up to an hour.
5. Analytics convert with the latest rate per currency, not the rate on the close date.
6. Tax rates are whatever the workspace enters; DealFlow does not determine or validate tax for any country.

## Feature status (Phase 6 close)

| Feature | Status |
|---|---|
| Central entitlement rule (`effectiveEntitlements`): Free capped at 2 users; paid plans at seats bought; trials at 10 seats; unpaid or canceled falls back to Free allowances with no data deleted. Used by seat, pipeline, AI credit, automation run and custom-role checks | Implemented, tested (unit + API) |
| Stripe adapter: hosted Checkout with seat quantity and promotion codes, optional Stripe Tax, Customer Portal, prorated seat and plan changes, cancel at period end and withdraw | Implemented, tested against a local fixture only. Not run against Stripe test mode |
| Razorpay adapter: subscription payment link, seat and plan changes from the next cycle, cancel at cycle end | Implemented, tested against a local fixture only. Some request fields unconfirmed (see docs/BILLING.md) |
| Signed webhooks (raw-body HMAC, Stripe timestamp tolerance), idempotent per event id, subscription re-read from the provider, invoices recorded, payment-failure notifications | Implemented, tested (bad, tampered, stale and duplicate deliveries) |
| Offline payments (2026-10-31, ADR 0013): online checkout off by default; invoice requests at rate-card prices; operator records the bank transfer (ADMIN, both audit logs); renewal from period end; period end to grace period, unpaid or Free | Implemented, tested (API + e2e) |
| Dunning: grace period then Free allowances, restored on payment; trial expiry back to Free; both in the worker with notifications | Implemented, tested |
| Downgrade guard: plan changes refused while members or pipelines exceed the target plan | Implemented, tested |
| Billing page: plan and status, seats, usage meters, plan cards with interval toggle, checkout or trial, portal, cancel, invoices; says plainly when checkout is not configured | Implemented, tested (e2e + axe) |
| Custom roles (Professional and above): create, edit, delete when unused; nobody can grant a permission they lack, also enforced on invitations and role changes; system roles fixed | Implemented, tested (API + e2e) |
| Approvals inbox opens for anyone holding an approval's permission, so a discount approver no longer needs `automation:manage` (closes Phase 5 known limit 2) | Implemented, tested |
| Onboarding checklist on the Command Center, computed from workspace data, dismissible | Implemented, tested (e2e) |
| Operator console (`/operator`): separate sign-in realm, workspace list with plan and member counts, invoices, plan/seat/status override with reason, suspend and reactivate, platform audit log; SUPPORT vs ADMIN operator roles; disabled unless `OPERATOR_JWT_SECRET` is set; CLI to create operators | Implemented, tested (API + e2e + axe) |
| Support access: owners grant 1 to 72 hours with a reason; only then can operators see members and the workspace audit log; never CRM records | Implemented, tested |
| Public site: landing page at `/` for visitors without a session, `/pricing` with monthly/annual toggle and FAQ, labelled a preview until `PRICING_PUBLISHED=true`; no stats, logos or testimonials | Implemented, tested (e2e + axe) |

### Deferred from the Phase 6 scope (not built)

- Report builder and custom dashboards (moved to Phase 7, now built).
- AI credit packs and other add-on purchases. When an allowance is used up the feature pauses; nothing is billed for overage.
- Coupons managed inside DealFlow. Promotion codes work only through Stripe Checkout.
- API keys for the `apiAccess` entitlement: there is no public API key feature yet, so the entitlement is not enforced anywhere.
- Running either payment provider in test mode (no accounts or keys in this environment).
- Invoice PDFs generated by DealFlow; invoices link to the provider's copy.
- A separate `apps/admin` deployable (the console is a route group in the web app, see ADR 0010).
- Legal pages (terms, privacy policy, DPA). None exist; the site does not link to any. They need to be written by Sampledge's counsel.
- Operator account management in the UI (MFA, disabling operators); operators are managed from the CLI for now.

### Known limits

1. An operator plan override on a workspace that pays through Stripe or Razorpay is overwritten by the provider's next webhook.
2. Razorpay amounts are stored in the plan's currency (usually INR); the Billing page shows USD catalogue prices. The provider's checkout page shows what is actually charged.
3. A workspace that falls back to Free keeps its existing members and pipelines; only new invitations and new pipelines above Free limits are refused. Existing custom roles keep working, but cannot be created or edited.
4. The pricing page is rendered on the server and cached for 5 minutes; it falls back to the built-in catalogue (marked as a preview) if the API is unreachable.
5. AI credits are counted per active member; seats paid for but unused do not add credits.

## Feature status (Phase 7 close)

| Feature | Status |
|---|---|
| Report builder over eight record types (deals, leads, contacts, companies, activities, tasks, latest quotes, contracts): count, sum, average, min, max; grouping with day/week/month/quarter/year buckets in the workspace time zone; up to 10 typed filters; table, bar, line, pie or single number; live preview | Implemented, tested (unit + API + e2e) |
| Report SQL built only from a fixed field catalogue with bound parameters, escaped `LIKE`, re-validated stored definitions, RLS plus explicit tenant filter, 10 s statement timeout | Implemented, tested (injection-shaped values, unknown fields, wrong operators rejected) |
| Money metrics in the workspace currency with the latest manual rate; records without a rate excluded and counted | Implemented, tested |
| Private and shared reports and dashboards; `reports:read/write/manage` permissions; entity read permission required to run; shared dashboards hold only shared reports; deleted reports leave dashboards | Implemented, tested |
| Report CSV export (`data:export`, audited) | Implemented, tested |
| Dashboards: ordered grid of saved reports, three widget sizes, reorder, add and remove, every widget with a table view | Implemented, tested (e2e + axe) |
| Stage history (`deal_stage_events`): written on create, move, clone and lead conversion; append-only for the app role; back-filled from the audit log and marked reconstructed | Implemented, tested (API; back-fill checked against recorded history) |
| Relationship Galaxy: companies, contacts and deals as a 3D force-directed network (layout in a Web Worker), parent links, selection details, filters, search; 2D view and searchable account list | Implemented, tested (e2e in 2D; 3D rendered and screenshotted in a software renderer) |
| Revenue Globe: open pipeline, 12-month wins, open deals or companies by country on a 3D globe with Natural Earth borders; flat 2D map; table; counts of what cannot be placed | Implemented, tested (API + e2e) |
| Pipeline flow: stage boxes with open deals, value and median days in stage; moves drawn as arcs with animated flow lines (static under reduced motion); tables | Implemented, tested (API + e2e + axe) |
| Pipeline replay: play, pause, speed and a keyboard-operable date slider over 30 to 365 days; live summary; per-day stage table | Implemented, tested (unit + e2e + axe) |
| Fallbacks: low-power and no-WebGL use 2D automatically; lost GPU context drops to 2D; a slow device (under 24 fps at the lowest quality) is offered 2D; reduced motion stops auto-rotation and animated lines | Implemented, tested (low-power and no-WebGL paths in e2e) |
| Performance: instanced meshes (one draw call per layer), on-demand rendering, pixel ratio capped at 2 and adaptive, 3D code loaded only on 3D pages (about 250 KB gzipped), optional frame-rate readout | Implemented. **60 FPS not verified on real hardware** (see ADR 0011) |

### Deferred from the Phase 7 scope (not built)

- Spatial dashboards (dashboards arranged in 3D). The 2D dashboard grid covers the need; see ADR 0011.
- Scheduled report delivery by email (no email sending exists yet, see Phase 5).
- Reports across two entities (for example deals grouped by contact job title), custom-field columns in reports, and a second grouping (stacked or multi-series charts).
- Measuring the 60 FPS budget on real devices (needs physical hardware; the readout is in place).

### Known limits

1. Replays use each deal's current amount, and a deal moved to another pipeline keeps its history in the old one.
2. Back-filled history can only include moves whose stage names were unchanged and unique within the pipeline; earlier moves are dropped, and creation events use the deal's creation time.
3. The galaxy shows at most 150 companies (by open pipeline), 600 contacts and 800 deals; the replay at most 400 deals. Both say when they are cut.
4. Countries are placed at the centre of their largest landmass, from the company's country only; contacts' and leads' countries are not used on the globe.
5. Charts use the shared palette of six colours; pies fold groups beyond six into "Other".
6. Report results are computed on every open (no caching); a very large workspace may hit the 10 s timeout, which the API reports as an error.

## Feature status (Phase 8 close)

| Feature | Status |
|---|---|
| Two-step verification (TOTP, RFC 6238): enrolment with password and QR code, 10 single-use recovery codes, replay rejection, turn off, regenerate codes; sign-in challenge step | Implemented, tested (unit with RFC vectors + API + e2e + axe) |
| Account lockout: 10 failures → 15 minutes, atomic, generic error | Implemented, tested (API) |
| Workspace policy: require two-step verification for password sign-in (members are held on an enrolment screen) | Implemented, tested (API + e2e) |
| Signed-in devices: list with method, device, IP and last use; sign out one or all others, effective immediately | Implemented, tested (API + e2e) |
| Single sign-on with OpenID Connect: per-workspace connection, discovery check, PKCE, state, nonce, JWKS verification, allowed domains, invitations or just-in-time accounts with a default role, enforcement (owners exempt), sessions bound to the workspace | Implemented, tested against a local OIDC provider (9 API tests including wrong issuer, audience, nonce, signature and domain). **Not yet tried with Okta, Entra ID or Google** |
| SCIM 2.0 Users: list/filter, get, create, replace, patch (Okta and Entra styles), delete; owner and cross-workspace protections; seat limits; hashed tokens | Implemented, tested (API). **Not yet tried with a real directory** |
| SSO and SCIM on every plan, including Free (decided 2026-10-31) | Implemented, tested (API + e2e) |
| Content security policy with per-request nonces and `strict-dynamic`; HSTS; COOP | Implemented, tested (e2e fails on any violation, 3D pages included) |
| Prometheus metrics (route-template labels), worker liveness, OpenTelemetry traces, log and trace redaction, `trace_id` in logs | Implemented, tested (API e2e + tracing check script) |
| Helm chart: API, worker, web, migration Job, HPA, PDB, NetworkPolicy, ServiceMonitor, PrometheusRule (7 alerts), hardened pods | Implemented. **Checked by CI lint and schema validation only; not installed on a cluster** |
| Backups (`dealflow_backup` role, checksum, manifest) and verified restore into a new database | Implemented, drilled (206k and 1.95M rows; docs/runbooks/database-restore.md) |
| Encryption key rotation (`ENCRYPTION_KEY_PREVIOUS` + re-seal script) | Implemented, tested (unit) and drilled |
| Load-test seed and runner; fixes for generic plans, JIT, globe and forecast | Done (docs/perf/README.md) |
| Pen-test brief, STRIDE threat model, dependency audit (6 of 8 advisories fixed), secret scan | Done (docs/security/PENTEST_PREP.md) |
| Runbooks: deploy and rollback, incident, alerts, restore, key rotation | Written; restore and key rotation drilled, the rest not |

### Deferred from the Phase 8 scope (not built)

- SAML 2.0 (OIDC only), WebAuthn/passkeys, SCIM Groups, IP allow-lists.
- ~~Password reset by email~~: built after Phase 9 (account email via `SMTP_URL`); tested only against a local SMTP stand-in.
- Egress NetworkPolicies, a WAF configuration, and a point-in-time-recovery drill.
- An external penetration test, and a real-device check of the Phase 7 60 FPS budget (no hardware or cluster here).
- Provider test-mode runs (Stripe, Razorpay, Google, Microsoft) and AI evals against the real model: no keys exist in
  this environment, so these integrations remain tested against local fixtures only.
- Zod 4 upgrade (closes the last dependency advisory; mitigated, see the pen-test brief).

### Known limits

1. Access tokens issued before a refresh rotation remain valid until they expire (at most 15 minutes); explicit
   sign-out and device sign-out are immediate.
2. The JWKS fetch during SSO is not re-checked against DNS rebinding (discovery and token calls are).
3. At ten times the load-test size (200,000 deals), the forecast takes about 2.6 s and pipeline flow about 1 s.
4. Every page is rendered per request because of the CSP nonce; static caching of marketing pages is lost.
5. The Marketplace module is not scheduled; it is labelled "After launch".

## After Phase 8

All eight roadmap phases are complete. Before general availability: install the chart on staging and run every
runbook there; connect a real Okta or Entra tenant for SSO and
SCIM; run the AI evals with a real key; measure the 3D views on real devices; commission the external pen test with
docs/security/PENTEST_PREP.md; set `OFFLINE_PAYMENT_INSTRUCTIONS` to the real bank details. The rate card was approved
on 2026-10-31 and production publishes it; payments are offline only (ADR 0013), so Stripe and Razorpay test-mode runs
are needed only before online checkout is turned on.

## Phase 9: email outreach and lead capture (complete, 2026-10-31)

Requested by Kunal on 2026-10-31. Plan: https://claude.ai/artifact/Bi2GJHfJJMDsLQs2cZXFw5

| Part | Status |
|---|---|
| Email templates, sequences, event rules, tracking, unsubscribe, do-not-email list, A/B tests of an email, test sends to yourself (ADR 0014) | Built and tested against the provider fixture; not yet sent through real Gmail or Outlook |
| Browser extension (Chrome/Edge): own connection codes, side panel, save as lead, enrol, optional auto-capture (ADR 0015) | Built; tested in Chromium against a stand-in site. Not yet in the Chrome Web Store: the privacy page (`/extension-privacy`) and listing kit (`apps/extension/store/`) are ready; submitting needs Sampledge's developer account |
| Email finder: own website reader, pattern and mail-server checks, optional Hunter.io key, extension button (ADR 0016) | Built; tested against made-up sites and a Hunter stand-in. Not yet run on the open internet or with a real Hunter key |

## Enhancement programme (in progress)

Requested by Kunal on 2026-10-31 ("Master enhancement, integration and non-duplication" spec plus the detailed
feature specifications). Audit of what already existed: posted in the project thread before building. Providers:
Apollo.io (company and contact data), Hunter.io (email finding and verification), Deepgram (speech to text), the
existing Gmail and Outlook connections. Every provider stays in Pending Configuration or Mock Mode until a real key
is configured and a live call has passed. One automation engine (Automation Studio) for sequences, workflows and AI
triggers.

| Phase | Features | Status |
|---|---|---|
| 1 | Deal health monitor, next best actions, 360° timeline, record intelligence, weekly insights (ADR 0017) | Built and tested; no external keys needed |
| 2 | Email automation on Automation Studio, template and inbox improvements, campaign analytics, features 5–9 | 2a built and tested: email and sequence events as triggers, new actions, the six scenarios as templates (ADR 0018). 2b built and tested: template categories, campaigns and duplication, `{{custom.*}}` and `{{var.*}}` merge fields, results by sequence, mailbox, template and follow-up (ADR 0019). 2c built and tested: Email Assistant (draft, rewrite, tone, subject lines, reply reading with intent, objections and a suggested reply; never sends) and rule-based sequence tips (ADR 0020). 2d proposals built and tested: proposal sections with templates and AI drafting, workspace branding, a signed online link that can be switched off, sending from the mailbox, and view counts labelled as estimates (ADR 0021). 2d inbox built and tested: conversations grouped by a database trigger, assignment, categories, internal notes, deal links, search and filters, replies kept in the thread, templates in the compose box, sequence tracking shown honestly, and mailbox sync logs (ADR 0022). 2d meetings built and tested: meeting records for calendar meetings or ad-hoc calls, Meet, Zoom and Teams links from the calendar, recording transcription through Deepgram (**Pending Configuration** until a key is set and a live transcription succeeds; streamed, not stored, consent required), an AI reading of summary, requirements, objections, decisions, action items, commitments and participants that a person reviews before tasks or a timeline note are created, and a follow-up draft in the compose box (ADR 0023) |
| 3 | Features 10–15: client portal, voice (Deepgram), gamification, visitor intelligence and the rest | 3a forecasting built and tested: month, quarter and year forecasts, probability from stage win history as a manager setting, adjustable category thresholds stored on snapshots, targets for any period with stated derivation, gaps, coverage, per-salesperson gaps, period risks, win/loss trends and first-snapshot accuracy (ADR 0024). 3b client portal built and tested: separate customer sign-in by invitation (viewer or approver), lockout and reset, projects with progress, shared milestones, proposals with recorded approval or decline, contracts, documents both ways with signed links, requests with numbering and assignment, messages, updates, and workspace settings for every section; invoices shown as not connected (ADR 0025). 3c voice-to-CRM built and tested: typed notes or browser recordings (consent per recording, audio not stored, Deepgram Pending Configuration), language choice or detection, AI suggestions of tasks, notes, leads and contacts that are saved only after the person confirms and edits them, last call summary from saved records only, sensitive requests listed and not done (ADR 0026). Features 13–15 still to do |
| Prospects | Prospect Discovery in the extension (Apollo, Hunter) and the Prospect Lists module | Not started |

## Original continuation instructions (Phase 8, done)

Follow the roadmap row for Phase 8 (SSO/SCIM/MFA, Kubernetes/Helm, observability, DR drills, performance tuning,
pen-test preparation, production runbooks). Include a real-device check of the Phase 7 frame-rate budget using the
readout on the Galaxy and Globe pages, load tests for the report endpoints at the documented record counts, and the
outstanding provider test-mode runs (Stripe, Razorpay, Google, Microsoft, Anthropic evals).

## Original continuation instructions (Phase 7, done)

Follow the roadmap row for Phase 7 (report builder and custom dashboards, then the immersive views: Relationship Galaxy,
Revenue Globe, animated pipeline intelligence, time-based replays) with a 60 FPS budget and accessible 2D fallbacks.
Before any launch, run both payment providers in test mode per docs/BILLING.md, record the results, and keep the rate
card labelled as a preview until Sampledge confirms it.

## Original continuation instructions (Phase 6, done)

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
