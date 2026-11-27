# ADR 0096: Delete all on every list

- Status: accepted
- Date: 2026-11-27

## Context

Kunal asked to "delete each and everything at once in all fields". PR #159 added select-all across pages to the table
lists (companies, contacts, leads, deals) through `POST /records/bulk` with `all: { query, expected }`. The other
sections (RFQs, follow-ups, tasks, activities, quotes, meeting notes) are not tables, and several of their lists stop
at a display cap (tasks 200, quotes 200, follow-ups 300, meeting notes 100), so "everything" cannot be what the screen holds.

## Decision

Each of those lists gets two routes on its own controller, so its feature, permission and workspace rules apply as they
do to its single delete:

- `POST <list>/count-all` with `{ query }` returns `{ count }`: every record the list's query matches, with no
  page or cap. The confirmation dialog shows this number.
- `POST <list>/delete-all` with `{ query, expected }` needs the password (`@ConfirmPassword`) and the workspace Delete
  action. It finds the ids first, refuses with 409 `SELECTION_CHANGED` if their count is not `expected`, then deletes
  each through the list's own single delete (same checks, side effects and audit entry), eight at a time, and writes
  one `records.bulk_delete` summary entry. Records that cannot be deleted (a quote that is no longer a first-version
  draft) are reported back, not hidden.

`query` is the list's own query, parsed with the same schema as its GET route. The shared helper is
`apps/api/src/common/delete-all.ts`; the screen side is `components/delete-all-button.tsx`.

The same routes cover a company's interactions log (`POST /companies/:id/interactions/delete-all`), the call history
(`/calls/delete-all`) and voice notes (`/voice-notes/delete-all`).
- Calls: the single route only discards calls that were never logged. "Delete all" removes logged calls too, through
  a new `removeCall`, together with the interaction each one logged on its company. It reaches only the calls that the
  person's history shows them.
- Interactions: emails read from a connected mailbox are not stored as interactions, so they stay.
- Voice notes: a person only ever sees and deletes their own.

## Consequences

Settings lists (statuses, templates, price books…) have no "delete all".
