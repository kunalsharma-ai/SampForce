# ADR 0060: Company-centric sales CRM

- Status: Accepted (foundations, PR 2a; lead form, branches, employees and ownership, PR 2b); later phases extend it
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

## Phase 2b: the lead form, branches, employees and ownership

- **"+ Create new lead"** (`/app/companies/new`) replaces the quick company dialog on the Companies page. Eight steps
  (company, location, business details and branches, employees, ownership, status, remarks and attachments, review)
  post once to `POST /company-leads`, which creates the company, its branches and employees in one transaction, so a
  bad employee leaves nothing behind (errors name `employees.N.field`). Attachments upload after the save; if one
  fails, the company page says which.
- **Drafts** (`lead_drafts`) keep the form as typed, per person, with the step; nobody else can read them. Saving the
  lead deletes its draft. Files are not kept in drafts.
- **Ownership.** `Company.pocUserId` is the internal point of contact, kept apart from the creator and the owner.
  The assigned manager defaults to the owner's reporting manager and follows the owner when it changes, unless the
  change names one. Who may be made owner follows record scope: ALL anyone, TEAM themselves and their reporting tree,
  OWN only themselves (a rep moving a lead elsewhere is the transfer request of Phase 4). Every owner change, the
  first assignment included, is a `lead_owner_changes` row (from, to, by, reason, note), and the new owner gets a
  notification. `POST /companies/:id/owner` takes a reason from the transfer reasons of section 16.
- **Branches** (`/companies/:id/branches`) and **files** (`company_files`, same types and 10 MB limit as portal
  documents but never shown in the portal) follow the company's visibility; roles without details see branch names
  and places only, and no files.
- **Employee relationship** (`GET /contacts/:id/stats`): emails sent (logged email activities plus synced sent
  mail), responses (synced received mail), calls, meetings, open tasks, last interaction, latest activity and the
  next follow-up (the earlier of the follow-up date and the next open task).
- Location pickers suggest states and cities from the dataset and always accept typed places; the GeoNames and
  OpenStreetMap credit is shown under them.

## Phase 3: the company dashboard, interactions, follow-ups and RFQs

- **The company page is a dashboard** (`GET /companies/:id/dashboard`): a profile header with quick actions (edit,
  add employee, branch, follow-up, log interaction, schedule call, add RFQ, upload, change status, transfer, send
  email), twelve performance tiles, a business overview (opportunities, RFQs, quoted and won value per currency, the
  latest update and the next action) and an employee directory (`GET /companies/:id/employees`). Every number is
  counted from stored records; nothing is typed in. Business generated is won deals plus won RFQs that never became
  a deal, so a converted RFQ is not counted twice.
- **There is no "recent history".** The Command Center activity widget is removed and saved layouts that still list
  it are cleaned when read. Interactions are their own log instead.
- **Interactions** are activities with an `interaction` kind (11 kinds), sender, recipient, outcome and next action.
  The log merges hand-logged items with mail synced from a connected mailbox, each badged by source. A logged
  interaction with a follow-up date also creates a follow-up for the company owner.
- **Follow-ups** are tasks with a company, type, manager, summary, next action and remarks. Buckets are worked out in
  the viewer's time zone: overdue (due before now), today, upcoming (tomorrow on, or no date), completed,
  rescheduled and cancelled. Rescheduling needs a reason, counts, and appends the reason to the remarks. Team scope is
  the person, their reporting tree, and follow-ups they manage.
- **RFQs** (`rfqs`, plan feature `rfqs`, on every plan) are numbered RFQ-0001 per workspace, with LOI, IR, CPI,
  sample size and a quotation total kept as sample size times CPI unless typed. Receiving and submitting log
  activities; the owner is notified. A won RFQ converts to a deal through the normal deal service, once; lost or
  cancelled RFQs cannot. Reports group by company, employee and owner. Files can be attached to an RFQ.
- Everything above follows company visibility, and roles without record details cannot log or change work.

## Consequences

- Reps in new workspaces see fewer records than before by default; tests that check permissions rather than
  visibility set the member role to ALL.
- Deal lists are not yet scoped by visibility; that comes with deal and revenue work in Phase 4.
- Companies created outside the paths above (browser extension, prospect lists, seed data) get their number the next
  time numbers are assigned in that workspace; making every path number at once is follow-up work.
