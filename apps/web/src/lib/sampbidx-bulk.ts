'use client';

import type { SampbidxBatchInput, SampbidxBatchRow, SampbidxBulkPreview, SampbidxDiagnoseInput, SampbidxDiagnosis, SampbidxOverview, SampbidxTransferRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The SampBidx settings page and bulk sends of deals and won companies (ADR 0099). */

export function useSampbidxOverview(enabled = true) {
  return useQuery({ enabled, queryKey: ['sampbidx', 'overview'], queryFn: () => api<SampbidxOverview>('/apps/sampbidx/overview') });
}

export function useSampbidxDiagnose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SampbidxDiagnoseInput) => api<SampbidxDiagnosis>('/apps/sampbidx/diagnose', { method: 'POST', json: input }),
    // Testing the saved connection updates its state, so the page and the Integrations card read it again.
    onSuccess: (d) => (d.saved ? Promise.all([qc.invalidateQueries({ queryKey: ['sampbidx', 'overview'] }), qc.invalidateQueries({ queryKey: ['apps'] })]) : undefined),
  });
}

export function useSampbidxBulkPreview() {
  return useMutation({ mutationFn: (input: SampbidxBatchInput) => api<SampbidxBulkPreview>('/apps/sampbidx/batches/preview', { method: 'POST', json: input }) });
}

export function useStartSampbidxBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SampbidxBatchInput) => api<SampbidxBatchRow>('/apps/sampbidx/batches', { method: 'POST', json: input }),
    onSuccess: (b) => qc.setQueryData(['sampbidx', 'batch', b.id], b),
  });
}

/** A batch, read again every second while it runs; it stops once every item has SampBidx's answer. */
export function useSampbidxBatch(id: string | null) {
  const qc = useQueryClient();
  return useQuery({
    enabled: !!id,
    queryKey: ['sampbidx', 'batch', id],
    queryFn: async () => {
      const b = await api<SampbidxBatchRow>(`/apps/sampbidx/batches/${id}`);
      if (b.status === 'DONE') void qc.invalidateQueries({ queryKey: ['sampbidx', 'overview'] });
      return b;
    },
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 800 : false),
  });
}

export function useRetrySampbidxBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<SampbidxBatchRow>(`/apps/sampbidx/batches/${id}/retry`, { method: 'POST', json: {} }),
    onSuccess: (b) => {
      qc.setQueryData(['sampbidx', 'batch', b.id], b);
      return qc.invalidateQueries({ queryKey: ['sampbidx', 'overview'] });
    },
  });
}

export function useRetrySampbidxTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<SampbidxTransferRow>(`/apps/sampbidx/transfers/${id}/retry`, { method: 'POST', json: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['sampbidx'] }),
  });
}
