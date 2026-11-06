# ADR 0030: Prospect Lists and prospect discovery use authorised providers, with Mock Mode until keys are added

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, Part 2 (Prospect Discovery Extension and Prospect Lists)

## Context

Part 2 asks for a prospect discovery extension that finds people at companies and a Prospect Lists module to
collect, clean, verify and work them, with import from CSV and Excel, filters, move and copy, duplicate removal,
assignment, export, adding to the CRM and to sequences, and list performance. The rules are: "The extension must not
depend on unauthorized scraping or bypassing website restrictions. Use authorized provider APIs and permitted data
sources. Do not invent or fabricate contact information", "Do not hardcode API keys in … browser extension source
code", and "Until the actual API keys are configured and successful live API calls are tested, mark the integration as
Pending Configuration or Mock Mode". SampForce already had a lead capture extension (ADR 0015), an email finder that
reads a company's public website (ADR 0016), the CRM's duplicate rules and the sequence engine.

## Decisions

1. **Lists are their own records, apart from leads.** `prospect_lists` (unique name per workspace, owner, assignee)
   and `prospects` hold people who are not in the CRM yet. A prospect links to a lead or contact when one with the
   same address exists or is created from it, so the CRM is never duplicated. Six new tables, all under the same
   forced row-level security as the rest of the schema. New permissions: `prospects:read`, `prospects:write`,
   `prospects:search` (members and up), `prospects:export` and `prospects:manage` (managers and up).
2. **Providers through the API only.** Apollo.io `mixed_people/api_search` finds people by company website, title,
   country, company size or keywords; it returns no addresses, so `people/bulk_match` reveals them only when the
   person ticks "Find email addresses" (it uses credits). Hunter.io's Email Verifier checks addresses on request.
   Keys are server environment secrets (`APOLLO_API_KEY`, `HUNTER_API_KEY`); the web app and the extension never
   see them. Each provider call counts against a per-person allowance over 24 hours (`PROSPECT_DAILY_LIMIT`, default
   100, with per-person overrides set by managers); Mock Mode calls count too, so limits behave the same before a key
   is added.
3. **Mock Mode is labelled and fenced.** Without an Apollo key, search returns deterministic sample people at
   "Company (sample)" on the reserved `.example` domain (RFC 2606), flagged `sample` everywhere and shown with a
   banner. Their addresses can never reach a mailbox. Sample people are refused by "Add to CRM", left out of exports
   and therefore out of sequences, and the API re-marks anything with a `sample_` id or `.example` domain as sample
   whatever the caller sends. With a key, the status reads Pending Configuration until the first successful call,
   then Connected. A refused key is a 502 `PROVIDER_ERROR` and does not count as live.
4. **Nothing is guessed.** A person with no address at Apollo is saved without one, never with a pattern guess, and
   is not offered to the CRM from the extension. Email statuses reuse the CRM's set; Apollo "verified" becomes valid,
   "unverified" or "extrapolated" becomes needs verification, and anything else unknown. Verification only comes from
   Hunter; without its key the Verify action is Pending Configuration.
5. **Reuse the existing engines.** Adding to the CRM goes through `LeadsService` (duplicate rules, audit, workflows)
   and enrolment through `SequencesService` (running sequence, connected mailbox, do-not-email list), so outreach
   results per list come from the sequence engine's own events. Opens are shown as estimates, as elsewhere.
6. **Import and export.** CSV and `.xlsx` files up to 5 MB and 5,000 rows are read on the server (exceljs), with a
   suggested column mapping the person can change; rows without a valid email, or without a name and company, are
   reported by row number. Export is eligible people only (not sample, has an address that is not invalid, bounced
   or on the do-not-email list), for managers, and audited with its row count.
7. **The extension discovers through the API, not the page.** "Find prospects at <domain>" sends only the domain and
   optional job titles; the API asks Apollo (or Mock Mode). The extension does not scrape people from the page or
   from social networks for this. Chosen people (up to 25) go to an existing list, a new list (reused when the name
   already exists), or the CRM as leads tagged `prospect-discovery`, optionally into a running sequence. The
   extension's token scope gains `prospects:read`, `prospects:write` and `prospects:search`; the person's role still
   decides each.
8. **Password sign-in from the extension.** `POST /extension/login` (and `/extension/login/mfa`) run the same
   password check, lockout and second factor as the web app, set no cookie and return an extension connection
   (the same `dfx_` session kind, visible and revocable under Integrations, audited `auth.login` with
   `client: extension` and `extension.connected` with `via: password`). Workspaces that enforce single sign-on get
   `SSO_REQUIRED` and keep using a connection code made after an SSO sign-in. The password is never stored by the
   extension.

## Consequences

- Apollo and Hunter are tested only against local stand-ins that follow their published documentation. Until a real
  key is added and a live call succeeds, the app shows Mock Mode or Pending Configuration, and the completion report
  lists both as keys still needed.
- An hourly worker sweep removes import files older than a day.
- The privacy page and the store listing describe the new data flows (domain and titles to the workspace, Apollo
  behind it; the password sent once to the workspace).
