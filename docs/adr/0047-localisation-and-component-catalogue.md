# ADR 0047: Localisation, right-to-left layout and the component catalogue

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (localisation and design system documentation)

## Context

The spec asks for locale-aware formatting, a translation layer ready for right-to-left languages, and a catalogue of
the design system. Before this change every date, number and amount was written in US English (36 hard-coded
`'en-US'`/`'en-GB'` calls plus 31 calls that used whatever the browser reported), there was no way to choose a
language, layout classes were physical (`ml-`, `pl-`, `left-`, `border-r`), and the components had no catalogue.

## Decisions

1. **A per-person setting, saved on the account.** `user_regional_settings` (one row per person, no tenant, like
   `user_preferences`) holds `language` (`en`, `es`, `fr`, `de`, `ar`, enforced by a check constraint and the zod
   enum) and `format_locale` (a BCP 47 tag, canonicalised with `Intl.getCanonicalLocales`, or null). API:
   `GET/PUT/DELETE /me/regional`; the read is allowed while a security policy restricts the session. A separate table
   rather than a field on the appearance JSON, because saved themes and the workspace default reuse that schema.
2. **Format locale resolution.** An explicit format locale wins; otherwise a browser locale in the chosen language
   (English reader in the UK gets `en-GB`), otherwise the language alone. `fmtLocale()` (server-safe,
   `lib/i18n/locale.ts`) is used by every formatter in `lib/` and by the components that formatted directly.
3. **Translation layer without a dependency.** Catalogues are typed TypeScript objects (`lib/i18n/messages`); English
   is the source and the `Messages` type makes every other catalogue complete. `{name}` placeholders are filled with
   numbers written in the format locale. Plurals use `_one`/`_other` keys chosen by `Intl.PluralRules`, with the
   extra forms a language needs (Arabic's six, the Spanish and French `many`). A unit test checks every catalogue
   has every key, the same placeholders and every plural form its language uses. `useT()` gives components `t()`,
   `t.plural()`, the language, the format locale and the direction.
4. **What is translated.** The shell (sidebar, module names, top bar, account menu, mobile bottom bar, command palette
   module list, policy gate, banners) and the Language & region settings. The other pages are still English; the
   settings card says so. The translations were written by Claude and should be reviewed by native speakers
   before they are offered to customers.
5. **Applying a change.** The setting is applied only after the server has saved it, so devices agree. The app shell
   keys the page on the language and format locale, so a change re-renders every label, date and number at once.
   `<html lang dir>` is set by the root providers and, before first paint, by the layout's bootstrap script from the
   device cache, so a right-to-left reload never flashes mirrored.
6. **Right to left.** Layout classes across the web app and `@dealflow/ui` moved to logical properties (`ms-`, `ps-`,
   `start-`, `border-s`, `rounded-s`, `text-start`; about 550 replacements, identical in left-to-right), side panels
   open from the logical edge, Radix primitives get the direction through `DirectionProvider`, and directional icons
   (chevrons, arrows) mirror with `rtl:-scale-x-100`. Charts and time axes stay left to right.
7. **Component catalogue: Storybook 10.6.2 (React + Vite).** Stories live in `apps/web/src/stories` (primitives, forms,
   foundations including colour tokens and localisation, bids). The preview paints every story with the real theme
   engine and has toolbar switches for theme, light or dark, and language (which sets the direction). The Vite
   builder reads `@dealflow/types` from source. `pnpm --filter @dealflow/web build-storybook` builds it and
   `test:storybook` (Playwright) opens every story in dark, light and Arabic, failing on render errors, console errors
   or any axe WCAG 2.2 AA violation. CI runs both.

## Not in this change

Translating every page, a workspace default language, per-person time zones (dates use the device's zone),
translator tooling (extraction, a TMS), and publishing the Storybook build to a hosted URL.
