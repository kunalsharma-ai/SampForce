# ADR 0024: Forecast planning stays rule-based and explains every number

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 3 (feature 10)

## Context

Feature 10 asks for revenue forecasts from pipeline and history, closure probability estimates, monthly, quarterly
and yearly views, targets against actuals, individual and team forecasts, revenue gaps and pipeline risks, win/loss
trends, best, expected and worst cases, accuracy tracking, manager-adjustable assumptions and dashboards. DealFlow
already had a weighted quarter forecast with worst, base and best scenarios, per-owner totals, immutable snapshots
that recompute exactly, an AI explanation of snapshot changes, quarterly targets, and revenue analytics.

## Decisions

1. **Months, quarters and years.** Periods are `YYYY-MM`, `YYYY-Qn` or `YYYY`. Snapshots of any size are stored and
   matched on both start and end, because a month and its quarter start on the same day.
2. **Probability from win history is a choice, not a model.** Managers pick "stage probability" (the default) or
   "stage win rate from history". The history rate for a stage is the share of deals closed in the window (3 to
   36 months) that were won among those that reached the stage, from the stage-change log. A stage is used only
   with at least the minimum number of closed deals (default 10); otherwise the stage probability is used. A
   probability entered on a deal always wins. Each deal line says where its probability came from.
3. **Managers change the category thresholds.** Commit and best-case cut-offs (default 70% and 30%) are settings,
   changed by people with `pipelines:manage` (the same people who set targets) and audited. A snapshot stores the
   thresholds it used, so it still recomputes to the same totals after they change.
4. **Targets for any period.** Targets can be set for a month, quarter or year, for the team or one person. When a
   period has no target, the plan says how it got one: the sum of the targets set inside it (quarters in a year,
   months in a quarter), or a third of the quarter for a month. It never invents a target when none is set.
5. **Gaps, coverage and risks are plain arithmetic.** Gap = target minus each scenario. Coverage = open pipeline ÷
   (target − won). Risks list open deals in the period whose close date has passed, with no activity for 30 days,
   or with a high-risk health score from Phase 1.
6. **Accuracy only for finished periods.** Trends compare what was won with the base forecast of the first snapshot
   of each period, and show "in progress" until the period ends.
7. **No new AI.** The existing AI explanation of snapshot changes stays; no number is produced by a model.

## Consequences

- People see why a deal has its probability and which assumptions produced the totals.
- Accuracy tracking depends on someone (or a later scheduled job) taking a snapshot at the start of each period.
