'use client';

import type {
  AssignedTaskCreateInput,
  AssignedTaskDetail,
  AssignedTasksView,
  AssignedTaskUpdateInput,
  TargetCreateInput,
  TargetDistributeInput,
  TargetRow,
  TargetsView,
  TargetUpdateInput,
  TaskProgressInput,
  TaskReaction,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** Targets and tasks handed down the workspace hierarchy (ADR 0071, part 4). */

const TARGETS = ['targets'] as const;
const TASKS = ['assigned-tasks'] as const;

export function useTargets(enabled = true) {
  return useQuery({ queryKey: TARGETS, queryFn: () => api<TargetsView>('/targets'), enabled });
}

export function useTargetMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: TARGETS });
  return {
    create: useMutation({ mutationFn: (input: TargetCreateInput) => api<TargetRow>('/targets', { method: 'POST', json: input }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: TargetUpdateInput }) => api<TargetRow>(`/targets/${id}`, { method: 'PATCH', json: input }), onSuccess: refresh }),
    distribute: useMutation({ mutationFn: ({ id, input }: { id: string; input: TargetDistributeInput }) => api<TargetRow[]>(`/targets/${id}/distribute`, { method: 'POST', json: input }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/targets/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useAssignedTasks(enabled = true) {
  return useQuery({ queryKey: TASKS, queryFn: () => api<AssignedTasksView>('/assigned-tasks'), enabled });
}

export function useAssignedTask(id: string | null) {
  return useQuery({ queryKey: [...TASKS, id], queryFn: () => api<AssignedTaskDetail>(`/assigned-tasks/${id}`), enabled: !!id });
}

export function useAssignedTaskMutations() {
  const qc = useQueryClient();
  const refresh = (t?: AssignedTaskDetail) => {
    if (t) qc.setQueryData([...TASKS, t.id], t);
    return Promise.all([qc.invalidateQueries({ queryKey: TASKS, exact: true }), qc.invalidateQueries({ queryKey: ['notifications'] })]);
  };
  return {
    create: useMutation({ mutationFn: (input: AssignedTaskCreateInput) => api<AssignedTaskDetail>('/assigned-tasks', { method: 'POST', json: input }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: AssignedTaskUpdateInput }) => api<AssignedTaskDetail>(`/assigned-tasks/${id}`, { method: 'PATCH', json: input }), onSuccess: refresh }),
    comment: useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => api<AssignedTaskDetail>(`/assigned-tasks/${id}/comments`, { method: 'POST', json: { body } }), onSuccess: refresh }),
    /** The assignee says where the task stands (redesign R7). */
    progress: useMutation({ mutationFn: ({ id, input }: { id: string; input: TaskProgressInput }) => api<AssignedTaskDetail>(`/assigned-tasks/${id}/progress`, { method: 'POST', json: input }), onSuccess: refresh }),
    /** Adds or takes back a reaction on a comment. */
    react: useMutation({
      mutationFn: ({ id, commentId, emoji }: { id: string; commentId: string; emoji: TaskReaction }) => api<AssignedTaskDetail>(`/assigned-tasks/${id}/comments/${commentId}/reactions`, { method: 'POST', json: { emoji } }),
      onSuccess: (t) => qc.setQueryData([...TASKS, t.id], t),
    }),
  };
}
