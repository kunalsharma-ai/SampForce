# ADR 0018: Email automation on Automation Studio

**Status:** accepted, 2026-10-31. **Requested by:** Kunal (Sampledge), enhancement spec Part 3 (advanced email
automation, scenarios 1–6) and feature 6 (workflow automation). Kunal's rule: "Reuse the existing automation engine
for email sequences, CRM workflows and AI-triggered actions."

**Context.** Sequences (ADR 0014) already send multi-step email with delays, condition branches, A/B tests, send
windows, working days, daily limits, the do-not-email list and per-sequence event rules (stop, move, change lead
status, task, notify). Automation Studio (ADR 0007 queue, Phase 3 engine) runs workflows from CRM events with
conditions, delays, approvals and actions. Email events did not reach Automation Studio, so anything beyond a
sequence's own rules needed a second engine.

**Decision.**

- **One event stream.** Email and sequence events go into the same domain-event outbox as CRM events and start
  workflows like any other trigger: `email.sent`, `email.opened`, `email.clicked`, `email.replied`, `email.bounced`,
  `email.unsubscribed`, `email.failed`, `sequence.enrolled`, `sequence.removed`. The record is the lead or contact
  ("person" triggers). One event per email and kind: the first open of an email, not every reload of it.
- **No "delivered" trigger.** Gmail and Outlook do not tell a sender that a message was delivered. SampForce knows an
  email was handed to the provider (sent) or came back (bounced), and says so instead of inventing delivery.
- **Confirmed and estimated events are labelled.** Sent, replied, bounced, unsubscribed and failed are confirmed.
  Opens are estimates (image loading, privacy proxies and scanners); clicks are likely but can come from link
  scanners. Each event carries `confirmed`, the editor warns on open and click triggers, and the next best action
  that uses opens says "(estimate)".
- **Email activity in conditions.** A workflow about a person can test `record.emailActivity` (replied, clicked or
  opened since the trigger; opens, clicks and replies in 30 days; live sequences), `record.engagementScore` and
  `record.emailStatus`. Conditions read fresh data after every wait, so "wait 3 days, then check for a reply" works.
- **New actions, all through existing services:** stop or pause the person's sequences; add them to an active
  sequence (one person per run; the sequence's own window, limits, consent and do-not-email checks apply); flag the
  address (needs verification, invalid, verified); change the engagement score (0–100, reusing the existing
  `leads.engagement_score`, now also on contacts); and create a task with a priority (new `tasks.priority`).
  Sending an email from a workflow still needs a person's approval each run.
- **Built-in safety does not depend on a workflow.** A bounce or unsubscribe stops every live sequence to that
  address and adds it to the do-not-email list at once; a bounce also marks the lead or contact `bounced`. Changing the
  address clears the status.
- **Sequences keep their steps and rules.** A sequence is a specialised, linear sender with per-step statistics and
  A/B tests; its rules are shortcuts for the common reactions. Both now sit on the same events, so a workflow can do
  everything a rule can and more. Moving sequence steps into workflow nodes was considered and not done: it would
  rebuild working, tested sending code for no change in behaviour, which the non-duplication rules argue against.
- **Scenarios** ship as six Automation Studio templates ("Email automation"), each tested end to end:
  1. no reply in 3 days → follow-up after approval (sequences do this natively for their own emails);
  2. proposal link clicked → high-priority task;
  3. reply → stop all sequences and notify;
  4. bounce → flag the address and ask for a working one;
  5. unsubscribe → confirm and notify (suppression is automatic);
  6. repeated engagement without a reply → engagement points and a follow-up, plus an "Engaged, no reply" next best
     action.

- **Switching a workflow on is a clean start.** `workflows.activated_at` records when it was last activated; events from before then that are still in the outbox do not start it (found by a flaky browser test).

**Consequences.** Every email reaction now has one place to live, with run history, retries, approvals and loop
protection from the existing engine. High-volume opens publish events but no audit rows. Replies are matched from
mailbox sync, so a reply is seen at the next sync, not instantly. Tested only against the local Gmail stand-in;
real Gmail and Outlook mailboxes have not been tried.
