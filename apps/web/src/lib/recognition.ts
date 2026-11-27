'use client';

import type {
  PipCard,
  PipCreateInput,
  PipDecisionInput,
  PipDetail,
  PipsView,
  PipUpdateInput,
  RecognitionAwardInput,
  RecognitionAwardRow,
  RecognitionCard,
  RecognitionPolicy,
  RecognitionScopeView,
  RecognitionTargetCreateInput,
  RecognitionTargetRow,
  RecognitionTargetUpdateInput,
  RecognitionView,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** Employee of the Month and Performance Improvement Plans (ADR 0102). Counted on the server from real records. */

const CARD = ['recognition', 'me'] as const;
const VIEW = ['recognition', 'view'] as const;
const PIP_CARD = ['pips', 'me'] as const;
const PIPS = ['pips'] as const;

/** The dashboard card: refreshed every minute and when the tab comes back, so progress moves by itself. */
export function useRecognitionCard(enabled = true) {
  return useQuery({ queryKey: CARD, queryFn: () => api<RecognitionCard>('/recognition/me'), enabled, refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export function useRecognitionView(month: string | null) {
  return useQuery({ queryKey: [...VIEW, month ?? 'current'], queryFn: () => api<RecognitionView>(`/recognition${month ? `?month=${month}` : ''}`), refetchOnWindowFocus: true });
}

export function useRecognitionMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['recognition'] }), qc.invalidateQueries({ queryKey: ['notifications'] })]);
  return {
    create: useMutation({ mutationFn: (input: RecognitionTargetCreateInput) => api<RecognitionTargetRow>('/recognition/targets', { method: 'POST', json: input }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: RecognitionTargetUpdateInput }) => api<RecognitionTargetRow>(`/recognition/targets/${id}`, { method: 'PATCH', json: input }), onSuccess: done }),
    cancel: useMutation({ mutationFn: (id: string) => api<void>(`/recognition/targets/${id}/cancel`, { method: 'POST', json: {} }), onSuccess: done }),
    award: useMutation({ mutationFn: (input: RecognitionAwardInput) => api<RecognitionAwardRow>('/recognition/awards', { method: 'POST', json: input }), onSuccess: done }),
    select: useMutation({ mutationFn: (month: string) => api<RecognitionScopeView>('/recognition/select', { method: 'POST', json: { month } }), onSuccess: done }),
    revoke: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api<void>(`/recognition/awards/${id}/revoke`, { method: 'POST', json: { reason } }), onSuccess: done }),
    policy: useMutation({ mutationFn: (p: RecognitionPolicy) => api<RecognitionPolicy>('/recognition/policy', { method: 'PUT', json: p }), onSuccess: done }),
  };
}

/** The dashboard: null plan and null completion show nothing at all. */
export function usePipCard(enabled = true) {
  return useQuery({ queryKey: PIP_CARD, queryFn: () => api<PipCard>('/pips/me'), enabled, refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export function usePips() {
  return useQuery({ queryKey: [...PIPS, 'list'], queryFn: () => api<PipsView>('/pips'), refetchOnWindowFocus: true });
}

export function usePip(id: string | null) {
  return useQuery({ queryKey: [...PIPS, 'one', id], queryFn: () => api<PipDetail>(`/pips/${id}`), enabled: !!id });
}

export function usePipMutations() {
  const qc = useQueryClient();
  const done = (d?: PipDetail | void) => {
    if (d) qc.setQueryData([...PIPS, 'one', d.id], d);
    return Promise.all([qc.invalidateQueries({ queryKey: PIPS }), qc.invalidateQueries({ queryKey: ['notifications'] })]);
  };
  const post = <T,>(path: string, json: unknown) => api<T>(path, { method: 'POST', json });
  return {
    create: useMutation({ mutationFn: (input: PipCreateInput) => post<PipDetail>('/pips', input), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: PipUpdateInput }) => api<PipDetail>(`/pips/${id}`, { method: 'PATCH', json: input }), onSuccess: done }),
    activate: useMutation({ mutationFn: (id: string) => post<PipDetail>(`/pips/${id}/activate`, {}), onSuccess: done }),
    acknowledge: useMutation({ mutationFn: ({ id, comment }: { id: string; comment?: string }) => post<PipDetail>(`/pips/${id}/acknowledge`, { comment }), onSuccess: done }),
    comment: useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => post<PipDetail>(`/pips/${id}/comments`, { body }), onSuccess: done }),
    evaluate: useMutation({ mutationFn: ({ id, goalId, score, comments }: { id: string; goalId: string; score: number; comments: string }) => post<PipDetail>(`/pips/${id}/evaluations`, { goalId, score, comments }), onSuccess: done }),
    review: useMutation({ mutationFn: ({ id, notes, nextReviewOn }: { id: string; notes: string; nextReviewOn?: string }) => post<PipDetail>(`/pips/${id}/reviews`, { notes, nextReviewOn }), onSuccess: done }),
    decide: useMutation({ mutationFn: ({ id, input }: { id: string; input: PipDecisionInput }) => post<PipDetail>(`/pips/${id}/decision`, input), onSuccess: done }),
    dismiss: useMutation({ mutationFn: (id: string) => post<void>(`/pips/${id}/dismiss`, {}), onSuccess: () => done() }),
  };
}

/** "December 2026" in the reader's language. */
export function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}
