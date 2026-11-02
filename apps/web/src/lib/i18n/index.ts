'use client';

import type { LanguageCode, TextDirection } from '@dealflow/types';
import { createElement, Fragment, type ReactNode, useCallback, useMemo } from 'react';
import { useRegional } from '@/stores/regional';
import { type ActiveLocale, activeLocaleFor } from './locale';
import { type MessageKey, type PluralKey, translate, translateData, translatePlural, type Vars } from './translate';

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
  const base = useCallback((key: MessageKey, vars?: Vars) => translate(language, key, vars, formatLocale), [language, formatLocale]);
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
