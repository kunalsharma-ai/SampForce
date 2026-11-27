# 0094: Notifications for the redesign's events, sound settings, and one end-to-end workflow test

Date: 2026-11-26. Status: accepted. Redesign R10 (plan sections 33-40).

## Decision

- **Every new event of the redesign notifies someone.** Most were added with their features: company and employee
  assignment (R2), follow-up reminders (R3), client won with its deal (R4), RFQ assigned (R5), team status (R6),
  task assigned, updated, commented and target events (R7). R10 adds the missing one: **deal lost**. When someone
  other than the owner moves a deal to a Lost stage, the owner gets "Deal lost: {deal}" (event relay, `deal.lost`).
  The person who did it is not told, the same rule as for "Deal won".
- **Every notification type has a category,** so it can be switched off for the workspace and its sound muted per
  person. Two new categories: "Task progress and comments" (`task.updated`, `task.commented`, `task.completed`) and
  "Team status: check-in, breaks and check-out" (`team.status`). Before this they fell into "Everything else".
- **Sound settings in one place.** Notifications > Sound and alerts now has the team chat chime switch next to the
  notification sound, volume and per-category switches. The chat chime is kept per device (`sf.chatSound`, ADR
  0093). The notification sound settings follow the person (ADR 0075).
- **One test for the whole workflow.** `e2e/redesign-workflow.spec.ts` runs it as two people in their own
  browsers: a manager adds a company with an employee, marks the initial email sent, completes a follow-up, gets a
  reply (cadence stops, Discussion in Progress), wins an RFQ, marks the company won and opens the won deal. The
  Super Workspace then marks another of the manager's deals lost on the deal page, and the manager sees it arrive
  in the bell. It ends on the sound settings. `apps/api/test/redesign-notifications.e2e.test.ts` checks the
  deal-lost rule and the categories.

## Not covered

- Sounds play only while SampForce is open in a tab. Push to phones follows the existing mobile push rules.
