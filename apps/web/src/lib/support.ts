'use client';

import type { HelpReader } from '@dealflow/help';
import type {
  OperatorSupportTicketDetail,
  OperatorSupportTicketRow,
  OperatorSupportUpdateInput,
  SupportAttachmentRow,
  SupportPerson,
  SupportCounts,
  SupportTicketCreateInput,
  SupportTicketDetail,
  SupportTicketRow,
  SupportTicketStatus,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

/** Support tickets raised from Help (ADR 0073), routed up the workspace hierarchy (ADR 0071 part 5). */
export type TicketScope = 'mine' | 'team' | 'handling';

export const supportKeys = {
  all: ['support'] as const,
  list: (scope: TicketScope) => ['support', 'list', scope] as const,
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

export function useTickets(scope: TicketScope) {
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

/** A reply with its text and the ids of files uploaded for it. */
export interface TicketReply {
  body: string;
  attachmentIds?: string[];
}

/** Uploads a screenshot or file to send with a new query or a reply; the Console uploads into the ticket. */
export function uploadSupportFile(file: File, ticketId?: string): Promise<SupportAttachmentRow> {
  const path = ticketId ? `/operator/support/tickets/${ticketId}/attachments` : '/support/attachments';
  return api<SupportAttachmentRow>(`${path}?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
}

export function supportFileHref(fileId: string, operatorTicketId?: string): string {
  return operatorTicketId ? `/api/v1/operator/support/tickets/${operatorTicketId}/attachments/${fileId}/download` : `/api/v1/support/attachments/${fileId}/download`;
}

export function useReplyToTicket(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: TicketReply) => api<SupportTicketDetail>(`/support/tickets/${id}/messages`, { method: 'POST', json: input }),
    onSuccess: refresh,
  });
}

export function useTicketStatus(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: SupportTicketStatus | { status: SupportTicketStatus; resolutionNote?: string | null }) =>
      api<SupportTicketDetail>(`/support/tickets/${id}`, { method: 'PATCH', json: typeof input === 'string' ? { status: input } : input }),
    onSuccess: refresh,
  });
}

/** The workspace handling a ticket passes it one level up. */
export function useEscalateTicket(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (note: string) => api<SupportTicketDetail>(`/support/tickets/${id}/escalate`, { method: 'POST', json: note ? { note } : {} }),
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

export function useSupportRepresentatives(enabled = true) {
  return useQuery({ enabled, queryKey: [...supportKeys.operator, 'representatives'], queryFn: () => api<SupportPerson[]>('/operator/support/tickets/representatives'), staleTime: 300_000 });
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
    reply: useMutation({ mutationFn: (input: TicketReply) => api<OperatorSupportTicketDetail>(`/operator/support/tickets/${id}/messages`, { method: 'POST', json: input }), onSuccess: done }),
    status: useMutation({ mutationFn: (status: SupportTicketStatus) => api<OperatorSupportTicketDetail>(`/operator/support/tickets/${id}`, { method: 'PATCH', json: { status } }), onSuccess: done }),
    update: useMutation({ mutationFn: (input: OperatorSupportUpdateInput) => api<OperatorSupportTicketDetail>(`/operator/support/tickets/${id}`, { method: 'PATCH', json: input }), onSuccess: done }),
  };
}
