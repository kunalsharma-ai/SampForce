# ADR 0063: Command Center dashboards, revenue attribution and lead transfers

- Status: Accepted (Phase 4: executive dashboard, revenue attribution, lead transfers, deal visibility; Phase 5:
  manager dashboard, instructions, client concerns); Phase 6 extends it with the senior management dashboard
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

## Phase 5: the manager dashboard, instructions and client concerns

- **A manager's team** is the manager and everyone below them in the reporting lines, limited to the people the
  viewer's record visibility reaches (only the viewer for OWN scope). `GET /command-center/manager` returns the header
  (team size, this month's team target as the sum of each member's target, and the team's revenue), the sixteen team
  cards of section 12.2, one row per person with the columns of 12.3 plus the rates the comparison charts use (response
  rate, RFQ conversion, follow-up completion, won deals, target achievement), the team funnel with the number of people
  handling each stage, the monitoring sections of 12.6, and the employee- and manager-wise revenue of 12.7. A senior
  person can open the dashboard of any manager they can see (`userId`).
- **No double counting.** Each person's business is their own credited share. The team total is the sum of those
  shares, which is each revenue record counted once at the team's combined share, so the rows always add up to it; a
  manager's line in the manager-wise table is the same sum over their part of the team.
- **Performance status** compares target achievement with how much of the period has gone: achieved at 100%, on track
  within 90% of that pace, at risk within 60%, else behind; without a target a person is "no target" or, with no
  activity in the period, "no activity".
- **Monitoring and actions.** Today's and overdue team follow-ups, meetings in the next 14 days, clients whose latest
  logged message from the team is an unanswered email, RFQ deadlines, open concerns, unassigned leads, and the items
  needing senior intervention (transfer requests from the team and concerns escalated to the manager). From each item
  the manager can reassign a follow-up or change its priority, assign a lead, add a follow-up, send an instruction,
  escalate a concern, and decide transfers. The order and visibility of these sections are part of the person's
  MANAGER layout.
- **Instructions** (`instructions`, feature `instructions`) go from someone to a person below them in the reporting
  lines (or from anyone who manages members and sees every record). The recipient is notified, acknowledges the
  instruction and marks it done with a note; the sender is told each time and can withdraw it while it is open. A
  remark is the same without the request to act.
- **Client concerns** (feature `client_concerns`) are escalations with a category (pricing, quality, communication,
  delivery, payment, service, not interested, rejected, lost opportunity), an employee, a manager (the owner's
  reporting manager by default) and a resolution deadline. Escalating sends a concern to the person chosen, else its
  manager, else the next person up; only the people working a concern and the managers above them can change it.
  Customer-success escalations keep working as before, and the health score counts both.
- **Notifications** now carry the sender (shown with their designation), a priority, the related company and employee,
  and whether action is required.
- Owners and admins without a designation are senior management; until the senior dashboard is built they keep the
  analytics layout as their default and can open the manager dashboard from its tab.

## Consequences

- People with OWN scope no longer see deals of companies they cannot see; one existing test that read another
  person's deal history now reads its own.
- The dashboards read live data. They are bounded by the workspace's size, not cached; a later phase can add
  snapshots if large workspaces need them.
- There is no "recent history" widget: interactions are their own log (ADR 0060).
