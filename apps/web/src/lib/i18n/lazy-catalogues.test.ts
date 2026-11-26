import { describe, expect, it } from 'vitest';
import { catalogueReady, catalogueVersion, loadCatalogue, subscribeCatalogues, translate, translateData } from './translate';

/** The other languages are a chunk of their own, loaded the first time they are needed (performance, 2026-11-26). */
describe('languages loaded on demand', () => {
  it('shows English until a language has arrived, then that language, and tells subscribers once', async () => {
    expect(catalogueReady('en')).toBe(true);
    expect(catalogueReady('es')).toBe(false);
    expect(translate('es', 'Board')).toBe('Board');
    expect(translateData('es', 'Board')).toBe('Board');

    let told = 0;
    const off = subscribeCatalogues(() => told++);
    const before = catalogueVersion();
    await Promise.all([loadCatalogue('es'), loadCatalogue('es')]);
    off();

    expect(catalogueReady('es')).toBe(true);
    expect(told).toBe(1);
    expect(catalogueVersion()).toBe(before + 1);
    expect(translate('es', 'Board')).toBe('Tablero');
    expect(translate('en', 'Board')).toBe('Board');
    // Languages not asked for stay unloaded.
    expect(catalogueReady('ar')).toBe(false);
  });
});
