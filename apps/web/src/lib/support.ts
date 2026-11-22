'use client';

import type { HelpReader } from '@dealflow/help';
import type {
  OperatorSupportTicketDetail,
  OperatorSupportTicketRow,
  SupportCounts,
  SupportTicketCreateInput,
  SupportTicketDetail,
  SupportTicketRow,
  SupportTicketStatus,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

/** Support tickets raised from Help (ADR 0073). */
export const supportKeys = {
  all: ['support'] as const,
  list: (scope: 'mine' | 'team') => ['support', 'list', scope] as const,
  one: (id: string) => ['support', 'ticket', id] as const,
  operator: ['operator', 'support'] as const,
};

/** Who is reading Help in a workspace: their effective features, hierarchy level and role permissions. */
export function useWorkspaceHelpReader(): HelpReader | null {
  const { data } = useSession();
  if (!data) return null;
  return { audience: 'workspace', features: data.tenant.features, level: data.workspace?.level ?? 'SUPER', permissions: data.permissions };
}

/** Whether the person may see their team's queries too: a manager, or a Super Workspace member who manages members. */
export function useCanSeeTeamQueries(): boolean {
  const { data } = useSession();
  if (!data) return false;
  const level = data.workspace?.level ?? 'SUPER';
  return level === 'MANAGER' || (level === 'SUPER' && data.permissions.includes('members:manage'));
}

export function useTickets(scope: 'mine' | 'team') {
  return useQuery({ queryKey: supportKeys.list(scope), queryFn: () => api<SupportTicketRow[]>(`/support/tickets?scope=${scope}`) });
}

export function useTicket(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: supportKeys.one(id ?? ''), queryFn: () => api<SupportTicketDetail>(`/support/tickets/${id}`) });
}

function useRefresh() {
  const qc = useQueryClient();
  return (t: SupportTicketDetail) => {
    qc.setQueryData(supportKeys.one(t.id), t);
    void qc.invalidateQueries({ queryKey: ['support', 'list'] });
  };
}

export function useRaiseQuery() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: SupportTicketCreateInput) => api<SupportTicketDetail>('/support/tickets', { method: 'POST', json: input }),
    onSuccess: refresh,
  });
}

export function useReplyToTicket(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: string) => api<SupportTicketDetail>(`/support/tickets/${id}/messages`, { method: 'POST', json: { body } }),
    onSuccess: refresh,
  });
}

export function useTicketStatus(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (status: SupportTicketStatus) => api<SupportTicketDetail>(`/support/tickets/${id}`, { method: 'PATCH', json: { status } }),
    onSuccess: refresh,
  });
}

// ── Console ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function useOperatorTickets(filter: { status?: SupportTicketStatus; q?: string }, enabled = true) {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.q) params.set('q', filter.q);
  return useQuery({
    enabled,
    queryKey: [...supportKeys.operator, 'list', filter.status ?? '', filter.q ?? ''],
    queryFn: () => api<OperatorSupportTicketRow[]>(`/operator/support/tickets?${params.toString()}`),
  });
}

export function useOperatorTicketCounts(enabled = true) {
  return useQuery({ enabled, queryKey: [...supportKeys.operator, 'counts'], queryFn: () => api<SupportCounts>('/operator/support/tickets/counts'), refetchInterval: 60_000 });
}

export function useOperatorTicket(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: [...supportKeys.operator, 'ticket', id ?? ''], queryFn: () => api<OperatorSupportTicketDetail>(`/operator/support/tickets/${id}`) });
}

export function useOperatorTicketActions(id: string) {
  const qc = useQueryClient();
  const done = (t: OperatorSupportTicketDetail) => {
    qc.setQueryData([...supportKeys.operator, 'ticket', id], t);
    void qc.invalidateQueries({ queryKey: [...supportKeys.operator, 'list'] });
    void qc.invalidateQueries({ queryKey: [...supportKeys.operator, 'counts'] });
  };
  return {
    reply: useMutation({ mutationFn: (body: string) => api<OperatorSupportTicketDetail>(`/operator/support/tickets/${id}/messages`, { method: 'POST', json: { body } }), onSuccess: done }),
    status: useMutation({ mutationFn: (status: SupportTicketStatus) => api<OperatorSupportTicketDetail>(`/operator/support/tickets/${id}`, { method: 'PATCH', json: { status } }), onSuccess: done }),
  };
}
