'use client';

import type { LanguageCode, TextDirection } from '@dealflow/types';
import { useCallback, useMemo } from 'react';
import { useRegional } from '@/stores/regional';
import { type ActiveLocale, activeLocaleFor } from './locale';
import { type MessageKey, type PluralKey, translate, translatePlural, type Vars } from './translate';

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
        // translate() falls back to the key itself, so unknown text is shown as it came (with its placeholders filled).
        maybe: (text: string, vars?: Vars) => translate(language, text as MessageKey, vars, formatLocale),
        language,
        formatLocale,
        dir,
      }),
    [base, language, formatLocale, dir],
  );
}

/** Renders data-borne text through `t.maybe`, for cells and constants defined outside a component. */
export function Tr({ text, vars }: { text: string; vars?: Vars }) {
  return useT().maybe(text, vars);
}
