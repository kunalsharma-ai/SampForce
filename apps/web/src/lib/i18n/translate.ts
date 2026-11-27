import type { LanguageCode } from '@dealflow/types';
import { en, type Messages, type ShellKey } from './messages/en';
import type { PhraseKey } from './phrases';

/** A dotted shell key (`nav.favourites`) or a page phrase keyed by its English text (`'Owner'`). */
export type MessageKey = ShellKey | PhraseKey;

export type Catalogue = Messages & Record<PhraseKey, string>;

/*
 * English is built in: shell messages come from messages/en and a page phrase is its own English text. The other
 * languages live in ./foreign, a chunk loaded the first time the interface needs one (`loadCatalogue`). Until it has
 * arrived the text is English; components re-render when it does (`useCatalogueVersion` in ./index).
 */
const english = en as Record<string, string>;
const loaded: Partial<Record<LanguageCode, Catalogue>> = {};
let serverText: typeof import('./foreign').localizeServerText | null = null;
let foreign: Promise<typeof import('./foreign')> | null = null;
const pending = new Map<LanguageCode, Promise<void>>();
let version = 0;
const listeners = new Set<() => void>();

/** Whether the language's text is here (English always is). */
export function catalogueReady(language: LanguageCode): boolean {
  return language === 'en' || !!loaded[language];
}

/** Loads a language's text once; resolves when it can be used. A failed load is tried again on the next call. */
export function loadCatalogue(language: LanguageCode): Promise<void> {
  if (catalogueReady(language)) return Promise.resolve();
  let p = pending.get(language);
  if (!p) {
    foreign ??= import('./foreign');
    p = foreign
      .then((m) => {
        loaded[language] = m.buildCatalogue(language);
        serverText = m.localizeServerText;
        version++;
        for (const l of listeners) l();
      })
      .catch((err: unknown) => {
        foreign = null;
        pending.delete(language);
        throw err;
      });
    pending.set(language, p);
  }
  return p;
}

/** For useSyncExternalStore: changes each time a language's text arrives. */
export function subscribeCatalogues(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const catalogueVersion = (): number => version;

function catalogue(language: LanguageCode): Record<string, string | undefined> | undefined {
  return language === 'en' ? english : (loaded[language] as Record<string, string | undefined> | undefined);
}

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
  const text = catalogue(language)?.[key] ?? english[key] ?? key;
  return interpolate(text, vars, formatLocale);
}

/**
 * Text that arrives as data (an API message, a stored reason, a shared label): the page catalogue first, then the
 * server's own text catalogue, which also matches sentences with values in them ("Import up to 5,000 rows at a
 * time."). A value carried inside such a sentence is translated too when the page catalogue knows it (a field name).
 * Anything else is shown as it came.
 */
export function translateData(language: LanguageCode, text: string, vars?: Vars, formatLocale: string = language): string {
  const cat = catalogue(language);
  if (language === 'en') return interpolate(english[text] ?? text, vars, formatLocale);
  const page = cat?.[text];
  if (page !== undefined || !cat || !serverText) return interpolate(page ?? text, vars, formatLocale);
  return interpolate(serverText(language, text, (value) => cat[value]), vars, formatLocale);
}

/** Picks the plural form for `count` with Intl.PluralRules ("1 day", "2 days"; Arabic's six forms). */
export function translatePlural(language: LanguageCode, key: PluralKey, count: number, vars?: Vars, formatLocale: string = language): string {
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  const form = count === 0 ? 'zero' : rules.select(count);
  const cat = catalogue(language) ?? {};
  // An explicit "_zero" form is used for 0 when the language has one (Arabic); otherwise the rule's own form.
  const text =
    (form === 'zero' ? cat[`${key}_zero`] : undefined) ??
    cat[`${key}_${count === 0 ? rules.select(0) : form}`] ??
    cat[`${key}_other`] ??
    english[`${key}_${new Intl.PluralRules('en').select(count)}`] ??
    key;
  return interpolate(text, { count, ...vars }, formatLocale);
}
