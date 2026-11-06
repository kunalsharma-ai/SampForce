# ADR 0028: Sales gamification is computed from CRM records under admin-set rules

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 3 (feature 14)

## Context

Feature 14 asks for performance dashboards, leaderboards, achievement badges, sales competitions, team challenges,
target progress and personal performance tracking, and says: "Gamification must be configurable. Administrators
should be able to decide which activities earn points and how achievements are calculated." SampForce already had the
records that matter (activities, tasks, leads, deals), sales targets for any month, quarter or year (ADR 0024), and a
`teams` table with no API or screen.

## Decisions

1. **No points ledger.** Points are worked out when someone looks, from CRM records, under the workspace's rules
   (`gamification_settings.rules`): calls, meetings, emails and notes logged, tasks completed, leads added and
   converted, deals created and won, and won revenue (points per 1,000 in the base currency, using the manual exchange
   rates). Each rule can be switched off, given points (0 to 1,000) and a daily limit per person (UTC day) that stops
   points from bulk-logged records. Deleted records stop counting. Credit goes to the record owner (the assignee for
   tasks). A rule change applies to every leaderboard at once; it is audited with before and after values.
2. **Off by default.** Nobody sees points until an admin or sales manager (`gamification:manage`; owners, admins and
   managers) turns it on. Everyone has `gamification:read`. Leaderboards can be shown to everyone or to managers only,
   in which case others see just their own score and awards.
3. **Leaderboards** rank people (standard competition ranking, ties share a rank) and teams (total and points per
   member, so team size is visible) for any month, quarter or year. They also show deals won, revenue won, logged
   activities, personal target attainment (from `sales_targets`) and badges. Won deals in a currency with no exchange
   rate are left out of revenue and counted on screen, not guessed.
4. **Badges are rules, awards are stored.** A badge is a measure (points, deals won, revenue won, calls, meetings,
   activities, or percent of personal target), a threshold and a window (month, quarter, year or all time; target
   attainment needs a period). The worker checks hourly (and managers can check now) for the current and just-ended
   period, stores one award per badge, person and period, notifies the person in SampForce and writes an audit entry.
   Awards are never taken away by later rule changes. Six suggested badges can be added in one click; none exist until
   someone adds them.
5. **Competitions and team challenges** run for a period label or custom dates, for people (optionally only members of
   chosen teams) or for teams, on points, revenue won, deals won or logged activities, with an optional goal (progress
   shown as a percent) and a free-text reward. They copy the scoring rules when created, so changing rules mid-way does
   not move standings. Participants get an in-app notification; nothing is emailed. They can be cancelled, not edited.
6. **Sales teams** get a small API under `tenants/current/teams` (`members:manage` to change, `members:read` to list)
   and a card on Team Management, because team challenges need them.

## Consequences

- Leaderboards cost a few grouped queries per request; there is no cache. Fine at current workspace sizes; a nightly
  roll-up would be the next step if it is ever slow.
- Days are UTC days, so a daily limit may split differently from someone's local day.
- Logged emails count only as EMAIL activities (logged or synced). Email opens and clicks do not earn points.
- There are no cash or payroll rewards; "reward" is a label the manager writes.
