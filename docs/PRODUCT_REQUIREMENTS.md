# DealFlow Product Requirements Document

**Product:** DealFlow, by Sampledge · **Positioning:** The Autonomous Revenue Intelligence Platform
**Tagline:** Close Smarter. Grow Faster. Flow Beyond Limits. · **Version:** 1.0 draft, 2026-10-30

## 1. Problem

Revenue teams run on several tools (CRM, engagement, marketing automation, forecasting, CS) whose data
drifts apart, whose pricing is hard to predict once AI and add-ons are included, and whose AI features are
hard to trust because they rarely show their evidence or ask before acting. Smaller teams pay for complexity
they don't use; larger teams pay for integration work.

## 2. Vision

A single, AI-native revenue workspace where every record, conversation, workflow and forecast shares one data
model; where AI agents do routine work under explicit permissions and approvals; and where pricing, usage and
reasoning are transparent.

## 3. Target customers and personas

| Persona | Needs | First value |
|---|---|---|
| Founder / solo seller (Free, Launch) | Track leads and deals fast; no setup | Pipeline in minutes, CSV import |
| Sales rep (all plans) | Know what to do next; less data entry | Next-best actions, AI drafts, auto-logging |
| Sales manager (Growth+) | Trustworthy forecast; coaching; team visibility | Forecast with snapshots, deal health |
| RevOps / CRM admin (Professional+) | Automate without code; clean data; governance | Automation Studio, data-quality agent, audit |
| Executive (Business+) | Real-time revenue picture across regions | Command Center, Revenue Globe, Time Machine |
| CS manager (Business+) | Renewals and expansion | Health scores, renewal briefs |
| Market research agency (Sampledge's home segment) | Project-based deals, multi-currency, proposals | Quotes/proposals, multi-currency, project pipelines |

Segments: startups to large enterprises, B2B and B2C, SaaS, consulting, financial and healthcare business
services, agencies, distributed international teams.

## 4. Success metrics

| Metric | Target (first 12 months after GA) |
|---|---|
| Time from sign-up to first deal created | < 10 minutes median |
| Weekly active users / paid seats | > 70% |
| AI recommendation acceptance rate | > 35% (tracked per agent) |
| Automation success rate | > 98% of executions |
| Gross margin | ≥ 75% (see PRICING_STRATEGY.md) |
| Accessibility | Zero axe AA violations on core pages in CI |

## 5. Flagship differentiators

1. **Command Center**: live, explainable revenue cockpit (foundation shipped in Phase 1).
2. **Automation Studio**: visual and AI-generated workflows with simulation, versioning and approvals.
3. **Unified Communication Hub**: email, calendar, meetings and messaging on every record's timeline.
4. Supporting: Copilot, Revenue Brain, Digital Sales Team, Relationship Galaxy, Revenue Time Machine.

## 6. Feature inventory by module

Status key: ✅ shipped · 🟡 schema only · ⏳ planned (phase).

### 6.1 Platform and administration
| Feature | Status |
|---|---|
| Sign-up creates organization, owner, roles, default pipeline, Free subscription | ✅ |
| Email/password auth, rotating sessions, workspace switching | ✅ |
| Five system roles, permission checks on every endpoint | ✅ |
| Workspace settings (name, brand colour, currency, time zone, locale) | ✅ |
| Member list and role management with owner protections | ✅ |
| Append-only audit log with UI | ✅ |
| Invitations, custom roles, teams UI | ⏳ P2/P6 |
| MFA, SSO (SAML/OIDC), SCIM | ⏳ P8 |

### 6.2 Command Center
| Feature | Status |
|---|---|
| 15 KPIs from live data with definitions and honest empty states | ✅ (2 await P3/P4 data) |
| Pipeline-by-stage chart with table alternative | ✅ |
| Audited activity stream | ✅ |
| AI Opportunity Radar, next-best actions, pending approvals | ⏳ P4 |
| Revenue Globe, spatial dashboards | ⏳ P7 |
| Customisable layouts | ⏳ P5 |

### 6.3 Leads (P2)
Capture (forms, CSV/Excel, API), validation, duplicate detection and merge, enrichment hooks, territory /
round-robin / workload routing, ownership rules, scoring (rule-based P2, AI P4), BANT and MEDDICC frameworks,
nurturing hand-off to marketing, reminders, lifecycle tracking, conversion analytics, consent preferences.
Schema 🟡 (Lead table exists).

### 6.4 Contacts, companies, accounts (P2)
Hierarchies, buying committees, stakeholder mapping, engagement history, relationship health, ownership,
segmentation, notes, documents, unified timeline, account-level forecasting (P5), AI meeting briefs (P4).
Schema 🟡.

### 6.5 Deals and pipelines (P2)
Multiple pipelines (plan-limited), custom stages and probabilities, Kanban/list/table/timeline/calendar/forecast
views, line items, approvals (P3), competitors, loss reasons, cloning, bulk updates, win/loss analytics,
AI deal health with signals and confidence (P4). Schema 🟡.

### 6.6 Activities and tasks (P2)
Calls, emails, meetings, notes, tasks with reminders, `ai_assisted` tracking. Schema 🟡.

### 6.7 Communication hub and engagement (P3)
Gmail/Microsoft 365 two-way sync, shared inboxes, templates, threading, calendar sync, scheduling, call
logging, Twilio/WhatsApp (P5, credentials and approvals required), sequences with branching, reply/bounce
detection, unsubscribe and sending limits, A/B tests, sender reputation monitoring.

### 6.8 Automation Studio (P3, AI builder P4)
Triggers, conditions, actions and advanced features as specified in [AI_AND_AUTOMATION.md](AI_AND_AUTOMATION.md).

### 6.9 AI: Copilot, Revenue Brain, Digital Sales Team (P4)
AI gateway, 12 agents, governance controls; see [AI_AND_AUTOMATION.md](AI_AND_AUTOMATION.md).

### 6.10 Marketing automation (P5)
Segments, journeys (visual), email marketing, forms, landing pages, attribution, funnels, exclusions, consent.

### 6.11 Commercial documents (P5)
Product/service catalogue, price books, multi-currency, discounts with approval, tax, quote/proposal templates,
AI drafting, versions, PDF, e-signature adapters, contract repository, renewal reminders.

### 6.12 Revenue intelligence and forecasting (P4–P5)
Revenue by every dimension, conversion and win/loss, velocity, coverage, weighted/historical/time-series and
scenario forecasts with confidence intervals and explanations, actual-vs-predicted, Revenue Time Machine.
All projections labelled as projections.

### 6.13 Customer success (P5)
Onboarding plans, health scores, renewals, expiry tracking, upsell/cross-sell, escalations, surveys, churn alerts.

### 6.14 Global operations (P5)
Currencies with configurable FX sources, time zones, territories, regional dashboards and access, localisation
framework (ICU messages; new languages without code changes), locale formats, regional tax, business-hour calendars.

### 6.15 Integrations marketplace (P3–P8)
See the category list in [FEATURE_MATRIX.md](FEATURE_MATRIX.md) §2E and the adapter contract in
[ARCHITECTURE.md](ARCHITECTURE.md) §8.

### 6.16 Commercialisation (P6)
Plans and entitlements, Stripe/Razorpay adapters, seats, proration, trials, coupons, dunning, invoices,
usage-based AI credits, tenant onboarding, marketing website (25 pages), operator super-console.

### 6.17 Immersive experience (P7)
Relationship Galaxy, Revenue Globe, animated pipeline flows, time-based ("4D-inspired") replays; adaptive
quality, lazy loading, 2D fallbacks, low-power mode (toggle shipped in P1).

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | See [SECURITY_MODEL.md](SECURITY_MODEL.md) |
| Performance | p95 API < 300 ms for record reads at 1M records/tenant; dashboard < 1.5 s; 60 FPS target for 3D on capable devices |
| Availability | 99.9% monthly for paid plans (SLA terms for Enterprise Plus negotiated) |
| Accessibility | WCAG 2.2 AA |
| Localisation | Unicode throughout; locale-aware formatting; RTL-ready layouts by P5 |
| Resilience | Core CRM independent of AI and integrations (see degradation matrix) |
| Data | Exportable at any time in open formats |

## 8. Out of scope for v1

Native mobile apps (architecture prepared; React Native after P8), built-in telephony carrier, ERP
functionality, a proprietary data-enrichment database.

## 9. Open decisions for Sampledge

1. Launch pricing (see the sustainability analysis in [PRICING_STRATEGY.md](PRICING_STRATEGY.md)).
2. Which AI providers to contract first, and whether to offer bring-your-own-key.
3. Primary hosting region(s) at launch (India, EU, US) and data-residency commitments.
4. Domain strategy (e.g., `dealflow.sampledge.com` vs a dedicated domain).
