'use client';

import type { CompanyJourney, JourneyBoard, JourneySettings, JourneySettingsInput } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The Pipeline journey board and each company's journey (redesign R5, ADR 0085). */
export function useJourneyBoard(f: { q?: string; mine?: boolean; perStage?: number }) {
  const qs = new URLSearchParams();
  if (f.q?.trim()) qs.set('q', f.q.trim());
  if (f.mine) qs.set('mine', 'true');
  if (f.perStage) qs.set('perStage', String(f.perStage));
  const s = qs.toString();
  return useQuery({ queryKey: ['journey-board', s], queryFn: () => api<JourneyBoard>(`/pipeline/journey${s ? `?${s}` : ''}`), staleTime: 15_000, placeholderData: (prev) => prev });
}

export function useCompanyJourney(companyId: string | null) {
  return useQuery({ queryKey: ['company-journey', companyId], queryFn: () => api<CompanyJourney>(`/companies/${companyId}/journey`), enabled: !!companyId, staleTime: 15_000 });
}

export function useJourneySettings() {
  const qc = useQueryClient();
  return {
    query: useQuery({ queryKey: ['crm-config', 'journey'], queryFn: () => api<JourneySettings>('/crm-config/journey'), staleTime: 60_000 }),
    save: useMutation({
      mutationFn: (input: JourneySettingsInput) => api<JourneySettings>('/crm-config/journey', { method: 'PUT', json: input }),
      onSuccess: (data) => {
        qc.setQueryData(['crm-config', 'journey'], data);
        void qc.invalidateQueries({ queryKey: ['journey-board'] });
        void qc.invalidateQueries({ queryKey: ['company-journey'] });
      },
    }),
  };
}
