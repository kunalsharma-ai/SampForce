'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ShellStore {
  /** Focus Workspace: hides the sidebar, ambient background and secondary top-bar icons. Kept on this device. */
  focus: boolean;
  setFocus: (v: boolean) => void;
  toggleFocus: () => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
  customizeOpen: boolean;
  setCustomizeOpen: (v: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export const useShell = create<ShellStore>()(
  persist(
    (set) => ({
      focus: false,
      setFocus: (focus) => set({ focus }),
      toggleFocus: () => set((s) => ({ focus: !s.focus })),
      shortcutsOpen: false,
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      customizeOpen: false,
      setCustomizeOpen: (customizeOpen) => set({ customizeOpen }),
      searchOpen: false,
      setSearchOpen: (v) => set((s) => ({ searchOpen: typeof v === 'function' ? v(s.searchOpen) : v })),
    }),
    { name: 'dealflow:shell', storage: createJSONStorage(() => localStorage), partialize: (s) => ({ focus: s.focus }) },
  ),
);
