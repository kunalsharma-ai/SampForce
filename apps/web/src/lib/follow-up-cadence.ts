'use client';

import type { ContactCadence, FirstEmailList, FirstEmailQuery, FollowUpCadenceInput, FollowUpCadenceSettings, InitialEmailInput } from '@dealflow/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The follow-up cadence (redesign R3, ADR 0083): the organisation's setting and each employee's place in it. */
export function useCadenceSettings(enabled = true) {
  const qc = useQueryClient();
  return {
    query: useQuery({ queryKey: ['crm-config', 'follow-up-cadence'], queryFn: () => api<FollowUpCadenceSettings>('/crm-config/follow-up-cadence'), staleTime: 60_000, enabled }),
    save: useMutation({
      mutationFn: (input: FollowUpCadenceInput) => api<FollowUpCadenceSettings>('/crm-config/follow-up-cadence', { method: 'PUT', json: input }),
      onSuccess: (data) => qc.setQueryData(['crm-config', 'follow-up-cadence'], data),
    }),
  };
}

export const contactCadenceKey = (id: string) => ['contact-cadence', id] as const;

export function useContactCadence(contactId: string, enabled = true) {
  return useQuery({ queryKey: contactCadenceKey(contactId), queryFn: () => api<ContactCadence>(`/contacts/${contactId}/cadence`), enabled, staleTime: 30_000 });
}

/** Records the first email as sent (one sent outside SampForce); the cadence starts from then. */
export function useMarkInitialEmail(contactId: string, companyId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InitialEmailInput) => api<ContactCadence>(`/contacts/${contactId}/initial-email`, { method: 'POST', json: input }),
    onSuccess: (data) => {
      qc.setQueryData(contactCadenceKey(contactId), data);
      void qc.invalidateQueries({ queryKey: ['employee-activity'] });
      void qc.invalidateQueries({ queryKey: ['employee-communication', contactId] });
      void qc.invalidateQueries({ queryKey: ['follow-ups'] });
      void qc.invalidateQueries({ queryKey: ['first-email'] });
      void qc.invalidateQueries({ queryKey: ['company-journey'] });
      if (companyId) void qc.invalidateQueries({ queryKey: ['companies', companyId] });
    },
  });
}

/** First Email Pending (ADR 0096): contacts whose first email has not gone out, and those waiting for follow-up 1. */
export function useFirstEmails(q: FirstEmailQuery, enabled = true) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  return useQuery({ queryKey: ['first-email', q], queryFn: () => api<FirstEmailList>(`/follow-ups/first-email?${sp.toString()}`), enabled, placeholderData: keepPreviousData });
}
