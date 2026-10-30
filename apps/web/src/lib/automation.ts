import type {
  ApprovalRow,
  EmailRow,
  ExecutionRow,
  MeetingRow,
  NotificationRow,
  ProviderStatus,
  WebhookRow,
  WorkflowDefinition,
  WorkflowRow,
} from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { toQuery } from './crm';

export function useWorkflows() {
  return useQuery({ queryKey: ['workflows'], queryFn: () => api<WorkflowRow[]>('/workflows') });
}

export function useWorkflow(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['workflows', id], queryFn: () => api<WorkflowRow>(`/workflows/${id}`) });
}

export function useExecutions(workflowId?: string) {
  return useQuery({
    queryKey: ['executions', workflowId ?? 'all'],
    queryFn: () => api<ExecutionRow[]>(`/workflows/executions${toQuery({ workflowId, limit: 50 })}`),
    // Keep run history fresh: quickly while something is in flight, slowly otherwise.
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'RUNNING') ? 3000 : 10_000),
  });
}

export function useVersions(workflowId: string | null) {
  return useQuery({
    enabled: !!workflowId,
    queryKey: ['workflows', workflowId, 'versions'],
    queryFn: () => api<{ id: string; version: number; createdAt: string; createdBy: { name: string } | null; definition: WorkflowDefinition }[]>(`/workflows/${workflowId}/versions`),
  });
}

export function useApprovals(status: 'PENDING' | 'DECIDED', enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['approvals', status],
    queryFn: () => api<ApprovalRow[]>(`/approvals?status=${status}`),
    refetchInterval: status === 'PENDING' ? 10_000 : false,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotificationRow[]; unread: number }>('/notifications'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useIntegrations() {
  return useQuery({ queryKey: ['integrations'], queryFn: () => api<ProviderStatus[]>('/integrations') });
}

export function useWebhooks(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['webhooks'], queryFn: () => api<WebhookRow[]>('/webhooks') });
}

export function useEmails(params: { contactId?: string; leadId?: string } = {}) {
  return useQuery({ queryKey: ['emails', params], queryFn: () => api<EmailRow[]>(`/emails${toQuery({ ...params, limit: 100 })}`) });
}

export function useMeetings(params: { contactId?: string } = {}) {
  return useQuery({ queryKey: ['meetings', params], queryFn: () => api<MeetingRow[]>(`/meetings${toQuery(params)}`) });
}

export const EXECUTION_TONE = {
  RUNNING: 'primary',
  WAITING: 'accent',
  AWAITING_APPROVAL: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'critical',
  CANCELED: 'neutral',
} as const;

export const EXECUTION_LABEL = {
  RUNNING: 'Running',
  WAITING: 'Waiting',
  AWAITING_APPROVAL: 'Needs approval',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
} as const;
