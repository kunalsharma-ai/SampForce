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
