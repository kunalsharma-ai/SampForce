import type { LanguageCode } from '@dealflow/types';
import { ar } from './messages/ar';
import { de } from './messages/de';
import { en, type MessageKey, type Messages } from './messages/en';
import { es } from './messages/es';
import { fr } from './messages/fr';

export type { MessageKey };

export const CATALOGUES: Record<LanguageCode, Messages> = { en, es, fr, de, ar };

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
  const text = CATALOGUES[language]?.[key] ?? en[key] ?? key;
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
