import { LANGUAGES, type LanguageCode } from '@dealflow/types';
import { PHRASES } from './phrases';

/**
 * The app's own words in the five SampForce languages. Each phrase is keyed by its English text, as on the web
 * (apps/web/src/lib/i18n); test/i18n.test.ts checks that every phrase the app uses has all four translations.
 * Server messages arrive already translated, because every request sends the phone's language.
 */

const ORDER = ['es', 'fr', 'de', 'ar'] as const;
let language: LanguageCode = 'en';

export function pickLanguage(tags: readonly (string | null | undefined)[]): LanguageCode {
  for (const tag of tags) {
    const code = tag?.slice(0, 2).toLowerCase();
    if (code && LANGUAGES.some((l) => l.code === code)) return code as LanguageCode;
  }
  return 'en';
}

export function setLanguage(code: LanguageCode) {
  language = code;
}

export function currentLanguage(): LanguageCode {
  return language;
}

export function isRtl(): boolean {
  return LANGUAGES.find((l) => l.code === language)?.dir === 'rtl';
}

function fill(text: string, vars?: Record<string, string | number>): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

function lookup(key: string): string | undefined {
  if (language === 'en') return key;
  const row = PHRASES[key];
  return row?.[ORDER.indexOf(language as (typeof ORDER)[number])];
}

/** A phrase the app wrote. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return fill(lookup(key) ?? key, vars);
}

/** Text that may or may not be one of the app's phrases (labels from @dealflow/types, messages from the app's logic). */
export function tMaybe(text: string, vars?: Record<string, string | number>): string {
  return t(text, vars);
}
