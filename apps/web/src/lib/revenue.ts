import type {
  CampaignRow,
  CommercialSettingsRow,
  ContractRow,
  CustomerRow,
  EscalationRow,
  ExchangeRateRow,
  LeadFormRow,
  PriceBookRow,
  ProductRow,
  QuoteRow,
  RevenueAnalytics,
  SalesTargetRow,
  SegmentRow,
  TaxRateRow,
} from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { toQuery } from './crm';

/** Data hooks for quotes, contracts, marketing, revenue analytics and customer success. */

export function useProducts() {
  return useQuery({ queryKey: ['catalog', 'products'], queryFn: () => api<ProductRow[]>('/catalog/products') });
}

export function usePriceBooks() {
  return useQuery({ queryKey: ['catalog', 'price-books'], queryFn: () => api<PriceBookRow[]>('/catalog/price-books') });
}

export function useTaxRates() {
  return useQuery({ queryKey: ['catalog', 'tax-rates'], queryFn: () => api<TaxRateRow[]>('/catalog/tax-rates') });
}

export function useCommercialSettings() {
  return useQuery({ queryKey: ['catalog', 'settings'], queryFn: () => api<CommercialSettingsRow>('/catalog/settings') });
}

export function useQuotes(params: { opportunityId?: string; status?: string } = {}) {
  return useQuery({ queryKey: ['quotes', 'list', params], queryFn: () => api<QuoteRow[]>(`/quotes${toQuery(params)}`) });
}

export function useQuote(id: string) {
  return useQuery({ queryKey: ['quotes', id], queryFn: () => api<QuoteRow>(`/quotes/${id}`) });
}

export function useQuoteVersions(id: string) {
  return useQuery({ queryKey: ['quotes', id, 'versions'], queryFn: () => api<QuoteRow[]>(`/quotes/${id}/versions`) });
}

export function useContracts(params: { status?: string; companyId?: string; renewalWithinDays?: number } = {}) {
  return useQuery({ queryKey: ['contracts', 'list', params], queryFn: () => api<ContractRow[]>(`/contracts${toQuery(params)}`) });
}

export function useContract(id: string) {
  return useQuery({ queryKey: ['contracts', id], queryFn: () => api<ContractRow>(`/contracts/${id}`) });
}

export function useSegments() {
  return useQuery({ queryKey: ['segments'], queryFn: () => api<SegmentRow[]>('/segments') });
}

export function useForms() {
  return useQuery({ queryKey: ['forms'], queryFn: () => api<LeadFormRow[]>('/forms') });
}

export function useCampaigns(enabled = true) {
  return useQuery({ queryKey: ['campaigns'], queryFn: () => api<CampaignRow[]>('/campaigns'), enabled });
}

export function useRevenue(period: string) {
  return useQuery({ queryKey: ['analytics', 'revenue', period], queryFn: () => api<RevenueAnalytics>(`/analytics/revenue?period=${period}`) });
}

export function useExchangeRates() {
  return useQuery({ queryKey: ['analytics', 'rates'], queryFn: () => api<{ base: string; rates: ExchangeRateRow[] }>('/analytics/exchange-rates') });
}

export function useTargets(period: string) {
  return useQuery({ queryKey: ['analytics', 'targets', period], queryFn: () => api<SalesTargetRow[]>(`/analytics/targets?period=${period}`) });
}

export function useCustomers() {
  return useQuery({ queryKey: ['success', 'customers'], queryFn: () => api<CustomerRow[]>('/success/customers') });
}

export function useCustomer(companyId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['success', 'customers', companyId],
    queryFn: () => api<CustomerRow>(`/success/customers/${companyId}`).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e))),
  });
}

export function useEscalations(params: { status?: 'OPEN' | 'RESOLVED'; companyId?: string } = {}) {
  return useQuery({ queryKey: ['success', 'escalations', params], queryFn: () => api<EscalationRow[]>(`/success/escalations${toQuery(params)}`) });
}

/** Money with cents, for quotes and contracts where every cent is part of the record. */
export function formatAmount(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export const QUOTE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'primary' },
  REJECTED: { label: 'Rejected', tone: 'critical' },
  SENT: { label: 'Sent', tone: 'accent' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'critical' },
} as const;

export const CONTRACT_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ACTIVE: { label: 'Active', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  TERMINATED: { label: 'Terminated', tone: 'critical' },
  RENEWED: { label: 'Renewed', tone: 'primary' },
} as const;

export const HEALTH_BAND = {
  healthy: { label: 'Healthy', tone: 'success' },
  watch: { label: 'Watch', tone: 'warning' },
  at_risk: { label: 'At risk', tone: 'critical' },
} as const;

export const SEVERITY_TONE = { LOW: 'neutral', MEDIUM: 'accent', HIGH: 'warning', CRITICAL: 'critical' } as const;

export const todayIso = () => new Date().toISOString().slice(0, 10);
