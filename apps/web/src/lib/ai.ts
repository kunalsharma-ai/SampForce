import type {
  ForecastPlan,
  ForecastTrends,
  PeriodGranularity,
  AiAgentKey,
  AiSettingsUpdate,
  AiStatus,
  AiUsageSummary,
  ForecastComparison,
  ForecastSnapshotRow,
  ForecastView,
  RecommendationRow,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { useCan } from './session';

export function useAiStatus(enabled = true) {
  const can = useCan('ai:use');
  return useQuery({ enabled: enabled && can, queryKey: ['ai', 'status'], queryFn: () => api<AiStatus>('/ai/status'), staleTime: 15_000 });
}

/** Why an agent cannot call the model right now, or null when it can. */
export function agentReason(status: AiStatus | undefined, key: AiAgentKey): string | null {
  return status?.agents.find((a) => a.key === key)?.reason ?? null;
}

export function useAiUsage(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['ai', 'usage'], queryFn: () => api<AiUsageSummary>('/ai/usage') });
}

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AiSettingsUpdate) => api<AiStatus>('/ai/settings', { method: 'PATCH', json: patch }),
    onSuccess: (s) => qc.setQueryData(['ai', 'status'], s),
  });
}

export function useRecommendations(entityType: 'lead' | 'contact' | 'deal', entityId: string) {
  const can = useCan('ai:use');
  return useQuery({
    enabled: can,
    queryKey: ['ai', 'recommendations', entityType, entityId],
    queryFn: () => api<RecommendationRow[]>(`/ai/recommendations?entityType=${entityType}&entityId=${entityId}`),
  });
}

export function useForecast(period: string) {
  return useQuery({ queryKey: ['forecast', period], queryFn: () => api<ForecastView>(`/forecast?period=${period}`) });
}

export function useForecastPlan(period: string) {
  return useQuery({ queryKey: ['forecast', period, 'plan'], queryFn: () => api<ForecastPlan>(`/forecast/plan?period=${period}`) });
}

export function useForecastTrends(granularity: PeriodGranularity, count: number) {
  return useQuery({ queryKey: ['forecast', 'trends', granularity, count], queryFn: () => api<ForecastTrends>(`/forecast/trends?granularity=${granularity}&count=${count}`) });
}

export function useSnapshots(period: string) {
  return useQuery({ queryKey: ['forecast', period, 'snapshots'], queryFn: () => api<ForecastSnapshotRow[]>(`/forecast/snapshots?period=${period}`) });
}

export type ForecastExplanation = ForecastComparison & { explanation: string | null; explanationUnavailable: string | null };

/** Turns AI gateway errors into the sentence a person should read. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'AI_CREDITS_EXHAUSTED') return `${err.message} An admin can review usage on the AI Agents page.`;
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}
