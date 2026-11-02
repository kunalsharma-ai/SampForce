# ADR 0052: Server text in the reader's language

- Status: Accepted
- Date: 2026-11-02
- Part of: Translating the text the earlier batches kept in English (ADR 0048, "Still English here")
- Builds on: ADR 0047 (languages and regional formats), ADR 0048 (phrase tables keyed by English)

## Context

Batches 1 to 9 translated every page, but the text the API writes stayed English: error messages, the field problems
of a failed validation, Zod's own default messages, and DealFlow's explanations of what a connected service refused.
Some of it reaches the browser as data the page cannot predict (`Import up to 5,000 rows at a time.`), and the same
Zod schemas run in the browser and again in the API, so a message can come from either side.

## Decisions

1. **The API answers in the language the request asks for.** The web app sends `Accept-Language` with the person's
   chosen interface language on every call (`languageHeader()` in `lib/api.ts`, also on downloads and the hosted
   form). A request without one, or in a language DealFlow does not have, is answered in English, so API clients,
   tests and webhooks are unchanged. `pickLanguage` honours q values and matches the primary subtag (`de-AT` is
   German). The browser extension asks for English, because its own screens are English.
2. **Messages stay English in the source.** Services keep throwing English messages; the exception filter translates
   `message` and every `details[].message` on the way out. Error `code`s never change, so clients keep branching on
   them. A middleware also records each request's language (`requestLanguage()`, `tr()`, `inLanguage()` in
   `common/request-language.ts`) for text the server composes, which later batches use.
3. **One shared catalogue, keyed by English.** `@dealflow/types` holds the server's tables
   (`src/i18n/text/*.ts`: validation, access, records, work, providers), each row `[es, fr, de, ar]` like the page
   tables. A phrase with placeholders also matches finished text: `{what} not found.` matches `Badge not found.`
   when no exact row exists, the carried values are put into the translation in its own word order, a carried value
   that is itself a phrase is translated, and English digit grouping in a value (`5,000`) is rewritten for the
   reader (`5.000`). Exact rows win over patterns, and longer patterns over shorter ones.
4. **Whole sentences, not stitched fragments.** Where the English used to build a plural or a list with a ternary
   inside a sentence (`pipeline${n === 1 ? '' : 's'}`), the source now chooses between two complete sentences, so
   each language can phrase both. "… not found." is a full row per record type ("Verkaufschance nicht gefunden."), so
   gender and word order are right; the `{what} not found.` pattern is only a fallback.
5. **The web app falls back to the same catalogue.** `t.maybe()` looks in the page tables first, then in the server
   catalogue (with the page tables translating a carried field name), so Zod messages checked in the browser, stored
   reasons and API messages already in a page all read in the person's language. A unit test requires every phrase
   that is in both places to have the same translations.
6. **A test reads the source.** `apps/api/src/i18n/messages.test.ts` scans the API and the shared schemas with the
   TypeScript compiler and fails when a message has no row: exception messages, `{ code, message }` bodies,
   `{ path, message }` field problems, Zod check messages (`.min(1, '…')`, `.refine(…, '…')`, `addIssue`), the
   arguments of the error helpers (`notFound('Deal')` is checked as "Deal not found."), the messages of the
   service errors that controllers pass on (AppError, ZoomError, OidcError and the rest) and the sentences returned by
   the functions that explain a delivery problem (`describeTwilioError`, `payReason`, …). Interpolations count as
   placeholders. Permission codes in `details` are machine values and stay as they are.

## Scope of this change

Translated: every error and validation message the API returns, Zod's default messages, the SMS and WhatsApp
delivery problems, card payment reasons, and DealFlow's messages about Slack, Teams, Zoom, DocuSign, Stripe and
Razorpay, Twilio, WhatsApp, Google and Microsoft mailboxes, single sign-on, Deepgram and Apollo.

Not translated, on purpose:

- **What a provider says in its own words** (Zoom's or DocuSign's `message`, a Stripe error description) is carried
  inside a translated sentence as it came.
- **SCIM error responses** answer identity providers' provisioning clients, not people.
- **Codes and identifiers**: error codes, permission codes, merge fields, environment variable names.

The sentences the server composes for pages (insights, next actions, health signals), seeded starter content,
emails, the proposal PDF, browser tab titles and AI drafts are later batches.

## Review

As with the page tables, the translations were written by Claude and need a native speaker's review before customers
rely on them.

## Consequences

- A new message in the API fails the unit test until its row exists in `packages/types/src/i18n/text`.
- Rewording an English message means changing its row too (the test points at it).
- Tests that assert an English message keep passing: requests without Accept-Language get English.
