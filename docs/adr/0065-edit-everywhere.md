# ADR 0065: Edit everywhere

- Status: Accepted
- Date: 2026-11-17

## Context

Kunal asked for "edit option everywhere so that we could edit and update the content". An audit of every record type
and settings screen found that leads, companies, employees/contacts, deals, RFQs, branches, custom field values, CRM
configuration items, custom field definitions, territories, pipelines, quotes, contracts, templates, reports and chat
messages could already be edited. These could only be created, acted on or deleted:

| Record | Before | Gap |
| --- | --- | --- |
| Logged notes, calls, emails, meetings (record timelines, Activities page) | log, delete | no edit in app or API |
| Company interactions | log, delete | no edit in app or API |
| Tasks | add, tick done | API could update; app had no edit form |
| Follow-ups | complete, reschedule, cancel | API could update; app had no edit form |
| Client concerns | raise, escalate, resolve | API could update; app had no edit button |
| Manager instructions | send, withdraw | no edit in app or API |
| Lead transfer requests | request, withdraw | no edit in app or API |
| Company files | upload, delete | no rename |

## Decision

- **New routes.** `GET` and `PATCH /activities/:id` (type, subject, details, when), `PATCH /interactions/:id` (every
  logged field except the company and the follow-up it scheduled), `PATCH /instructions/:id` (kind, message, priority,
  due date), `PATCH /lead-transfers/:id` (everything except the company) and `PATCH /company-files/:id` (name).
- **Who may edit is who may already act on it.** Activities and interactions: anyone with `activities:write` (the
  same rule as delete); interactions also need to be able to change the company (record visibility, ADR 0060).
  Instructions: only the sender, while open. Transfer requests: only the requester, while pending. Files: anyone who
  can change the company. Tasks, follow-ups and concerns keep their existing update rules.
- **What an edit cannot do.** It cannot move a record to another lead, company or person it is linked to (the
  schemas are strict); a company interaction's activity type follows its interaction kind, so the generic activity
  edit refuses to change it (`INTERACTION_TYPE`).
- **Edits are visible.** Activities, interactions, instructions and transfer requests store `editedAt` and show
  "(edited)". Every edit writes an audit entry (`activity.updated`, `instruction.updated`, `lead_transfer.updated`,
  `company.file_renamed`) naming the changed fields; note text itself is not copied into the audit log. The recipient
  of an edited instruction and whoever decides an edited transfer request are notified.
- **Saving nothing changes nothing.** An edit that changes no field writes no audit entry and sends no notification.
- **App.** A pencil button opens the same form used to create the record, filled in, with "Save changes"; file names
  are edited in place. Follow-up and concern edits keep the current executive, manager or owner when those fields are
  left empty (empty only means "the default" when adding).

## Consequences

- Three optional fields (`edited_at`) on `activities`, `instructions` and `lead_transfers`; no index or set-up change.
- API tests in `apps/api/test/edit-everywhere.e2e.test.ts`; browser tests in `apps/web/e2e/edit-everywhere.spec.ts`.
- Not changed: approvals, meeting records and voice notes (already editable or decision-only), gamification
  competitions (create and cancel only) and inbox thread notes.
