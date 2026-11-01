import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_TYPES,
  DEAL_PRIORITIES,
  DEAL_RISK_LABELS,
  EMAIL_STATUS_LABELS,
  ENROLL_SKIP_LABELS,
  INBOX_STATUS_LABELS,
  LANGUAGES,
  LEAD_STATUSES,
  NEXT_ACTION_LABELS,
  SSO_ERRORS,
  THEMES,
  TIMELINE_KIND_LABELS,
} from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { ENTITY_LABEL, titleCase } from '@/lib/crm';
import { MODULES, moduleKey } from '@/lib/navigation';
import { en } from './messages/en';
import { PHRASE_TABLES, PHRASES } from './phrases';
import { CATALOGUES, translate, translatePlural } from './translate';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const PLURAL = /_(zero|one|two|few|many|other)$/;

describe('message catalogues', () => {
  it('has a catalogue for every language the API accepts', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  for (const [lang, messages] of Object.entries(CATALOGUES)) {
    it(`${lang}: translates every key, with the same placeholders and no unknown keys`, () => {
      const known = new Set([...Object.keys(en), ...Object.keys(PHRASES)]);
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const text = messages[key];
        expect(text, `${lang} ${key}`).toBeTruthy();
        // A plural form may drop {count} ("one day ago"), but may never introduce a placeholder the source lacks.
        if (PLURAL.test(key)) for (const p of placeholders(text)) expect(placeholders(en[key]), `${lang} ${key}`).toContain(p);
        else expect(placeholders(text), `${lang} ${key}`).toEqual(placeholders(en[key]));
      }
      for (const key of Object.keys(messages)) {
        if (!known.has(key)) expect(PLURAL.test(key) && known.has(`${key.replace(PLURAL, '')}_other`), `${lang} has unknown key ${key}`).toBe(true);
      }
    });

    it(`${lang}: has every plural form the language uses`, () => {
      const forms = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const bases = Object.keys(en).filter((k) => k.endsWith('_other')).map((k) => k.replace(/_other$/, ''));
      for (const base of bases) for (const form of forms) expect((messages as Record<string, string>)[`${base}_${form}`], `${lang} ${base}_${form}`).toBeTruthy();
    });
  }

  it('names every sidebar module and group', () => {
    for (const m of MODULES) expect(en).toHaveProperty([moduleKey(m)]);
    for (const g of new Set(MODULES.map((m) => m.group))) expect(en).toHaveProperty([`nav.group.${g}`]);
  });
});

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('page phrases', () => {
  it('keeps each phrase in one table', () => {
    const seen = new Map<string, string>();
    for (const [table, rows] of Object.entries(PHRASE_TABLES))
      for (const key of Object.keys(rows)) {
        expect(seen.get(key), `"${key}" is in both ${seen.get(key)} and ${table}`).toBeUndefined();
        seen.set(key, table);
      }
  });

  it('translates every phrase into every language with the same placeholders', () => {
    for (const [key, row] of Object.entries(PHRASES)) {
      expect(row, key).toHaveLength(4);
      for (const text of row) {
        expect(text.trim(), key).not.toBe('');
        expect(placeholders(text), `${key} -> ${text}`).toEqual(placeholders(key));
      }
    }
  });

  // Labels that reach the pages as data and are shown through t.maybe(): each must have a phrase, or it would
  // silently stay in English.
  const dataLabels: [string, string[]][] = [
    ['shared type labels', [...Object.values(DEAL_RISK_LABELS), ...Object.values(EMAIL_STATUS_LABELS), ...Object.values(TIMELINE_KIND_LABELS), ...Object.values(INBOX_STATUS_LABELS), ...Object.values(ENROLL_SKIP_LABELS), ...Object.values(NEXT_ACTION_LABELS)]],
    ['statuses, priorities and activity types', [...LEAD_STATUSES, 'OPEN', 'WON', 'LOST', ...DEAL_PRIORITIES, ...ACTIVITY_TYPES].map(titleCase)],
    ['activity log buttons', ACTIVITY_TYPES.map((a) => `Log ${a.toLowerCase()}`)],
    [
      'record names in sentences',
      Object.values(ENTITY_LABEL).flatMap(({ one, many }) => {
        const o = one.toLowerCase();
        const m = many.toLowerCase();
        return [many, `New ${o}`, `Edit ${o}`, `Create ${o}`, `Delete ${o}`, `Delete this ${o}?`, `You have an unsaved ${o} from {when}.`, `No ${m} yet.`, o, m];
      }),
    ],
    // Sent by the API: KPI names and onboarding steps (dashboard), buying signals and flags (record intelligence),
    // deal health risk signals (scoring). Read from the API source so a new label fails here until it is translated.
    ['dashboard API labels', [...source('../../../../api/src/dashboard/dashboard.service.ts').matchAll(/label: '([^']+)'/g)].map((m) => m[1]!)],
    ['record intelligence API labels', [...source('../../../../api/src/intelligence/record-intelligence.service.ts').matchAll(/label: '([^']+)'/g)].map((m) => m[1]!)],
    ['deal health signals', [...source('../../../../api/src/ai/scoring.ts').matchAll(/risk\('\w+', '([^']+)'/g)].map((m) => m[1]!)],
    ['fixed forecast columns', ['Overdue', 'Later', 'No close date']],
    // Sign-in errors and the validation messages of the shared auth schemas, shown through t.maybe() on the auth pages.
    ['single sign-on errors', Object.values(SSO_ERRORS)],
    // Theme descriptions and the readability check labels come from the shared appearance module.
    ['theme descriptions', THEMES.map((th) => th.description)],
    ['contrast check labels', [...source('../../../../../packages/types/src/appearance.ts').matchAll(/\['([^']+)', '[\w-]+', '[\w-]+', [\d.]+\]/g)].map((m) => m[1]!)],
    ['custom field validation messages', [...source('../../../../../packages/types/src/crm.ts').matchAll(/customFieldDefSchema[\s\S]*?CustomFieldDefInput/g)].flatMap((m) => [...m[0].matchAll(/(?:regex\([^,]+, |message: )'([^']+)'/g)].map((x) => x[1]!))],
    ['workspace settings validation messages', [...source('../../app/app/settings/workspace-settings.tsx').matchAll(/(?:min|regex|length)\([^,]+, '([^']+)'\)/g)].map((m) => m[1]!)],
    ['territory validation messages', [...source('../../../../../packages/types/src/territories.ts').matchAll(/(?:min|regex)\([^,]+, '([^']+)'\)|refine\([^,]+, '([^']+)'\)/g)].map((m) => (m[1] ?? m[2])!)],
    ['auth validation messages', [...[...source('../../../../../packages/types/src/auth.ts').matchAll(/(?:min|regex)\([^,]+, '([^']+)'\)/g)].map((m) => m[1]!), 'Invalid email']],
  ];
  for (const [name, labels] of dataLabels)
    it(`has a phrase for every ${name}`, () => {
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.filter((l) => !(l in PHRASES))).toEqual([]);
    });
});

describe('translate', () => {
  it('fills placeholders and writes numbers in the format locale', () => {
    expect(translate('de', 'nav.removeFavourite', { label: 'Acme' })).toBe('Acme aus den Favoriten entfernen');
    expect(translate('en', 'regional.formatsAuto', { locale: 'en-GB' })).toBe('Match the language (en-GB)');
    expect(translatePlural('en', 'regional.days', 1234, undefined, 'de-DE')).toBe('1.234 days ago');
  });

  it('looks up page phrases by their English text, and leaves unknown text as it came', () => {
    expect(translate('en', 'Owner')).toBe('Owner');
    expect(translate('es', 'Owner')).toBe('Responsable');
    expect(translate('de', 'Page {page} of {pages}', { page: 2, pages: 1200 }, 'de-DE')).toBe('Seite 2 von 1.200');
    expect(translate('fr', 'Acme pipeline' as never)).toBe('Acme pipeline');
    expect(translatePlural('ar', 'count.deals', 2)).toBe('صفقتان');
  });

  it('picks plural forms with the language’s rules', () => {
    expect(translatePlural('en', 'regional.days', 1)).toBe('1 day ago');
    expect(translatePlural('fr', 'regional.days', 2)).toBe('il y a 2 jours');
    expect(translatePlural('ar', 'regional.days', 0)).toBe('اليوم');
    expect(translatePlural('ar', 'regional.days', 2)).toBe('قبل يومين');
    expect(translatePlural('ar', 'regional.days', 5, undefined, 'en')).toBe('قبل 5 أيام');
    expect(translatePlural('ar', 'regional.days', 11, undefined, 'en')).toBe('قبل 11 يومًا');
  });
});
