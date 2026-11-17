'use client';

import type {
  AttributionRule,
  CurrencyRateInput,
  CurrencySettings,
  CurrencySettingsInput,
  CustomFieldDef,
  CustomFieldEntity,
  DashboardPolicy,
  ExportPolicy,
  ExportPolicyRow,
  NotificationSettings,
  OptionListKind,
  OptionRow,
  OptionUpdate,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** Settings → CRM configuration: custom fields, statuses and categories, and workspace settings (ADR 0062). */

export function useOptions(kind: OptionListKind) {
  return useQuery({ queryKey: ['crm-options', kind], queryFn: () => api<OptionRow[]>(`/crm-config/options?kind=${kind}`), staleTime: 60_000 });
}

/** Label and colour for a stored status or category value, from the workspace's options (falls back to the value). */
export function useOptionLookup(kind: OptionListKind) {
  const q = useOptions(kind);
  const byValue = new Map((q.data ?? []).map((o) => [o.value, o]));
  return (value: string) => byValue.get(value) ?? null;
}

export function useOptionMutations(kind: OptionListKind) {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['crm-options', kind] });
    void qc.invalidateQueries({ queryKey: kind === 'FOLLOW_UP_TYPE' ? ['follow-ups'] : kind === 'RFQ_STATUS' ? ['rfqs'] : ['deals'] });
  };
  return {
    create: useMutation({ mutationFn: (input: { label: string; color: string; description: string | null }) => api<OptionRow>(`/crm-config/options/${kind}`, { method: 'POST', json: input }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ value, input }: { value: string; input: OptionUpdate }) => api<OptionRow>(`/crm-config/options/${kind}/${value}`, { method: 'PUT', json: input }), onSuccess: done }),
    reorder: useMutation({ mutationFn: (values: string[]) => api<OptionRow[]>('/crm-config/options/order', { method: 'PUT', json: { kind, values } }), onSuccess: done }),
    remove: useMutation({ mutationFn: (value: string) => api<void>(`/crm-config/options/${kind}/${value}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

/** Every field of one record type, switched-off ones too (administrators only). */
export function useFieldAdmin(entity: CustomFieldEntity) {
  return useQuery({ queryKey: ['custom-fields', entity, 'admin'], queryFn: () => api<CustomFieldDef[]>(`/custom-fields?entity=${entity}&includeInactive=true`) });
}

export function useFieldMutations(entity: CustomFieldEntity) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['custom-fields'] });
  return {
    create: useMutation({ mutationFn: (input: unknown) => api<CustomFieldDef>('/custom-fields', { method: 'POST', json: input }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: unknown }) => api<CustomFieldDef>(`/custom-fields/${id}`, { method: 'PATCH', json: input }), onSuccess: done }),
    reorder: useMutation({ mutationFn: (ids: string[]) => api<CustomFieldDef[]>('/custom-fields/order', { method: 'PUT', json: { entity, ids } }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/custom-fields/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

function useSetting<T, I = T>(path: string, key: string, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['crm-config', key], queryFn: () => api<T>(`/crm-config/${path}`), enabled });
  const save = useMutation({
    mutationFn: (input: I) => api<T>(`/crm-config/${path}`, { method: 'PUT', json: input }),
    onSuccess: (data) => qc.setQueryData(['crm-config', key], data),
  });
  return { query, save };
}

export const useNotificationSettings = () => useSetting<NotificationSettings>('notifications', 'notifications');
export const useExportPolicy = () => useSetting<ExportPolicyRow[], ExportPolicy>('export-policy', 'export-policy');
export const useDashboardPolicies = () => useSetting<DashboardPolicy[], DashboardPolicy>('dashboards', 'dashboards');
export const useAttributionRule = () => useSetting<AttributionRule>('attribution', 'attribution');

export function useCurrencySettings() {
  const qc = useQueryClient();
  const set = (data: CurrencySettings) => qc.setQueryData(['crm-config', 'currency'], data);
  return {
    query: useQuery({ queryKey: ['crm-config', 'currency'], queryFn: () => api<CurrencySettings>('/crm-config/currency'), staleTime: 60_000 }),
    save: useMutation({ mutationFn: (input: CurrencySettingsInput) => api<CurrencySettings>('/crm-config/currency', { method: 'PUT', json: input }), onSuccess: set }),
    addRate: useMutation({ mutationFn: (input: CurrencyRateInput) => api<CurrencySettings>('/crm-config/currency/rates', { method: 'POST', json: input }), onSuccess: set }),
    removeRate: useMutation({ mutationFn: (currency: string) => api<CurrencySettings>(`/crm-config/currency/rates/${currency}`, { method: 'DELETE' }), onSuccess: set }),
  };
}
