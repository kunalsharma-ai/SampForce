# 0091. Task progress, comment reactions and new target periods and measures

Date: 2026-11-26. Status: accepted. Part of the role and workflow redesign (R7).

## Context

Assigned tasks (ADR 0071, part 4) were open, done or cancelled. A manager could not tell whether an executive had
seen a task, started it or was stuck on it, short of asking. Targets had four measures (leads, calls, deals won,
revenue) and periods up to a quarter; Kunal's spec asks for half-yearly and yearly targets and for emails sent,
follow-ups completed, meetings, RFQs and conversions.

## Decision

- **Where a task stands.** An open task carries `progress`: `NEW` (not acknowledged), `ACKNOWLEDGED`,
  `IN_PROGRESS` or `BLOCKED`. Only the person doing the task changes it (`POST /assigned-tasks/:id/progress`);
  blocking needs a reason (up to 500 characters), shown on the task and in the list. The first acknowledgement is
  time-stamped. Each change goes into the task history and notifies the assigner ("Task acknowledged / in progress /
  blocked: {title}"), so the bell, chime and section strip work as for other notifications (ADR 0075).
- **Reactions on comments.** Six quick reactions (👍 ✅ 👀 🎉 ❤️ 🙏) on task comments, one of each per person,
  toggled with `POST /assigned-tasks/:id/comments/:commentId/reactions`. The task shows each reaction with its count
  and who gave it. Anyone who can see the task can react.
- **Targets.** New periods `HALF_YEARLY` (six months) and `YEARLY`; new measures `EMAILS_SENT`,
  `FOLLOW_UPS_DONE`, `MEETINGS`, `RFQS` (received) and `CONVERSIONS` (clients converted). They are counted with the
  same `Metrics` the dashboards use, so a target and the dashboard never disagree. Splitting down the team works for
  every measure.

## Consequences

- Old tasks read as `NEW` until someone acts on them; nothing is migrated.
- A done or cancelled task keeps its last progress, but only open tasks show it.
- Tests: `apps/api/test/workspace-work.e2e.test.ts` (progress rules, notifications, reactions, new measures) and
  `apps/web/e2e/redesign-tasks-targets.spec.ts` (the whole flow between an executive, their manager and the Super
  Workspace, with axe).
