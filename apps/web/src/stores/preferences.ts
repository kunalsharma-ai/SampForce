'use client';

import { type Appearance, DEFAULT_APPEARANCE, normalizeAppearance } from '@dealflow/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type { Appearance };
export type ThemePref = Appearance['mode'];
export type MotionPref = Appearance['motion'];

interface Preferences {
  /** What is applied now. Saved to the person's account (see lib/appearance-sync.ts) and cached on this device. */
  appearance: Appearance;
  /** True when settings changed on this device and have not reached the server yet. */
  dirty: boolean;
  sidebarCollapsed: boolean;
  /** The workspace brand colour, used as the primary colour unless the person picked their own. Not persisted. */
  brandColor: string | null;
  setBrandColor: (c: string | null) => void;
  /** Replaces the settings with a change the person made (marks them for saving). */
  update: (patch: Partial<Appearance>) => void;
  /** Adopts settings that came from the server (does not mark them for saving). */
  adopt: (a: Appearance) => void;
  markSynced: () => void;
  toggleSidebar: () => void;
  // Shorthands kept for existing callers.
  setTheme: (mode: ThemePref) => void;
  setMotion: (m: MotionPref) => void;
  setLowPower: (v: boolean) => void;
}

/** Version 0 stored { theme, motion, lowPower } on this device only. */
function fromV0(old: Record<string, unknown>): Appearance {
  const motion = old.motion === 'reduced' ? 'minimal' : old.motion === 'system' || old.motion === undefined ? 'balanced' : old.motion;
  return normalizeAppearance({ mode: old.theme, motion, lowPower: old.lowPower });
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      appearance: DEFAULT_APPEARANCE,
      dirty: false,
      sidebarCollapsed: false,
      brandColor: null,
      setBrandColor: (brandColor) => set({ brandColor }),
      update: (patch) => set((s) => ({ appearance: normalizeAppearance({ ...s.appearance, ...patch }), dirty: true })),
      adopt: (appearance) => set({ appearance: normalizeAppearance(appearance), dirty: false }),
      markSynced: () => set({ dirty: false }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (mode) => set((s) => ({ appearance: { ...s.appearance, mode }, dirty: true })),
      setMotion: (motion) => set((s) => ({ appearance: { ...s.appearance, motion }, dirty: true })),
      setLowPower: (lowPower) => set((s) => ({ appearance: { ...s.appearance, lowPower }, dirty: true })),
    }),
    {
      name: 'dealflow:preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ appearance: s.appearance, dirty: s.dirty, sidebarCollapsed: s.sidebarCollapsed }),
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Record<string, unknown>;
        if (version === 0) {
          // A device that had chosen something before settings moved to the account uploads it once.
          const changed = old.theme !== undefined || old.motion !== undefined || old.lowPower !== undefined;
          return { appearance: fromV0(old), dirty: changed, sidebarCollapsed: !!old.sidebarCollapsed };
        }
        return { ...old, appearance: normalizeAppearance(old.appearance) };
      },
    },
  ),
);

/** Selectors for the settings most components read. */
export const useAppearanceValue = <K extends keyof Appearance>(key: K): Appearance[K] => usePreferences((s) => s.appearance[key]);
