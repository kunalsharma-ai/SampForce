import { activities } from './activities';
import { auth } from './auth';
import { crm } from './crm';
import { dashboard } from './dashboard';
import { deals } from './deals';
import { sequences } from './sequences';
import { communication } from './communication';
import { meetings } from './meetings';
import { settings } from './settings';
import { table } from './table';
import { territories } from './territories';
import type { PhraseTable } from './types';

/** Every page phrase table. A phrase lives in exactly one table (src/lib/i18n/i18n.test.ts checks for repeats). */
export const PHRASE_TABLES = { dashboard, table, crm, deals, auth, settings, activities, territories, sequences, communication, meetings } as const satisfies Record<string, PhraseTable>;

export const PHRASES = { ...dashboard, ...table, ...crm, ...deals, ...auth, ...settings, ...activities, ...territories, ...sequences, ...communication, ...meetings } as const;
export type PhraseKey = keyof typeof PHRASES;
export type { PhraseRow, PhraseTable } from './types';
