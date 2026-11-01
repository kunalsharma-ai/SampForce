/**
 * Page text is keyed by its English wording (gettext style): `t('Owner')`. Each entry holds the Spanish, French,
 * German and Arabic translations in that order, side by side so a reviewer reads one phrase in every language at once.
 * `{name}` placeholders must appear in every translation (src/lib/i18n/i18n.test.ts checks this).
 */
export type PhraseRow = readonly [es: string, fr: string, de: string, ar: string];
export type PhraseTable = Readonly<Record<string, PhraseRow>>;
