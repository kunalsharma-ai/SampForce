# ADR 0025: The client portal is a separate sign-in that shows only what the workspace chooses

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 3 (feature 11)

## Context

Feature 11 asks for a client self-service portal: customers sign in, follow their projects, see proposals,
contracts and documents, approve proposals, raise support and change requests, message their account team and
receive updates. DealFlow already had companies with owners, deals, sent proposals with a signed public link
(ADR 0021), contracts, tasks and notifications. It had no customer accounts.

## Decisions

1. **Portal users are not workspace members.** They live in their own table (`portal_users`), sign in with their
   own password (argon2), and get their own session cookie (`df_portal`, HttpOnly, SameSite=Lax, scoped to
   `/api/v1/client-portal`). No CRM route accepts that cookie and no portal route accepts a member session. Portal
   users never count as seats.
2. **One company per portal user.** Every portal query filters on the user's company in addition to row-level
   security on the workspace. Tokens (sessions, invitations, resets) start with the workspace id, so they are looked
   up inside that workspace only, and are stored as SHA-256 hashes. The portal address (`/portal/<slug>`) is resolved
   through a narrow RLS policy that only exposes enabled portals with that exact slug.
3. **The workspace decides what is visible.** Settings switch each section on or off: projects (deals as a stage and
   progress bar, never amounts or internal fields), milestones (only tasks a member ticks "show in portal"; titles,
   due dates and done state only), proposals (sent, accepted or declined; never drafts or internal approvals),
   contracts (not drafts), documents, uploads, requests and messages. Approving proposals is off by default.
4. **Approvals are deliberate.** Only portal users with the approver role can approve or decline, only when
   approvals are on, only the latest version, only while it is sent and not past its valid date. The customer must
   tick a statement naming the reference, total and company before confirming. The decision, note and person are
   stored on the quote, audited, and the quote creator and deal owner are notified.
5. **Invitations by link, email when available.** Inviting returns a 7-day link. When the workspace's mail service is
   configured and the portal is on, it is also emailed; otherwise the screen says to send it by hand. Resets last
   60 minutes, end every session, and the forgot-password form answers the same for unknown emails. Five wrong
   passwords lock the account for 15 minutes (counted in its own transaction so the refusal cannot roll it back).
   Switching a person or the whole portal off ends access at once.
6. **Requests and messages are simple threads.** A request gets a workspace-wide number (`R-0001`), is assigned to
   the company owner, and moves open → in progress → resolved → closed. A customer reply re-opens a resolved request;
   a closed one takes no replies. Team replies add a portal update and, when email is configured, a short notice
   to the person who opened it (the reply itself stays in the portal).
7. **Documents are stored in Postgres** (up to 10 MB; PDF, images, text, CSV, Word, Excel, PowerPoint) with a SHA-256,
   downloaded through 10-minute signed links that name the workspace, document and company. Downloads are sent as
   attachments with a sandboxing Content-Security-Policy.
8. **Invoices are not shown.** DealFlow's invoices are its own SaaS billing, not invoices to the workspace's
   customers. The portal says invoices are not available yet instead of showing an empty list.

## Consequences

- Customers see a branded portal (the workspace logo from proposal settings and its brand colour) with no DealFlow
  CRM chrome.
- Documents in the database suit the 10 MB cap; larger files or high volume would need object storage later.
- There is no single sign-on for portal users and no customer invoicing; both are possible later additions.
