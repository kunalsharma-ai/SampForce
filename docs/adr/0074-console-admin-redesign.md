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

## C3a: structured audit log and the activity feed

- **One writer.** Every platform audit entry goes through `writePlatformAudit` (`apps/api/src/operator/platform-audit.ts`).
  An entry now records what it is about (`targetType`, `targetId`, `targetLabel`: client, operator, role, plan,
  provider, setting, ticket, support chat, help content), the changed values `before` and `after`, and the Console
  `sessionId` and `userAgent` of the request (kept per request in `common/audit-context.ts`). Entries that already
  logged `from`/`to` keep them as before/after. Keys that look like secrets (password, secret, token, hash, OTP,
  recovery codes, API keys, sealed `...Enc` values) are replaced by `[removed]` at any depth; fingerprints and hints
  stay. Values over 20 KB are cut. Updates and deletes stay refused by the database guard (`scope.ts`).
- **Every Console write is audited.** Instead of a lint rule, `AuditRequiredInterceptor` (global) checks that a signed-in
  operator's successful write wrote at least one entry. Under test a missing entry fails the request with
  `UNAUDITED_WRITE`, so a new route cannot ship without one; in production it is logged. Writes that change nothing
  on the platform say so with `@OperatorNoAudit()` (own preferences, chat read/typing/delivered marks, socket tickets).
  Operator replies, edits, removals and files in client support chat, ticket attachments and starting two-step
  verification setup are now recorded; message text is not copied into the log.
- **Search and export.** `GET /operator/audit-log` filters by free text (action, target name or id, operator email or
  name, client name), client, operator, action, target and dates. `GET /operator/audit-log/{id}` returns one entry.
  `GET /operator/audit-log/export` returns the filtered log as CSV (up to 10,000 rows, cells that a spreadsheet would
  run as formulas are prefixed with an apostrophe) and records the export.
- **Activity feed.** `GET /operator/activity` merges operator actions (looking, searching and signing in are left
  out) with platform records: clients joining, Manager and Executive Workspaces created, invoices issued and paid,
  subscriptions going past due, tickets reaching SampForce support and unusual operator sign-ins. Each category needs
  a permission (clients.view, workspaces.view, billing.view, support.handle, security.manage, audit.view), so a role
  sees only what it may act on. It reads no CRM records. Indexes were added for these reads.
- **Page.** `/operator/audit` is "Activity & audit log" with two tabs; an entry opens in a side panel with a
  before/after table. The activity feed refreshes every 30 seconds; live push arrives with notifications (C3b).
- **Retention.** Entries are kept; the 7-year retention in the spec is a floor, and nothing deletes them.

## C3b: Console notifications

- **What reaches whom.** Ten types (`OPERATOR_NOTIFICATION_DEFS` in `@dealflow/types`): new client, new workspace,
  subscription ending (14 and 3 days before, only when it does not renew by itself), payment failed, invoice overdue
  (open 14 days after issue), new ticket, ticket past its response time (24 hours, 8 when high priority), provider
  check failed, unusual sign-in and features changed. Each type belongs to one permission; an operator receives it only
  while their role has that permission, so a Support Admin never sees billing.
- **Where they come from.** The worker's `ConsoleNotificationSweep` reads the platform's own records since a cursor
  kept in `PlatformSetting` (`console.notifications.cursor`), every `CONSOLE_NOTIFY_INTERVAL_MS` (default one minute).
  A new deployment starts from now, so history is never sent out. Conditions that come due (ending, overdue, late) are
  checked on every pass. Each notification has a dedupe key unique per operator, so a pass that sees an event twice,
  or two workers, never deliver it twice.
- **How.** `OperatorNotification` rows (`targetTenantId`, not `tenantId`, because the workspace guard treats any
  `tenantId` field as workspace-scoped) and `OperatorNotificationPref` per operator and type: Console, email, both or
  neither. Urgent and money types go by email by default; the rest only in the Console. Email goes to the operator's
  sign-in address through the platform mailer, and only when one is configured.
- **In the Console.** A bell in the top bar with the unread count and the latest eight (the alert chime plays for a new
  urgent one when sounds are on), a Notifications menu item with the same count, and `/operator/notifications` with
  All, Unread and Preferences. Opening a notification goes to what it is about and marks it read. Reading and choosing
  change nothing on the platform, so those writes are marked `@OperatorNoAudit()`.
- **Not yet.** Counts update by polling every 30 seconds, not over the support chat's socket.
