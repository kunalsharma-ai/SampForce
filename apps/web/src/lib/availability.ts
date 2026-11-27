'use client';

import { AVAILABILITY_BEAT_MS, type AvailabilityMe, type AvailabilityTeam, type ChoosableStatus } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';

/*
 * Working status in the browser (ADR 0081). The header beats once a minute while a page is open, which keeps the
 * person from showing as Away; every change refreshes their own status and the team boards.
 */

export const AVAILABILITY_ME_KEY = ['availability', 'me'] as const;
const TEAM_KEY = ['availability', 'team'] as const;

/** The signed-in person's status, refreshed by a beat every minute while the page is visible. */
export function useAvailability(enabled = true) {
  return useQuery({
    enabled,
    queryKey: AVAILABILITY_ME_KEY,
    queryFn: () => api<AvailabilityMe>('/availability/beat', { method: 'POST' }),
    refetchInterval: () => (typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : AVAILABILITY_BEAT_MS),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export type AvailabilityAction = 'check-in' | 'break' | 'resume' | 'check-out';

export function useAvailabilityActions() {
  const qc = useQueryClient();
  const done = (me: AvailabilityMe) => {
    qc.setQueryData(AVAILABILITY_ME_KEY, me);
    void qc.invalidateQueries({ queryKey: TEAM_KEY });
  };
  const act = useMutation({ mutationFn: (a: AvailabilityAction) => api<AvailabilityMe>(`/availability/${a}`, { method: 'POST' }), onSuccess: done });
  const choose = useMutation({ mutationFn: (status: ChoosableStatus) => api<AvailabilityMe>('/availability/status', { method: 'PUT', json: { status } }), onSuccess: done });
  return { act, choose };
}

/** The people the caller may see, refreshed every 30 seconds while shown. */
export function useAvailabilityTeam(workspaceId?: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...TEAM_KEY, workspaceId ?? null],
    queryFn: () => api<AvailabilityTeam>(`/availability/team${workspaceId ? `?workspaceId=${workspaceId}` : ''}`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** The current time, ticking every `ms` (so "On break — 12 min" counts up without asking the server). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Whole minutes from an ISO time to now. */
export function minutesSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}
