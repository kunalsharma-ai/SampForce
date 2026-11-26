'use client';

import type { LanguageCode, TextDirection } from '@dealflow/types';
import { createElement, Fragment, type ReactNode, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useRegional } from '@/stores/regional';
import { type ActiveLocale, activeLocaleFor } from './locale';
import { catalogueReady, catalogueVersion, loadCatalogue, type MessageKey, type PluralKey, subscribeCatalogues, translate, translateData, translatePlural, type Vars } from './translate';

export { catalogueReady, loadCatalogue } from './translate';

/** Which languages' text has arrived; components that translate re-render when it changes. */
export function useCatalogueVersion(): number {
  return useSyncExternalStore(subscribeCatalogues, catalogueVersion, () => 0);
}

/** The data-attribute the layout's bootstrap script sets while a non-English page waits for its text. */
export const LANGUAGE_PENDING_ATTR = 'data-language-pending';

if (typeof window !== 'undefined') {
  // Start fetching the person's language as soon as the app's code runs, not after the first render; and again
  // whenever they switch language. Once it has arrived the page is shown (see app/layout.tsx).
  const ready = () => document.documentElement.removeAttribute(LANGUAGE_PENDING_ATTR);
  const want = (language: LanguageCode) => {
    if (catalogueReady(language)) return ready();
    // A failed load shows the page in English rather than leaving it hidden.
    loadCatalogue(language).then(ready, ready);
  };
  want(useRegional.getState().regional.language);
  useRegional.subscribe((s, prev) => {
    if (s.regional.language !== prev.regional.language) want(s.regional.language);
  });
}

export type { ActiveLocale, MessageKey, PluralKey };
export { activeLocaleFor, fmtLocale } from './locale';

export function useActiveLocale(): ActiveLocale {
  const regional = useRegional((s) => s.regional);
  return useMemo(() => activeLocaleFor(regional), [regional]);
}

export interface Translator {
  (key: MessageKey, vars?: Vars): string;
  plural: (key: PluralKey, count: number, vars?: Vars) => string;
  /**
   * For text that arrives as data (API labels such as KPI names, shared constants): translated when the catalogue has
   * the English wording as a phrase, otherwise shown as it came.
   */
  maybe: (text: string, vars?: Vars) => string;
  language: LanguageCode;
  formatLocale: string;
  dir: TextDirection;
}

/** `t('nav.favourites')`, `t('nav.removeFavourite', { label })`, `t.plural('regional.days', 3)`. */
export function useT(): Translator {
  const { language, formatLocale, dir } = useActiveLocale();
  const loaded = useCatalogueVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `loaded` makes a new translator when a language arrives
  const base = useCallback((key: MessageKey, vars?: Vars) => translate(language, key, vars, formatLocale), [language, formatLocale, loaded]);
  return useMemo(
    () => Object.assign(base, {
        plural: (key: PluralKey, count: number, vars?: Vars) => translatePlural(language, key, count, vars, formatLocale),
        // Unknown text is shown as it came (with its placeholders filled).
        maybe: (text: string, vars?: Vars) => translateData(language, text, vars, formatLocale),
        language,
        formatLocale,
        dir,
      }),
    [base, language, formatLocale, dir],
  );
}

/** A translated label used inside a sentence ("Added a {block} block"): lower case, except in German, where nouns keep their capital. */
export function inSentence(t: Pick<Translator, 'language'>, label: string): string {
  return t.language === 'de' ? label : label.toLocaleLowerCase(t.language);
}

/** Renders data-borne text through `t.maybe`, for cells and constants defined outside a component. */
export function Tr({ text, vars }: { text: string; vars?: Vars }) {
  return useT().maybe(text, vars);
}

/**
 * Fills `{name}` slots in an already translated sentence with elements (links, code, bold names), so the translator
 * keeps control of word order: `rich(t('Turn it on in {link}.'), { link: <Link …>{t('Account security')}</Link> })`.
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  const children = text.split(/\{(\w+)\}/).map((piece, i) => (i % 2 === 1 ? (piece in parts ? parts[piece] : `{${piece}}`) : piece));
  return createElement(Fragment, null, ...children);
}
