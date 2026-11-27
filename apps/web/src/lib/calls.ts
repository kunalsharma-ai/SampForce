'use client';

import type { CallControlInput, CallDetails, CallFavorite, CallListQuery, CallLogInput, CallOutcomeDef, CallOutcomeInput, CallRow, CallStarted, CallStartInput, CallStats, CallTarget, CallUpdateInput, DialerInput, DialerLogRow, DialerRow, DialerSettings, DialerTestResult, RecordingListQuery, RecordingPolicy, RecordingRow } from '@dealflow/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { browserTimeZone } from './company-work';

/** The Calls section (ADR 0088) and the universal dialer (ADR 0101). */

const CALL_KEYS = [['calls'], ['call-stats'], ['call-recordings'], ['call-favorites'], ['deals'], ['call-details'], ['interactions'], ['follow-ups'], ['company-dashboard'], ['company-employees'], ['employee-activity'], ['contacts']];
function useInvalidateCalls() {
  const qc = useQueryClient();
  return () => Promise.all(CALL_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useDialers() {
  return useQuery({ queryKey: ['dialers'], queryFn: () => api<DialerSettings>('/calls/dialers'), staleTime: 60_000 });
}

export function useDialerMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['dialers'] });
  return {
    create: useMutation({ mutationFn: (input: DialerInput) => api<DialerRow>('/calls/dialers', { method: 'POST', json: input }), onSuccess }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: DialerInput }) => api<DialerRow>(`/calls/dialers/${id}`, { method: 'PUT', json: input }), onSuccess }),
    renewSecret: useMutation({ mutationFn: (id: string) => api<DialerRow>(`/calls/dialers/${id}/secret`, { method: 'POST', json: {} }), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api(`/calls/dialers/${id}`, { method: 'DELETE' }), onSuccess }),
    setActive: useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api<DialerRow>(`/calls/dialers/${id}/active`, { method: 'POST', json: { active } }), onSuccess }),
    makeDefault: useMutation({ mutationFn: (id: string) => api<DialerRow>(`/calls/dialers/${id}/default`, { method: 'POST', json: {} }), onSuccess }),
    renewEvents: useMutation({ mutationFn: (id: string) => api<DialerRow>(`/calls/dialers/${id}/events-address`, { method: 'POST', json: {} }), onSuccess }),
    test: useMutation({
      mutationFn: (id: string) => api<DialerTestResult>(`/calls/dialers/${id}/test`, { method: 'POST', json: {} }),
      onSuccess: (_r, id) => Promise.all([qc.invalidateQueries({ queryKey: ['dialers'] }), qc.invalidateQueries({ queryKey: ['dialer-logs', id] })]),
    }),
  };
}

/** A dialer's integration log: each request to the provider and what came back. */
export function useDialerLogs(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['dialer-logs', id], queryFn: () => api<DialerLogRow[]>(`/calls/dialers/${id}/logs`) });
}

/** The workspace's call outcomes: SampForce's 17 with the workspace's changes, then its own. */
export function useCallOutcomes() {
  return useQuery({ queryKey: ['call-outcomes'], queryFn: () => api<CallOutcomeDef[]>('/calls/outcomes'), staleTime: 5 * 60_000 });
}

export function useOutcomeMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['call-outcomes'] });
  return {
    add: useMutation({ mutationFn: (input: CallOutcomeInput) => api<CallOutcomeDef[]>('/calls/outcomes', { method: 'POST', json: input }), onSuccess }),
    save: useMutation({ mutationFn: ({ key, input }: { key: string; input: CallOutcomeInput }) => api<CallOutcomeDef[]>(`/calls/outcomes/${key}`, { method: 'PUT', json: input }), onSuccess }),
    remove: useMutation({ mutationFn: (key: string) => api<CallOutcomeDef[]>(`/calls/outcomes/${key}`, { method: 'DELETE' }), onSuccess }),
  };
}

export function useRecordingPolicy() {
  return useQuery({ queryKey: ['call-recording-policy'], queryFn: () => api<RecordingPolicy>('/calls/recording-policy'), staleTime: 5 * 60_000 });
}

export function useSaveRecordingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordingPolicy) => api<RecordingPolicy>('/calls/recording-policy', { method: 'PUT', json: input }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['call-recording-policy'] }), qc.invalidateQueries({ queryKey: ['dialers'] }), qc.invalidateQueries({ queryKey: ['call-recordings'] })]),
  });
}

export function useCallFavorites() {
  return useQuery({ queryKey: ['call-favorites'], queryFn: () => api<CallFavorite[]>('/calls/favorites'), staleTime: 60_000 });
}

export function useFavoriteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, contactId, on }: { companyId: string | null; contactId: string | null; on: boolean }) => api('/calls/favorites', { method: 'POST', json: { companyId, contactId, on } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['call-favorites'] }), qc.invalidateQueries({ queryKey: ['call-details'] })]),
  });
}

