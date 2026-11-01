# ADR 0042: Shared data table, saved views and bulk actions

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (Part 10 premium data tables, Part 13 density, Part 14 mobile)

## Context

The spec asks for enterprise tables with sticky headers, column resizing, reordering and pinning, multi-column
sorting, saved views, row selection and bulk actions, keyboard navigation, search highlighting, custom column
visibility and four density modes that stay accessible, while staying fast on large lists and not shrinking into
unreadable tables on phones. Before this change the record lists (leads, contacts, companies, deals, accounts) used a
small hand-written table with single-column sorting and nothing saved.

## Decisions

1. **One shared component on TanStack Table.** `components/data-table/` wraps `@tanstack/react-table` in manual
   (server) mode for selection and column sizing. Lists stay server-paginated (25 rows), which keeps them fast at any
   size; virtualisation is unnecessary at that page size.
2. **The layout is a value.** `ViewConfig` (packages/types/src/views.ts) holds visible columns in order, widths,
   up to three sort keys, filters (status, owner with "me" meaning the viewer), search and density. The table edits
   that value; a saved view stores it. Stored configs are re-validated on read and unknown columns are dropped, so an
   old view never breaks a list.
3. **Saved views live on the server, private by default.** `saved_views` has forced RLS: a person reads their own
   views and views shared in the workspace, and only the creator can update or delete (separate SELECT, INSERT,
   UPDATE and DELETE policies). The last view used on each list is remembered on the device and reopened.
4. **Multi-column sorting in the existing list API.** `sort` accepts "status,-createdAt" (up to three keys, "-" for
   descending) while the old `sort` + `order` form keeps working. Only each list's allow-listed fields are used,
   and the id is always the final tie-breaker.
5. **Bulk actions reuse the single-record rules.** `POST /records/bulk` (assign, set lead status, delete; up to 100
   ids) calls the same service method as a single edit for each record, so validation, ownership checks, automation
   events and audit entries are identical. Records that fail are listed in the response and shown to the person.
   Delete asks for confirmation.
6. **Accessible at every density.** Density per table overrides the person's setting through `--cell-py`. Row
   checkboxes keep a 24 px target. Column resizing works by mouse, touch and keyboard (a focusable separator with
   Left and Right). Up and Down move between rows. Shift-click (or Shift+Enter) adds a sort key, and the caption
   reads out the full sort order.
7. **Cards on phones.** Below 768 px the list renders as cards (name, then up to four fields) instead of the table;
   only one layout is in the DOM.

## Not in this change

Inline editing, grouping, expandable rows and AI-assisted filters are left for follow-ups; the deal pipeline views
(PR 5) will add the deal-specific ones.
