# ADR 0085: Company journey and the Pipeline journey board

- Status: Accepted
- Date: 2026-11-26
- Part of: the role and workflow redesign, R5 (plan in `sampforce/redesign/PLAN.md`)

## Context

Spec sections 15–18 ask for a Pipeline that shows every company as a card in a journey column. Each card shows the
stage, the current follow-up, the next action, the due date and the status. Clicking a card opens a visual journey,
marked done, current, next, pending, won or lost.

The spec also lists the outcome states: Won, Lost, Rejected, Not Interested and On Hold. A Super Workspace
administrator should be able to rename, recolour or hide them.

Companies already have statuses, and employees already have communication stages (ADR 0080, 0083). A third status
list that people type into would drift away from both. `/app/pipelines` was the deal pipeline settings page.

## Decision

**The journey is worked out, never stored.** It uses a fixed set of keys, defined in `packages/types/src/journey.ts`:

- **The main path:** New, Fresh Email, Initial Email, Follow-up, Discussion, RFQ, Negotiation, Won.
- **The endings:** Lost, Rejected, Not Interested, and On Hold.

The function `journeyStageOf` applies these rules in order:

1. A company status meaning CLIENT, or a won deal, puts the company in **Won**.
2. A status meaning LOST puts it in **Lost**, **Rejected** or **Not Interested**, chosen by the status name.
3. A status meaning ON_HOLD puts it in **On Hold**.
4. If every employee's conversation has ended and nothing is still open, the company is **Lost**, or **Rejected** when an RFQ was rejected.
5. Otherwise the furthest point reached decides:
   - an open deal, or an employee in negotiation, means **Negotiation**;
   - an open RFQ, or any RFQ stage, means **RFQ**;
   - a discussion or call means **Discussion**;
   - a follow-up means **Follow-up**;
   - **Initial Email Sent** and then **Fresh Email Pending** come next;
   - anything else is **New**.

`journeySteps` builds the visual journey:

- A company still on the path gets its path steps marked DONE, CURRENT, NEXT or PENDING.
- A company that has ended gets the steps it reached, then its ending.

**Settings.** `CrmSettings.journeyStages` holds per-key names, colours and hidden flags. It is changed through
`PUT /crm-config/journey`, which only the Super Workspace can use (the check is shared with the cadence settings in
`super-workspace.ts`). Four stages can never be hidden: New, RFQ, Won and Lost. A company in a hidden stage shows in
the nearest earlier stage that is shown.

**API.**

- `GET /pipeline/journey?q=&mine=&ownerId=&perStage=` returns the board. It covers every company the caller can see, puts overdue cards first, and gives one query per kind of record.
- `GET /companies/:id/journey` returns the steps of one company. Where they are known, it includes dates: created, first email, first follow-up done, first RFQ, deal, won, and status change.

**Screens.**

- `/app/pipelines` is now the **Pipeline** journey board. It has search, an "Only my companies" filter, and stage colours with checked contrast. The board scrolls sideways inside itself, never the page.
- A card opens the journey. The company profile has a **Company journey** card.
- Deal pipeline settings moved to `/app/settings/pipelines`, with a link from the board.
- CRM configuration has a **Journey stages** tab.

## Consequences

- Nothing about the journey needs migrating or keeping in step, because it is always derived.
- The board reads up to 5,000 companies per request, which is fine for current workspaces. Paging by column can come later if that becomes too slow.
