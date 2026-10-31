'use client';

import { create } from 'zustand';

interface CopilotStore {
  open: boolean;
  /** A question to ask as soon as the panel opens (from "Ask Copilot" buttons elsewhere in the app). */
  pending: string | null;
  setOpen: (open: boolean) => void;
  ask: (question: string) => void;
  takePending: () => string | null;
}

export const useCopilot = create<CopilotStore>((set, get) => ({
  open: false,
  pending: null,
  setOpen: (open) => set({ open }),
  ask: (question) => set({ open: true, pending: question }),
  takePending: () => {
    const q = get().pending;
    if (q) set({ pending: null });
    return q;
  },
}));
