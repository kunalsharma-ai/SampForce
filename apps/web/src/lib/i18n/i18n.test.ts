import { LANGUAGES } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { MODULES, moduleKey } from '@/lib/navigation';
import { en } from './messages/en';
import { CATALOGUES, translate, translatePlural } from './translate';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const PLURAL = /_(zero|one|two|few|many|other)$/;

describe('message catalogues', () => {
  it('has a catalogue for every language the API accepts', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  for (const [lang, messages] of Object.entries(CATALOGUES)) {
    it(`${lang}: translates every key, with the same placeholders and no unknown keys`, () => {
      const known = new Set(Object.keys(en));
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const text = messages[key];
        expect(text, `${lang} ${key}`).toBeTruthy();
        // A plural form may drop {count} ("one day ago"), but may never introduce a placeholder the source lacks.
        if (PLURAL.test(key)) for (const p of placeholders(text)) expect(placeholders(en[key]), `${lang} ${key}`).toContain(p);
        else expect(placeholders(text), `${lang} ${key}`).toEqual(placeholders(en[key]));
      }
      for (const key of Object.keys(messages)) {
        if (!known.has(key as keyof typeof en)) expect(PLURAL.test(key) && known.has(`${key.replace(PLURAL, '')}_other` as keyof typeof en), `${lang} has unknown key ${key}`).toBe(true);
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

describe('translate', () => {
  it('fills placeholders and writes numbers in the format locale', () => {
    expect(translate('de', 'nav.removeFavourite', { label: 'Acme' })).toBe('Acme aus den Favoriten entfernen');
    expect(translate('en', 'regional.formatsAuto', { locale: 'en-GB' })).toBe('Match the language (en-GB)');
    expect(translatePlural('en', 'regional.days', 1234, undefined, 'de-DE')).toBe('1.234 days ago');
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
