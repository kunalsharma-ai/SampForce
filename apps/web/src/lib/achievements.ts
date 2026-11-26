'use client';

import type { AchievementCategory, AchievementPage, AchievementRow, AchievementSettingsInput, AchievementSettingsView, AchievementSummary } from '@dealflow/types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/*
 * Achievements in the browser (ADR 0090). The celebration host claims new achievements after each change and every
 * so often; the My Achievements page reads the history and the summary without ever replaying a celebration.
 */

export const ACHIEVEMENTS_KEY = ['achievements'] as const;
const SETTINGS_KEY = ['achievements', 'settings'] as const;

export function useAchievementSettings(enabled = true) {
  return useQuery({ enabled, queryKey: SETTINGS_KEY, queryFn: () => api<AchievementSettingsView>('/achievements/settings'), staleTime: 60_000 });
}

export function useSaveAchievementSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AchievementSettingsInput) => api<AchievementSettingsView>('/achievements/settings', { method: 'PUT', json: input }),
    onSuccess: (view) => {
      qc.setQueryData(SETTINGS_KEY, view);
      void qc.invalidateQueries({ queryKey: [...ACHIEVEMENTS_KEY, 'summary'] });
    },
  });
}

export function useAchievementSummary() {
  return useQuery({ queryKey: [...ACHIEVEMENTS_KEY, 'summary'], queryFn: () => api<AchievementSummary>('/achievements/summary') });
}

export function useAchievementHistory(category: AchievementCategory | null) {
  return useInfiniteQuery({
    queryKey: [...ACHIEVEMENTS_KEY, 'history', category ?? 'all'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: '20' });
      if (category) q.set('category', category);
      if (pageParam) q.set('cursor', pageParam);
      return api<AchievementPage>(`/achievements?${q}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function claimAchievements(): Promise<AchievementRow[]> {
  return api<AchievementRow[]>('/achievements/claim', { method: 'POST' });
}
