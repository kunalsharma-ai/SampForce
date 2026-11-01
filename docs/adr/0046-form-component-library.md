# ADR 0046: Form component library

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (Part 7 forms)

## Context

The spec asks for premium form controls: floating labels, searchable and multi-select fields, currency, country and
phone inputs, number steppers, segmented controls, upload zones and draft recovery, with clear validation. The app had
native selects, free-text country ("2-letter ISO code") and currency fields, a comma-separated tags box, plain file
inputs and no draft recovery. The API already validates ISO country and currency codes and a loose phone format.

## Decisions

1. **One small library in `apps/web/src/components/forms`.** Every control takes the props `Field` passes (`id`,
   `aria-invalid`, `aria-describedby`), so it drops into existing forms and keeps the shared error and hint wiring.
   - `Combobox` (single) and `MultiCombobox` (chips, optionally creatable) follow the ARIA 1.2 combobox pattern:
     fuzzy search (the command palette's matcher), arrow keys, Home, End, Enter and Escape, a live region announcing
     added and removed chips, 24px remove buttons.
   - `CountrySelect`, `CurrencySelect` and `TimeZoneSelect` use ISO 3166, ISO 4217 and IANA codes (what the API
     stores) with names from the browser's `Intl` data, so they follow the reader's language.
   - `PhoneInput` uses `libphonenumber-js` (pinned) for the calling code list, as-you-type formatting and validation,
     and stores E.164 once the number is valid. The record form explains an invalid number before saving.
   - `CurrencyInput` shows the currency symbol and grouped digits, and parses the reader's own separators.
   - `NumberStepper` clamps to its range and steps with buttons or arrow keys.
   - `UploadZone` accepts a dropped file or a real file button, checks type and size, and announces problems.
   - `FloatingField` is a real label that sits inside the input and floats up on focus or value; it never
     disappears like a placeholder does.
   - `useFormDraft` keeps unsaved values on the device after a short pause, offers them back next time (restore or
     discard, never applied silently), clears them on save, and drops drafts older than a week.
   - `Segmented` (from the theme work) covers small exclusive choices.
2. **Rolled into the busiest forms.** The lead, contact, company and deal forms use the country, currency, time zone,
   phone, money, tag and stepper controls, plus a priority control on deals and draft recovery when creating. The
   sign-in, sign-up and password forms use floating labels. The CSV import and the proposal logo use the upload zone.
3. **Server rules unchanged.** The API keeps validating codes and phone format; the controls make valid input easy
   and explain problems early, but they are not the only check.

## Not in this change

Address autocomplete (needs a geocoding provider), rich text editing, and moving every remaining form onto the
library; new forms should use it.
