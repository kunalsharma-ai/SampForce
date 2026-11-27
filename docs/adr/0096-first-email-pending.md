# ADR 0096: First Email Pending and the move into Follow-ups

- Status: accepted
- Date: 2026-11-27
- Builds on: ADR 0083 (follow-up cadence), ADR 0057 (plan features), ADR 0058 (MongoDB workspace guard)

## Context

Section 5 of the refined CRM spec asks for a First Email Pending list on the Follow-ups page. Every new contact
should be in it until their first email is confirmed as sent. Contacts with no email address are flagged for
completion, not treated as failures. Once the first email is sent, the contact waits for a period the Super
Workspace sets (7 days by default). If nobody answers, a background job creates the next follow-up and the contact
moves into Follow-ups. The period can differ per company, per team and per type of follow-up. The move is
rule-based and uses no AI.

Before this change, ADR 0083 created follow-up 1 at the moment the first email was recorded, so there was no
waiting period and nothing to configure.

## Decision

**One place at a time.** A contact is in exactly one of these states:

1. First email pending: no `initialEmailAt`, no stopped cadence, and the stage is unset, New contact or Fresh Email Pending.
2. Sent, waiting: `initialEmailAt` is set and `cadenceMovesAt` holds when the contact will move.
3. In Follow-ups: the job has cleared `cadenceMovesAt` and created follow-up 1.

**Statuses** shown in the list: `PENDING`, `NO_EMAIL`, `INVALID_EMAIL` (address marked invalid or bounced) and `SENT`.

**Verified sends only.** `initialEmailSent` runs only after:

- a provider accepts a send (`SENT`),
- mailbox sync finds the email (`MAILBOX`),
- someone logs an email-sent interaction (`LOGGED`), or
- someone marks it by hand (`MANUAL`).

The source is stored on the contact (`initialEmailSource`). A failed send never reaches this path, so the contact stays pending.

**The background job.** The worker tick calls `FollowUpCadenceService.moveDue()` before reminders. For each contact
whose `cadenceMovesAt` has passed, the job does the following:

- **Claims the contact.** A conditional `updateMany` clears `cadenceMovesAt` only if it is still set, so two
  workers can never create two follow-ups for the same contact.
- **Creates follow-up 1.** It is due at the end of that local day in the workspace's time zone.
- **Records the move.** It writes an activity note and sends one notification per assignee, grouped.
- **Stops the cadence instead** if the contact already moved past outreach. The reason recorded is "other activity
  after the first email".

A first email backdated past its period moves at once.

**Settings.** `CrmSettings.followUpCadence` gains:

- `firstFollowUpDays`: when null, it falls back to `intervalDays`, so existing settings keep working.
- `channel`: Email, Call, WhatsApp, LinkedIn or Meeting. The follow-up task gets this type.
- `rules`: up to 100 rules, each scoped to a company or a team.

A team is a Manager Workspace. An Executive Workspace belongs to its parent Manager Workspace's team. Precedence is
company rule, then team rule, then the organisation default.

**Worker access.** `Contact` joins `WORKER_READ` in the workspace guard, so the worker can scan every workspace for contacts that are due.

**API.** `GET /api/v1/follow-ups/first-email` returns the list with filters:

- scope, period (today, yesterday, this week, this month or all, in the caller's time zone)
- creation date from/to
- status, assigned employee, company, and a search

It also returns counts per status and the number of contacts created today.

## Consequences

- **Follow-up 1 timing changes.** It is no longer created at the moment the first email is recorded; it now comes
  after the period. Earlier tests that expected an immediate follow-up 1 now backdate the first email past the period.
- **Contacts emailed before this change** that already have follow-up tasks are left as they are. They are not
  reconciled into the new states.
- **Imports set the Fresh stage directly**, so they fall under the stage-based rule. This is not covered by a dedicated import test.
- **The mobile app does not show the new list yet.**
