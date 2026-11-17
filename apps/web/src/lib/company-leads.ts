'use client';

import type {
  BranchInput,
  BranchRow,
  CompanyFileRow,
  CompanyLeadInput,
  CompanyLeadResult,
  EmployeeStats,
  LeadDraftInput,
  LeadDraftRow,
  OwnerChangeInput,
  OwnerChangeRow,
  PersonRef,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The lead form, drafts, branches, ownership, files and employee stats (ADR 0060, Phase 2b). */

export interface LeadPerson extends PersonRef {
  assignable: boolean;
}

export function useLeadPeople() {
  return useQuery({ queryKey: ['lead-people'], queryFn: () => api<LeadPerson[]>('/company-leads/people'), staleTime: 60_000 });
}

export function useLeadDrafts(enabled = true) {
  return useQuery({ enabled, queryKey: ['lead-drafts'], queryFn: () => api<LeadDraftRow[]>('/company-leads/drafts') });
}

export function useLeadDraft(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['lead-drafts', id], queryFn: () => api<LeadDraftRow>(`/company-leads/drafts/${id}`), staleTime: Infinity });
}

export function useSaveLeadDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: LeadDraftInput }) =>
      id ? api<LeadDraftRow>(`/company-leads/drafts/${id}`, { method: 'PUT', json: input }) : api<LeadDraftRow>('/company-leads/drafts', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-drafts'], exact: true }),
  });
}

export function useRemoveLeadDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/company-leads/drafts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-drafts'] }),
  });
}

export function useCreateCompanyLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyLeadInput) => api<CompanyLeadResult>('/company-leads', { method: 'POST', json: input }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: ['companies'] }), qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['lead-drafts'] })]),
  });
}

export function useBranches(companyId: string) {
  return useQuery({ queryKey: ['branches', companyId], queryFn: () => api<BranchRow[]>(`/companies/${companyId}/branches`) });
}

export function useBranchMutations(companyId: string) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['branches', companyId] }), qc.invalidateQueries({ queryKey: ['companies', 'detail', companyId] })]);
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id: string | null; input: BranchInput }) =>
        id ? api<BranchRow>(`/companies/${companyId}/branches/${id}`, { method: 'PUT', json: input }) : api<BranchRow>(`/companies/${companyId}/branches`, { method: 'POST', json: input }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/companies/${companyId}/branches/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useOwnerHistory(companyId: string) {
  return useQuery({ queryKey: ['owner-history', companyId], queryFn: () => api<OwnerChangeRow[]>(`/companies/${companyId}/owner-history`) });
}

export function useChangeOwner(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OwnerChangeInput) => api(`/companies/${companyId}/owner`, { method: 'POST', json: input }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['owner-history', companyId] }), qc.invalidateQueries({ queryKey: ['companies'] })]),
  });
}

export function useCompanyFiles(companyId: string) {
  return useQuery({ queryKey: ['company-files', companyId], queryFn: () => api<CompanyFileRow[]>(`/companies/${companyId}/files`) });
}

/** Sends the file as the raw request body, as the portal documents do. */
export function uploadCompanyFile(companyId: string, file: File, rfqId?: string): Promise<CompanyFileRow> {
  return api<CompanyFileRow>(`/companies/${companyId}/files?name=${encodeURIComponent(file.name)}${rfqId ? `&rfqId=${rfqId}` : ''}`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
}

export function useCompanyFileMutations(companyId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['company-files', companyId] });
  return {
    upload: useMutation({ mutationFn: (file: File) => uploadCompanyFile(companyId, file), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/company-files/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useEmployeeStats(contactId: string) {
  return useQuery({ queryKey: ['employee-stats', contactId], queryFn: () => api<EmployeeStats>(`/contacts/${contactId}/stats`) });
}

/** "Kunal Sharma – Business Development Manager". */
export function personLabel(p: Pick<PersonRef, 'name' | 'designation'> | null | undefined): string {
  if (!p) return '';
  return p.designation ? `${p.name} – ${p.designation}` : p.name;
}
