# ADR 0044: Pipeline views, deal priority and the deal side panel

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (Part 5 sales pipeline experience)

## Context

The spec asks for several pipeline views (Kanban, compact table, split screen, timeline, calendar, forecast,
territory, AI priority), Kanban cards that show name, client, value, stage, owner, close date, priority and an AI risk
indicator, optimistic drag and drop with keyboard alternatives and error recovery, and a deal workspace in a side
panel so people do not leave the pipeline. The board already had keyboard drag and drop, a Move menu and optimistic
moves with rollback (Phase 2). Deals had no priority, and cards did not show health.

## Decisions

1. **Priority is a real field.** `opportunities.priority` (enum LOW, MEDIUM, HIGH, nullable: not set) is part of the
   deal input, audited like any other change, sortable (empty values last) and copied when a deal is cloned.
2. **Health comes from deal intelligence.** Every `DealRow` carries the latest stored health score and risk
   (`deal_health_scores`), or null. Cards show "Not scored" instead of guessing.
3. **Views read the same records.** Board and table are unchanged in shape. Split, timeline and calendar use the deal
   list with new `closeFrom`/`closeTo` filters (open deals, at most 100, with a note when more exist). Forecast
   (`GET /deals/forecast`) groups open deals into overdue, the next six months, later and undated, with value and
   weighted value (amount times effective probability). Priority (`GET /deals/priority`) ranks open deals with a
   deterministic, explained score: health risk (critical 40, at risk 20, not scored 10), close date (overdue 30,
   within 14 days 25, within 30 days 15, none 5), size against the largest candidate (up to 30) and the priority set
   by people (high 15, medium 5). Each deal lists the reasons. It is labelled "Priority", not "AI", because no model
   is involved; the health score it uses is the existing deal intelligence signal.
4. **The view and the open deal live in the URL.** `?view=` and `?deal=` make any view and open panel shareable and
   survive a reload; the last view is also remembered on the device.
5. **One deal workspace, two placements.** `DealPanel` (summary, stage stepper, tabs for overview with inline edits,
   activity, emails, quotes, AI insights and history) opens as a slide-over from every view, and sits beside the
   list in split view on wide screens (a slide-over on phones). Edits save explicitly with validation, show unsaved
   and saved states, and refresh every view. History (`GET /deals/:id/history`) lists the deal's audit entries for
   anyone who can read the deal, with changed fields.
6. **Accessible by default.** Tabs follow the ARIA tabs pattern (arrow keys, Home, End). The calendar is a table with
   a caption and becomes a day list on phones; the timeline has a text alternative for every bar.

## Not in this change

Territory view (needs a territory model; tracked as a follow-up), and the Contacts, Products, Bids, Documents and
Forecast tabs in the panel (the full deal page still has contacts and products; bids arrive with PR 6).
