import type { EnquiryConvertInput, EnquiryConvertResult, EnquiryDetail, EnquiryPage, EnquiryRow, EnquirySummary, EnquiryUpdateInput, EnquiryView } from '@dealflow/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The list's filters, as the page keeps them in its address (ADR 0095). */
export interface EnquiryFilters {
  view: EnquiryView;
  q: string;
  status: string[];
  type: string[];
  category: string[];
  form: string;
}

export const NO_FILTERS: EnquiryFilters = { view: 'all', q: '', status: [], type: [], category: [], form: '' };

export function enquiryQuery(f: EnquiryFilters, limit: number): string {
  const qs = new URLSearchParams();
  if (f.view !== 'all') qs.set('view', f.view);
  if (f.q.trim()) qs.set('q', f.q.trim());
  if (f.status.length) qs.set('status', f.status.join(','));
  if (f.type.length) qs.set('type', f.type.join(','));
  if (f.category.length) qs.set('category', f.category.join(','));
  if (f.form) qs.set('form', f.form);
  qs.set('limit', String(limit));
  return qs.toString();
}

/** Counts and how enquiries arrive. Refreshed every 20 seconds so a new enquiry shows up while the page is open. */
export function useEnquirySummary() {
  return useQuery({ queryKey: ['website-enquiries', 'summary'], queryFn: () => api<EnquirySummary>('/website-enquiries/summary'), refetchInterval: 20_000 });
}

export function useEnquiries(f: EnquiryFilters, limit: number) {
  const qs = enquiryQuery(f, limit);
  return useQuery({ queryKey: ['website-enquiries', 'list', qs], queryFn: () => api<EnquiryPage>(`/website-enquiries?${qs}`), placeholderData: keepPreviousData, refetchInterval: 20_000 });
}

/** Opening an enquiry marks it seen, so the counts are refreshed once it has loaded. */
export function useEnquiry(id: string | null) {
  const qc = useQueryClient();
  return useQuery({
    enabled: !!id,
    queryKey: ['website-enquiries', 'detail', id],
    queryFn: async () => {
      const d = await api<EnquiryDetail>(`/website-enquiries/${id}`);
      void qc.invalidateQueries({ queryKey: ['website-enquiries', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['website-enquiries', 'list'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      return d;
    },
  });
}

/** Enquiries linked to an employee or company, for their pages. */
export function useRecordEnquiries(ref: { contactId?: string; companyId?: string }, enabled = true) {
  const qs = new URLSearchParams(Object.entries(ref).filter(([, v]) => !!v) as [string, string][]).toString();
  return useQuery({ enabled: enabled && !!qs, queryKey: ['website-enquiries', 'record', qs], queryFn: () => api<EnquiryRow[]>(`/website-enquiries/record?${qs}`) });
}

export function useEnquiryMutations() {
  const qc = useQueryClient();
  const refresh = async (detail?: EnquiryDetail) => {
    if (detail) qc.setQueryData(['website-enquiries', 'detail', detail.id], detail);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['website-enquiries', 'summary'] }),
      qc.invalidateQueries({ queryKey: ['website-enquiries', 'list'] }),
      qc.invalidateQueries({ queryKey: ['website-enquiries', 'record'] }),
    ]);
  };
  return {
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: EnquiryUpdateInput }) => api<EnquiryDetail>(`/website-enquiries/${id}`, { method: 'PATCH', json: body }),
      onSuccess: (d) => refresh(d),
    }),
    convert: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<EnquiryConvertInput> }) => api<EnquiryConvertResult>(`/website-enquiries/${id}/convert`, { method: 'POST', json: body }),
      onSuccess: async (r) => {
        await refresh(r.enquiry);
        await Promise.all([qc.invalidateQueries({ queryKey: ['companies'] }), qc.invalidateQueries({ queryKey: ['contacts'] })]);
      },
    }),
    unread: useMutation({
      mutationFn: (id: string) => api<{ updated: number }>(`/website-enquiries/${id}/unread`, { method: 'POST' }),
      onSuccess: () => refresh(),
    }),
    seenAll: useMutation({
      mutationFn: () => api<{ updated: number }>('/website-enquiries/seen', { method: 'POST', json: {} }),
      onSuccess: () => refresh(),
    }),
    sync: useMutation({
      mutationFn: () => api<{ ran: boolean; ok: boolean; message: string; received: number }>('/website-enquiries/sync', { method: 'POST' }),
      onSuccess: () => refresh(),
    }),
  };
}

/** Initials for the avatar ("Asha Rao" -> AR). */
export function initialsOf(name: string | null, email: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words[0]![0]! + (words.length > 1 ? words.at(-1)![0]! : '')).toUpperCase();
  return (email?.[0] ?? '?').toUpperCase();
}

/** A flag emoji for a two-letter country code. */
export function flagOf(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
