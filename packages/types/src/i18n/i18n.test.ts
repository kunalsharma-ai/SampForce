import { describe, expect, it } from 'vitest';
import { pickLanguage, placeholdersOf, TextCatalogue } from './catalogue';
import { SERVER_TEXT, SERVER_TEXT_TABLES } from './index';

describe('server text tables', () => {
  const rows = Object.entries(SERVER_TEXT_TABLES).flatMap(([table, t]) => Object.entries(t).map(([key, row]) => ({ table, key, row: row as readonly string[] })));

  it('gives every phrase four non-empty translations with the same placeholders', () => {
    for (const { key, row } of rows) {
      expect(row, key).toHaveLength(4);
      const want = [...placeholdersOf(key)].sort();
      for (const text of row) {
        expect(text.trim(), key).not.toBe('');
        expect([...placeholdersOf(text)].sort(), `${key} → ${text}`).toEqual(want);
      }
    }
  });

  it('keeps each phrase in one table', () => {
    const seen = new Map<string, string>();
    for (const { table, key } of rows) {
      expect(seen.get(key), `"${key}" is in ${seen.get(key)} and ${table}`).toBeUndefined();
      seen.set(key, table);
    }
  });
});

describe('TextCatalogue', () => {
  const cat = new TextCatalogue([
    {
      'Deal not found.': ['No se encontró la oportunidad.', 'Opportunité introuvable.', 'Verkaufschance nicht gefunden.', 'لم يُعثر على الصفقة.'],
      '{what} not found.': ['No se encontró: {what}.', 'Introuvable : {what}.', 'Nicht gefunden: {what}.', 'غير موجود: {what}.'],
      'Import up to {max} rows at a time.': ['Importa hasta {max} filas a la vez.', 'Importez jusqu’à {max} lignes à la fois.', 'Importieren Sie bis zu {max} Zeilen auf einmal.', 'استورد حتى {max} صف في كل مرة.'],
      'The deal is in {a} and the quote in {b}.': ['La oportunidad está en {a} y el presupuesto en {b}.', 'x {a} {b}', 'Angebot in {b}, Verkaufschance in {a}.', 'x {a} {b}'],
      Required: ['Obligatorio', 'Obligatoire', 'Erforderlich', 'مطلوب'],
    },
  ]);

  it('translates exact phrases and leaves English and unknown text alone', () => {
    expect(cat.localize('de', 'Deal not found.')).toBe('Verkaufschance nicht gefunden.');
    expect(cat.localize('en', 'Deal not found.')).toBe('Deal not found.');
    expect(cat.localize('fr', 'Something nobody wrote down.')).toBe('Something nobody wrote down.');
  });

  it('matches a phrase with placeholders, carrying the values over in the translation’s order', () => {
    expect(cat.localize('de', 'The deal is in EUR and the quote in USD.')).toBe('Angebot in USD, Verkaufschance in EUR.');
    expect(cat.localize('es', 'Widget not found.')).toBe('No se encontró: Widget.');
  });

  it('prefers the exact phrase over a pattern, and translates a carried value that is itself a phrase', () => {
    expect(cat.localize('es', 'Deal not found.')).toBe('No se encontró la oportunidad.');
    expect(cat.localize('fr', 'Required not found.')).toBe('Introuvable : Obligatoire.');
  });

  it('rewrites English digit grouping in the reader’s format, but not plain numbers', () => {
    expect(cat.localize('de', 'Import up to 5,000 rows at a time.')).toBe('Importieren Sie bis zu 5.000 Zeilen auf einmal.');
    expect(cat.localize('de', 'Import up to 2026 rows at a time.')).toBe('Importieren Sie bis zu 2026 Zeilen auf einmal.');
  });

  it('writes a phrase with values, numbers in the language’s format', () => {
    expect(cat.say('de', 'Import up to {max} rows at a time.', { max: 5000 })).toBe('Importieren Sie bis zu 5.000 Zeilen auf einmal.');
    expect(cat.say('en', 'Import up to {max} rows at a time.', { max: 5000 })).toBe('Import up to 5,000 rows at a time.');
  });

  it('is what the shared catalogue does for real messages', () => {
    expect(SERVER_TEXT.localize('ar', 'String must contain at least 3 character(s)')).toBe('يجب ألا يقل عن 3 حرف');
    expect(SERVER_TEXT.localize('fr', 'Escalation not found.')).toBe('Escalade introuvable.');
  });
});

describe('pickLanguage', () => {
  it('follows the preference order and q values, on the primary subtag', () => {
    expect(pickLanguage('de-AT,de;q=0.9,en;q=0.8')).toBe('de');
    expect(pickLanguage('ja,fr;q=0.5,en;q=0.9')).toBe('en');
    expect(pickLanguage('ar')).toBe('ar');
    expect(pickLanguage('pt-BR')).toBe('en');
    expect(pickLanguage(undefined)).toBe('en');
    expect(pickLanguage('es;q=0')).toBe('en');
  });
});
