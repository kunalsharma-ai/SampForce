import type { EmailAnalytics, EmailTemplateRow, EmailVariableRow, EnrollmentRow, SequenceRow, SequenceStepStats, SuppressionRow } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { toQuery } from './crm';

/** Data hooks for email templates, sequences, enrolments and the do-not-email list. */

export function useTemplates(filter: { category?: string; campaignId?: string } = {}, enabled = true) {
  return useQuery({ enabled, queryKey: ['email-templates', filter], queryFn: () => api<EmailTemplateRow[]>(`/email-templates${toQuery(filter)}`) });
}

export function useTemplateCategories() {
  return useQuery({ queryKey: ['email-templates', 'categories'], queryFn: () => api<string[]>('/email-templates/categories') });
}

export function useEmailVariables() {
  return useQuery({ queryKey: ['email-variables'], queryFn: () => api<EmailVariableRow[]>('/email-variables') });
}

export function useEmailAnalytics(days: number, scope: 'mine' | 'team') {
  return useQuery({ queryKey: ['sequences', 'analytics', days, scope], queryFn: () => api<EmailAnalytics>(`/sequences/analytics${toQuery({ days, scope })}`) });
}

export function useSequences() {
  return useQuery({ queryKey: ['sequences', 'list'], queryFn: () => api<SequenceRow[]>('/sequences') });
}

export function useSequence(id: string) {
  return useQuery({ queryKey: ['sequences', id], queryFn: () => api<SequenceRow>(`/sequences/${id}`) });
}

export function useStepStats(id: string) {
  return useQuery({ queryKey: ['sequences', id, 'step-stats'], queryFn: () => api<SequenceStepStats[]>(`/sequences/${id}/step-stats`) });
}

export function useEnrollments(params: { sequenceId?: string; leadId?: string; contactId?: string; status?: 'live' | 'finished' }) {
  return useQuery({ queryKey: ['sequences', 'enrollments', params], queryFn: () => api<EnrollmentRow[]>(`/sequences/enrollments${toQuery(params)}`) });
}

export function useSuppressions(search: string) {
  return useQuery({ queryKey: ['sequences', 'suppressions', search], queryFn: () => api<SuppressionRow[]>(`/sequences/suppressions${toQuery({ search: search || undefined })}`) });
}

export const ENROLLMENT_LABEL: Record<EnrollmentRow['status'], string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Finished',
  REPLIED: 'Replied',
  BOUNCED: 'Bounced',
  UNSUBSCRIBED: 'Unsubscribed',
  STOPPED: 'Stopped',
  MOVED: 'Moved',
  FAILED: 'Failed',
};

export const ENROLLMENT_TONE: Record<EnrollmentRow['status'], 'neutral' | 'success' | 'warning' | 'critical' | 'primary'> = {
  ACTIVE: 'primary',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  REPLIED: 'success',
  BOUNCED: 'critical',
  UNSUBSCRIBED: 'warning',
  STOPPED: 'neutral',
  MOVED: 'neutral',
  FAILED: 'critical',
};

export const SEQUENCE_TONE = { DRAFT: 'neutral', ACTIVE: 'success', PAUSED: 'warning', ARCHIVED: 'neutral' } as const;

export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');
