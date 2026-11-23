# ADR 0074: Console Admin redesign

**Status:** accepted (2026-11-23), built in parts C1 to C10

**Context.** Kunal asked for the operator Console (`/operator`) to become a premium, enterprise-grade control center:
a left menu, global search, palettes and colour modes, a richer overview, client profiles, workspace and user
directories, granular operator roles with MFA, billing, feature and mobile-seat management, notifications and system
health. The full specification, the audit of the Console as it was, and the ten-part plan are in the Claude Doc
"SampForce Console Admin Redesign — Implementation Spec".

**Decision.**

- **Reuse, don't rebuild.** Every existing Console route and model stays; the redesign wraps them. Client = `Tenant`,
  Super Workspace = the SUPER `WorkspaceNode` (ADR 0071), plan quotas stay in `plans.entitlements` (ADR 0057).
- **Shell (C1).** A grouped left menu (Command, Customers, Commercial, Support, Governance, Platform) that collapses
  to an icon rail with tooltips, nested groups, live counts for support chat and tickets, breadcrumbs, a client
  context bar on every page inside a client, and a drawer menu below 1024 px. Menu items are added as their pages
  ship, never as dead links.
- **Appearance through the theme engine (ADR 0040).** Six Console palettes (Professional Blue, Indigo Violet,
  Emerald, Dark Enterprise, Modern Cyan, Neutral Minimal) are theme-engine themes with Console overrides, so the
  Console paints with the same tokens and the same contrast rules. Palette, colour mode (light, dark, system),
  sidebar state and sound are saved per operator in `platform_operators.preferences`
  (`GET /operator/me`, `PUT /operator/me/preferences`). The Console paint is kept apart from the workspace paint in
  the same browser (`dealflow:console-paint`), and the workspace appearance is restored on leaving the Console.
- **Global search.** `GET /operator/search?q=` finds clients, people by name or email (with their client),
  workspaces (with level and client), invoices, tickets (by subject or number) and plans. It reads names and numbers
  only, never CRM records, is rate limited and is written to the platform audit log (`console.searched`).
- **Sound** is optional, off by default, and made with Web Audio on save, alert and error. Nothing depends on it.
- **Operators still never read CRM records** without a client's support grant.
- Later parts add operator roles and permissions, MFA and sessions (C2), structured audit and notifications (C3),
  client profiles and locations (C4), the overview dashboard (C5), directories (C6), plans and subscriptions (C7),
  billing (C8), features and mobile seats (C9), and support, providers and system health (C10).

**Consequences.** The Console looks and navigates like the new design from C1, with today's features inside. Operator
preferences follow the operator across devices. The "Operator log" menu item is now "Audit log".

## C2: roles, permissions and sign-in security

- **Permissions on every route.** 22 permissions (`OPERATOR_PERMISSIONS` in `@dealflow/types`) and six built-in roles
  (Super Admin, Finance, Support, Sales, Operations, Read-only) plus custom roles (`operator_console_roles`). Each
  operator route carries `@OperatorPermission(...)` or `@OperatorAny()`; `operator-routes.test.ts` fails on a route
  with neither. An edit permission brings its view permission. The legacy `ADMIN`/`SUPPORT` field stays in step
  (Super Admin = ADMIN), so the CLI and the last-admin guard keep working; operators made before C2 get Super Admin or
  Support Admin. Support Admins no longer see billing or the audit log, as the spec's matrix sets out.
- **No escalation.** Nobody can grant a permission they lack, change their own role or status, or remove the last
  active Super Admin.
- **Operators join by link.** A Super Admin adds an operator; a one-time link (72 hours, hash stored) is emailed, or
  shown to copy when email is not set up. Reset links last an hour. Setting a password ends every open session.
- **Sessions are rows.** The cookie names an `operator_sessions` row the guard checks on every request: it can be
  listed, ended by its operator or a Super Admin, and ends after the policy's idle time (default 60 minutes). "Keep me
  signed in" lasts 7 days instead of 8 hours. Sign-out ends the row, so a copied cookie stops working.
- **Two-step verification** (TOTP, recovery codes, the same code as workspaces) is optional unless the security policy
  requires it; an operator without it can then open only their account page. Requiring it needs it on for the person
  asking. A Super Admin can reset a lost authenticator, which ends that operator's sessions.
- **Lockout and history.** Five failures in a row pause sign-in for 15 minutes with the same answer as a wrong
  password. Every attempt goes to `operator_login_events`; a success after three failures in an hour, or from an
  address none of the last 20 sign-ins used, is flagged as unusual.
- **Deviation from the spec:** two-step verification is not forced by default, so upgrading does not lock out
  operators who have no authenticator yet; Super Admins switch the policy on.
