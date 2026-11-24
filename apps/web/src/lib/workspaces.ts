'use client';

import { type CreateWorkspaceInput, PASSWORD_CONFIRMATION_HEADER, type UpdateWorkspaceInput, type WorkspaceDeleted, type WorkspaceImpact, type WorkspacePermissionsInput, type WorkspaceRow, type WorkspaceTree } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

const KEY = ['workspaces', 'tree'] as const;

/** The workspaces the caller can see, with their limits and what the caller may create (ADR 0071). */
export function useWorkspaceTree() {
  return useQuery({ queryKey: KEY, queryFn: () => api<WorkspaceTree>('/workspaces') });
}

/** Every change refreshes the tree, the caller's identity and the session's features (a grant can change them). */
export function useWorkspaceMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['workspaces'] }), qc.invalidateQueries({ queryKey: ['members'] })]);
  return {
    create: useMutation({
      mutationFn: (input: CreateWorkspaceInput) => api<WorkspaceRow & { inviteUrl?: string }>('/workspaces', { method: 'POST', json: input }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateWorkspaceInput }) => api<WorkspaceRow>(`/workspaces/${id}`, { method: 'PATCH', json: input }),
      onSuccess: refresh,
    }),
    permissions: useMutation({
      mutationFn: ({ id, input }: { id: string; input: WorkspacePermissionsInput }) => api<WorkspaceRow>(`/workspaces/${id}/permissions`, { method: 'PUT', json: input }),
      onSuccess: refresh,
    }),
    move: useMutation({
      mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => api<WorkspaceRow>(`/workspaces/${id}/move`, { method: 'POST', json: { parentId } }),
      onSuccess: refresh,
    }),
    assign: useMutation({
      mutationFn: ({ id, userId }: { id: string; userId: string }) => api<WorkspaceRow>(`/workspaces/${id}/members`, { method: 'POST', json: { userId } }),
      onSuccess: refresh,
    }),
    /** Deactivating asks for the password: the caller passes the one-time pass from the dialog. */
    deactivate: useMutation({
      mutationFn: ({ id, reason, pass }: { id: string; reason: string; pass: string }) =>
        api<WorkspaceRow>(`/workspaces/${id}/deactivate`, { method: 'POST', json: { reason }, headers: { [PASSWORD_CONFIRMATION_HEADER]: pass } }),
      onSuccess: refresh,
    }),
    /** A blacklist until a day (YYYY-MM-DD): asks for the password like deactivating. */
    blacklist: useMutation({
      mutationFn: ({ id, until, reason, pass }: { id: string; until: string; reason: string; pass: string }) =>
        api<WorkspaceRow>(`/workspaces/${id}/blacklist`, { method: 'POST', json: { until, reason }, headers: { [PASSWORD_CONFIRMATION_HEADER]: pass } }),
      onSuccess: refresh,
    }),
    reactivate: useMutation({
      mutationFn: (id: string) => api<WorkspaceRow>(`/workspaces/${id}/reactivate`, { method: 'POST' }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: ({ id, confirmName, handoverToId, pass }: { id: string; confirmName: string; handoverToId: string | null; pass: string }) =>
        api<WorkspaceDeleted>(`/workspaces/${id}`, { method: 'DELETE', json: { confirmName, handoverToId }, headers: { [PASSWORD_CONFIRMATION_HEADER]: pass } }),
      onSuccess: refresh,
    }),
  };
}

/** What deleting a workspace would touch (W4), loaded when the delete dialog opens. */
export function useWorkspaceImpact(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['workspaces', 'impact', id], queryFn: () => api<WorkspaceImpact>(`/workspaces/${id}/impact`), staleTime: 0 });
}
