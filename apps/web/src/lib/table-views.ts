'use client';

import {
  type BulkActionInput,
  type BulkActionResult,
  type SavedView,
  type SavedViewInput,
  type SavedViewUpdate,
  type TableEntity,
  type ViewConfig,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

export const viewsKey = (tenantId: string | undefined, entity: TableEntity) => ['views', tenantId ?? 'none', entity] as const;

export function useSavedViews(entity: TableEntity) {
  const { data: me } = useSession();
  return useQuery({
    queryKey: viewsKey(me?.tenant.id, entity),
    queryFn: () => api<SavedView[]>(`/views?entity=${entity}`),
    enabled: !!me,
    staleTime: 30_000,
  });
}

export function useViewMutations(entity: TableEntity) {
  const qc = useQueryClient();
  const { data: me } = useSession();
  const key = viewsKey(me?.tenant.id, entity);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return {
    create: useMutation({ mutationFn: (v: Omit<SavedViewInput, 'entity'>) => api<SavedView>('/views', { method: 'POST', json: { ...v, entity } }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...v }: SavedViewUpdate & { id: string }) => api<SavedView>(`/views/${id}`, { method: 'PATCH', json: v }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/views/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useBulkAction(entity: TableEntity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<BulkActionInput, 'entity'>) => api<BulkActionResult>('/records/bulk', { method: 'POST', json: { ...input, entity } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [entity] }),
  });
}

/** Two configs show the same table (ignores key order in widths). */
export function sameConfig(a: ViewConfig, b: ViewConfig): boolean {
  const norm = (c: ViewConfig) => JSON.stringify({ ...c, widths: Object.fromEntries(Object.entries(c.widths).sort()) , filters: Object.fromEntries(Object.entries(c.filters).filter(([, v]) => v !== undefined && v !== '').sort()) });
  return norm(a) === norm(b);
}
