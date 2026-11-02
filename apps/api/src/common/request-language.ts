import { AsyncLocalStorage } from 'node:async_hooks';
import { ALL_SERVER_TEXT, type LanguageCode, NOTIFICATION_TEXT, pickLanguage, SERVER_TEXT, type TextVars } from '@dealflow/types';

const store = new AsyncLocalStorage<LanguageCode>();

type HeaderRequest = { headers: Record<string, string | string[] | undefined> };

/**
 * Remembers the language of each request, from its Accept-Language header. The web app sends the person's chosen
 * language (or, on public pages, the visitor's browser language); requests without one are answered in English.
 */
export function requestLanguageMiddleware(req: HeaderRequest, _res: unknown, next: () => void): void {
  store.run(pickLanguage(req.headers['accept-language']), next);
}

/** The language of the request being handled, or English outside a request (workers, scripts). */
export function requestLanguage(): LanguageCode {
  return store.getStore() ?? 'en';
}

/** Runs `fn` as if handling a request in `language`, for work done on someone's behalf outside a request. */
export function inLanguage<T>(language: LanguageCode, fn: () => T): T {
  return store.run(language, fn);
}

/** Writes a server phrase in the request's language: `tr('Closes in {days} days', { days })`. */
export function tr(key: string, vars?: TextVars): string {
  return ALL_SERVER_TEXT.say(requestLanguage(), key, vars, requestLocale());
}

/** Translates finished English text (an error message, a validation message) into `language`. */
export function localize(text: string, language: LanguageCode = requestLanguage()): string {
  return SERVER_TEXT.localize(language, text);
}

/** Translates a stored notification title or body into the request's language. */
export function localizeNotification(text: string, language: LanguageCode = requestLanguage()): string {
  return NOTIFICATION_TEXT.localize(language, text);
}

export { pickLanguage };

/** The number format for the request's language; English keeps the US format the API has always used. */
export function requestLocale(language: LanguageCode = requestLanguage()): string {
  return language === 'en' ? 'en-US' : language;
}

/** A whole amount in `currency`, in the request's number format ("$5,000", "5.000 $"). */
export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(requestLocale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

/** A percentage already multiplied by 100 ("12.5%", "12,5 %"). */
export function percent(value: number): string {
  return new Intl.NumberFormat(requestLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
}

/**
 * The language a PDF is written in: the request's, except Arabic, which the built-in Latin-1 PDF fonts cannot draw.
 * Those PDFs stay in English until a Unicode font is embedded (ADR 0052).
 */
export function pdfLanguage(language: LanguageCode = requestLanguage()): LanguageCode {
  return language === 'ar' ? 'en' : language;
}

/** An amount with two decimals and the currency code, for PDFs ("USD 5,000.00", "EUR 5.000,00"), in Latin-1 safe spacing. */
export function pdfMoney(amount: number, currency: string): string {
  const n = amount.toLocaleString(requestLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n.replace(/[\u202F\u2009]/g, '\u00A0')}`;
}
