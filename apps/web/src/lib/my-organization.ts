'use client';

import type {
  OrgActivityRow,
  OrgCredentialInput,
  OrgCredentialRow,
  OrgCredentialSecret,
  OrgCredentialUpdate,
  OrgDocumentDetail,
  OrgDocumentMeta,
  OrgDocumentQuery,
  OrgDocumentRow,
  OrgDocumentUpdate,
  OrgOverview,
  OrgProfile,
  OrgProfileInput,
  OrgShareInput,
  OrgShareRow,
  OrgSharedView,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_CONFIRMATION_HEADER } from '@dealflow/types';
import { api, ApiError, CHANGE_EVENT, languageHeader, refreshSession } from './api';

/** The one-time pass from the password dialog, when the page asked for it itself (so it can say what is at stake). */
const passHeader = (pass?: string): Record<string, string> => (pass ? { [PASSWORD_CONFIRMATION_HEADER]: pass } : {});

/** My Organization (ADR 0100): the organisation's own record, documents, credentials, client shares and history. */

const KEYS = { overview: ['org', 'overview'], documents: ['org', 'documents'], credentials: ['org', 'credentials'], shares: ['org', 'shares'], activity: ['org', 'activity'] } as const;

export function useOrgOverview() {
  return useQuery({ queryKey: KEYS.overview, queryFn: () => api<OrgOverview>('/organization') });
}

export function useOrgDocuments(q: OrgDocumentQuery = {}) {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();
  return useQuery({ queryKey: [...KEYS.documents, q], queryFn: () => api<OrgDocumentRow[]>(`/organization/documents${qs ? `?${qs}` : ''}`) });
}

export function useOrgDocument(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: [...KEYS.documents, 'one', id], queryFn: () => api<OrgDocumentDetail>(`/organization/documents/${id}`) });
}

export function useOrgCredentials(enabled: boolean) {
  return useQuery({ enabled, queryKey: KEYS.credentials, queryFn: () => api<OrgCredentialRow[]>('/organization/credentials') });
}

export function useOrgShares() {
  return useQuery({ queryKey: KEYS.shares, queryFn: () => api<OrgShareRow[]>('/organization/shares') });
}

export function useOrgActivity(limit = 50) {
  return useQuery({ queryKey: [...KEYS.activity, limit], queryFn: () => api<OrgActivityRow[]>(`/organization/activity?limit=${limit}`) });
}

/** Sends a file as the raw request body, the way the API takes uploads, with the same session refresh as api(). */
async function sendFile<T>(method: 'POST' | 'PUT', path: string, file: File, retry = true): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method, credentials: 'include', headers: { ...languageHeader(), 'content-type': file.type || 'application/octet-stream' }, body: file });
  if (res.status === 401 && retry && (await refreshSession())) return sendFile(method, path, file, false);
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: { path: string; message: string }[] } } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Something went wrong. Please try again.', body?.error?.details);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return body as T;
}

export function useOrgMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['org'] });
  const opts = { onSuccess: refresh };
  return {
    saveProfile: useMutation({ mutationFn: (input: OrgProfileInput) => api<OrgProfile>('/organization/profile', { method: 'PUT', json: input }), ...opts }),
    uploadLogo: useMutation({ mutationFn: (file: File) => sendFile<OrgProfile>('PUT', '/organization/logo', file), ...opts }),
    removeLogo: useMutation({ mutationFn: () => api<OrgProfile>('/organization/logo', { method: 'DELETE' }), ...opts }),
    upload: useMutation({
      mutationFn: ({ file, meta }: { file: File; meta: OrgDocumentMeta }) => sendFile<OrgDocumentDetail>('POST', `/organization/documents?${new URLSearchParams({ name: file.name, meta: JSON.stringify(meta) })}`, file),
      ...opts,
    }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: OrgDocumentUpdate }) => api<OrgDocumentDetail>(`/organization/documents/${id}`, { method: 'PATCH', json: input }), ...opts }),
    replace: useMutation({
      mutationFn: ({ id, file, note }: { id: string; file: File; note?: string }) => sendFile<OrgDocumentDetail>('POST', `/organization/documents/${id}/versions?${new URLSearchParams({ name: file.name, ...(note ? { note } : {}) })}`, file),
      ...opts,
    }),
    remove: useMutation({ mutationFn: ({ id, pass }: { id: string; pass?: string }) => api<void>(`/organization/documents/${id}`, { method: 'DELETE', headers: passHeader(pass) }), ...opts }),
    addCredential: useMutation({ mutationFn: (input: OrgCredentialInput) => api<OrgCredentialRow>('/organization/credentials', { method: 'POST', json: input }), ...opts }),
    updateCredential: useMutation({ mutationFn: ({ id, input }: { id: string; input: OrgCredentialUpdate }) => api<OrgCredentialRow>(`/organization/credentials/${id}`, { method: 'PATCH', json: input }), ...opts }),
    reveal: useMutation({ mutationFn: ({ id, pass }: { id: string; pass?: string }) => api<OrgCredentialSecret>(`/organization/credentials/${id}/reveal`, { method: 'POST', headers: passHeader(pass) }), onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.activity }) }),
    removeCredential: useMutation({ mutationFn: ({ id, pass }: { id: string; pass?: string }) => api<void>(`/organization/credentials/${id}`, { method: 'DELETE', headers: passHeader(pass) }), ...opts }),
    share: useMutation({ mutationFn: (input: OrgShareInput) => api<OrgShareRow>('/organization/shares', { method: 'POST', json: input }), ...opts }),
    revoke: useMutation({ mutationFn: (id: string) => api<OrgShareRow>(`/organization/shares/${id}/revoke`, { method: 'POST' }), ...opts }),
  };
}

/** Where a document's file is: `inline` for the preview, otherwise a download. */
export function documentFileUrl(id: string, opts: { version?: number; inline?: boolean } = {}): string {
  const qs = new URLSearchParams({ ...(opts.version ? { version: String(opts.version) } : {}), ...(opts.inline ? { inline: '1' } : {}) }).toString();
  return `/api/v1/organization/documents/${id}/file${qs ? `?${qs}` : ''}`;
}

/** The client's view of a share link (no sign-in). */
export async function fetchSharedOrganization(token: string): Promise<OrgSharedView> {
  const res = await fetch(`/api/v1/organization-shares/${encodeURIComponent(token)}`, { headers: languageHeader() });
  const body = (await res.json().catch(() => null)) as (OrgSharedView & { error?: { code: string; message: string } }) | null;
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Something went wrong. Please try again.');
  return body!;
}

export const sharedFileUrl = (token: string, documentId: string, inline = false) => `/api/v1/organization-shares/${encodeURIComponent(token)}/documents/${documentId}${inline ? '?inline=1' : ''}`;
