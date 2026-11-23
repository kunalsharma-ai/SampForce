'use client';

import type { CreateWorkspaceInput, UpdateWorkspaceInput, WorkspacePermissionsInput, WorkspaceRow, WorkspaceTree } from '@dealflow/types';
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
    archive: useMutation({
      mutationFn: (id: string) => api(`/workspaces/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}
