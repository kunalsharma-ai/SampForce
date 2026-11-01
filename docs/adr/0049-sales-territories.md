# ADR 0049: Sales territories and the territory view

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec follow-ups (territory view, deferred from ADR 0044)

## Context

The spec's pipeline views include a territory view. ADR 0044 deferred it because DealFlow had no territory model.
Companies already store an ISO 3166-1 country, and deals link to a company, so a territory can be defined by the
countries it covers without asking anyone to tag deals by hand.

## Decisions

1. **A territory is a named set of countries.** `territories` (name unique per workspace regardless of case, optional
   description and manager) and `territory_countries` (one row per country). A unique index on
   `(tenant_id, country)` keeps each country in one territory; the API checks first so the error names the country
   and the territory that holds it (`409 COUNTRY_TAKEN`). Both tables have tenant-isolation RLS.
2. **Deals are placed, not tagged.** A deal belongs to the territory holding its company's country, resolved when the
   view is read. Changing a company's country or a territory's countries re-sorts deals immediately, and nothing on
   the deal can drift out of date. There is no per-deal override.
3. **Deals no territory covers are shown, with the reason.** The view lists them under "Not in a territory" and says
   how many have no company, how many have a company with no country, and which countries no territory covers.
4. **Honest totals.** Open value and weighted value (amount times effective probability) add up deals in the workspace
   currency only; deals in other currencies are counted and the card says so. Won and lost counts cover the current
   calendar quarter (UTC); won value is in the workspace currency.
5. **Who can do what.** Anyone with `deals:read` sees territories and the view (`GET /deals/territories`, with the same
   pipeline and owner filters as the other views; `GET /territories`). Only `tenant:manage` (owners and
   administrators) creates, edits or deletes territories. Every change is audited (`territory.created`, `.updated`
   with changed fields, `.deleted`).
6. **Where it lives.** The view is the "Territory" option on Deals (`?view=territory`), next to Forecast and Priority.
   Territories are managed at Settings → Territories, with a searchable country picker whose names follow the reader's
   language.
7. **Two picker fixes found by the browser test.** The shared searchable pickers closed their list a moment after
   the user tabbed away and straight back (the pending close from the blur was never cancelled); focusing again now
   cancels it. And Escape in an open picker inside a dialog closed the whole dialog, because the dialog hears Escape
   first; the dialog now leaves Escape to an open picker, which closes only its list.

## Not in this change

Territory-based lead routing and assignment rules, territories by region or postcode below country level, quota per
territory, and per-territory access control (a territory does not limit who can see a deal).
