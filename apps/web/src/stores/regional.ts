import { DEFAULT_REGIONAL, normalizeRegional, type Regional } from '@dealflow/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface RegionalState {
  /** What is applied now: the account's saved settings, cached on this device so a reload starts in the right language. */
  regional: Regional;
  adopt: (r: Regional) => void;
}

/** Read by the bootstrap script in app/layout.tsx to set <html lang dir> before first paint. */
export const REGIONAL_STORAGE_KEY = 'dealflow:regional';

export const useRegional = create<RegionalState>()(
  persist(
    (set) => ({
      regional: DEFAULT_REGIONAL,
      adopt: (r) => set({ regional: normalizeRegional(r) }),
    }),
    {
      name: REGIONAL_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ regional: s.regional }),
      merge: (persisted, current) => ({ ...current, regional: normalizeRegional((persisted as { regional?: unknown } | undefined)?.regional) }),
    },
  ),
);
