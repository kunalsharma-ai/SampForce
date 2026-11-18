# ADR 0066: Smart import, and companies with their contacts in one place

- Status: Accepted
- Date: 2026-11-17

## Context

Kunal's team keeps prospects in spreadsheets where each row is a company and one of its employees: `COMPANY NAME`,
`WESBSITE`, `COMPANY LINKEDIN ID`, `EMPLOYEE NAME`, `EMPLOYEE DESGNATION`, `EMPLOYEE EMAIL ID`, plus columns such
as `DATE`, `NO OF BRANCHES & ADDRESS` and `COUNTRY & WORKING HOURS`. Settings → Import could not take such a file:
it matched headings only by exact name or a short alias list, so every column showed "Don't import" and the import
stopped with "Map a column to fullName". It read CSV only, imported one record type per file, and had no way to keep
columns SampForce has no field for.

He also asked to "put company and contact in one", so a company's people can be added and changed where the company
is, and while the company is being created.

## Decision

### Import

- **Headings are matched, not looked up.** `packages/types/src/import-mapping.ts` compares a heading with each field's
  key, label and synonyms after removing case, punctuation and spacing (`E-mail ID` = `email id`), and forgives small
  typos by edit distance (none for names of 4 letters or fewer, 1 up to 9, 2 above). Each field takes one column; the
  closest match wins. The wizard and the API use the same code, so `autoMap: true` on `POST /imports` maps a file
  exactly as the screen does.
- **Columns nothing matches become custom fields** (the ADR 0062 system) when the person may configure the CRM
  (`crm:configure`). The new field is TEXT (NUMBER when every value is a plain number), labelled from the heading
  ("COUNTRY & WORKING HOURS" → "Country & Working Hours"), keyed from it (`country_and_working_hours`, never a key a
  deleted field used), shown in forms and searchable. A dry run reports the fields it would add and checks the rows
  against them without creating anything; the real run creates them in the same transaction as the records. People
  without `crm:configure` can import into existing fields only; asking for a new field is refused (403).
- **A new import type, "Companies with their employees"** (`companies_contacts`): each row is a company and,
  optionally, one employee. Targets are `company.<field>`, `contact.<field>` and `company|contact.customFields.<key>`.
  A bare shared heading ("Country", "LinkedIn") goes to the company; prefixed ones ("Employee country") to their record.
  Rows with the same company name (legal suffixes ignored) are one company. Existing companies the importer can see
  are reused when the name or website matches; their empty fields and empty custom fields are filled, nothing they
  hold is changed. Employees are skipped (or not) by the usual duplicate setting, matched on email, phone or LinkedIn.
  An employee with an email but no name is named from the address.
- **New companies are made like the lead form makes them:** lead number, default status, owner = importer, the
  owner's reporting manager, a first ownership-history entry, duplicate keys and website/LinkedIn lists. The single
  "Companies" and "Contacts" imports now do the same (before, imported companies had no duplicate keys).
- **Country names are accepted** ("India", "United States of America (USA)", "UK") and stored as ISO codes; a name
  that is no country is a row error.
- **Excel**: `POST /imports/file` takes an .xlsx body (2 MB), checks it with the zip-bomb guard, and returns the first
  sheet with data as CSV (dates as YYYY-MM-DD, formulas as their values, rich text as text). The import then runs on
  that CSV, so both formats behave the same. Old .xls is not read.
- Row numbers in errors are the spreadsheet's line numbers, blank lines included. Blank rows are skipped.
- The imports route takes a 4 MB JSON body (the 2 MB CSV limit did not fit the 1 MB default).

### Companies and contacts in one place

- Companies and Contacts stay separate records and pages; they are shown as two tabs of one place.
- The companies list's Contacts count opens the company's employees in place: add a new one, add an existing contact,
  edit one, or take one off the company (the contact stays under Contacts; nothing is deleted).
- The company page's employee list has the same controls.
- "New company" (Quick create) has an Employees section; the company and its employees are saved together through
  `POST /company-leads` (all or nothing). The step-by-step lead form keeps its Employees step.

## Consequences

- Imports can add custom fields; the audit log records each (`custom_field.created`, `source: import`) and the import
  entry lists them.
- A company of the same name is never duplicated by the combined import. Two different companies with the same name
  in one workspace would be merged by it; the dry run shows how many companies were matched.
- New text is translated into Spanish, French, German and Arabic; the translations are machine-quality and need the
  same native review as the rest.
