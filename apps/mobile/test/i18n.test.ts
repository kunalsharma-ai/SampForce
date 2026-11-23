import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MOBILE_DASHBOARD_CARD_DEFS, MOBILE_MODULE_DEFS } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { HANDLER_LABEL, STATUS_LABEL } from '../src/lib/help-types';
import { pickLanguage, setLanguage, t } from '../src/lib/i18n';
import { greetingFor, LEVEL_LABEL } from '../src/lib/labels';
import { PHRASES } from '../src/lib/phrases';

const ROOT = join(import.meta.dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const source = [...files(join(ROOT, 'app')), ...files(join(ROOT, 'src'))].map((f) => readFileSync(f, 'utf8')).join('\n');

describe('app phrases', () => {
  it('translates every phrase the screens use into all four languages', () => {
    const used = [...source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
    expect(used.length).toBeGreaterThan(40);
    const missing = used.filter((k) => !PHRASES[k]);
    expect(missing).toEqual([]);
  });

  it('translates the labels and messages shown through tMaybe', () => {
    const labels = [
      ...MOBILE_MODULE_DEFS.flatMap((m) => [m.label, m.description]),
      ...Object.values(MOBILE_DASHBOARD_CARD_DEFS).flatMap((c) => [c.label, c.description]),
      ...Object.values(LEVEL_LABEL),
      ...Object.values(STATUS_LABEL),
      ...Object.values(HANDLER_LABEL),
      ...[5, 13, 20].map(greetingFor),
      // Messages the app's own logic produces (api.ts, session-controller.ts).
      ...[...source.matchAll(/(?:error|message|super\(|NetworkError\(|Error\()[^'\n]*'([A-Z][^'\n]{8,}\.)'/g)].map((m) => m[1]!),
    ];
    expect(labels.filter((k) => !PHRASES[k])).toEqual([]);
  });

  it('keeps every translation filled in, with the same placeholders as the English', () => {
    for (const [en, row] of Object.entries(PHRASES)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const x of row) {
        expect(x.trim(), en).not.toBe('');
        expect(vars(x), en).toEqual(vars(en));
      }
    }
  });

  it('follows the phone language, falling back to English', () => {
    expect(pickLanguage(['de-DE', 'en-GB'])).toBe('de');
    expect(pickLanguage(['ja-JP', 'ar-AE'])).toBe('ar');
    expect(pickLanguage(['ja-JP'])).toBe('en');
    setLanguage('fr');
    expect(t('Good morning, {name}', { name: 'Ana' })).toBe('Bonjour, Ana');
    setLanguage('en');
    expect(t('Good morning, {name}', { name: 'Ana' })).toBe('Good morning, Ana');
  });
});
