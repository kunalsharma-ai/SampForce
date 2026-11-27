# 0096: Deals and Pipeline redesign: dashboard, rich board, new deal fields, archive, duplicate guard, bulk changes

Date: 2026-11-27. Status: accepted. Section 8 of the "SampForce – Complete CRM Redesign" brief.

## Decision

- **Deals dashboard** (`GET /deals/summary`, `apps/api/src/crm/deals-summary.ts`, `components/deals/deals-dashboard.tsx`).
  One read of the active deals the person may see (`dealScope`, so workspace visibility applies) computes total,
  open, won, lost, created and closed this month, pipeline and weighted value, average deal value, conversion rate,
  average time to win, deals by stage, employee, manager and company, a six-month trend, upcoming closing dates and
  "needs attention" counts. Period presets (month, quarter, year, last 12 months, all time) and custom dates filter
  created, won and lost; open pipeline is always "as of now". Only amounts in the workspace currency are added up;
  the number of deals in other currencies is shown. No AI is involved.
- **Board cards** carry owner, company, contact, value, expected close (overdue and soon tones), last activity,
  next follow-up, priority, risk, linked RFQ and SampBidx status. These come from `deal-extras.ts`: four tenant-scoped
  aggregates per page of deals, never stored. Stages keep their own colour and a 3D-style icon tile.
- **Bulk changes** on the board (per-card and per-stage checkboxes) and in the table: move to a stage (Lost asks
  for the reason), assign, priority, close date, archive or restore, delete, and a slot for SampBidx transfer
  (`sampbidx-bulk-slot.tsx`, filled by the SampBidx work). `POST /deals/bulk-update` is now strict and needs at
  least one change. The bar sits in the page flow above the board so it never covers a card.
- **New deal fields:** source (suggested list, free text allowed), products or services, notes, associated RFQ
  (same company only), and "next follow-up", which books one follow-up task for the owner on that date.
- **Archive** (`POST /deals/:id/archive`, `/restore`): archived deals leave the board, the default list, priority
  and forecast but keep their history; the table has an "Archived deals" filter to find and restore them.
- **Duplicate guard:** creating a deal with the same name (ignoring case, accents and punctuation) as an open deal
  of the same company returns 409 `DUPLICATE_DEAL` with the existing deal. The form offers "Open the existing deal"
  or "Create anyway" (`allowDuplicate`).
- **Pipeline page** (company journey) gains a summary strip and the same toned columns and cards.

## Changed earlier behaviour

- The Deals page opens on the Board as before, with a new Dashboard view and a four-tile KPI strip above other views.
- Archived deals are hidden from the board, list, priority and forecast.
- A same-named open deal at the same company now needs "Create anyway".
- The bulk-update body rejects unknown fields and empty changes.
