import { type LanguageCode, SERVER_TEXT } from '@dealflow/types';
import { ar } from './messages/ar';
import { de } from './messages/de';
import { en, type Messages } from './messages/en';
import { es } from './messages/es';
import { fr } from './messages/fr';
import { PHRASES, type PhraseKey } from './phrases';
import type { Catalogue } from './translate';

/*
 * The Spanish, French, German and Arabic text (about 1.5 MB of page phrases plus the server's own text). It is a
 * separate chunk that translate.ts loads only when the interface is in one of those languages, so English pages no
 * longer download every translation.
 */

const COLUMN: Record<Exclude<LanguageCode, 'en'>, number> = { es: 0, fr: 1, de: 2, ar: 3 };
const SHELL: Record<Exclude<LanguageCode, 'en'>, Messages> = { es, fr, de, ar };

function phrases(lang: LanguageCode): Record<PhraseKey, string> {
  const out = {} as Record<PhraseKey, string>;
  for (const [key, row] of Object.entries(PHRASES) as [PhraseKey, readonly string[]][]) out[key] = lang === 'en' ? key : row[COLUMN[lang]]!;
  return out;
}

/** The whole catalogue of one language: shell messages and page phrases. */
export function buildCatalogue(lang: LanguageCode): Catalogue {
  return (lang === 'en' ? { ...en, ...phrases('en') } : { ...SHELL[lang], ...phrases(lang) }) as Catalogue;
}

/** Every catalogue at once (tests). */
export function allCatalogues(): Record<LanguageCode, Catalogue> {
  return { en: buildCatalogue('en'), es: buildCatalogue('es'), fr: buildCatalogue('fr'), de: buildCatalogue('de'), ar: buildCatalogue('ar') };
}

/** The server's text catalogue, for text that arrives as data. */
export function localizeServerText(language: LanguageCode, text: string, term: (value: string) => string | undefined): string {
  return SERVER_TEXT.localize(language, text, term);
}