export function useClearNumberFlag() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (target: { companyId?: string | null; contactId?: string | null }) => api('/calls/number-flag/clear', { method: 'POST', json: target }), onSuccess: () => qc.invalidateQueries({ queryKey: ['call-details'] }) });
}

export function useRecordings(q: Partial<RecordingListQuery>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
  return useQuery({ queryKey: ['call-recordings', q], queryFn: () => api<RecordingRow[]>(`/calls/recordings?${qs}`), placeholderData: keepPreviousData });
}

export function useRecordingMutations() {
  const invalidate = useInvalidateCalls();
  return {
    notes: useMutation({ mutationFn: ({ id, notes }: { id: string; notes: string | null }) => api<RecordingRow>(`/calls/recordings/${id}`, { method: 'PATCH', json: { notes } }), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => api(`/calls/recordings/${id}`, { method: 'DELETE' }), onSuccess: invalidate }),
    upload: useMutation({
      mutationFn: async ({ callId, file, source, durationSec }: { callId: string; file: Blob; source: 'UPLOAD' | 'BROWSER'; durationSec?: number | null }) => {
        const qs = new URLSearchParams({ source });
        if (durationSec != null) qs.set('durationSec', String(Math.round(durationSec)));
        return api<RecordingRow>(`/calls/${callId}/recordings?${qs}`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'audio/mpeg' } });
      },
      onSuccess: invalidate,
    }),
  };
}

/** Where a recording's audio plays from (the server checks who may hear it). */
export const recordingAudioUrl = (id: string, download = false) => `/api/v1/calls/recordings/${id}/audio${download ? '?download=1' : ''}`;

export function useCallSearch(q: string) {
  const term = q.trim();
  return useQuery({ enabled: term.length >= 2, queryKey: ['call-search', term], queryFn: () => api<CallTarget[]>(`/calls/search?q=${encodeURIComponent(term)}`), placeholderData: keepPreviousData, staleTime: 30_000 });
}

export function useCallDetails(target: { companyId?: string | null; contactId?: string | null } | null) {
  const qs = new URLSearchParams();
  if (target?.companyId) qs.set('companyId', target.companyId);
  if (target?.contactId) qs.set('contactId', target.contactId);
  return useQuery({ enabled: !!(target?.companyId || target?.contactId), queryKey: ['call-details', target?.companyId ?? '', target?.contactId ?? ''], queryFn: () => api<CallDetails>(`/calls/details?${qs}`) });
}

export function useCalls(q: Partial<CallListQuery>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
  return useQuery({ queryKey: ['calls', q], queryFn: () => api<CallRow[]>(`/calls?${qs}`), placeholderData: keepPreviousData });
}

/** A call refreshes while it rings or is in progress, from the provider's status callbacks. */
export function useCall(id: string | null, live: boolean) {
  return useQuery({ enabled: !!id, queryKey: ['calls', 'one', id], queryFn: () => api<CallRow>(`/calls/${id}`), refetchInterval: live ? 3_000 : false });
}

/** Today's numbers, and incoming calls ringing now (checked every 15 s when a dialer reports incoming calls). */
export function useCallStats(watchIncoming = false) {
  return useQuery({ queryKey: ['call-stats'], queryFn: () => api<CallStats>(`/calls/stats?tz=${encodeURIComponent(browserTimeZone())}`), refetchInterval: watchIncoming ? 15_000 : false });
}

export function useCallMutations() {
  const invalidate = useInvalidateCalls();
  return {
    start: useMutation({ mutationFn: (input: Partial<CallStartInput>) => api<CallStarted>('/calls', { method: 'POST', json: input }), onSuccess: invalidate }),
    log: useMutation({ mutationFn: ({ id, input }: { id: string; input: CallLogInput }) => api<CallRow>(`/calls/${id}/log`, { method: 'POST', json: input }), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: CallUpdateInput }) => api<CallRow>(`/calls/${id}`, { method: 'PATCH', json: input }), onSuccess: invalidate }),
    discard: useMutation({ mutationFn: (id: string) => api(`/calls/${id}`, { method: 'DELETE' }), onSuccess: invalidate }),
    control: useMutation({ mutationFn: ({ id, action }: { id: string; action: CallControlInput['action'] }) => api<CallRow>(`/calls/${id}/control`, { method: 'POST', json: { action } }), onSuccess: invalidate }),
    consent: useMutation({ mutationFn: (id: string) => api<CallRow>(`/calls/${id}/consent`, { method: 'POST', json: {} }), onSuccess: invalidate }),
  };
}

/** Opens a dialer link. Web dialers open in a new tab; phone links (tel:, callto:, sip:, app schemes) hand over to the app. */
export function openDialer(url: string) {
  if (/^https?:/i.test(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function talkTime(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
