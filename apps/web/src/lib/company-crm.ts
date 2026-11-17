'use client';

import type {
  CrmStatusInput,
  CrmStatusKind,
  CrmStatusRow,
  CrmStatusUpdate,
  DepartmentInput,
  DepartmentRow,
  DesignationInput,
  DesignationRow,
  GeoCity,
  GeoRegion,
  LeadNumberingInput,
  LeadNumberingRow,
  MemberOrgInput,
  RoleVisibilityInput,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { toQuery } from './crm';

/** Company-centric CRM configuration and reference data (ADR 0060). */

export function useCrmStatuses(kind: CrmStatusKind) {
  return useQuery({ queryKey: ['crm-statuses', kind], queryFn: () => api<CrmStatusRow[]>(`/crm-config/statuses?kind=${kind}`), staleTime: 60_000 });
}

export function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: () => api<DepartmentRow[]>('/crm-config/departments'), staleTime: 60_000 });
}

export function useDesignations() {
  return useQuery({ queryKey: ['designations'], queryFn: () => api<DesignationRow[]>('/crm-config/designations'), staleTime: 60_000 });
}

export function useLeadNumbering() {
  return useQuery({ queryKey: ['lead-numbering'], queryFn: () => api<LeadNumberingRow>('/crm-config/lead-numbering') });
}

export function useRegions(country: string | null | undefined) {
  return useQuery({
    enabled: !!country,
    queryKey: ['geo-regions', country],
    queryFn: () => api<GeoRegion[]>(`/geo/countries/${country}/regions`),
    staleTime: Infinity,
  });
}

export function useCities(country: string | null | undefined, region: string | null | undefined, q: string) {
  return useQuery({
    enabled: !!country,
    queryKey: ['geo-cities', country, region, q],
    queryFn: () => api<GeoCity[]>(`/geo/countries/${country}/cities${toQuery({ region: region ?? undefined, q, limit: 30 })}`),
    staleTime: Infinity,
  });
}

/** Status changes also refresh the record lists, whose rows carry the status name and colour. */
export function useStatusMutations(kind: CrmStatusKind) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['crm-statuses', kind] }),
      qc.invalidateQueries({ queryKey: [kind === 'COMPANY' ? 'companies' : 'contacts'] }),
    ]);
  return {
    create: useMutation({ mutationFn: (input: CrmStatusInput) => api<CrmStatusRow>('/crm-config/statuses', { method: 'POST', json: input }), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: CrmStatusUpdate }) => api<CrmStatusRow>(`/crm-config/statuses/${id}`, { method: 'PUT', json: input }),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: (ids: string[]) => api<CrmStatusRow[]>('/crm-config/statuses/order', { method: 'PUT', json: { kind, ids } }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/crm-config/statuses/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

/** Departments and designations share one shape; `path` picks which. */
export function useOrgListMutations<I extends DepartmentInput | DesignationInput>(path: 'departments' | 'designations') {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: [path] }), qc.invalidateQueries({ queryKey: ['members'] })]);
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id: string | null; input: I }) =>
        id ? api(`/crm-config/${path}/${id}`, { method: 'PUT', json: input }) : api(`/crm-config/${path}`, { method: 'POST', json: input }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/crm-config/${path}/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useSaveLeadNumbering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadNumberingInput) => api<LeadNumberingRow>('/crm-config/lead-numbering', { method: 'PUT', json: input }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['lead-numbering'] }), qc.invalidateQueries({ queryKey: ['companies'] })]),
  });
}

export function useSetMemberOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, input }: { membershipId: string; input: MemberOrgInput }) =>
      api(`/tenants/current/members/${membershipId}/org`, { method: 'PATCH', json: input }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['members'] }), qc.invalidateQueries({ queryKey: ['departments'] }), qc.invalidateQueries({ queryKey: ['designations'] })]),
  });
}

export function useSetRoleVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, input }: { roleId: string; input: RoleVisibilityInput }) => api(`/tenants/current/roles/${roleId}/visibility`, { method: 'PUT', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}

/**
 * Text colour that reads best on a status colour. Pure black or white: for any background one of them reaches at least
 * 4.58:1, so every chip passes WCAG AA whatever colour an administrator picks.
 */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}
