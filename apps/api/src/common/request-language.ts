import { AsyncLocalStorage } from 'node:async_hooks';
import { type LanguageCode, pickLanguage, SERVER_TEXT, type TextVars } from '@dealflow/types';

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
  return SERVER_TEXT.say(requestLanguage(), key, vars);
}

/** Translates finished English text (an error message, a validation message) into `language`. */
export function localize(text: string, language: LanguageCode = requestLanguage()): string {
  return SERVER_TEXT.localize(language, text);
}

export { pickLanguage };
