import type { DashboardRow, GalaxyGraph, GlobeData, PipelineFlow, PipelineReplay, ReportDefinition, ReportResult, ReportRow } from '@dealflow/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { toQuery } from './crm';

/** Data hooks for the report builder, dashboards and the immersive views. */

export function useReports() {
  return useQuery({ queryKey: ['reports', 'list'], queryFn: () => api<ReportRow[]>('/reports') });
}

export function useReport(id: string | undefined) {
  return useQuery({ queryKey: ['reports', 'one', id], queryFn: () => api<ReportRow>(`/reports/${id}`), enabled: !!id });
}

/** Runs a definition (saved or not). Keeps the previous result on screen while the next one loads. */
export function useReportResult(definition: ReportDefinition | null, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'run', definition],
    queryFn: () => api<ReportResult>('/reports/run', { method: 'POST', json: { definition } }),
    enabled: enabled && !!definition,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useSavedResult(id: string) {
  return useQuery({ queryKey: ['reports', 'result', id], queryFn: () => api<ReportResult>(`/reports/${id}/result`), staleTime: 30_000 });
}

export function useDashboards() {
  return useQuery({ queryKey: ['dashboards', 'list'], queryFn: () => api<DashboardRow[]>('/dashboards') });
}

export function useDashboard(id: string) {
  return useQuery({ queryKey: ['dashboards', 'one', id], queryFn: () => api<DashboardRow>(`/dashboards/${id}`) });
}

export function useGalaxy() {
  return useQuery({ queryKey: ['insights', 'galaxy'], queryFn: () => api<GalaxyGraph>('/insights/galaxy'), staleTime: 60_000 });
}

export function useGlobe() {
  return useQuery({ queryKey: ['insights', 'globe'], queryFn: () => api<GlobeData>('/insights/globe'), staleTime: 60_000 });
}

export function useFlow(params: { pipelineId?: string; days: number }) {
  return useQuery({ queryKey: ['insights', 'flow', params], queryFn: () => api<PipelineFlow>(`/insights/flow${toQuery(params)}`), placeholderData: keepPreviousData });
}

export function useReplay(params: { pipelineId?: string; days: number }) {
  return useQuery({ queryKey: ['insights', 'replay', params], queryFn: () => api<PipelineReplay>(`/insights/replay${toQuery(params)}`), placeholderData: keepPreviousData });
}

/** Formats a report value: money in the result currency, otherwise a plain number. */
export function formatValue(v: number, currency: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }).format(v);
    } catch {
      return `${currency} ${v.toLocaleString('en-US')}`;
    }
  }
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}
