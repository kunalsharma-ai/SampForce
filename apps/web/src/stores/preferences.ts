'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePref = 'system' | 'dark' | 'light';
/** full = all motion, reduced = essential transitions only, off = no animation at all. */
export type MotionPref = 'system' | 'full' | 'reduced' | 'off';

interface Preferences {
  theme: ThemePref;
  motion: MotionPref;
  /** Disables ambient effects and (from Phase 7) 3D scenes to save battery and GPU. */
  lowPower: boolean;
  sidebarCollapsed: boolean;
  setTheme: (t: ThemePref) => void;
  setMotion: (m: MotionPref) => void;
  setLowPower: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      theme: 'dark',
      motion: 'system',
      lowPower: false,
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      setMotion: (motion) => set({ motion }),
      setLowPower: (lowPower) => set({ lowPower }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'dealflow:preferences', storage: createJSONStorage(() => localStorage) },
  ),
);
