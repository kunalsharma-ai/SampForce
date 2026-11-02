# ADR 0048: Translating pages with phrase tables

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec follow-ups (translating the remaining pages, batch 1)
- Builds on: ADR 0047

## Context

ADR 0047 translated the shell and the language settings with dotted keys (`nav.favourites`). The pages hold far more
text (about 36,000 lines across 250 page and component files), much of it already covered by English end-to-end
tests. Dotted keys for every sentence would mean inventing thousands of names and reading two files to understand one
line. Some text also reaches the pages as data: KPI names and onboarding steps from the dashboard API, deal health
signals, status enums, shared label constants in `@dealflow/types`, and column headers defined outside components.

## Decisions

1. **Phrases are keyed by their English text (gettext style).** `t('Owner')`, `t('Page {page} of {pages}', {...})`.
   The English wording is the key, so English output is unchanged and the existing English tests keep passing.
   `MessageKey` is now `ShellKey | PhraseKey`, so the type checker rejects any `t('...')` whose phrase is missing.
2. **Tables sit side by side.** `lib/i18n/phrases/<area>.ts` maps each English phrase to
   `[es, fr, de, ar]`, so a reviewer reads one phrase in all four languages on one line. Areas: `dashboard`,
   `table`, `crm`, `deals`. `translate.ts` builds each language's catalogue from the shell catalogue plus its column.
3. **Data-borne text uses `t.maybe()` / `<Tr>`.** It translates when the phrase exists and otherwise shows the text as
   it came (placeholders still filled). `PageHeader`, `DetailList` labels, data table captions and column headers,
   and status badges go through it, so a page passing an English title gets it translated once the phrase exists.
   Constants defined in the web app (form field labels, column headers, tabs, view names, loss reasons) are typed
   `MessageKey` instead, so the compiler checks them.
4. **A unit test guards what the compiler cannot see.** `i18n.test.ts` checks that every phrase has four non-empty
   translations with the same placeholders, that no phrase is in two tables, and that every label arriving as data
   has a phrase: the `@dealflow/types` label maps, titled statuses and priorities, record-name sentences built from
   `ENTITY_LABEL`, and the labels the API sends, read straight from the API source (dashboard KPIs and onboarding,
   record intelligence signals, deal health risk signals) so a new API label fails the test until it is translated.
5. **Counts that need grammar use shell plurals.** `count.deals`, `count.openDealsClosing` and `count.unsavedChanges`
   have every plural form (Arabic's six), chosen by `Intl.PluralRules`.
6. **Dates in pages follow the format locale.** Forecast month columns are named in the browser from the bucket key
   rather than shown as the API's English month name; calendar weekday headers come from `Intl`.

## Scope of batch 1

Translated: the Command Center (layout controls, every widget and chart, KPI names, insights, next actions,
onboarding), the shared data table (search, sort, paging, columns, density, saved views, bulk actions), leads,
contacts, companies, accounts and deals lists, the lead, contact, company and deal record pages, the record form and
its fields, timelines and tasks, sales intelligence, the deals board, split, timeline, calendar, forecast and priority
views, the deal panel and history, and deal health.

Still English, and why:

- **Sentences written by the server**: KPI definitions, insight sentences, next-action titles and reasons, priority
  reasons with numbers ("Closes in 3 days"), health signal details, activity summaries and API error messages. These
  need the API to send a message key and values instead of a finished sentence; that is a separate change.
- **Validation messages from zod schemas** shared with the API.
- **Components owned by other modules shown on record pages** (meetings, voice notes, web visits, AI cards, quotes,
  WhatsApp and SMS): they are translated with their own modules in later batches.
- **Browser tab titles** (`metadata.title`), which are rendered on the server before the language is known.
- **Text people typed**: record names, stage names, custom field names, tags and notes are never translated.

## Scope of batch 2

Translated: the signed-out pages (sign in, two-step verification, single sign-on and its errors, sign up, password
reset, invitations and the marketing panel), the validation messages of the shared auth and custom field schemas,
Settings (workspace, appearance, the Theme Studio with its preview, readability check and theme descriptions, custom
fields, data import) and Sales Activities (tasks and the recent activity feed). New tables: `auth`, `settings`,
`activities`.

**Choosing a language before signing in.** The sign-in and sign-up pages have a language picker. It applies on the
device straight away (`chooseSignedOut` in the regional store) and is remembered as the signed-out choice. On the first
load after signing in, if the account has no language of its own (`source: 'default'`), the app saves the choice to
the account and then clears it; an account that already chose a language keeps its own. A brand-new account therefore
starts in the language its owner signed up in, on every device.

Still English in these pages: the Theme Studio's automatic adjustment notes (sentences with colour values built in
`@dealflow/types`), API error messages, and the per-row problems an import check returns from the server.

## Scope of batch 3

