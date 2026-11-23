'use client';

import type { WorkspaceDashboard, WorkspaceDashboardPeriod } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** The dashboard of the caller's workspace level (ADR 0071, part 6). Refreshes every minute so new work shows up. */
export function useWorkspaceDashboard(period: WorkspaceDashboardPeriod, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['workspace-dashboard', period],
    queryFn: () => api<WorkspaceDashboard>(`/workspace-dashboard?period=${period}`),
    refetchInterval: 60_000,
  });
}
