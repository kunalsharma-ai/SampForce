# ADR 0083: The follow-up cadence

- Status: Accepted
- Date: 2026-11-26
- Part of: the role and workflow redesign, R3 (plan in `sampforce/redesign/PLAN.md`)

## Context

Kunal's redesign spec asks for a fixed follow-up rhythm for every employee of a company:

- New employees start in **Fresh Email Pending**.
- When the first email goes out they move to **Initial Email Sent**.
- They then get **Follow-up 1 … N**, a set number of days apart.
- The default is 5 follow-ups, 7 days apart. Only the Super Workspace can change this.
- Owners get a daily reminder of what is due.

Follow-up tasks, reminders, overdue alerts and the Follow-ups page already exist (ADR 0060). Communication stages exist
too, from ADR 0080. The cadence had to be built on top of these rather than beside them.

## Decision

**Settings.** A new `CrmSettings.followUpCadence` stores `{followUps, intervalDays}`:

- The default is 5 and 7. The limits are 1–20 follow-ups and 1–90 days.
- Anyone with `contacts:read` can read it.
- Only an administrator (`crm:configure`) of the Super Workspace can change it. Anyone else gets `403 CADENCE_SUPER_ONLY`.
- Each change is audited.
- It appears in CRM configuration under **Follow-up cadence**.

**Two new built-in stages.** Fresh Email Pending and Initial Email Sent are added after New Contact. `ensureStages`
adds any missing built-in stage to existing workspaces, in its place. New employees of a company start in Fresh Email
Pending. This applies to employees added by hand, by company lead or by import.

**Each step is a real follow-up task.** The task has `followUpType: EMAIL` and a `cadenceStep` number. Its title is
"Follow-up 2 of 5: Name", and it is assigned to the employee owner, who is also notified. Because they are ordinary
follow-up tasks, the following all work unchanged:

- reminders before due
- overdue alerts to the owner and their manager
- the Follow-ups buckets
- dashboards and the Command Center

**What starts it.** The cadence starts once, and only before any outreach. Any of these starts it:

- a logged `EMAIL_SENT` interaction
- an email sent from SampForce
- an outbound email seen by mailbox sync
- **Mark initial email as sent** on the employee row or card, for email sent outside SampForce. It can be backdated and cannot be in the future.

Starting the cadence sets `Contact.initialEmailAt`, moves the employee to Initial Email Sent and plans follow-up 1 for
`initialEmailAt + interval`.

**Moving on.** When a cadence follow-up is completed, the next one is planned, `interval` days after completion, until
the number is reached. Completion can come from the Follow-ups page or from the task itself. The existing stage logic
moves the employee to Follow-up N.

**What stops it.** These all stop the cadence:

- a reply (logged, or a synced inbound email)
- a call
- a meeting
- negotiation
- an RFQ arriving

Stopping records `cadenceStoppedAt` and the reason, and cancels the planned follow-up with the outcome "Cadence
stopped: …". A synced reply also moves the employee to Discussion in Progress, with source `EMAIL`.

**Daily summary.** From 8:00 in the workspace's time zone, each person with open follow-ups gets one notification a
day: "Follow-ups for today: N due, M overdue". The type is `followup.daily`, in the follow-up reminder category. A
per-person, per-day event id stops it from being sent twice.

**Where people see it.** The employee rows and the contact's communication card show one of these:

- "Initial email pending" with the mark button
- "Follow-up 2 of 5, due …" (red when overdue)
- "All 5 follow-ups done"
- "Cadence stopped: the contact replied"

`GET /contacts/:id/cadence` returns the same state, and so does `EmployeeActivityRow.cadence`.

## Consequences

- Changing the setting affects the next follow-up planned, not tasks already planned.
- Employees past outreach (an RFQ, a reply, a later stage) never start a cadence, so the change does not disturb
  existing conversations.
- A cadence runs once per employee. The plan's open question about a restart after an RFQ cycle is left for later.
- The timeline no longer fades the "from" stage chip, because the faded cyan failed the 4.5:1 contrast check.
