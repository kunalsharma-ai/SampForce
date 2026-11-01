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

## Review

The translations were written by Claude and need review by native speakers before customers rely on them; Kunal's
team owns that review. Each table lists the four languages on one line to make the review a read-through.

## Consequences

- English text in a page is now also a catalogue key. Changing an English phrase means changing its table entry too;
  the type checker points at the table.
- Adding a page to the translated set is: wrap its strings in `t()`, add the phrases, run the unit test.
