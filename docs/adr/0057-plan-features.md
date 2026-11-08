# ADR 0057: Plan features, set by the platform admin and enforced on the server

- Status: Accepted
- Date: 2026-11-08

## Context

Kunal asked that every feature of SampForce be controlled by the platform admin (the "superadmin", who signs in to
the operator console), and that what a workspace can use follows the subscription its admin buys. Until now plans
differed only in limits (users, pipelines, AI credits, automation runs) and two flags (`apiAccess`, `customRoles`).
Every module was open on every plan, and changing what a plan included meant a code change and a release.

## Decision

- **One feature catalogue** in `packages/types/src/features.ts`: 36 features in six groups (Sales, Engage,
  Intelligence, Revenue, Apps, Administration). Each has a key, a name, a one-line description, the cheapest plan
  that includes it by default, and the app pages it owns. Everything else (leads, contacts, companies, deals,
  pipelines, activities, team, billing, settings, integrations page, administration) is the core CRM and is on
  every plan.
- **Shipped packaging** (the defaults, used for a new installation and as the fallback for a plan row that is
  missing or malformed):
  - Free (5): mailbox and calendar sync, AI assistant and agents, Automation Studio, reports and dashboards, single
    sign-on and SCIM (on every plan, decided 2026-10-31).
  - Launch (11) adds quotes and catalogue, email templates, email sequences, browser extension, segments and lead
    forms, campaigns.
  - Growth (26) adds territories, proposals, contracts, team inbox, email finder, prospect lists, meeting recordings,
    sales intelligence, forecasting, gamification, Slack, Microsoft Teams, Zoom, API and Zapier, webhooks.
  - Professional and above (36) add website visitors, voice to CRM, revenue intelligence, client portal, customer
    success, DocuSign, card payments, WhatsApp, SMS and custom roles.
- **The plan's features live in the `plans` table** (`entitlements.features`, beside the limits), so the platform
  admin edits them in the operator console (**Plans**: a matrix of features and limits, `PUT /operator/plans/:code`,
  admins only, with a reason). A change applies to every workspace on the plan on its next request and shows on the
  public pricing page, which now compares plans feature by feature. The migration `20261108010000_plan_features`
  writes the shipped packaging into existing rows and drops `apiAccess` and `customRoles`, which became features.
- **Per-workspace overrides** in `tenant_feature_overrides` (tenant, feature, on or off, reason, who, when; under
  RLS). On a workspace's page in the console an admin sets each feature to "as plan", "always on" or "always off"
  (`POST /operator/tenants/:id/features`). Both the platform log (`tenant.features_overridden`) and the workspace's
  own audit log (`billing.features_overridden`, actor `PLATFORM_ADMIN`) record it with the reason. Support staff can
  see overrides but not change them.
- **What applies**: the applied plan (Free while a paid plan is unpaid or canceled, as for limits), its features
  from the `plans` table, then the workspace's overrides. `entitlementsFor()` in `apps/api/src/billing/entitlements.ts`
  is the single function every check uses; `/auth/me` and `/billing` return the result to the web app.

## Enforcement (server first)

- **API routes**: a global `FeatureGuard` (after `AuthGuard`) reads `@RequireFeature(feature)` on controllers and
  methods and refuses with 403 `FEATURE_NOT_IN_PLAN` ("Email sequences is not included in your plan. A workspace
  admin can upgrade on the Billing page.", translated per ADR 0052; the feature key is in `details`). The apps
  controller picks the feature from the `:app` path segment. Reading the integrations list, disconnecting an app,
  approvals, record timelines and the customer-facing portal are not gated.
- **API keys** (API and Zapier) stop working when the plan loses `api_access`.
- **Background work**: workflows do not start without `automation`, webhooks are marked failed without `webhooks`,
  sequence steps wait without `sequences`, mailbox sync skips without `email_sync`, and AI refuses with
  `AI_NOT_IN_PLAN` before any provider call without `ai_assistant`.
- **Public endpoints fail closed without saying why**: lead forms answer as if the form were gone, the website
  tracker reports tracking off and stores nothing, shared proposals answer "not found", the client portal does not
  sign in, card payments and the browser extension refuse, single sign-on starts as an unknown workspace and SCIM
  answers 403.
- **SSO enforcement lapses** while `sso_scim` is off the plan, so a workspace that loses it cannot lock out members
  who have no password sign-in policy to fall back to.
- **Nothing is deleted.** Losing a feature keeps all records, connections and settings; they come back when the
  feature does. Limits already worked this way.

## In the app

`useFeatures()` / `useHasFeature()` in `apps/web/src/lib/features.ts` read `me.tenant.features`. The sidebar puts a
lock on modules outside the plan; opening one shows an upgrade page (`FeatureLocked`) with the current plan, the
cheapest plan that includes the feature (from the live catalogue), and a link to Billing for people who can buy.
Panels that belong to a feature on record pages and the Command Center are wrapped with `gated()` so they are not
shown and do not call an API that would refuse. The Billing page lists every feature with what the plan includes and
what the SampForce team added or turned off for the workspace. All text is in the five languages; the feature names
and descriptions are in the server text table `features`, which the web app falls back to.

## Consequences

- A new module must add a feature (or be declared core), annotate its controller, and gate its panels. The API
  e2e test `plan-features.e2e.test.ts` and the Playwright spec `plan-features.spec.ts` cover the refusals, the
  overrides and the console; `i18n.test.ts` fails when a feature's name or description has no translation.
- Existing workspaces on Free lose the modules outside Free when this ships. That is the intended packaging; an
  admin can turn features back on per workspace in the console.
- Test helpers put new test workspaces on Enterprise Plus unless a test asks for a plan, so feature tests are not
  coupled to the packaging.
