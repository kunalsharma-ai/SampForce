# ADR 0079: Company export to Excel and CSV

- Status: Accepted
- Date: 2026-11-26

## Context

Kunal asked (2026-11-26) for an export option, as Excel and CSV, for all companies and for a single company, that
carries every detail the CRM holds: the Business Information fields auto-fill fills (ADR 0076), every website, email,
phone and social profile URL, remarks, custom fields, and the company's employees. No AI may be involved.

The old `GET /exports/companies` wrote twenty columns (name, domain, industry, country, primary email and phone and a
few more) and ignored the list filters.

## Decision

- **One export, built from the stored record.** `CompanyExportService` reads companies through
  `CompaniesService.rowsForExport`, which uses the list's own filter (`listWhere`) and the same `toRow` the company
  page uses. So the export follows the list on screen (search, owner, status, Accounts view, country, industry,
  custom field filters, sort) and record visibility, and details hidden from the reader (ADR 0060) stay blank exactly
  as on screen. A field added to `CompanyRow` later only needs a column in `companySheet`.
- **Parts.** Companies, Employees (contacts of those companies), Branches and Interactions (logged on the company or
  its employees). Excel: one workbook with a sheet per part. CSV: one file per part (`part=companies|employees|
  branches|interactions`), since a CSV holds one table.
- **Columns.** Human-readable headings, multi-value fields joined with `; ` (primary first, labels in brackets).
  Fixed columns for every Business Information field; LinkedIn, X, Facebook, Instagram and YouTube always, other
  platforms only when a company has one, plus "All social profiles". Each "more details" label (slogan, VAT number,
  DUNS, LEI, ticker…) becomes its own column. Custom fields the reader may see, by label. "Where details came from"
  summarises `fieldSources`. The stored AI summary is included but labelled "(generated)"; nothing is generated.
- **Routes.** `GET /exports/companies?format=xlsx|csv&part=…&<list filters>` (the existing route, now the full
  export) and `GET /companies/:id/export?format=…&part=…` for one company (404 when not visible). Both need
  `data:export` and `companies:read` and the workspace `export` action, and are audited as `data.exported`.
- **Rights.** The role export policy (ADR 0062) applies: companies must be allowed in the format; Employees also need
  `contacts:read` and contacts allowed; Interactions need `activities:read` and the `interactions` plan feature. A CSV
  part that is not allowed is refused (403); Excel leaves that sheet out. "Without contact details" blanks emails,
  phones, LinkedIn and social profile links (company, branch and employee). Excel needs `excel_export`.
- **Safety.** CSV starts with a byte order mark (Excel reads it as UTF-8, so Arabic and accented names survive) and
  neutralises values that start with `= + - @` (formula injection). Excel cells are typed text cells, so they are
  never formulas and phone numbers keep their leading `+`. Web addresses become links. At most 50,000 rows per part.

## Consequences

- CSV headings of the companies export changed from field keys (`primaryEmail`, `customFields.markets`) to labels
  ("Primary email", "markets"). The smart import (ADR 0066) matches headings by meaning, so an exported file can be
  imported again.
- Column headings are English in every reader language for now.
