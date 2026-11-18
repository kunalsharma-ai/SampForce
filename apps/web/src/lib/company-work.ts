'use client';

import type {
  CompanyDashboard,
  CompanyEmployeeRow,
  FollowUpBucket,
  FollowUpCounts,
  FollowUpInput,
  FollowUpRow,
  InteractionInput,
  InteractionKind,
  InteractionRow,
  InteractionUpdate,
  MoneyByCurrency,
  Page,
  RfqInput,
  RfqReportRow,
  RfqRow,
  RfqStatus,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The company dashboard, interactions, follow-ups and RFQs (ADR 0060, Phase 3). */

export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Everything that changes when an interaction, follow-up or RFQ is saved. */
const WORK_KEYS = [['company-dashboard'], ['company-employees'], ['interactions'], ['follow-ups'], ['rfqs'], ['activities'], ['tasks'], ['contacts']];
function useInvalidateWork() {
  const qc = useQueryClient();
  return () => Promise.all(WORK_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useCompanyDashboard(companyId: string) {
  return useQuery({ queryKey: ['company-dashboard', companyId], queryFn: () => api<CompanyDashboard>(`/companies/${companyId}/dashboard`) });
}

export function useCompanyEmployees(companyId: string) {
  return useQuery({ queryKey: ['company-employees', companyId], queryFn: () => api<CompanyEmployeeRow[]>(`/companies/${companyId}/employees`) });
}

export function useInteractions(companyId: string, filter: { kind?: InteractionKind | ''; contactId?: string }) {
  const qs = new URLSearchParams({ limit: '100' });
  if (filter.kind) qs.set('kind', filter.kind);
  if (filter.contactId) qs.set('contactId', filter.contactId);
  return useQuery({ queryKey: ['interactions', companyId, filter.kind ?? '', filter.contactId ?? ''], queryFn: () => api<InteractionRow[]>(`/companies/${companyId}/interactions?${qs}`) });
}

export function useLogInteraction() {
  const invalidate = useInvalidateWork();
  return useMutation({ mutationFn: (input: InteractionInput) => api<InteractionRow>('/interactions', { method: 'POST', json: input }), onSuccess: invalidate });
}

export function useUpdateInteraction() {
  const invalidate = useInvalidateWork();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: InteractionUpdate }) => api<InteractionRow>(`/interactions/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['timeline'] })]),
  });
}

export function useRemoveInteraction() {
  const invalidate = useInvalidateWork();
  return useMutation({ mutationFn: (id: string) => api(`/interactions/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
}

export interface FollowUpFilter {
  bucket?: FollowUpBucket;
  scope?: 'mine' | 'team' | 'all';
  companyId?: string;
  contactId?: string;
}

function followUpQuery(f: FollowUpFilter): string {
  const qs = new URLSearchParams({ tz: browserTimeZone() });
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  return qs.toString();
}

export function useFollowUps(f: FollowUpFilter) {
  return useQuery({ queryKey: ['follow-ups', 'list', f], queryFn: () => api<FollowUpRow[]>(`/follow-ups?${followUpQuery(f)}`) });
}

export function useFollowUpCounts(f: Omit<FollowUpFilter, 'bucket'>) {
  return useQuery({ queryKey: ['follow-ups', 'counts', f], queryFn: () => api<FollowUpCounts>(`/follow-ups/counts?${followUpQuery(f)}`) });
}

export function useFollowUpMutations() {
  const invalidate = useInvalidateWork();
  const opts = { onSuccess: invalidate };
  return {
    create: useMutation({ mutationFn: (input: FollowUpInput) => api<FollowUpRow>('/follow-ups', { method: 'POST', json: input }), ...opts }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<FollowUpInput> }) => api<FollowUpRow>(`/follow-ups/${id}`, { method: 'PATCH', json: input }), ...opts }),
    complete: useMutation({ mutationFn: ({ id, outcome }: { id: string; outcome?: string | null }) => api<FollowUpRow>(`/follow-ups/${id}/complete`, { method: 'POST', json: { outcome: outcome || null } }), ...opts }),
    reschedule: useMutation({ mutationFn: ({ id, dueAt, reason }: { id: string; dueAt: string; reason?: string | null }) => api<FollowUpRow>(`/follow-ups/${id}/reschedule`, { method: 'POST', json: { dueAt, reason: reason || null } }), ...opts }),
    cancel: useMutation({ mutationFn: (id: string) => api<FollowUpRow>(`/follow-ups/${id}/cancel`, { method: 'POST', json: {} }), ...opts }),
  };
}

export interface RfqFilter {
  companyId?: string;
  ownerId?: string;
  status?: RfqStatus | '';
  open?: 'true' | 'false' | '';
  q?: string;
  page?: number;
}

export function useRfqs(f: RfqFilter, enabled = true) {
  const qs = new URLSearchParams({ pageSize: '50' });
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, String(v));
  return useQuery({ enabled, queryKey: ['rfqs', 'list', f], queryFn: () => api<Page<RfqRow>>(`/rfqs?${qs}`) });
}

export function useRfq(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['rfqs', 'one', id], queryFn: () => api<RfqRow>(`/rfqs/${id}`) });
}

export function useRfqReport(by: 'company' | 'employee' | 'owner', enabled = true) {
  return useQuery({ enabled, queryKey: ['rfqs', 'report', by], queryFn: () => api<RfqReportRow[]>(`/rfqs/report?by=${by}`) });
}

export function useRfqMutations() {
  const invalidate = useInvalidateWork();
  const qc = useQueryClient();
  const opts = { onSuccess: invalidate };
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id: string | null; input: Partial<RfqInput> }) =>
        id ? api<RfqRow>(`/rfqs/${id}`, { method: 'PATCH', json: input }) : api<RfqRow>('/rfqs', { method: 'POST', json: input }),
      ...opts,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/rfqs/${id}`, { method: 'DELETE' }), ...opts }),
    convert: useMutation({
      mutationFn: (id: string) => api<RfqRow>(`/rfqs/${id}/convert`, { method: 'POST', json: {} }),
      onSuccess: () => Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['deals'] })]),
    }),
  };
}

/** "USD 5,400 · EUR 8,000"; amounts in different currencies are listed, never added up. */
export function formatMoneyList(list: MoneyByCurrency, locale?: string): string {
  if (!list.length) return '0';
  return list
    .map(({ currency, amount }) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
      } catch {
        return `${currency} ${amount.toLocaleString(locale)}`;
      }
    })
    .join(' · ');
}

/** A `datetime-local` input value for a date, in the browser's time zone. */
export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The ISO instant of a `datetime-local` value, or null when empty. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
