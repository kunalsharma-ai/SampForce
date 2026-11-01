# ADR 0045: Quick Bid Studio and bid templates

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (Part 6 Quick Bid Studio and template gallery)

## Context

The spec asks for a fast way to build a bid (client, template and products, pricing, preview and send) with a live
preview, inline validation and autosave, and a gallery of ten professional templates (corporate executive, minimal
premium, modern blue, dark luxury, global enterprise, technology, market research, consulting, healthcare research,
financial services) that can be customised. Quotes already had priced lines from price books, discount approvals,
versions, proposal sections, an online link with view tracking, email sending and a PDF. They had no visual look:
the online proposal used the workspace brand colour and the PDF was plain.

## Decisions

1. **A template is a look plus starting sections, defined in code.** `BID_TEMPLATES` in `@dealflow/types` holds ten
   templates, each with an accent colour, a heading typeface (sans or serif) and a cover style (colour band, dark
   band, side rule or a quiet rule under the title), and the sections a buyer of that kind expects. Keeping them in
   code means the API validates keys with the same list the web uses and the PDF can draw each cover. Custom
   templates per workspace are a follow-up.
2. **The look is stored on the quote.** Migration `20261101020000_quote_bid_style` adds `quotes.template_key` and
   `quotes.accent_color` (checked as `#rrggbb`). Both are part of the quote input, editable while the quote is a
   draft, copied on revision, and resolved by `bidStyle()` into `{templateKey, accent, font, cover}`: the accent
   override wins, then the template accent, then the workspace brand colour.
3. **One renderer for preview and customer view.** The public proposal carries `style`, and the same
   `ProposalDocument` component renders the online proposal, the client portal, the gallery preview and the studio's
   live preview. The studio builds its preview from local state with the shared `quoteTotals` maths, so it matches
   what the server stores. The PDF draws the same cover and uses Times for serif templates.
4. **Accent colours never carry text on white.** Accents colour bands, rules and borders. Text on a band uses white
   or near-black, whichever contrasts better (`textOn`); headings and body text keep the theme colours. Every
   template accent is tested to give at least 3:1 with its band text.
5. **The studio is four steps over a real quote.** Step 1 chooses the deal, the price book (suggested from the deal's
   currency, fixed once created) and a title. Until then the draft is kept in this device's storage and offered back
   on return. Continuing creates a draft quote, and from then on every valid change is saved with a debounced PATCH
   (saves run one after another, so an older save never lands last). Steps 2 and 3 edit the template, accent,
   sections, items, quantities, discounts, tax, validity and terms with inline validation; a draft with no items can
   still be saved. Step 4 finalises (or submits for approval when a discount is above the workspace limit), downloads
   the PDF, and reuses the existing sharing and email controls. The URL carries `?quote=` so a bid can be reopened.
6. **Gallery to studio by link.** The gallery shows every template with an example preview, labelled as example
   content, and an accent picker. "Use template" opens the studio with `?template=` and `?accent=`.

## Not in this change

Workspace-defined templates, uploaded fonts, and per-template layouts for the price table.
