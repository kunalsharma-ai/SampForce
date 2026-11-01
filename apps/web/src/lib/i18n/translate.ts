import type { LanguageCode } from '@dealflow/types';
import { ar } from './messages/ar';
import { de } from './messages/de';
import { en, type Messages, type ShellKey } from './messages/en';
import { es } from './messages/es';
import { fr } from './messages/fr';
import { PHRASES, type PhraseKey } from './phrases';

/** A dotted shell key (`nav.favourites`) or a page phrase keyed by its English text (`'Owner'`). */
export type MessageKey = ShellKey | PhraseKey;

const COLUMN: Record<Exclude<LanguageCode, 'en'>, number> = { es: 0, fr: 1, de: 2, ar: 3 };
function phrases(lang: LanguageCode): Record<PhraseKey, string> {
  const out = {} as Record<PhraseKey, string>;
  for (const [key, row] of Object.entries(PHRASES) as [PhraseKey, readonly string[]][]) out[key] = lang === 'en' ? key : row[COLUMN[lang]]!;
  return out;
}

export type Catalogue = Messages & Record<PhraseKey, string>;
export const CATALOGUES: Record<LanguageCode, Catalogue> = {
  en: { ...en, ...phrases('en') },
  es: { ...es, ...phrases('es') },
  fr: { ...fr, ...phrases('fr') },
  de: { ...de, ...phrases('de') },
  ar: { ...ar, ...phrases('ar') },
};

/** Keys that have plural forms, written without the `_one`/`_other` suffix. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never;

export type Vars = Record<string, string | number>;

const pluralRules = new Map<string, Intl.PluralRules>();

function interpolate(text: string, vars: Vars | undefined, locale: string): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) return whole;
    return typeof v === 'number' ? new Intl.NumberFormat(locale).format(v) : v;
  });
}

/**
 * Looks up a message in the language's catalogue, falling back to English (and then to the key itself, which a
 * test makes impossible for shipped keys) and fills `{name}` placeholders. Numbers are written in `formatLocale`.
 */
export function translate(language: LanguageCode, key: MessageKey, vars?: Vars, formatLocale: string = language): string {
  const text = CATALOGUES[language]?.[key] ?? CATALOGUES.en[key] ?? key;
  return interpolate(text, vars, formatLocale);
}

/** Picks the plural form for `count` with Intl.PluralRules ("1 day", "2 days"; Arabic's six forms). */
export function translatePlural(language: LanguageCode, key: PluralKey, count: number, vars?: Vars, formatLocale: string = language): string {
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  const form = count === 0 ? 'zero' : rules.select(count);
  const catalogue = CATALOGUES[language] as Record<string, string | undefined>;
  // An explicit "_zero" form is used for 0 when the language has one (Arabic); otherwise the rule's own form.
  const text =
    (form === 'zero' ? catalogue[`${key}_zero`] : undefined) ??
    catalogue[`${key}_${count === 0 ? rules.select(0) : form}`] ??
    catalogue[`${key}_other`] ??
    (en as Record<string, string>)[`${key}_${new Intl.PluralRules('en').select(count)}`] ??
    key;
  return interpolate(text, { count, ...vars }, formatLocale);
}
