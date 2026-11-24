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
  // When a run finishes, the company itself changed: reload it so the new details and logo show. The company may
  // have loaded just before the run finished, so the first finished run seen after opening the page counts too.
  const seen = React.useRef<string | null>(null);
  const latest = query.data?.runs.find((r) => r.status !== 'PENDING');
  const finished = latest ? `${latest.id}:${latest.finishedAt}` : null;
  React.useEffect(() => {
    if (!finished || seen.current === finished) return;
    if (seen.current !== null || latest?.status === 'DONE') void qc.invalidateQueries({ queryKey: ['companies', 'detail', companyId] });
    seen.current = finished;
  }, [finished, latest?.status, companyId, qc]);
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
