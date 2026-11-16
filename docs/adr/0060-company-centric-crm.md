# ADR 0060: Company-centric sales CRM

- Status: Accepted (foundations, PR 2a); later phases extend it
- Date: 2026-11-16

## Context

Kunal asked for SampForce to become a company-centric sales CRM: a lead is a company, not a person. Each company
lead has a sequential number (FRFS01, FRFS02 …), a configurable coloured status, the person who created it, the
person who owns it now and their manager, and a list of employees (points of contact) with their own statuses.
Sales people should see their own leads, managers their team's, and senior people everything, and an administrator
should decide whether someone may see the details (emails, phones, notes) of leads they can see but do not own.

The existing model was person-centric: `Lead` is a person who becomes a `Contact` on conversion, and `Company`
held only a name, domain, industry and country. Nothing could be lost: existing workspaces keep every record and
every screen.

## Decision

- **Company is the lead.** `Company` gains the lead number, status, creator, last editor, manager, department and
  team, the full profile (website, LinkedIn, primary email and phone, overview, size, type, founded year,
  headquarters, specialties, business category, address, time zone, notes) and lists of emails, phones, websites,
  LinkedIn pages and addresses with one primary each. `Contact` is the employee or point of contact and gains a
  status, department, LinkedIn, location, remarks, next follow-up date and lists of emails and phones. The old
  person `Lead` stays, shown as inbound leads (web forms, the extension, imports); converting one now fills the
  company's new fields and gives it a number.
- **Lead numbers** come from the workspace counter `seq:lead:<tenant>` (atomic, so concurrent creates never clash)
  and are written as prefix + zero-padded sequence (`leadSeq` and `leadNumber`, unique per workspace). The prefix
  defaults to the workspace initials ("Frequent Research Fieldwork Solutions" gives FRFS) and is editable in
  Settings → CRM configuration, with minimum digits. A change applies to new leads only, or rewrites every existing
  number from its stored sequence, so the order never changes. A number in API input is ignored. Every path that
  creates companies (the companies API, lead conversion, CSV import) numbers them in the same transaction; companies
  created before the upgrade are numbered oldest first.
- **Statuses** are rows in `crm_statuses` per workspace and kind (COMPANY or EMPLOYEE): name, colour, description,
  position, one default, and a meaning (NEW, ACTIVE, CLIENT, CONCERN, ON_HOLD, LOST) that dashboards and reports use
  whatever the status is called. New workspaces get the 15 company and 16 employee statuses from the specification.
  A status in use cannot be deleted, only deactivated (records keep it; it can no longer be picked). Each change of
  status records who and when, and is audited.
- **Organisation.** `departments` and `designations` are workspace lists. A designation has a tier (EXECUTIVE,
  MANAGER, SENIOR) that picks the Command Center a person sees; permissions still come from roles. A membership has
  a designation, department and reporting manager; loops are refused.
- **Record visibility per role.** `Role.recordScope` is OWN (records they own, created or manage, plus unassigned
  ones), TEAM (the same for everyone reporting to them, directly or further down) or ALL; `viewOthersDetails` says
  whether they see emails, phones, links, notes and custom fields of visible records someone else owns. It applies
  to lists, record pages, search, exports and duplicate checks (which look across the workspace but only return
  names, with a `visible` flag). Changing a restricted record is refused, except its status. The owner role is always
  ALL with details. New workspaces start with member OWN and manager TEAM; **existing workspaces keep ALL with details
  for every role**, so an upgrade never hides records from anyone, and an administrator narrows it on the Team page.
- **Duplicate checks** use normalised keys stored on the record: `nameKey` (accents, punctuation and legal suffixes
  removed) and `matchKeys` (domain, email, phone's last ten digits, LinkedIn path). Free-mail domains never count as
  a company domain.
- **Countries, regions and cities** ship with the API (`apps/api/assets/geo`, built by `scripts/geo`): 248 countries
  with dialling code, currency and IANA time zones in `@dealflow/types`, and states and cities served by
  `GET /geo/countries/:code/regions` and `/cities`. Places not in the list can always be typed. Flags are SVGs from
  flag-icons. Sources and licences are in `scripts/geo/README.md`.
- **Super admin control.** The core company CRM is on every plan. Each module added in later phases (RFQs, revenue
  attribution, lead transfers, manager and senior dashboards, instructions, client concerns, advanced custom fields,
  Excel export, internal chat) gets a plan feature key (ADR 0057), so the operator console controls it per plan and
  per workspace.
- **Upgrade** runs once per workspace from `db:setup` (marker counter `upgrade:company-crm-1:<tenant>`): it creates the
  default statuses, designations and departments, adds the new `crm:configure` permission to the owner and admin
  roles, gives companies a status (Existing Client when they have a won deal, otherwise New Lead), a creator (from the
  audit log, else the owner) and duplicate keys, gives contacts a status and their email and phone as list entries,
  and numbers the companies.

## Consequences

- Reps in new workspaces see fewer records than before by default; tests that check permissions rather than
  visibility set the member role to ALL.
- Deal lists are not yet scoped by visibility; that comes with deal and revenue work in Phase 4.
- Companies created outside the paths above (browser extension, prospect lists, seed data) get their number the next
  time numbers are assigned in that workspace; making every path number at once is follow-up work.
