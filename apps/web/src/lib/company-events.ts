'use client';

import type { CompanyEventsInput, CompanyEventsSettings } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The company's own special days, set by the Super Workspace and shown on every home dashboard on the day. */
export function useCompanyEvents() {
  const qc = useQueryClient();
  return {
    query: useQuery({ queryKey: ['crm-config', 'company-events'], queryFn: () => api<CompanyEventsSettings>('/crm-config/company-events'), staleTime: 60_000 }),
    save: useMutation({
      mutationFn: (input: CompanyEventsInput) => api<CompanyEventsSettings>('/crm-config/company-events', { method: 'PUT', json: input }),
      onSuccess: (data) => {
        qc.setQueryData(['crm-config', 'company-events'], data);
        void qc.invalidateQueries({ queryKey: ['special-days'] });
      },
    }),
  };
}
