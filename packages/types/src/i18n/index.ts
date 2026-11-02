import { TextCatalogue } from './catalogue';
import { composed } from './text/composed';
import { errorsAccess } from './text/errors-access';
import { errorsProviders } from './text/errors-providers';
import { errorsRecords } from './text/errors-records';
import { errorsWork } from './text/errors-work';
import { notifications } from './text/notifications';
import { stored } from './text/stored';
import { validation } from './text/validation';

export { pickLanguage, placeholdersOf, TextCatalogue, type TextRow, type TextTable, type TextVars } from './catalogue';

/** Every table of text the server writes, by area. A phrase lives in one table (i18n.test.ts checks for repeats). */
export const SERVER_TEXT_TABLES = { validation, errorsAccess, errorsRecords, errorsWork, errorsProviders, stored, notifications, composed } as const;

const broad = [validation, errorsAccess, errorsRecords, errorsWork, errorsProviders, stored];

/**
 * The server's text in Spanish, French, German and Arabic, for translating finished English text: the API's error and
 * validation messages (by Accept-Language), stored signals, and in the web app text that arrives as data. Notification
 * and composed sentences are left out of the matching here, because their patterns ("{name} replied") are only safe on
 * text known to be a notification or written by `tr()`.
 */
export const SERVER_TEXT = new TextCatalogue(broad);

/** For notifications, which are stored in English and translated when someone opens them. */
export const NOTIFICATION_TEXT = new TextCatalogue([...broad, notifications]);

/** Every phrase, for `tr(key)` in the API, which writes a known phrase by its key. */
export const ALL_SERVER_TEXT = new TextCatalogue(Object.values(SERVER_TEXT_TABLES));
