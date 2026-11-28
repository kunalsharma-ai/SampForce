# 0096. Recurring tasks counted from real work, target rings and performance ranking

Date: 2026-11-27. Status: accepted. Sections 7, 10 and 11 of Kunal's CRM redesign brief.

## Context

Tasks (ADR 0071, 0091) were one-off: someone wrote a task, someone marked it done. Kunal wants tasks that repeat
(per day, per week, per month), whose progress counts itself from the records people add, with statuses, reminders,
history and a celebration when they are done. Targets needed more measures (qualified companies, contacts, connected
calls, deals created, deal value, RFQs converted), organisation-wide targets, a picture of progress past 100%, what
is left, the time left and a comparison with the previous period. Rankings must use plain arithmetic the Super
Workspace controls, never an AI score.

## Decision

### One way of counting

`Measures.count(metric, users, start, end)` (apps/api/src/workspace-work/measures.ts) counts every measure for
targets, recurring tasks and rankings, so the three never disagree. It reuses the dashboards' `Metrics` where one
existed. "Qualified companies" are the companies the duplicate and reachability detector already accepts (a website,
email, phone or LinkedIn, and not a repeat). Deleted records never count; contacts need an email or phone; connected
calls are logged calls whose outcome reached someone. Each measure has a sentence (`METRIC_RULE`) shown next to it.

### Recurring tasks

- A **task plan** (`task_plans`) holds a title, up to eight requirements (measure, amount, per day/week/month), a
  duration (1 day, 2 days, 1 week, 1 month, 1 quarter, 6 months, 1 year or custom up to 366 days), working days,
  days off and the people doing it. Managers set plans for their team (`assign` permission, hierarchy rules);
  anyone can set one for themselves; the Super Workspace can set them for anyone.
- **Instances** (`task_plan_instances`) are made by themselves, one per person, cadence and period: a daily
  instance on each working day that is not a day off, a weekly one Monday to Sunday, a monthly one per calendar
  month, all in the organisation's time zone and clipped to the plan. A unique index makes creation idempotent; the
  worker sweep (every minute, per tenant) and opening the page both create what is due.
- **Progress counts itself.** Each instance keeps a copy of its requirements with `done` counted by `Measures`.
  Saving a company, contact, deal, email, call, follow-up or RFQ refreshes the person's open instances at the end of
  the same transaction, so a task completes the moment the record that finishes it is saved.
- **Statuses.** Running: Not started, In progress, Half completed (50%), Completed. When the period ends:
  Completed, Partially completed, Not completed. Cancelled when the plan is paused or cancelled. A completed
  instance leaves the pending list and stays in the history. The overall percentage is the average of each
  requirement's share, capped at 100% each, so one large number cannot hide a missing one.
- **Notifications** use the shared task types, so muting and on-screen cards apply: `task.assigned`,
  `task.updated`, `task.cancelled`, `task.half_completed`, `task.completed`, `task.not_completed` and
  `task.due_soon` (morning, 12 hours and 16 hours into the day, and the last day of a week or month). The person
  hears everything; the plan's creator and the Manager Workspace above hear completions and misses; the Super
  Workspace hears completions and misses, only misses, or nothing (its setting). Each notification is sent once per
  instance (`notified` list, claimed with the row's `updatedAt`).
- **Celebrations** (ADR 0090): `TASK_PLAN_DONE` ("Today's task completed!", with the streak) and
  `TASK_PLAN_HALF` ("Halfway there!"), in the `tasks` category so they can be muted.
- **Changes apply from now on.** Editing amounts, measures, working days, days off, the last day or the people
  updates open instances (keeping what is already done) and future ones. Finished instances are never rewritten.
  Each change is kept in the plan's revisions and in the audit trail (`task_plan.*`). A plan with finished
  instances cannot be deleted, only cancelled.

### Targets

- New measures: `QUALIFIED_COMPANIES`, `CONTACTS`, `CALLS_CONNECTED`, `DEALS_CREATED`, `DEAL_VALUE`,
  `RFQS_CONVERTED`. `LEADS` keeps its old meaning and label.
- The Super Workspace can set a target on the organisation itself; it counts every active member.
- A manager sees other managers' targets when its workspace may see other managers.
- Each target now says what is left, whether it is upcoming, running or ended, the days left, the same measure over
  the previous period of the same length, and how it is counted. `GET /targets/:id/trend` gives cumulative progress
  day by day with the even pace that reaches it on time, and up to six earlier periods.
- Changing a target's end date makes its period custom, moves the parts handed down from it, and tells the people
  it was set for.
- The screen draws each target as a ring in the milestone colours (30%, 50%, 75%, 100%, and a gold second lap
  above 100%), filters by level (organisation, managers, executives, yours) and opens the trend on demand. Motion
  is skipped when the person asked for less motion.

### Performance ranking

- `GET /performance?period=WEEK|MONTH|QUARTER&offset=0..-24` ranks Manager Workspaces (whole team counted together)
  and executives. The Super Workspace sees everyone; a manager sees itself, its executives and other managers when
  allowed; an executive sees its own figures, and its place in the team when the Super Workspace turns that on.
- The score is arithmetic, shown in full on the page: each measure gives a share between 0 and 1. Target
  achievement (average of the person's targets, each capped at 100%) and task completion (completed ÷ finished
  instances) are already percentages; every other measure is divided by the best figure in the same ranking. The
  score is the weighted average of the shares × 100. A measure with no target or no finished task is left out,
  not counted as zero. Ties share a place. The previous period is ranked the same way, for the change.
- The Super Workspace sets the weights (0 to 100 per measure), the executives' team position and its task
  notifications in `performance_settings` (`PUT /performance/settings`, audited as `performance.settings_updated`).
  The defaults weigh results over activity: target achievement 30, task completion 15, revenue 15, deals created 10,
  deals won 10, qualified companies 10, emails 5, connected calls 5.

## What changed in earlier behaviour

- Targets: new fields on each row; Super can set organisation targets; managers may see other managers' targets
  when allowed; a new end date turns the period custom. Existing targets are unchanged.
- The Tasks page has three tabs: Today, Recurring tasks and One-off tasks. One-off tasks work as before
  (`?task=` still opens one); closing one keeps the One-off tab.
- `AchievementsService.award()` was split out of `detect()` so recurring tasks can award achievements.
- The `task_updates` notification category also covers the new task types.
- The audit categories put `task_plan.*` under Tasks and `performance.*` under Sales targets.
- The menu has a Performance entry after Targets (feature: sales target management).

## Consequences

- No AI anywhere in counting, statuses or ranking. Every number can be traced to stored records.
- Counting runs at the end of each record's transaction for the person who saved it; a busy person with many open
  instances adds a few count queries per save.
