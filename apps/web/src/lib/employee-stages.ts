'use client';

import type { EmployeeActivity, EmployeeActivityRow, EmployeeCommunication, EmployeeStageRow, SampbidxCompanyPreview, SampbidxCompanySendResult, SampbidxSendCompanyInput, SampbidxTransferRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** Employee communication stages, RFQ contributors and company sends to SampBidx (ADR 0080). */

const KEYS = [['employee-activity'], ['employee-communication'], ['company-employees'], ['contacts'], ['company-dashboard'], ['interactions'], ['follow-ups'], ['rfqs'], ['sampbidx-company'], ['sampbidx-transfers'], ['crm-statuses']];
export function useInvalidateStages() {
  const qc = useQueryClient();
  return () => Promise.all(KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useEmployeeStages(enabled = true) {
  return useQuery({ enabled, queryKey: ['employee-stages'], queryFn: () => api<EmployeeStageRow[]>('/employee-stages'), staleTime: 60_000 });
}

export function useEmployeeActivity(companyId: string, enabled = true) {
  return useQuery({ enabled, queryKey: ['employee-activity', companyId], queryFn: () => api<EmployeeActivity>(`/companies/${companyId}/employee-activity`) });
}

export function useEmployeeCommunication(contactId: string | null) {
  return useQuery({ enabled: !!contactId, queryKey: ['employee-communication', contactId], queryFn: () => api<EmployeeCommunication>(`/contacts/${contactId}/communication`) });
}

export function useChangeStage() {
  const invalidate = useInvalidateStages();
  return useMutation({
    mutationFn: ({ contactId, stageId, note, rfqId }: { contactId: string; stageId: string; note?: string | null; rfqId?: string | null }) =>
      api<EmployeeActivityRow>(`/contacts/${contactId}/stage`, { method: 'PATCH', json: { stageId, note: note || null, rfqId: rfqId ?? null } }),
    onSuccess: invalidate,
  });
}

export function useMarkContributor() {
  const invalidate = useInvalidateStages();
  return useMutation({
    mutationFn: ({ contactId, marked }: { contactId: string; marked: boolean }) => api<EmployeeActivityRow>(`/contacts/${contactId}/rfq-contributor`, { method: 'PATCH', json: { marked } }),
    onSuccess: invalidate,
  });
}

export function useSampbidxCompanyPreview(companyId: string, q: { contactId: string | null; rfqId: string | null; extra: string[] }, enabled: boolean) {
  const qs = new URLSearchParams();
  if (q.contactId) qs.set('contactId', q.contactId);
  if (q.rfqId) qs.set('rfqId', q.rfqId);
  if (q.extra.length) qs.set('contactIds', q.extra.join(','));
  return useQuery({
    enabled,
    queryKey: ['sampbidx-company', companyId, q.contactId, q.rfqId, q.extra.join(',')],
    queryFn: () => api<SampbidxCompanyPreview>(`/apps/sampbidx/companies/${companyId}/preview?${qs}`),
    placeholderData: (prev) => prev,
  });
}

export function useSendCompanyToSampbidx() {
  const invalidate = useInvalidateStages();
  return useMutation({ mutationFn: (input: SampbidxSendCompanyInput) => api<SampbidxCompanySendResult>('/apps/sampbidx/transfers/company', { method: 'POST', json: input }), onSuccess: invalidate });
}

export function useRetrySampbidx() {
  const invalidate = useInvalidateStages();
  return useMutation({ mutationFn: (id: string) => api<SampbidxTransferRow>(`/apps/sampbidx/transfers/${id}/retry`, { method: 'POST' }), onSuccess: invalidate });
}
