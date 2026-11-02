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

## Review

The translations were written by Claude and need review by native speakers before customers rely on them; Kunal's
team owns that review. Each table lists the four languages on one line to make the review a read-through.

## Consequences

- English text in a page is now also a catalogue key. Changing an English phrase means changing its table entry too;
  the type checker points at the table.
- Adding a page to the translated set is: wrap its strings in `t()`, add the phrases, run the unit test.
