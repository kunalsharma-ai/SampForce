'use client';

import { create } from 'zustand';
import type { CrmEntity } from '@/lib/crm';

export type QuickCreateKind = CrmEntity | 'task';

interface QuickCreate {
  kind: QuickCreateKind | null;
  open: (kind: QuickCreateKind) => void;
  close: () => void;
}

export const useQuickCreate = create<QuickCreate>((set) => ({
  kind: null,
  open: (kind) => set({ kind }),
  close: () => set({ kind: null }),
}));
