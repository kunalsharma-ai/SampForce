'use client';

import type { DealForecast, DealRow, Page, PriorityDeal } from '@dealflow/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
