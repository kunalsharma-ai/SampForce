# 0086. Role dashboards

Date: 2026-11-26. Status: accepted. Part of the role and workflow redesign (R6).

## Context

The home page opened on the level dashboard (ADR 0071, part 6). It showed figures, but it did not answer the one question each role has when they sign in. Quick actions sat in the header's Create menu.

## Decision

`/app` opens on one dashboard per workspace level. Each one is built around a question:

- **Executive: "What do I need to do today?"** It shows:
  - today's work: follow-ups due, tasks, leads against the daily target, calls;
  - the follow-up queue, overdue first;
  - target rings for today and this month;
  - their pipeline strip, from the journey board (ADR 0085);
  - "continue where you left off": the companies they last worked on, from the audit trail, or else the ones they own updated last.
- **Manager: "How is my team doing?"** It shows:
  - the team's results;
  - tasks pending and done;
  - the team status board (ADR 0081);
  - the team follow-up queue;
  - monthly and quarterly target rings;
  - the executive ranking;
  - work load by executive;
  - new companies and active deals.
- **Super: "What is happening across the organisation?"** It shows:
  - organisation KPIs;
  - team status grouped by manager;
  - the pipeline funnel;
  - target rings and targets by workspace;
  - productivity by team;
  - work load by team.

Every card links to the exact list it counts:

- follow-ups take `?bucket=` and `?scope=`;
- the Pipeline board takes `?mine=true`;
- deals open with `?view=list`.

Quick actions (Add company, Add contact, Send email, Create task, Schedule follow-up, Create deal) are on the dashboard. Each one only shows when the person has the permission it needs.

The data comes from the existing `GET /workspace-dashboard`. It now also returns:

- `extras` for the manager and Super dashboards: new companies, active deals, task counts, and work load per workspace below;
- `tasks` and `recent` for the executive.

Follow-ups, targets, the journey board and team status use their own APIs. Nothing is counted twice.

The follow-ups "My team" scope now follows record visibility. In a Manager Workspace the team is the workspace branch (ADR 0071), not only the reporting lines. Without this, the manager's team queue was empty.

The old level dashboard stays under `?view=overview`, and the designation dashboards stay under their own tabs, until Kunal decides to drop them.

## Consequences

- Specs that expected the old home page heading now expect the role question. The old views are still reachable by URL and tab.
- Mobile reads the same API. Its new fields are optional for it.
