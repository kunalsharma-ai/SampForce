import type { BillingOverview, InvoiceRow, OnboardingState, RoleRow, SupportGrantRow } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { fmtLocale } from '@/lib/i18n/locale';

/** Data hooks for billing, onboarding, custom roles and support access. */

export function useBilling(enabled = true) {
  return useQuery({ enabled, queryKey: ['billing'], queryFn: () => api<BillingOverview>('/billing') });
}

export function useInvoices(enabled = true) {
  return useQuery({ enabled, queryKey: ['billing', 'invoices'], queryFn: () => api<InvoiceRow[]>('/billing/invoices') });
}

export function useOnboarding() {
  return useQuery({ queryKey: ['onboarding'], queryFn: () => api<OnboardingState>('/onboarding') });
}

export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/tenants/current/roles') });
}

export function useSupportGrants(enabled = true) {
  return useQuery({ enabled, queryKey: ['support-access'], queryFn: () => api<SupportGrantRow[]>('/support-access') });
}

/** Provider amounts are in minor units (cents, paise). */
export function formatMinor(cents: number, currency: string): string {
  return new Intl.NumberFormat(fmtLocale(), { style: 'currency', currency }).format(cents / 100);
}

export const SUBSCRIPTION_STATUS = {
  TRIALING: { label: 'Trial', tone: 'accent' },
  ACTIVE: { label: 'Active', tone: 'success' },
  PAST_DUE: { label: 'Payment failed', tone: 'warning' },
  UNPAID: { label: 'Unpaid', tone: 'critical' },
  CANCELED: { label: 'Canceled', tone: 'neutral' },
} as const;

export const INVOICE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  OPEN: { label: 'Open', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  VOID: { label: 'Void', tone: 'neutral' },
  UNCOLLECTIBLE: { label: 'Uncollectible', tone: 'critical' },
} as const;

export const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(fmtLocale(), { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
