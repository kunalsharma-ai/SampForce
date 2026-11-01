'use client';

import type { TerritoryInput, TerritoryRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

const KEY = ['territories'] as const;

export function useTerritories() {
  return useQuery({ queryKey: KEY, queryFn: () => api<TerritoryRow[]>('/territories') });
}

/** Create, update and delete territories; every change refreshes the list and the territory view. */
export function useTerritoryMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['deal-views', 'territories'] })]);
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id: string | null; input: TerritoryInput }) =>
        id ? api<TerritoryRow>(`/territories/${id}`, { method: 'PATCH', json: input }) : api<TerritoryRow>('/territories', { method: 'POST', json: input }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/territories/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}