Translated: Email Sequences (the sequence list, the editor's steps, rules, send window, people and results tabs, the
do-not-email list, workspace variables and campaign results), email templates with the template designer (palette,
outline, block settings, look, previews and the drag-and-drop announcements), merge-field buttons and the lead
preview, and the "Write with AI" panel. New table: `sequences`; new plural key `count.inSequences`.

- **Tips from the results API are written in the app.** Each tip now carries `facts` (the numbers behind it) next to
  its English `title` and `detail`, and the page writes the sentence in the reader's language from its `kind`.
  Durations such as "5 hours" use `Intl.NumberFormat` with a unit, so each language gets its own plural.
- **Weekday names** in the send window come from `Intl.DateTimeFormat` in the format locale.
- **Labels inside sentences** ("Added a pricing table block") go through `inSentence`, which lower-cases them except
  in German, where nouns keep their capital. The translations quote the label where the grammar needs it.
- **The outline's summaries** take a translator for their fixed wording (`blockSummary(block, say)`); the text people
  typed in a block is never translated.

Still English here: the starter content of a new sequence and of a new design (it is email text people replace),
AI-written drafts, the reasons on a paused or failed enrolment, and API error messages.

## Scope of batch 4

Translated: Email & Communication (the team inbox, its filters, the conversation view with status, category, owner,
links and internal notes, message tracking, the mailbox sync log and the compose dialog), the AI reading of an email,
Meetings (the calendar list and meeting notes), the meeting notes page (notes and transcript, recording
transcription, the AI analysis and its review form, and putting it to use as tasks, a timeline summary or a follow-up
email), the transcription status banner, Zoom scheduling on records, and the AI qualification, deal health and
proposal draft panels on lead and deal records. New tables: `communication` and `meetings`; new plural keys
`count.notes`, `count.messages`, `count.emailsRead`, `count.tasks`, `count.createTasks` and
`count.tasksCreatedFromMeeting`.

- **Counts in buttons and confirmations** ("Create 2 tasks", "1 task created from this meeting.") are plural keys, so
  each language gets its own forms and the English wording stays the same.
- **Durations** ("due in 3 days", "30 minutes") use `Intl.NumberFormat` with a unit.
- **Labels from shared maps** (inbox categories, email intents and next actions, meeting platforms, meeting-note
  stages and Zoom transcript states) go through `t.maybe` and are checked by the data-label test, read from the source
  where they are defined. The compose, note and meeting analysis schemas' validation messages are checked the same way.

Still English here: email subjects and bodies, the AI's own summaries and drafts, the signal names and details the
scoring API writes, provider error text from Zoom and mailbox syncs, and API error messages.

## Scope of batch 5

Translated: Quotes & Proposals (the quote list, the catalogue and price books, the quote editor with its lines, totals,
discount approval and versions, the online proposal panel with tracking, payments and the send dialog), the Quick Bid
Studio (all four steps, its checks, autosave and restore), the bid template gallery and previews, the upload zone,
e-signature on quotes and contracts, Contracts (the list, renewals and the contract page with signature, renewal and
termination), Approvals, Billing (plan, trial, seats, usage, plans and invoices), the permission notice and the
commercial panels on records. New tables: `quotes` and `contracts`; new plural keys `count.prices`,
`count.suggestedSections`, `count.proposalOpened`, `count.startingSections`, `count.daysLeft`, `count.endedDaysAgo`,
`count.daysBeforeEnd`, `count.seats`, `count.tryFreeDays` and `count.pipelines`.

- **Template names, categories and descriptions** (the ten bid templates and the proposal templates), plan audiences,
  quote, contract, invoice, subscription, payment, envelope and approval statuses, signature methods and the Quick Bid
  checks go through `t.maybe` and are checked by the data-label test, read from the source where they are defined.
- **The upload zone's file checks** take the translator as an argument, with an English default, so the shared
  `fileProblem` check stays usable in tests and outside React.
- **Names stay as they are**: plan names ("DealFlow Professional"), Stripe and Razorpay, and money in the format
  locale.

Still English here: the section text a bid template starts with and the example lines in the gallery preview (it is
proposal text people replace), what customers see on the public proposal page, PDF and email text sent to customers,
and API and payment provider error messages.

## Scope of batch 6

Translated: Reports & Analytics (saved reports, the report editor with its records, measures, groupings, chart types,
order, filters and definition checks, the report view and its chart descriptions), Dashboards, the Pipeline flow,
Pipeline replay, Relationship Galaxy and Revenue Globe explorers with their 2D fallbacks and 3D notices, Forecasting
(the forecast, targets, gap and coverage, the trend view and the plan), Revenue Intelligence and Customer Success
(customers, churn risk, health signals, escalations and suggested retention steps). New tables: `reports` and
`revenue`; 28 new plural keys, among them `count.lastDays`, `count.stageChanges`, the eight `count.<records>Match` keys
and `count.recordsLeftOut`.

