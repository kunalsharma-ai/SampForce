'use client';

import {
  APPROVAL_HEADER,
  type CreateTeamApprovalInput,
  type RecycleBatchRow,
  type RestoreResult,
  type TeamApprovalOverview,
  type TeamApprovalQuery,
  type TeamApprovalRow,
  type TeamApprovalSettings,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

/** Team approvals and Deleted items (ADR 0097). */

export function useApprovalOverview() {
  const { data: me } = useSession();
  return useQuery({
    queryKey: ['team-approvals', 'overview'],
    queryFn: () => api<TeamApprovalOverview>('/team-approvals/overview'),
    enabled: !!me && !me.restriction,
    refetchInterval: 30_000,
  });
}

export function useTeamApprovals(q: Partial<TeamApprovalQuery>, enabled = true) {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();
  return useQuery({
    queryKey: ['team-approvals', 'list', params],
    queryFn: () => api<TeamApprovalRow[]>(`/team-approvals?${params}`),
    enabled,
    refetchInterval: 15_000,
  });
}

export function useDeletedItems(q: { q?: string; state?: 'kept' | 'restored' | 'any' }, enabled = true) {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][]).toString();
  return useQuery({ queryKey: ['deleted-items', params], queryFn: () => api<RecycleBatchRow[]>(`/deleted-items?${params}`), enabled });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['team-approvals'] }), qc.invalidateQueries({ queryKey: ['deleted-items'] })]);
}

export function useApprovalMutations() {
  const refresh = useRefresh();
  const qc = useQueryClient();
  return {
    ask: useMutation({ mutationFn: (input: CreateTeamApprovalInput) => api<TeamApprovalRow>('/team-approvals', { method: 'POST', json: input }), onSuccess: refresh }),
    decide: useMutation({
      mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string }) => api<TeamApprovalRow>(`/team-approvals/${v.id}/decision`, { method: 'POST', json: { decision: v.decision, note: v.note || undefined } }),
      onSuccess: refresh,
    }),
    cancel: useMutation({ mutationFn: (id: string) => api<TeamApprovalRow>(`/team-approvals/${id}/cancel`, { method: 'POST' }), onSuccess: refresh }),
    /** Sends the approved action again, carrying the approval: the record is deleted (or changed) now. */
    carryOut: useMutation({
      mutationFn: (row: TeamApprovalRow) => {
        const a = row.action!;
        return api<unknown>(a.path, { method: a.method, ...(a.body === undefined ? {} : { json: a.body }), headers: { [APPROVAL_HEADER]: row.id } });
      },
      // Whatever list the record was on is stale now.
      onSuccess: () => Promise.all([refresh(), qc.invalidateQueries()]),
    }),
    saveSettings: useMutation({ mutationFn: (s: TeamApprovalSettings) => api<TeamApprovalSettings>('/team-approvals/settings', { method: 'PUT', json: s }), onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['me'] })]) }),
    restore: useMutation({ mutationFn: (id: string) => api<RestoreResult>(`/deleted-items/${id}/restore`, { method: 'POST' }), onSuccess: () => Promise.all([refresh(), qc.invalidateQueries()]) }),
    purge: useMutation({ mutationFn: (id: string) => api<void>(`/deleted-items/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}
