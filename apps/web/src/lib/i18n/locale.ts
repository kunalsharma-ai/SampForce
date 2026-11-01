import { type LanguageCode, languageDir, type Regional, resolveFormatLocale, type TextDirection } from '@dealflow/types';
import { useRegional } from '@/stores/regional';

/** Server-safe: no React here, so formatters in lib/ can import it from server and client code alike. */

function browserLocales(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
}

export interface ActiveLocale {
  language: LanguageCode;
  /** The BCP 47 locale for Intl formatting (dates, numbers, money). */
  formatLocale: string;
  dir: TextDirection;
}

export function activeLocaleFor(regional: Regional): ActiveLocale {
  return { language: regional.language, formatLocale: resolveFormatLocale(regional, browserLocales()), dir: languageDir(regional.language) };
}

/**
 * The locale for Intl formatting outside React (formatters in lib/). Pages re-render with a new value because the app
 * shell remounts the page when the regional settings change (components/shell/app-shell.tsx). On the server, before
 * the person's settings are known, it is the default language.
 */
export function fmtLocale(): string {
  return activeLocaleFor(useRegional.getState().regional).formatLocale;
}
