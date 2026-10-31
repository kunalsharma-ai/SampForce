import type {
  PortalBranding,
  PortalDashboard,
  PortalDocumentRow,
  PortalMe,
  PortalMessageRow,
  PortalRequest,
  PortalRequestRow,
  PortalSettings,
  PortalUserRow,
  PublicProposal,
} from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { toQuery } from './crm';

export type PortalDocument = PortalDocumentRow & { downloadUrl: string };

export interface CompanyPortal {
  enabled: boolean;
  url: string | null;
  users: PortalUserRow[];
  documents: PortalDocument[];
  messages: PortalMessageRow[];
  tasks: { id: string; title: string; dueAt: string | null; done: boolean; deal: string | null; portalVisible: boolean }[];
  requests: PortalRequestRow[];
}

// ─── Workspace members ───

export function usePortalSettings() {
  return useQuery({ queryKey: ['portal', 'settings'], queryFn: () => api<PortalSettings>('/portal/settings') });
}

export function usePortalRequests(filter: { status?: string; mine?: boolean }) {
  return useQuery({ queryKey: ['portal', 'requests', filter], queryFn: () => api<PortalRequestRow[]>(`/portal/requests${toQuery({ status: filter.status, mine: filter.mine ? 'true' : undefined })}`) });
}

export function usePortalRequest(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['portal', 'request', id], queryFn: () => api<PortalRequest>(`/portal/requests/${id}`) });
}

export function usePortalUsers() {
  return useQuery({ queryKey: ['portal', 'users'], queryFn: () => api<PortalUserRow[]>('/portal/users') });
}

export function useCompanyPortal(companyId: string) {
  return useQuery({ queryKey: ['portal', 'company', companyId], queryFn: () => api<CompanyPortal>(`/portal/companies/${companyId}`) });
}

/** Sends a file as the raw request body; the API checks its type and size. */
export function uploadFile<T>(path: string, file: File) {
  return api<T>(`${path}${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
}

// ─── Customers (client portal session) ───

export const portalPath = (p: string) => `/client-portal${p}`;

export function usePortalBranding(slug: string) {
  return useQuery({ queryKey: ['client-portal', 'branding', slug], queryFn: () => api<PortalBranding>(portalPath(`/portals/${encodeURIComponent(slug)}`)), retry: false });
}

/** null when nobody is signed in to the portal. */
export function usePortalMe() {
  return useQuery({
    queryKey: ['client-portal', 'me'],
    retry: false,
    queryFn: async () => {
      try {
        return await api<PortalMe>(portalPath('/me'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

export function usePortalDashboard(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['client-portal', 'dashboard'], queryFn: () => api<PortalDashboard>(portalPath('/dashboard')) });
}

export function useCustomerRequests(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['client-portal', 'requests'], queryFn: () => api<PortalRequestRow[]>(portalPath('/requests')) });
}

export function useCustomerRequest(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['client-portal', 'request', id], queryFn: () => api<PortalRequest>(portalPath(`/requests/${id}`)) });
}

export function useCustomerMessages(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['client-portal', 'messages'], queryFn: () => api<PortalMessageRow[]>(portalPath('/messages')) });
}

export function useCustomerDocuments(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['client-portal', 'documents'], queryFn: () => api<PortalDocument[]>(portalPath('/documents')) });
}

export function useCustomerProposal(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['client-portal', 'proposal', id], queryFn: () => api<PublicProposal>(portalPath(`/proposals/${id}`)) });
}

export const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
