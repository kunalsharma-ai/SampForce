import type { CustomFieldDef, MemberRow, Page, PipelineRow } from '@dealflow/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';

export type CrmEntity = 'leads' | 'contacts' | 'companies' | 'deals';

export const ENTITY_LABEL: Record<CrmEntity, { one: string; many: string }> = {
  leads: { one: 'Lead', many: 'Leads' },
  contacts: { one: 'Contact', many: 'Contacts' },
  companies: { one: 'Company', many: 'Companies' },
  deals: { one: 'Deal', many: 'Deals' },
};

export const CUSTOM_FIELD_ENTITY = { leads: 'LEAD', contacts: 'CONTACT', companies: 'COMPANY', deals: 'OPPORTUNITY' } as const;

export interface ListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  status?: string;
  ownerId?: string;
  companyId?: string;
  pipelineId?: string;
  stageId?: string;
}

export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useRecordList<T>(entity: CrmEntity, params: ListParams & { contactId?: string }, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [entity, 'list', params],
    queryFn: () => api<Page<T>>(`/${entity}${toQuery({ ...params })}`),
    placeholderData: keepPreviousData,
  });
}

export function useRecord<T>(entity: CrmEntity, id: string) {
  return useQuery({ queryKey: [entity, 'detail', id], queryFn: () => api<T>(`/${entity}/${id}`) });
}

export function useMembers() {
  return useQuery({ queryKey: ['members'], queryFn: () => api<MemberRow[]>('/tenants/current/members'), staleTime: 60_000 });
}

export function usePipelines() {
  return useQuery({ queryKey: ['pipelines'], queryFn: () => api<PipelineRow[]>('/pipelines'), staleTime: 30_000 });
}

export function useCustomFields(entity: CrmEntity) {
  const key = CUSTOM_FIELD_ENTITY[entity];
  return useQuery({
    queryKey: ['custom-fields', key],
    queryFn: () => api<CustomFieldDef[]>(`/custom-fields?entity=${key}`),
    staleTime: 60_000,
  });
}

export function formatMoney(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const LEAD_STATUS_TONE = {
  NEW: 'primary',
  CONTACTED: 'accent',
  QUALIFIED: 'success',
  UNQUALIFIED: 'neutral',
  CONVERTED: 'success',
} as const;

export const DEAL_STATUS_TONE = { OPEN: 'primary', WON: 'success', LOST: 'critical' } as const;

export function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
