# ADR 0056: An "i" help button on every page and section

- Status: Accepted
- Date: 2026-11-06

## Context

Kunal asked for an "i" icon beside each feature so people understand what it is for, how to use it and where to use
it. SampForce has about 60 signed-in pages and many sections and settings on them, used in five languages
(English, Spanish, French, German, Arabic). The help has to work with a keyboard and a screen reader, follow the
design system and stay in step as pages are added.

## Decision

- **One component, two placements.** `components/info-tip.tsx` (`<InfoTip topic="…" />`) is a small round "i"
  button that opens a popover (`Popover` in `packages/ui`, built on `@radix-ui/react-popover`) with three parts:
  *What it is for*, *How to use it*, *Where to use it*. `components/page-help.tsx` (`<PageHelp />`) picks the page's
  topic from the route; `PageHeader` renders it beside every page title, and the pages that draw their own `<h1>`
  (record pages, quote, contract, sequence, meeting, report and dashboard editors, prospect lists) render it too.
  About 90 section headings and settings cards carry their own `<InfoTip>`.
- **The button sits beside the heading, never inside it**, so a heading's accessible name stays its text. The button
  is named "What is this?" everywhere and its `title` ("About Deals") gives the feature: screen readers read it as the
  description and mouse users see it on hover. Keeping the feature name out of the accessible name means label and
  role lookups such as "Language" or "Save" stay unambiguous. Radix gives the popover `role="dialog"`, labelled by its
  title, moves focus into it, closes on Escape or a click outside and returns focus to the button. The hit area is
  24 px (WCAG 2.5.8).
- **Text lives in `lib/help`**, one file per area (`topics-workspace`, `-engage`, `-revenue`, `-intelligence`,
  `-organization`). Each sentence is written once in all five languages side by side (`[en, es, fr, de, ar]`), like
  the page phrase tables (ADR 0048), so a reviewer reads one sentence in every language. Topic titles reuse the
  page's own translated heading text through the phrase tables. `PAGE_HELP` maps routes to page topics; static
  segments win over dynamic ones.
- **The Help center has a feature guide** (`/app/help#guide`) built from the same topics: every page with its
  sections, searchable in the reader's language, with a link to each page.

## Guard rails

`lib/help/help.test.ts` fails when a signed-in or operator page has no help topic, a topic is defined twice or not
used, a translation is missing, left in English or not in Arabic script, an explanation is longer than 240
characters, a title has no translation, or a page that draws its own title lacks `<PageHelp />`.
`e2e/help.spec.ts` checks the button on pages and sections by mouse and keyboard, the popover's accessible name,
focus return, Spanish and Arabic text, the feature guide search, and runs axe. A Storybook story shows the button
closed and open in every theme and language.

## Consequences

- A new page needs a `page.*` topic and a `PAGE_HELP` entry, or the unit test fails. A new section topic must be
  used somewhere with `<InfoTip topic="…">`.
- Help text is product copy; it describes what the screen does today. When a feature changes, its topic should be
  updated in the same pull request. The translations were written for this change and still want a native-speaker
  review, like the rest of the interface.
