'use client';

import type { CallDetails, CallListQuery, CallLogInput, CallRow, CallStarted, CallStartInput, CallStats, CallTarget, CallUpdateInput, DialerInput, DialerRow, DialerSettings } from '@dealflow/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { browserTimeZone } from './company-work';

/** The Calls section (ADR 0088). */

const CALL_KEYS = [['calls'], ['call-stats'], ['call-details'], ['interactions'], ['follow-ups'], ['company-dashboard'], ['company-employees'], ['employee-activity'], ['contacts']];
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
  };
}

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

/** A Twilio call refreshes while it rings or is in progress, from Twilio's status callbacks. */
export function useCall(id: string | null, live: boolean) {
  return useQuery({ enabled: !!id, queryKey: ['calls', 'one', id], queryFn: () => api<CallRow>(`/calls/${id}`), refetchInterval: live ? 3_000 : false });
}

export function useCallStats() {
  return useQuery({ queryKey: ['call-stats'], queryFn: () => api<CallStats>(`/calls/stats?tz=${encodeURIComponent(browserTimeZone())}`) });
}

export function useCallMutations() {
  const invalidate = useInvalidateCalls();
  return {
    start: useMutation({ mutationFn: (input: Partial<CallStartInput>) => api<CallStarted>('/calls', { method: 'POST', json: input }), onSuccess: invalidate }),
    log: useMutation({ mutationFn: ({ id, input }: { id: string; input: CallLogInput }) => api<CallRow>(`/calls/${id}/log`, { method: 'POST', json: input }), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: CallUpdateInput }) => api<CallRow>(`/calls/${id}`, { method: 'PATCH', json: input }), onSuccess: invalidate }),
    discard: useMutation({ mutationFn: (id: string) => api(`/calls/${id}`, { method: 'DELETE' }), onSuccess: invalidate }),
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