- **The report catalogue** (record types, field labels, measure names such as "Total amount" and date groupings such
  as "Created (month)"), the report templates and the report definition checks from the shared types go through
  `t.maybe`; the data-label test builds every combination from `REPORT_CATALOG` and fails if one has no phrase.
- **Sentences are not stitched from fragments**: the "Not included" list uses `Intl.ListFormat`, day counts use
  `Intl.NumberFormat` units, and each chart description is one phrase per chart type.

Still English here: row labels that the API computes for reports (month, week and country names), the detail line
under a health signal and under a churn risk (it carries counts and dates from the server), the "why" text under a
suggested retention step, and browser tab titles.

## Scope of batch 7

Translated: Team Management (members, roles and their permission counts, sales teams, invitations), Administration
(the hub, the audit log, support access and workspace security with two-step verification, single sign-on and SCIM
tokens), Integrations (your mailbox and calendar, workspace apps: Slack, Microsoft Teams, Zoom, DocuSign, card
payments, WhatsApp Business and SMS, the browser extension, Zapier and API keys, outbound webhooks and the planned
integrations) and Automation Studio (the workflow list and templates, the editor with every trigger, condition field,
operator and action, the schema checks, simulation, run history and versions). New tables: `administration`,
`automation` and `integrations`; 12 new plural keys, among them `count.members`, `count.permissions`, `count.scopes`,
`count.attempts`, `count.runsIn30Days` and `count.smsSegments`.

- **Links and code inside a sentence** use a new helper, `rich(t('… {link} …'), { link: <Link>…</Link> })`, which
  translates the whole sentence first and then puts the React parts in its placeholders, so translators see one
  sentence and can move the link.
- **App cards** (name, description, warnings and state badges from the API's app registry), OAuth outcomes, API key
  scopes, trigger events, actions, operators and workflow templates go through `t.maybe`; the data-label test reads them
  from `@dealflow/types`, `workflow-model.ts` and the API's apps service, and fails if one has no phrase.
- **Product terms stay as the provider shows them**: Stripe and Razorpay key prefixes, the Twilio console labels
  ("A message comes in", Account SID, Auth Token) and Teams' "Send webhook alerts to a channel" are not translated, so
  people can find them in the provider's own screens.
- The scope checkboxes on API keys and the event checkboxes on webhooks now have 24px targets (WCAG 2.2 target size),
  found by the Arabic integrations test.

Still English here: error messages and details returned by the API, the summaries in each app's recent activity list,
workflow checks that name a step id (for example "Step "action_2" points to missing step …"), permission codes in the
role editor, simulation step details computed by the API, webhook event codes, AI notes and browser tab titles.

## Scope of batch 8

Translated: account security (two-step verification and signed-in devices), AI Agents (each agent's permissions,
availability and cost), Campaigns, the Email Finder, Marketing (segments with every field and operator, lead forms and
their consent text), pipeline settings, the Client Portal (settings, people with access, requests and the company
page's portal card), Prospect Lists (lists, CSV and Excel import, Apollo.io search in Mock Mode, verification, moving
and adding to the CRM, usage limits), Website Visitors (dashboard, visitor detail, install and consent settings), Sales
Gamification (my performance, leaderboards, competitions, badges, rules), the help center and the planned-module page.
New tables: `growth` and `engagement`; 30 new plural keys, among them `count.prospects`, `count.importRows`,
`count.visitsLast`, `count.points` and `count.badgesAwarded`.

- **Period names** for leaderboards and competitions ("Last month (October 2026)") are built by `periodOptions(t, …)`,
  which marks past periods with a flag instead of matching the English word "Last".
- **Defaults that get saved** (a new form's consent text, a new pipeline's stage names, form field labels) are
  translated when the screen creates them, so they are stored in the language of the person who made them. Saved
  values are shown as stored and are not translated again.
- **Counts that carry a formatted number** (points, won deals, activities) pass it as `{value}` next to the raw
  `count`, so the plural form follows the number while the text shows it with the person's number format.

Still English here: error messages and details returned by the API (including import row errors and provider notices
with dates), the AI provider's own notes, intent signal labels and other visitor labels computed by the API, Email
Finder notes that name a domain, competition and award period keys, and browser tab titles. Public pages that visitors
and customers see without a DealFlow account (hosted forms, the portal sign-in, unsubscribe and the website) are a
separate batch, because they need the visitor's language rather than a saved setting.

## Review

The translations were written by Claude and need review by native speakers before customers rely on them; Kunal's
team owns that review. Each table lists the four languages on one line to make the review a read-through.

## Consequences

- English text in a page is now also a catalogue key. Changing an English phrase means changing its table entry too;
  the type checker points at the table.
- Adding a page to the translated set is: wrap its strings in `t()`, add the phrases, run the unit test.
