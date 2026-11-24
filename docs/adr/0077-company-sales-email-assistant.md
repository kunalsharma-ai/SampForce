# ADR 0077: AI sales email assistant on the company page

- Status: Accepted
- Date: 2026-11-24

## Context

Kunal asked for an AI email assistant on the company page with controls for purpose, recipient, tone, length, call to
action, personalisation, sales objective and follow-ups. The emails must be written for the user's own organisation:
nothing about Frequent Research or any other sender is built in. Each customer organisation (tenant) describes
itself once, and its Manager and Executive Workspaces use the same description.

## Decision

- **Sales profile.** `Tenant.salesProfile` (`salesProfileSchema`): organisation name for emails (blank = workspace
  name), what it does, services, value proposition, differentiators, industries served, website and a signature.
  `GET /tenants/current/sales-profile` (tenant:read) and `PUT` (tenant:manage, and only from the Super Workspace).
  Workspaces share the tenant, so Manager and Executive Workspaces inherit it with no copy. Changes are audited
  (`sales_profile.updated`). It is a card in Settings, Workspace section (`#sales-profile`).
- **Drafting.** `POST /companies/:id/ai-email` (companies:read, ai:use), run by the `email_assistant` agent with
  prompt `company-email@1.0.0`. Input: the settings, the sales profile, the writer's name, the company's Business
  Information (website text and the AI summary wrapped as untrusted), the recipient and the last interactions. The
  recipient is an employee the caller may see, or a role only, in which case no name is used. Output: subject, body,
  alternative subjects, 0-3 follow-ups (wait clamped to 2-14 days), what it relied on and what to check. The
  signature is appended by the server. Missing facts are written as `[placeholders]`.
- **Safety.** It never sends and never changes the company. The draft is edited in place and sent through the normal
  email window from the person's own mailbox. An employee who opted out of marketing email or whose address bounced
  is flagged. Missing services or value proposition are reported as `sender.gaps`, and the panel links to Settings.
- The panel is gated by the `ai_assistant` feature and `ai:use`, and also opens from the header quick action
  "Write email with AI".

## Consequences

- Tested against the AI stand-in (`apps/api/test/fixtures/ai-fixture.ts`), which checks the plumbing and rules, not
  the quality of real drafts.
