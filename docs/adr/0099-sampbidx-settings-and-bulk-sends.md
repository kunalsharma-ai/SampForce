# ADR 0099: SampBidx settings page, connection test, and bulk sends of deals and won companies

- Status: Accepted (built against the SampBidx stand-in; SampBidx has not built `PUT /v1/clients` or `PUT /v1/deals` yet)
- Date: 2026-11-27

## Context

Kunal could not connect SampForce to SampBidx and could not tell why: the Integrations card only said the check
failed. He also asked to send many deals (Deals section) and many won companies (Companies section) to SampBidx at
once, with select all, a check before sending where missing details can be corrected, progress, sent / failed /
skipped results, retry, idempotency through an external id, and history. A fake "connected" state must never show,
credentials never reach the browser, nothing is invented (prices, taxes, discounts, prepayment), and nothing says
"sent" before SampBidx confirms it. Core features must not depend on AI.

## Decision

- **Settings page** at Integrations → SampBidx settings (`integrations:manage`). It reads `GET /apps/sampbidx/overview`:
  the saved connection's real state (not connected, connected, or a connection problem with its reason), address,
  account, the key's last four characters only, who connected it and when, the last test, the last status callback,
  sync counts per transfer kind (sent, failed, sending, last confirmed), the 20 latest failed sends with SampBidx's
  reason and a retry, the latest bulk sends with each item's result, and the field mapping (`SAMPBIDX_FIELD_MAP`).
- **Test connection** (`POST /apps/sampbidx/diagnose`) runs six steps in order and stops at the first failure with a
  plain fix: address, allowed to call it (public https, or a private host an operator approved), SampBidx answers
  (with the network cause: refused, name not found, timed out, certificate), the SampForce API is there (`GET
  /v1/ping` 404 means SampBidx has not built it at that address), key accepted, and status callbacks (advice only).
  Typed-in values are tried and never saved. Testing the saved connection records the result on it: a failure sets
  the connection to ERROR with the reason, a pass sets it back to CONNECTED. Sends that are refused while in ERROR
  now say "SampBidx cannot be used right now: <reason>" (earlier: "needs a new API key", which was wrong for
  failures other than a refused key); the Integrations card says "Connection problem" unless the key was refused.
- **Deals in SampBidx**: a new transfer kind `DEAL`, sent with `PUT /v1/deals/{dealId}` after the deal's company is
  a SampBidx client. It carries the deal's number, name, amount and currency, status, pipeline, stage, dates, owner
  and manager, the client and the deal's contact. Client sends now also carry `relationship` (won date and won deal)
  for won companies. Contract: `docs/integrations/sampbidx-api.md`.
- **Bulk sends** (`sampbidx_batches`): `POST /apps/sampbidx/batches/preview` checks each chosen deal or won company
  and answers READY, NEEDS_FIX (with the exact fields: contact email, country, time zone, deal amount) or SKIP with
  the reason (no company, not won, not visible, already in SampBidx and unchanged, being sent now). `POST
  /apps/sampbidx/batches` saves the typed corrections to the records (audited, `via: sampbidx_bulk`), then sends in
  the background one record at a time through the same transfers as single sends; items still missing details are
  skipped as "Needs correction". A deal sends its client first when SampBidx lacks it or it changed; if the client is
  refused the deal is not sent. Won companies go with the won deal's contact and the RFQ contributors who have
  complete details (others are left out with a warning). Up to 200 records, or every visible won company.
- **Idempotency**: each transfer id is its `Idempotency-Key`, and each record's SampForce id its `externalId`, so a
  second send updates the same SampBidx record. Retrying a batch resends the failed transfer itself with the same key.
  A batch whose runner stopped (restart) resumes when it is read after two minutes without progress.
- **Progress and results**: the dialog polls the batch every 0.8 s and shows a progress bar, tiles and the summary
  line ("25 selected · 22 sent · 3 need correction"), SampBidx's reference per item, retry of failed items, and
  "Correct and send the skipped". When a batch finishes, the person who started it gets a `sampbidx.transfer_completed`
  or `sampbidx.transfer_failed` notification.
- **Access**: deals need `deals:write`, won companies `companies:write`, both `contacts:write` (corrections); the
  overview and the test need `integrations:manage`. Admins see every batch, others their own.

## Consequences

- Nothing in SampBidx changes until SampBidx builds `PUT /v1/deals` and reads `relationship`; until then deal sends
  fail with SampBidx's real answer (404) and show it, and a won company send updates the client only.
- The deals bulk bar slot from the Deals redesign (`components/deals/sampbidx-bulk-slot.tsx`) is filled in here.
- Item reasons are stored in English in the batch, like transfer errors.
