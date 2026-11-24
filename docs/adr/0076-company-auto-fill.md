# ADR 0076: Company auto-fill from public sources

- Status: Accepted
- Date: 2026-11-24

## Context

Kunal asked (2026-11-24) for a system where a person enters only a company's basic details and SampForce completes
the rest: description, services, products, industry, offices and headquarters, general email and phone, social
profiles, founded year, head count, founders and CEO, parent company, certifications. The spec's data rules
(section 23) say: never invent data, use public and legal sources only, prefer official sources, leave or mark what
cannot be verified, never overwrite manually entered information, keep the source of each value, and keep all of it
in Business Information as structured fields, not as custom fields.

## Decision

- **Sources, in order of trust.** The company's own website (home page, then up to three About, Contact and Offices
  pages it links to): schema.org JSON-LD `Organization` data first, then links (`mailto:`, `tel:`, social profiles),
  then page text read by pattern (labelled phones, `<address>` blocks, "founded in", "450 employees", ISO and similar
  certifications, service and industry lists). Then Wikidata, matched by the website (`P856`) or, without a website,
  only when exactly one non-person item has that exact name and a website. No paid registry, no LinkedIn scraping
  (a LinkedIn company URL the site links to is kept), no search engine. An AI source is reserved (`AI`) for the AI
  summary and is not used yet.
- **Only empty fields are filled.** Scalars are written only while empty; list fields (emails, phones, services,
  social links...) only gain new items. The headquarters address (street, city, state, postal code) is taken from
  one source as a block and only when all of it is empty. The time zone is filled only when the country has a single
  zone. A personal mailbox on the site is skipped; role mailboxes (info@, sales@) on the company's own domain are kept.
- **Every value says where it came from.** `Company.fieldSources` holds, per field: source, URL, time, confidence
  (`high` structured data or exact match, `medium` read from text, `low` weak signal such as a country from the
  ccTLD, `uncertain` when sources disagree; the other values are kept as alternatives), the run, the list items it
  added and the items someone rejected. A field someone edits becomes `USER` and is never filled again; a list item
  someone removes is never added again.
- **Undo.** `POST /companies/:id/enrichment/:runId/undo` with optional `fields` clears what a run wrote, as long as
  the field still holds that value, and remembers it as rejected. The panel offers Undo per field and Undo all.
- **When it runs.** On create, on import (runs spaced 3 s apart), when the website changes, and from the Enrich
  button (`POST /companies/:id/enrich`, 202; refused while a run is waiting, and within a minute of the last one).
  The worker claims runs with a 5-minute lease, 4 at a time, 45 s per run, 8 s and 1.5 MB per page. An unreachable
  site is retried after 10 minutes and 6 hours, then the run is `FAILED` with the reason. A newly found website
  queues the logo look-up (ADR 0070).
- **Safety.** All requests go through `publicFetch` (public addresses only, every redirect re-checked), the same
  protections as ADR 0070, shared through `site-fetch.ts`. The user agent names SampForce and what it reads.
- **Plan and switches.** It is the plan feature `company_enrichment` (catalogue version 3, on from Free). Operators
  can switch the Wikidata look-up off in the console card "Company auto-fill" (`COMPANY_AUTOFILL_WIKIDATA`); unset
  means on.

## Consequences

- Real company sites can differ from the made-up sites in tests (`apps/api/test/fixtures/company-sites.ts`), so the
  readers need a live check on the server before relying on them. Sites that render only with JavaScript give little.
- Business Information editing, the redesigned header and social icons, the review step in Create Company and the
  AI summary build on `fieldSources` in later changes.
