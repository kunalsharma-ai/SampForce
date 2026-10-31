# ADR 0014: Email sequences from each person's own mailbox

**Status:** accepted, 2026-10-31. **Requested by:** Kunal (Sampledge): email automation with templates, an email
integration and customisable rules for what happens at the recipient's end, alongside a lead-capture browser extension
and an email finder (later parts of Phase 9).

**Context.** Phase 3 connected Gmail and Microsoft 365 for sync and one-to-one sending, with a per-person daily cap,
and stated that DealFlow does not send bulk email. Sales teams want multi-step outreach that stops when someone replies.

**Decision.**

- **Templates** (`email_templates`) hold a subject and plain-text body with merge fields (`{{first_name}}`,
  `{{company|your team}}` with a fallback, sender fields). Personal by default; sharing needs `marketing:manage`.
- **Sequences** (`sequences`) are a list of up to 20 steps stored as JSON: `email` (template or inline text),
  `task` (for the sender), and `condition` (after a wait, has the person replied / opened / clicked; jump forward,
  carry on or stop). Each step waits a number of days after the previous one.
- **Who sends.** Every email goes one-to-one from the **enrolling person's own connected mailbox** through the existing
  adapters. Nothing is sent from a shared DealFlow domain. Limits: the sequence's per-sender daily limit, the mailbox's
  `EMAIL_DAILY_SEND_LIMIT` (now counting direct and sequence sends together), a send window in the sequence's time zone,
  and a few minutes of spacing between sends. This replaces the earlier "no bulk email" wording: these are personal,
  capped, one-recipient sends that a person sets up and starts; they are not newsletters.
- **AI agents** cannot create, start or enrol people in sequences; no agent tool exposes them.
- **Enrolment** (`sequence_enrollments`) skips people with no email, people who opted out of marketing, addresses on
  the workspace **do-not-email list** (`email_suppressions`) and people already live in the sequence (partial unique
  index). Up to 500 at once, by lead, contact or segment. The sender must have a connected mailbox.
- **Missing merge data pauses** that person's run with a clear message instead of sending "Hi ,".
- **What recipients did** (`sequence_messages`, `email_events`):
  - Replies and bounces come from **mailbox sync**: a hook in `IntegrationsService.sync` sees every new message before
    unrelated mail is dropped. A reply is an inbound message from the recipient after the send (out-of-office subjects
    are ignored); a bounce is a mailer-daemon/postmaster notice naming a recently emailed address.
  - Opens use a tracking image and clicks a signed redirect; both are optional per sequence. **Opens are approximate**
    (Apple Mail Privacy Protection loads images; many corporate gateways block them), and the UI says so.
  - Unsubscribe: every sequence email has a link to `/unsubscribe/<token>` (a confirm page, so link scanners do not
    unsubscribe people) and `List-Unsubscribe` / `List-Unsubscribe-Post` headers for RFC 8058 one-click. Microsoft
    Graph only accepts `X-` headers, so Outlook sends carry the link in the body only.
  - Tokens are `base64url(tenant id ‖ message id) . HMAC`, keyed by `TRACKING_SECRET` (or a key derived from
    `JWT_ACCESS_SECRET`). Public endpoints act inside the token's tenant; click URLs are signed too, so the redirect
    is not an open redirect. No IP addresses or user agents are stored.
- **Rules.** For each event the sequence owner picks actions: stop, move to another sequence, change lead status,
  create a task, notify the sender. Rules fire once per event per run. Bounces and unsubscribes always stop all live
  runs to that address in every sequence and add it to the do-not-email list; unsubscribes also set marketing consent
  to opted out on matching leads and contacts. Removing an unsubscribed address from the list needs a written reason.
- **Permissions.** New `sequences:read` (every system role) and `sequences:write` (owner, admin, manager, member).
  Editing someone else's sequence or template, and managing the do-not-email list removals, needs `marketing:manage`.

**Consequences.**

- Tracking needs a public address that serves `/api/v1/t/*` and `/unsubscribe/*` (`TRACKING_BASE_URL`, default
  `PUBLIC_WEB_URL`). Use a subdomain of the customer-facing domain in production.
- Deliverability depends on each sender's mailbox reputation and domain setup (SPF, DKIM, DMARC). DealFlow does not
  warm up mailboxes or rotate senders.
- Not verified here: sending through real Gmail or Outlook accounts, inbox placement, and the bounce formats of every
  mail system (tested with a Gmail-style notice). Legal duties for cold outreach (for example GDPR, CAN-SPAM, India's
  DPDP Act) depend on where senders and recipients are; DealFlow records consent and honours unsubscribes but does not
  make a workspace compliant.

**Addendum, 2026-10-31: A/B tests and test sends.**

- An email step can have a **version B** (its own template or subject and text). Each person in the run gets one
  version, chosen from a hash of the run id and step id, so a retried send uses the same version and runs split about
  evenly. `sequence_messages.variant` records which one went out, and the Results tab shows replies, clicks, opens and
  bounces for each version. The page marks a version "ahead on replies" only once both have gone to at least 20 people,
  and says that small differences can be chance. DealFlow does not pick a winner automatically: the sender decides and
  removes the other version.
- **Send me a test** sends one saved email step (either version) to the caller's own connected mailbox address, filled
  in for a chosen lead. Empty merge fields are shown as "[Job title missing]" rather than left blank, the subject starts
  with "[Test]", nothing is tracked, no run or sequence message is created, and it counts toward the mailbox's daily
  limit. It needs `sequences:write` and is limited to 10 a minute.
