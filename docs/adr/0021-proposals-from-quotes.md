# ADR 0021: Proposals are quotes with sections, branding and an online link

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 2d (feature 9)

## Context

Feature 9 asks for proposal templates, AI-assisted content, branding, an online proposal, sending by email and
knowing when it was opened. DealFlow already has quotes with price books, discount approval, versions, a PDF and
contracts from accepted quotes. A separate proposal object would duplicate prices and approvals and let the two
drift apart.

## Decisions

1. **A proposal is a quote.** `quotes.sections` (a JSON array of heading and body, at most 20) holds the narrative
   shown above the price table. Prices, discounts, approval, versions and acceptance stay exactly as they were.
   Revising a quote copies its sections to the new version.
2. **Templates and AI only fill the editor.** Three starting templates ship in `PROPOSAL_TEMPLATES`. "Draft sections
   with AI" reuses the existing `proposal_draft` agent (`POST /ai/deals/:id/proposal`), shows what it was based on
   and its open questions, and changes the editor only when the person chooses "Use these sections". Nothing is
   saved until the draft is saved, and the AI cannot change prices.
3. **Branding is workspace-wide.** A PNG or JPEG logo (stored as a data URL, at most about 250 KB), a header line
   and a footer live on `commercial_settings`. They print on the online page and the PDF, which is called a
   "Proposal" when it has sections. The audit log records "(image)" in place of the logo bytes.
4. **The online link is signed and switchable.** The link is `/p/<token>`, signed with the tracking secret under
   its own purpose (`dealflow-proposal-v1`), so an email-tracking token cannot open a proposal. It works only
   while sharing is on for that version and the quote is approved, sent, accepted or declined. An older version
   says it has been replaced. Turning sharing off makes the link return 404.
5. **Sending reuses the mailbox send path.** `POST /quotes/:id/send` sends from the person's connected mailbox
   through the same communication service as every other email (permissions, do-not-email list, activity log),
   adds the link under the message, turns sharing on, marks an approved quote as sent and audits `quote.emailed`.
   Only the latest, unexpired, approved or sent version can be sent.
6. **Opens are estimates.** Each public load counts a view (first, last, count). The creator is notified on the
   first one. The screen and the notification both say that email security scanners can open links, so a view is
   likely, not confirmed. The rep's own preview (`?preview=1`) and the PDF download are not counted.

## Not built

- Customer e-signature or "accept online". The page tells the customer to reply to the email; the rep records
  the decision, which keeps contract creation where it is.
- Per-template branding or multiple brands per workspace.
