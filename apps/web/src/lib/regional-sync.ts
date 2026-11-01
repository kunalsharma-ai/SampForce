'use client';

import type { Regional, RegionalResponse } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useRegional } from '@/stores/regional';

export const REGIONAL_KEY = ['me', 'regional'] as const;

/** Applies the language and formats saved on the person's account (the device cache only bridges the first paint). */
export function useRegionalSync(enabled: boolean) {
  const query = useQuery({ queryKey: REGIONAL_KEY, queryFn: () => api<RegionalResponse>('/me/regional'), enabled, staleTime: Infinity });
  useEffect(() => {
    if (query.data) useRegional.getState().adopt(query.data.regional);
  }, [query.data]);
  return query;
}

export function useRegionalQuery() {
  return useQuery({ queryKey: REGIONAL_KEY, queryFn: () => api<RegionalResponse>('/me/regional'), staleTime: Infinity });
}

/**
 * When the settings were last saved from this tab. Applying a new language remounts the page, so the settings card reads
 * this to keep showing its confirmation.
 */
export const regionalSaves = { at: 0 };

/** Saves to the account first and applies only once the server has it, so every device agrees. */
export function useSaveRegional() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: Regional) => api<RegionalResponse>('/me/regional', { method: 'PUT', json: r }),
    onSuccess: (res) => {
      regionalSaves.at = Date.now();
      qc.setQueryData(REGIONAL_KEY, res);
      useRegional.getState().adopt(res.regional);
    },
  });
}

export function useResetRegional() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<RegionalResponse>('/me/regional', { method: 'DELETE' }),
    onSuccess: (res) => {
      regionalSaves.at = Date.now();
      qc.setQueryData(REGIONAL_KEY, res);
      useRegional.getState().adopt(res.regional);
    },
  });
}
