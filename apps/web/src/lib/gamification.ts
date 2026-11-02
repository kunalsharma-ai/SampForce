import type { AwardRow, BadgeInput, BadgeRow, CompetitionInput, CompetitionRow, GamificationMe, GamificationSettings, GamificationSettingsInput, Leaderboard, TeamInput, TeamRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { fmtLocale } from '@/lib/i18n/locale';
import type { Translator } from '@/lib/i18n';

export function useGamificationMe() {
  return useQuery({ queryKey: ['gamification', 'me'], queryFn: () => api<GamificationMe>('/gamification/me') });
}

export function useLeaderboard(period: string | null, enabled = true) {
  return useQuery({ enabled, queryKey: ['gamification', 'leaderboard', period], queryFn: () => api<Leaderboard>(`/gamification/leaderboard${period ? `?period=${period}` : ''}`) });
}

export function useGamificationSettings() {
  return useQuery({ queryKey: ['gamification', 'settings'], queryFn: () => api<GamificationSettings>('/gamification/settings') });
}

export function useBadges() {
  return useQuery({ queryKey: ['gamification', 'badges'], queryFn: () => api<BadgeRow[]>('/gamification/badges') });
}

export function useAwards(enabled = true) {
  return useQuery({ enabled, queryKey: ['gamification', 'awards'], queryFn: () => api<AwardRow[]>('/gamification/awards') });
}

export function useCompetitions(enabled = true) {
  return useQuery({ enabled, queryKey: ['gamification', 'competitions'], queryFn: () => api<CompetitionRow[]>('/gamification/competitions') });
}

export function useTeams() {
  return useQuery({ queryKey: ['teams'], queryFn: () => api<TeamRow[]>('/tenants/current/teams') });
}

/** Any gamification change can move points, badges and standings: refresh them all. */
export function useGamificationMutation<A, R>(fn: (arg: A) => Promise<R>, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      onDone?.(r);
      await Promise.all([qc.invalidateQueries({ queryKey: ['gamification'] }), qc.invalidateQueries({ queryKey: ['teams'] })]);
    },
  });
}

export const gamificationApi = {
  saveSettings: (body: GamificationSettingsInput) => api<GamificationSettings>('/gamification/settings', { method: 'PUT', json: body }),
  createBadge: (body: BadgeInput) => api<BadgeRow>('/gamification/badges', { method: 'POST', json: body }),
  updateBadge: (id: string, body: BadgeInput) => api<BadgeRow>(`/gamification/badges/${id}`, { method: 'PUT', json: body }),
  removeBadge: (id: string) => api<void>(`/gamification/badges/${id}`, { method: 'DELETE' }),
  addDefaultBadges: () => api<BadgeRow[]>('/gamification/badges/defaults', { method: 'POST' }),
  evaluate: () => api<{ awarded: number }>('/gamification/badges/evaluate', { method: 'POST' }),
  createCompetition: (body: CompetitionInput) => api<CompetitionRow>('/gamification/competitions', { method: 'POST', json: body }),
  cancelCompetition: (id: string) => api<CompetitionRow>(`/gamification/competitions/${id}/cancel`, { method: 'POST' }),
  createTeam: (body: TeamInput) => api<TeamRow>('/tenants/current/teams', { method: 'POST', json: body }),
  updateTeam: (id: string, body: TeamInput) => api<TeamRow>(`/tenants/current/teams/${id}`, { method: 'PUT', json: body }),
  removeTeam: (id: string) => api<void>(`/tenants/current/teams/${id}`, { method: 'DELETE' }),
};

/** Period labels for the selector: this month back five, this quarter and last, this year and last. */
export function periodOptions(t: Translator, now = new Date()): { value: string; label: string; last: boolean }[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: { value: string; label: string; last: boolean }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(y, m - i, 1));
    const value = d.toISOString().slice(0, 7);
    const short = d.toLocaleDateString(fmtLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' });
    out.push({ value, last: i === 1, label: i === 0 ? t('This month ({month})', { month: short }) : i === 1 ? t('Last month ({month})', { month: short }) : d.toLocaleDateString(fmtLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
  }
  const q = Math.floor(m / 3) + 1;
  out.push({ value: `${y}-Q${q}`, last: false, label: t('This quarter (Q{q} {year})', { q, year: y }) });
  out.push(q === 1 ? { value: `${y - 1}-Q4`, last: true, label: t('Last quarter (Q{q} {year})', { q: 4, year: y - 1 }) } : { value: `${y}-Q${q - 1}`, last: true, label: t('Last quarter (Q{q} {year})', { q: q - 1, year: y }) });
  out.push({ value: `${y}`, last: false, label: t('This year ({year})', { year: y }) });
  out.push({ value: `${y - 1}`, last: true, label: t('Last year ({year})', { year: y - 1 }) });
  return out;
}
