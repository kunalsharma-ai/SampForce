import { DEFAULT_REGIONAL, type LanguageCode, normalizeRegional, type Regional } from '@dealflow/types';
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
        const regional = normalizeRegional(p?.regional);
        return { ...current, regional, chosenSignedOut: p?.chosenSignedOut === regional.language ? regional.language : null };
      },
    },
  ),
);
