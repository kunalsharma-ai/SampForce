# ADR 0043: Command Center filters, charts and personal layouts

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (Part 4 Command Center)

## Context

The spec asks for a customisable Command Center: draggable, resizable widgets, saved layouts, executive and
salesperson presets, filters, chart/table toggles and exports, and charts the dashboard did not have yet (revenue
trajectory, stage conversion, win/loss, team performance, deal risk, goal attainment), plus win rate, sales
velocity and task KPIs. Before this change the page was a fixed grid of 15 KPIs over the last 30 days, a pipeline
chart and the activity stream.

## Decisions

1. **Filters are part of the API.** `GET /dashboard/summary` and the new `GET /dashboard/charts` take `period`
   (7d, 30d, 90d, 365d), `ownerId` (a member id or "me") and `pipelineId`, validated by `dashboardFilterSchema`.
   The owner filter applies to leads, deals, activities and tasks; the pipeline filter to deals. KPI definitions
   name the period and scope so the tooltip always says what the number covers.
2. **Charts are computed from records, never estimated.** Revenue trajectory sums won deals by closing week
   (periods up to 90 days) or month. Stage conversion counts deals created in the period by the furthest stage
   they reached, from `deal_stage_events` plus the current stage, so a deal that was lost at Discovery still counts
   as reaching Discovery. Win/loss uses deals closed in the period with their loss reasons. Team performance groups
   won, lost and open value and activities by owner. Deal risk groups open deals by their stored health score, and
   deals without a score are shown as "unscored" rather than guessed. Goal attainment uses the quarter's sales
   target (the person's own when filtered to one owner, otherwise the workspace target) and shows nothing, with a
   link to Forecasting, when no target is set.
3. **One personal layout per person per workspace.** The layout (preset name, ordered widgets with half or full
   width and hidden flag, and the filters) is stored in `workspace_navigation.dashboard_layout`, which already has
   forced RLS limited to the owner (ADR 0041). `GET/PUT/DELETE /me/dashboard-layout`. Stored layouts are
   re-validated, and widgets added in later versions are appended hidden, so an old layout never breaks the page.
   Nothing saved means the salesperson preset.
4. **Presets are data.** `DASHBOARD_PRESETS` in packages/types: the executive view leads with revenue, goal,
   conversion and team over 90 days for everyone; the salesperson view leads with next best actions and the
   person's own numbers over 30 days.
5. **Customising is a draft.** "Customize layout" edits a copy; Done saves it, Cancel throws it away and Reset
   deletes the saved layout. Widgets reorder by drag and drop or by Move up/Move down buttons, each change is
   announced in a live region, and widget content is inert while editing so focus stays on the controls.
6. **Every chart has a table and a CSV.** `ChartCard` gives each chart a text summary for screen readers, a table
   view with the exact values, and a CSV download of the same rows (cells that start with `=`, `+`, `-` or `@` are
   prefixed so spreadsheets do not run them). Chart animation follows the person's motion setting.

## Not in this change

Free-form pixel resizing (widgets are half or full width), per-widget filters, scheduled emailing of the dashboard
and sharing layouts with a team are left for later.
