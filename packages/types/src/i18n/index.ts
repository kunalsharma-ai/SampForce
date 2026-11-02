import { TextCatalogue } from './catalogue';
import { errorsAccess } from './text/errors-access';
import { errorsProviders } from './text/errors-providers';
import { errorsRecords } from './text/errors-records';
import { errorsWork } from './text/errors-work';
import { validation } from './text/validation';

export { pickLanguage, placeholdersOf, TextCatalogue, type TextRow, type TextTable, type TextVars } from './catalogue';

/** Every table of text the server writes, by area. A phrase lives in one table (i18n.test.ts checks for repeats). */
export const SERVER_TEXT_TABLES = { validation, errorsAccess, errorsRecords, errorsWork, errorsProviders } as const;

/**
 * The server's text in Spanish, French, German and Arabic. The API translates error and validation messages with it
 * in the reader's language (Accept-Language), and the web app falls back to it for text that arrives as data.
 */
export const SERVER_TEXT = new TextCatalogue(Object.values(SERVER_TEXT_TABLES));
