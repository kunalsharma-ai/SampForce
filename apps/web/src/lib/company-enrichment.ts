'use client';

import type { CompanyEnrichmentState, EnrichField, EnrichmentRun } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { api } from './api';

/** Company auto-fill (ADR 0076): the runs, the source of every filled field, look up again, undo. */
export function useCompanyEnrichment(companyId: string, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['company-enrichment', companyId],
    queryFn: () => api<CompanyEnrichmentState>(`/companies/${companyId}/enrichment`),
    enabled,
    // While a run waits or reads the website, check every few seconds; otherwise only when asked.
    refetchInterval: (q) => (q.state.data?.busy ? 3_000 : false),
  });
  // When a run finishes, the company itself changed: reload it so the new details and logo show.
  const wasBusy = React.useRef(false);
  const busy = !!query.data?.busy;
  React.useEffect(() => {
    if (wasBusy.current && !busy) void qc.invalidateQueries({ queryKey: ['companies', 'detail', companyId] });
    wasBusy.current = busy;
  }, [busy, companyId, qc]);
  return query;
}

export function useEnrichCompany(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<EnrichmentRun>(`/companies/${companyId}/enrich`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-enrichment', companyId] }),
  });
}

export function useUndoEnrichment(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, fields }: { runId: string; fields?: EnrichField[] }) =>
      api(`/companies/${companyId}/enrichment/${runId}/undo`, { method: 'POST', json: fields ? { fields } : {} }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: ['company-enrichment', companyId] }), qc.invalidateQueries({ queryKey: ['companies', 'detail', companyId] })]),
  });
}
