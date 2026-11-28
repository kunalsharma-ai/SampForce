'use client';

import type {
  PerformanceQuery,
  PerformanceSettings,
  PerformanceSettingsInput,
  PerformanceView,
  TargetTrend,
  TaskPlanCreateInput,
  TaskPlanDetail,
  TaskPlansView,
  TaskPlanUpdateInput,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** Recurring tasks, target trends and performance ranking (ADR 0096). */

const PLANS = ['task-plans'] as const;

/** Counted on the server from real records; refreshed every minute and when the tab comes back, so progress moves by itself. */
export function useTaskPlans(enabled = true) {
  return useQuery({ queryKey: PLANS, queryFn: () => api<TaskPlansView>('/task-plans'), enabled, refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export function useTaskPlan(id: string | null) {
  return useQuery({ queryKey: [...PLANS, id], queryFn: () => api<TaskPlanDetail>(`/task-plans/${id}`), enabled: !!id });
}

export function useTaskPlanMutations() {
  const qc = useQueryClient();
  const done = (d?: TaskPlanDetail | void) => {
    if (d) qc.setQueryData([...PLANS, d.id], d);
    return Promise.all([qc.invalidateQueries({ queryKey: PLANS, exact: true }), qc.invalidateQueries({ queryKey: ['notifications'] })]);
  };
  return {
    create: useMutation({ mutationFn: (input: TaskPlanCreateInput) => api<TaskPlanDetail>('/task-plans', { method: 'POST', json: input }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: TaskPlanUpdateInput }) => api<TaskPlanDetail>(`/task-plans/${id}`, { method: 'PATCH', json: input }), onSuccess: done }),
    pause: useMutation({ mutationFn: (id: string) => api<TaskPlanDetail>(`/task-plans/${id}/pause`, { method: 'POST', json: {} }), onSuccess: done }),
    resume: useMutation({ mutationFn: (id: string) => api<TaskPlanDetail>(`/task-plans/${id}/resume`, { method: 'POST', json: {} }), onSuccess: done }),
    cancel: useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => api<TaskPlanDetail>(`/task-plans/${id}/cancel`, { method: 'POST', json: reason ? { reason } : {} }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/task-plans/${id}`, { method: 'DELETE' }), onSuccess: () => done() }),
  };
}

export function useTargetTrend(id: string | null) {
  return useQuery({ queryKey: ['targets', 'trend', id], queryFn: () => api<TargetTrend>(`/targets/${id}/trend`), enabled: !!id });
}

export function usePerformance(q: PerformanceQuery) {
  return useQuery({ queryKey: ['performance', q.period, q.offset], queryFn: () => api<PerformanceView>(`/performance?period=${q.period ?? 'MONTH'}&offset=${q.offset ?? 0}`) });
}

export function usePerformanceSettings(enabled = true) {
  return useQuery({ queryKey: ['performance', 'settings'], queryFn: () => api<PerformanceSettings>('/performance/settings'), enabled });
}

export function useSavePerformanceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PerformanceSettingsInput) => api<PerformanceSettings>('/performance/settings', { method: 'PUT', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['performance'] }),
  });
}
