import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SERVER_TEXT as SERVER_TEXT } from '@dealflow/types';
import { shape, sourceTexts } from './source-text';

const ROOT = join(__dirname, '../../../..');

/** Permission codes ("reports:write") travel in error details for machines and are not text. */
const NOT_TEXT = /^[a-z_]+:[a-z_]+$/;

describe('text the API sends to people', () => {
  const found = sourceTexts([join(ROOT, 'apps/api/src'), join(ROOT, 'packages/types/src')], ROOT).filter((t) => !NOT_TEXT.test(t.text));
  const shapes = new Set(SERVER_TEXT.keys().map(shape));

  it('finds the messages (the scan itself works)', () => {
    expect(found.length).toBeGreaterThan(500);
    expect(found.map((f) => f.text)).toContain('Deal not found.');
  });

  it('has a Spanish, French, German and Arabic translation for every message', () => {
    const keys = new Set(SERVER_TEXT.keys());
    const missing = [...new Set(found.filter((t) => (t.kind === 'key' ? !keys.has(t.text) : !shapes.has(shape(t.text)))).map((t) => `${t.file}: ${t.text}`))];
    expect(missing, 'Add these to packages/types/src/i18n/text').toEqual([]);
  });
});
