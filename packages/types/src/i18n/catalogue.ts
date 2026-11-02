import type { LanguageCode } from '../regional';

/**
 * Text the server writes (API error messages, validation messages, sentences it composes, starter content) is keyed by
 * its English wording, like the web app's page phrases (ADR 0048). Each row holds the Spanish, French, German and
 * Arabic translations in that order. `{name}` placeholders must appear in every translation.
 */
export type TextRow = readonly [es: string, fr: string, de: string, ar: string];
export type TextTable = Readonly<Record<string, TextRow>>;

export type TextVars = Record<string, string | number>;

const COLUMN: Record<Exclude<LanguageCode, 'en'>, number> = { es: 0, fr: 1, de: 2, ar: 3 };
const PLACEHOLDER = /\{(\w+)\}/g;

interface Pattern {
  key: string;
  re: RegExp;
  names: string[];
  row: TextRow;
  /** Number of fixed characters; longer patterns are tried first so the most specific one wins. */
  weight: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The placeholder names of a phrase, in order. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/** "5,000" written by the server in English becomes "5.000" in German; plain numbers (years, ids) are left alone. */
function reformatGrouped(value: string, locale: string): string {
  if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) return value;
  return new Intl.NumberFormat(locale).format(Number(value.replace(/,/g, '')));
}

function fill(text: string, vars: TextVars | undefined, locale: string): string {
  if (!vars) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) return whole;
    return typeof v === 'number' ? new Intl.NumberFormat(locale).format(v) : v;
  });
}

export class TextCatalogue {
  private readonly exact = new Map<string, TextRow>();
  private readonly patterns: Pattern[] = [];

  constructor(tables: readonly TextTable[]) {
    for (const table of tables) {
      for (const [key, row] of Object.entries(table)) {
        this.exact.set(key, row);
        const names = placeholdersOf(key);
        if (!names.length) continue;
        const pieces = key.split(PLACEHOLDER);
        // split() with a capture group alternates literal, name, literal, name, …
        const source = pieces.map((p, i) => (i % 2 === 1 ? '([\\s\\S]+?)' : escapeRe(p))).join('');
        const weight = pieces.filter((_, i) => i % 2 === 0).join('').length;
        this.patterns.push({ key, re: new RegExp(`^${source}$`), names, row, weight });
      }
    }
    this.patterns.sort((a, b) => b.weight - a.weight);
  }

  /** Every English key, for tests. */
  keys(): string[] {
    return [...this.exact.keys()];
  }

  /** True when `text` is a phrase, or matches a phrase with placeholders. */
  covers(text: string): boolean {
    return this.exact.has(text) || this.patterns.some((p) => p.re.test(text));
  }

  row(key: string): TextRow | undefined {
    return this.exact.get(key);
  }

  /**
   * Writes the phrase `key` in `language` and fills its placeholders (numbers in the language's format). English, and
   * any key without a row, gives the English text.
   */
  say(language: LanguageCode, key: string, vars?: TextVars, locale: string = language): string {
    const row = language === 'en' ? undefined : this.exact.get(key);
    return fill(row ? row[COLUMN[language as Exclude<LanguageCode, 'en'>]]! : key, vars, locale);
  }

  /**
   * Translates finished English text: an exact phrase, or a phrase with placeholders whose fixed words match (the
   * values in between are carried over). `term` may translate a carried value, for labels such as field names.
   * Text that matches nothing is returned unchanged, so a message without a translation still reads in English.
   */
  localize(language: LanguageCode, text: string, term?: (value: string) => string | undefined): string {
    if (language === 'en' || !text) return text;
    const col = COLUMN[language as Exclude<LanguageCode, 'en'>];
    const hit = this.exact.get(text);
    if (hit) return hit[col]!;
    for (const p of this.patterns) {
      const m = p.re.exec(text);
      if (!m) continue;
      const vars: TextVars = {};
      p.names.forEach((name, i) => {
        if (name in vars) return;
        const value = m[i + 1]!;
        vars[name] = term?.(value) ?? this.exactIn(language, value) ?? reformatGrouped(value, language);
      });
      return fill(p.row[col]!, vars, language);
    }
    return text;
  }

  private exactIn(language: LanguageCode, value: string): string | undefined {
    const row = this.exact.get(value);
    return row ? row[COLUMN[language as Exclude<LanguageCode, 'en'>]] : undefined;
  }
}

/**
 * The language to answer in, from an Accept-Language header: the first supported language by preference (q values
 * honoured), matched on the primary subtag so "de-AT" is German. The web app sends the person's chosen language.
 */
export function pickLanguage(header: string | string[] | undefined, supported: readonly LanguageCode[] = ['en', 'es', 'fr', 'de', 'ar']): LanguageCode {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!value) return 'en';
  const ranked = value
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { primary: (tag ?? '').toLowerCase().split('-')[0]!, q: q === undefined ? 1 : Number(q), index };
    })
    .filter((r) => r.primary && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const r of ranked) {
    const hit = supported.find((code) => code === r.primary);
    if (hit) return hit;
  }
  return 'en';
}
