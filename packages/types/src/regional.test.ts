import { describe, expect, it } from 'vitest';
import { languageDir, normalizeRegional, regionalSchema, resolveFormatLocale } from './regional';

describe('regional settings', () => {
  it('canonicalises the format locale and rejects invalid tags', () => {
    expect(regionalSchema.parse({ language: 'en', formatLocale: 'en-gb' })).toEqual({ language: 'en', formatLocale: 'en-GB' });
    expect(regionalSchema.safeParse({ language: 'en', formatLocale: 'english please' }).success).toBe(false);
    expect(regionalSchema.safeParse({ language: 'zz', formatLocale: null }).success).toBe(false);
  });

  it('reads stored values leniently', () => {
    expect(normalizeRegional(null)).toEqual({ language: 'en', formatLocale: null });
    expect(normalizeRegional({ language: 'fr', formatLocale: '!!' })).toEqual({ language: 'fr', formatLocale: null });
  });

  it('resolves the locale: explicit, then a browser locale in the same language, then the language', () => {
    expect(resolveFormatLocale({ language: 'en', formatLocale: 'de-CH' }, ['en-GB'])).toBe('de-CH');
    expect(resolveFormatLocale({ language: 'en', formatLocale: null }, ['fr-FR', 'en-GB'])).toBe('en-GB');
    expect(resolveFormatLocale({ language: 'ar', formatLocale: null }, ['en-GB'])).toBe('ar');
  });

  it('knows which languages read right to left', () => {
    expect(languageDir('ar')).toBe('rtl');
    expect(languageDir('de')).toBe('ltr');
  });
});
