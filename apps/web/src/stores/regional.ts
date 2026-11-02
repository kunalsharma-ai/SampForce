import { DEFAULT_REGIONAL, LANGUAGES, type LanguageCode, normalizeRegional, type Regional } from '@dealflow/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface RegionalState {
  /** What is applied now: the account's saved settings, cached on this device so a reload starts in the right language. */
  regional: Regional;
  adopt: (r: Regional) => void;
  /**
   * A language picked on the sign-in or sign-up page, before there is an account to save it to. The app saves it to
   * the account on first load when the account has no setting of its own, then clears it.
   */
  chosenSignedOut: LanguageCode | null;
  chooseSignedOut: (language: LanguageCode) => void;
  clearSignedOut: () => void;
}

/**
 * The first supported language in the browser's preference list (`navigator.languages`), matched on the primary
 * subtag, so `de-AT` picks German. Used on a device that has never stored a language: visitors to a hosted form, a
 * proposal link, the client portal or the website see their own language before anyone has chosen one.
 */
export function visitorLanguage(preferred: readonly string[]): LanguageCode | null {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    const hit = LANGUAGES.find((l) => l.code === primary);
    if (hit) return hit.code;
  }
  return null;
}

function browserLanguage(): LanguageCode {
  if (typeof navigator === 'undefined') return DEFAULT_REGIONAL.language;
  return visitorLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]) ?? DEFAULT_REGIONAL.language;
}

/** Read by the bootstrap script in app/layout.tsx to set <html lang dir> before first paint. */
export const REGIONAL_STORAGE_KEY = 'dealflow:regional';

export const useRegional = create<RegionalState>()(
  persist(
    (set) => ({
      regional: DEFAULT_REGIONAL,
      adopt: (r) => set({ regional: normalizeRegional(r) }),
      chosenSignedOut: null,
      chooseSignedOut: (language) => set((s) => ({ chosenSignedOut: language, regional: normalizeRegional({ ...s.regional, language }) })),
      clearSignedOut: () => set({ chosenSignedOut: null }),
    }),
    {
      name: REGIONAL_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ regional: s.regional, chosenSignedOut: s.chosenSignedOut }),
      merge: (persisted, current) => {
        const p = persisted as { regional?: unknown; chosenSignedOut?: unknown } | undefined;
        // Nothing stored on this device yet: start in the browser's language. Signing in still applies the account's own.
        const regional = p?.regional === undefined ? normalizeRegional({ ...DEFAULT_REGIONAL, language: browserLanguage() }) : normalizeRegional(p.regional);
        return { ...current, regional, chosenSignedOut: p?.chosenSignedOut === regional.language ? regional.language : null };
      },
    },
  ),
);
