import type {
  ListPerformance,
  ProspectAddResult,
  ProspectBulkResult,
  ProspectImportField,
  ProspectImportPreview,
  ProspectInput,
  ProspectListDetail,
  ProspectListInput,
  ProspectListRow,
  ProspectRow,
  ProspectSettings,
  ProspectSettingsInput,
  ProspectUsage,
  ProviderPerson,
  ProviderSearchInput,
  ProviderSearchResult,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile } from './api';
import type { Translator } from './i18n';
import { uploadFile } from './portal';

export type ProspectFilters = Partial<Record<'search' | 'industry' | 'country' | 'companySize' | 'title' | 'emailStatus' | 'stage' | 'source' | 'sort', string>> & { page?: number };

export function useProspectLists() {
  return useQuery({ queryKey: ['prospects', 'lists'], queryFn: () => api<ProspectListRow[]>('/prospect-lists') });
}

export function useProspectList(id: string, filters: ProspectFilters) {
  const q = new URLSearchParams(Object.entries(filters).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]])));
  return useQuery({ queryKey: ['prospects', 'list', id, q.toString()], queryFn: () => api<ProspectListDetail>(`/prospect-lists/${id}?${q}`), placeholderData: (prev) => prev });
}

export function useListPerformance(id: string) {
  return useQuery({ queryKey: ['prospects', 'performance', id], queryFn: () => api<ListPerformance>(`/prospect-lists/${id}/performance`) });
}

export function useProspectSettings() {
  return useQuery({ queryKey: ['prospects', 'settings'], queryFn: () => api<ProspectSettings>('/prospects/settings') });
}

export function useProspectUsage() {
  return useQuery({ queryKey: ['prospects', 'usage'], queryFn: () => api<ProspectUsage>('/prospects/usage') });
}

export function useProspectMutation<A, R>(fn: (a: A) => Promise<R>, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      onDone?.(r);
      await qc.invalidateQueries({ queryKey: ['prospects'] });
    },
  });
}

export const prospectsApi = {
  createList: (body: ProspectListInput) => api<ProspectListRow>('/prospect-lists', { method: 'POST', json: body }),
  updateList: (id: string, body: ProspectListInput) => api<ProspectListRow>(`/prospect-lists/${id}`, { method: 'PUT', json: body }),
  deleteList: (id: string) => api<void>(`/prospect-lists/${id}`, { method: 'DELETE' }),
  add: (id: string, prospects: ProspectInput[]) => api<ProspectAddResult>(`/prospect-lists/${id}/prospects`, { method: 'POST', json: { prospects } }),
  importPreview: (id: string, file: File) => uploadFile<ProspectImportPreview>(`/prospect-lists/${id}/import`, file),
  importCommit: (id: string, importId: string, mapping: Partial<Record<ProspectImportField, number>>) => api<ProspectAddResult>(`/prospect-lists/${id}/import/${importId}`, { method: 'POST', json: { mapping } }),
  dedupe: (id: string) => api<{ removed: number }>(`/prospect-lists/${id}/dedupe`, { method: 'POST' }),
  exportCsv: (id: string) => downloadFile(`/prospect-lists/${id}/export`, 'prospects.csv'),
  search: (body: ProviderSearchInput) => api<ProviderSearchResult>('/prospects/search', { method: 'POST', json: body }),
  addFromProvider: (id: string, people: ProviderPerson[], revealEmails: boolean) => api<ProspectAddResult & { revealed: number }>(`/prospect-lists/${id}/provider`, { method: 'POST', json: { people, revealEmails } }),
  move: (prospectIds: string[], toListId: string, copy: boolean) => api<{ moved: number; duplicates: number }>('/prospects/move', { method: 'POST', json: { prospectIds, toListId, copy } }),
  remove: (prospectIds: string[]) => api<{ deleted: number }>('/prospects/delete', { method: 'POST', json: { prospectIds } }),
  toCrm: (prospectIds: string[], sequenceId?: string) => api<ProspectBulkResult>('/prospects/to-crm', { method: 'POST', json: { prospectIds, ...(sequenceId ? { sequenceId } : {}) } }),
  verify: (prospectIds: string[]) => api<{ checked: number; skipped: number }>('/prospects/verify', { method: 'POST', json: { prospectIds } }),
  update: (id: string, body: Partial<ProspectRow>) => api<ProspectRow>(`/prospects/${id}`, { method: 'PATCH', json: body }),
  saveSettings: (body: ProspectSettingsInput) => api<ProspectSettings>('/prospects/settings', { method: 'PUT', json: body }),
};

export function addResultText(t: Translator, r: ProspectAddResult & { revealed?: number }): string {
  const parts = [t.plural('count.addedProspects', r.added)];
  if (r.duplicates) parts.push(t('{n} already in this list.', { n: r.duplicates }));
  if (r.inCrm) parts.push(t('{n} already in the CRM (linked).', { n: r.inCrm }));
  if (r.revealed !== undefined) parts.push(t.plural('count.emailsFound', r.revealed));
  if (r.invalid.length) parts.push(t.plural('count.rowsNotImported', r.invalid.length));
  return parts.join(' ');
}
