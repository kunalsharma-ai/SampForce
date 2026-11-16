# ADR 0063: Command Center dashboards, revenue attribution and lead transfers

- Status: Accepted (Phase 4: executive dashboard, revenue attribution, lead transfers, deal visibility); Phases 5
  and 6 extend it with the manager and senior management dashboards
- Date: 2026-11-16

## Context

The company-centric CRM master spec (ADR 0060, sections 10 to 13, 15, 16 and 18) asks for a Command Center with a
dashboard per level of the organisation: executives, managers and senior management. Every number has to come from
real records and open the records it counts, and revenue has to be shared between the people who won it without
ever counting a deal twice. Executives also need a way to ask for a lead to move to a manager or a senior person,
with a decision recorded and the lead's creator kept.

## Decision

- **Who sees which dashboard.** A person's tier comes from their designation (EXECUTIVE, MANAGER or SENIOR, ADR
  0060). Without one it falls back to their role: owner and admin are senior, manager is manager, everyone else is
  an executive. Seniors see the senior, manager and executive dashboards; managers the manager and executive ones;
  executives their own. Every tier keeps the earlier analytics layout as a tab. `GET /command-center/context` returns
  the tier, the dashboards and the people reporting to the caller (none for OWN scope). The manager and senior
  dashboards each have a plan feature (`manager_dashboard`, `senior_dashboard`, ADR 0057); so do lead transfers,
  revenue attribution, manager instructions and client concerns.
- **Periods** are computed in the viewer's time zone: this or last month, quarter, year and financial year (April by
  default), each half-year, or two dates. Targets reuse `SalesTarget`; a month without its own target takes a third
  of its quarter's, else a twelfth of its year's.
- **Revenue records.** Each won deal, and each won RFQ that has no deal, gets one `RevenueRecord` with its value in
  its own currency and the people involved (lead creator, closer, account owner, manager, supporters). Its
  `RevenueCredit`s always sum to exactly 100%. They come from the workspace rule in `Tenant.revenueAttribution`:
  lead generation, deal closure (the default), account ownership, or shared percentages. A missing person's share
  goes to the closer, then the owner, then the creator. Someone with `pipelines:manage` can enter a split by hand,
  which survives a change of rule until they put the record back on the rule. A person's revenue is the sum of their
  shares; any total over several people (a team, a department, the organisation) counts each record once, at its
  full value. Reopening a deal voids its record and winning it again restores it, so nothing is counted twice.
  Records are reconciled right after deal and RFQ writes, and fully (at most every 15 seconds per workspace) before a
  dashboard is read, so they stay right even after imports or changes made elsewhere. Recognised and collected
  amounts and a payment status are kept on the record.
- **Deals** gain a number (DEAL-0001, from a workspace counter), the lead creator (copied from the company), a
  manager (from the input, else the company's manager, else the owner's reporting manager) and supporting people.
  Deal lists, the board, forecasts and every deal action follow record visibility: a person sees deals they own,
  manage or support, deals of companies they can see, and deals with neither owner nor company.
- **Lead transfers.** An executive asks for a lead to move, with a reason, an optional proposed owner, an
  opportunity value and remarks. Their manager and the proposed owner are notified. Only someone above the requester
  in the reporting lines (or with ALL scope) decides: approve, give it to someone else, or reject, with a note and
  instructions for the new owner. Approval changes the owner through the normal owner-change path (ADR 0060), so the
  creator never changes and the history records the reason. One request per lead can wait at a time.
- **Funnel stages** are derived, not stored: a company is Won when it has a won deal or RFQ or a client status, Lost
  when its status means lost, and otherwise sits at the furthest stage its status name, interactions, RFQs and open
  deals show. Phase 7 may map statuses to stages in configuration.
- **Layouts.** Each person can reorder and hide the sections of each tier's dashboard and the sections of My Work,
  and add their own My Work categories (open follow-ups of a type and/or priority), stored per person and tier in
  `command_center_layouts`. The dashboard policies of Settings → CRM configuration (ADR 0062) can limit and lock
  these.
- **Drill-down.** `GET /command-center/drill` returns the records behind any number on the dashboards, with the same
  filters, so a card and its list always agree. It is capped at 200 rows and reports the full total.

## Consequences

- People with OWN scope no longer see deals of companies they cannot see; one existing test that read another
  person's deal history now reads its own.
- The dashboards read live data. They are bounded by the workspace's size, not cached; a later phase can add
  snapshots if large workspaces need them.
- There is no "recent history" widget: interactions are their own log (ADR 0060).
