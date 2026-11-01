'use client';

import {
  completeLayout,
  DASHBOARD_PRESETS,
  type DashboardCharts,
  type DashboardFilter,
  type DashboardLayout,
  type DashboardSummary,
} from '@dealflow/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

const qs = (f: DashboardFilter) => {
  const p = new URLSearchParams({ period: f.period });
  if (f.ownerId) p.set('ownerId', f.ownerId);
  if (f.pipelineId) p.set('pipelineId', f.pipelineId);
  return `?${p}`;
};

export function useDashboardSummary(filter: DashboardFilter, enabled = true) {
  return useQuery({
    queryKey: ['dashboard', 'summary', filter],
    queryFn: () => api<DashboardSummary>(`/dashboard/summary${qs(filter)}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDashboardCharts(filter: DashboardFilter, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'charts', filter],
    queryFn: () => api<DashboardCharts>(`/dashboard/charts${qs(filter)}`),
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The person's saved layout in this workspace, or the salesperson preset when nothing is saved. */
export function useDashboardLayout() {
  const { data: me } = useSession();
  const q = useQuery({
    queryKey: ['dashboard-layout', me?.tenant.id],
    queryFn: () => api<{ layout: DashboardLayout | null }>('/me/dashboard-layout'),
    enabled: !!me && !me.restriction,
    staleTime: Infinity,
  });
  return { ...q, layout: q.data?.layout ?? completeLayout(DASHBOARD_PRESETS.salesperson), saved: !!q.data?.layout };
}

export function useSaveDashboardLayout() {
  const qc = useQueryClient();
  const { data: me } = useSession();
  const key = ['dashboard-layout', me?.tenant.id];
  return useMutation({
    mutationFn: (layout: DashboardLayout | null) =>
      layout
        ? api<{ layout: DashboardLayout | null }>('/me/dashboard-layout', { method: 'PUT', json: layout })
        : api<{ layout: DashboardLayout | null }>('/me/dashboard-layout', { method: 'DELETE' }),
    onMutate: (layout) => {
      const prev = qc.getQueryData<{ layout: DashboardLayout | null }>(key);
      qc.setQueryData(key, { layout });
      return { prev };
    },
    onError: (_e, _l, ctx) => qc.setQueryData(key, ctx?.prev),
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}

/** Builds a CSV file from rows and starts a download. Values are quoted; formulas are neutralised. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    let s = v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
