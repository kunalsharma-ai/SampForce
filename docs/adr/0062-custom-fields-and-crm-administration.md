# ADR 0062: Custom fields and CRM administration

- Status: Accepted (Phase 7 of the company-centric CRM, ADR 0060)
- Date: 2026-11-16

## Context

The company-centric CRM master spec (sections 14, 20 and 23) asks for Settings → CRM Configuration to hold
everything an administrator tunes without a developer: custom fields on companies, employees, lead forms,
follow-ups, RFQs and deals; the RFQ, deal and follow-up statuses; revenue attribution rules; notification and
reminder settings; currency; who may export; and which dashboard widgets each designation level gets.

SampForce already had a small custom field feature (text, number, date, select, checkbox on leads, contacts,
companies and deals; admins only; values in each record's `customFields` JSON). It had no descriptions, defaults,
per-designation rights, ordering, files, or use in filters, reports and exports.

## Decision

### Custom fields

- **14 types**: `TEXT`, `TEXTAREA`, `NUMBER`, `CURRENCY`, `DATE`, `DATETIME`, `SELECT`, `MULTISELECT`, `CHECKBOX`,
  `BOOLEAN` (yes/no), `URL`, `EMAIL`, `PHONE`, `FILE`. The existing `CustomField` model gains a description,
  default value, currency (for `CURRENCY`), `viewDesignationIds` / `editDesignationIds`, `showInForms`,
  `searchable` and `active`. Values stay in each record's `customFields` JSON, so no data moves.
- **Entities**: companies, employees (contacts), leads, deals, follow-ups and RFQs. The new lead wizard shows company
  fields marked "show on forms".
- **Access**: an empty designation list means everyone who can see (or change) the record. Administrators, and
  system readers with no membership (workers, workflows), see every field. Hidden fields are removed from API
  responses, search, filters, reports and exports; a read-only field is kept as stored when an update leaves it out,
  and refused if it is sent changed.
- **Validation** is on the server for every type (`CustomFieldsService.validateFor`), with error paths like
  `customFields.<key>` that the forms map back to the input.
- **Files** go to `CustomFieldFile` (bytes in MongoDB like company files, 10 MB, the portal document types). An
  upload is unclaimed until the record saves; downloads check that the person may see the record and the field.
- **Order and switch-off**: `position` orders fields in forms and on records; a switched-off field is hidden
  everywhere but keeps its values. A key is fixed once created; a type cannot change once records may hold values.
- **Filters**: lists take `cf=` (JSON `[{key, op, value}]`, at most 10) with ops chosen per type
  (`filterOpsFor`). **Search** looks through text-like fields marked searchable. **Reports** expose visible fields as
  `cf.<key>` columns for group by, sums and filters. **Exports** add a column per visible field, as CSV or Excel.

### Conditional and formula fields

- **Conditions**: any field may have `showWhen`, a test on another field of the same record type, in the same
  `{key, op, value}` shape as list filters (`is`, `is not`, `is one of`, `has a value`, `is empty`, at least, at most).
  A field whose test fails is hidden on forms and record pages, is not required, and its value is cleared when the
  record is saved. A condition on a hidden field fails too, so chains hide everything below the first failing test.
  Loops are refused when the field is saved.
- **Formulas**: a new `FORMULA` type holds `formula` (numbers, `{field_key}`, `+ - * /` and brackets, at most 500
  characters), `decimals` (0 to 6, default 2) and an optional currency for display. It may use number, currency and
  other formula fields of the same record type; a formula that would use itself is refused. The result is empty when
  a field it uses is empty or hidden, or when it divides by zero. Nobody types a formula value.
- **One implementation**: parsing, evaluation and condition tests live in `packages/types`
  (`custom-field-logic.ts`), so forms calculate and show or hide as people type, and the server applies exactly the
  same rules when it stores a record.
- **Stored results**: the server stores each formula's result in the record's `customFields`, so list filters,
  reports (sums and averages) and exports work on them like on a number field. Changing a formula or a condition
  recalculates every record of that type. Reads leave out the values of fields whose condition fails.
- A field used by another field's condition or formula cannot be deleted until that field is changed
  (`FIELD_IN_USE`). Conditions and formulas are part of `custom_fields_advanced`.

### Statuses and categories

RFQ statuses, deal statuses and follow-up categories are `CrmOption` rows over built-in values
(`BUILT_IN_OPTIONS`): an administrator renames, recolours, reorders, describes and hides them. RFQ and deal
statuses keep their fixed values because the pipeline and revenue logic depend on them; follow-up categories can be
added (`C_<NAME>`) and deleted while unused.

### Workspace settings (`CrmSettings`, one per workspace)

- **Notifications**: which notification categories are sent at all, and reminder timing (before a follow-up is
  due, before an RFQ deadline, overdue alerts and whether the manager is told). Billing, security and failure alerts
  are always sent.
- **Currency**: base currency, the currencies people may pick, and dated exchange rates (existing `ExchangeRate`).
- **Export permissions**: per designation, which record types may be exported. Exporting also needs `data:export`.
- **Dashboard policies**: per designation tier, the widgets allowed, a default layout, and whether people may
  rearrange their own. `GET /me/dashboard-layout` returns the layout with disallowed widgets removed and the
  policy that applies; saving is refused when the tier is locked. The widget list is generic so the role dashboards
  (ADR 0063) can add widgets without changing this screen.
- **Attribution rule**: the attribution model and the percentage split between lead creator, closer, account owner
  and supporters (`attributionRuleSchema`), used by the revenue records of ADR 0063.

### Plans and permissions

Two plan features (ADR 0057): `custom_fields_advanced` (from Growth: the newer types, fields on follow-ups and RFQs,
designation rules) and `excel_export` (from Launch). Fields and options need `crm:configure`; workspace settings
need `tenant:manage`.

## Consequences

- Existing custom fields keep working unchanged; the old `/app/settings/custom-fields` page redirects to the new
  section.
- Field labels and option labels are workspace data and are not translated; everything around them is, in all five
  languages.
- Custom field filters on lists run as a separate MongoDB query for matching ids, capped at 10,000 matches.
- Formulas are arithmetic only (no functions, dates or text) and use fields of the same record; anything wider
  belongs in reports.
