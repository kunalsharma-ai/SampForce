'use client';

import type { BulkDealUpdateInput, DealForecast, DealRow, DealsSummary, Page, PriorityDeal, TerritoryView } from '@dealflow/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface DealViewFilter {
  pipelineId?: string;
  /** "me" or a member id. */
  ownerId?: string;
}

const params = (f: DealViewFilter, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams(extra);
  if (f.pipelineId) p.set('pipelineId', f.pipelineId);
  if (f.ownerId) p.set('ownerId', f.ownerId);
  return p.size ? `?${p}` : '';
};

export function usePriorityDeals(f: DealViewFilter) {
  return useQuery({ queryKey: ['deal-views', 'priority', f], queryFn: () => api<PriorityDeal[]>(`/deals/priority${params(f)}`), placeholderData: keepPreviousData });
}

export function useDealForecast(f: DealViewFilter) {
  return useQuery({ queryKey: ['deal-views', 'forecast', f], queryFn: () => api<DealForecast>(`/deals/forecast${params(f)}`), placeholderData: keepPreviousData });
}

/** Open pipeline and this quarter's results per sales territory. */
export function useTerritoryView(f: DealViewFilter) {
  return useQuery({ queryKey: ['deal-views', 'territories', f], queryFn: () => api<TerritoryView>(`/deals/territories${params(f)}`), placeholderData: keepPreviousData });
}

/**
 * Open deals expected to close between two dates (YYYY-MM-DD), soonest first; at most 100. The list endpoint takes a
 * member id, so "me" is resolved by the caller.
 */
export function useDealsClosing(f: DealViewFilter & { from: string; to: string }, enabled = true) {
  return useQuery({
    queryKey: ['deal-views', 'closing', f],
    queryFn: () =>
      api<Page<DealRow>>(
        `/deals${params({ pipelineId: f.pipelineId, ownerId: f.ownerId }, { status: 'OPEN', closeFrom: f.from, closeTo: f.to, sort: 'expectedCloseDate,-amount', pageSize: '100' })}`,
      ),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The Deals dashboard numbers (ADR 0096). `from`/`to` are YYYY-MM-DD or empty for all time. */
export function useDealsSummary(f: DealViewFilter & { from?: string; to?: string }) {
  const p = new URLSearchParams();
  if (f.pipelineId) p.set('pipelineId', f.pipelineId);
  if (f.ownerId) p.set('ownerId', f.ownerId);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  return useQuery({ queryKey: ['deal-views', 'summary', f], queryFn: () => api<DealsSummary>(`/deals/summary${p.size ? `?${p}` : ''}`), placeholderData: keepPreviousData });
}

/** Changes many deals at once, then refreshes every deal view. */
export function useBulkDeals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkDealUpdateInput) => api<{ updated: number }>('/deals/bulk-update', { method: 'POST', json: input }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['board'] }), qc.invalidateQueries({ queryKey: ['deals'] }), qc.invalidateQueries({ queryKey: ['deal-views'] })]),
  });
}

/** Archives or restores one deal. */
export function useArchiveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api<DealRow>(`/deals/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST', json: {} }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['board'] }), qc.invalidateQueries({ queryKey: ['deals'] }), qc.invalidateQueries({ queryKey: ['deal-views'] }), qc.invalidateQueries({ queryKey: ['deal'] })]),
  });
}
