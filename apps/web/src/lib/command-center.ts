'use client';

import type {
  ClientConcernInput,
  ClientConcernRow,
  ClientConcernUpdate,
  CommandCenterContext,
  CommandCenterLayout,
  DashboardTier,
  DrillMetric,
  DrillResult,
  ExecutiveDashboard,
  InstructionInput,
  InstructionProgress,
  InstructionRow,
  LeadTransferDecision,
  LeadTransferInput,
  LeadTransferRow,
  ManagerDashboard,
  ReportPeriod,
  SeniorDashboard,
  RevenueRecordRow,
  RevenueRecordUpdate,
} from '@dealflow/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { browserTimeZone } from './company-work';

/** The Command Center dashboards (ADR 0063): who sees which, the executive dashboard, transfers and revenue records. */

export interface PeriodChoice {
  period: ReportPeriod;
  from?: string;
  to?: string;
}

export function periodQuery(
  p: PeriodChoice,
  extra: Record<string, string | undefined> = {},
): string {
  const qs = new URLSearchParams({ period: p.period, tz: browserTimeZone() });
  if (p.period === 'custom' && p.from && p.to) {
    qs.set('from', p.from);
    qs.set('to', p.to);
  }
  for (const [k, v] of Object.entries(extra)) if (v) qs.set(k, v);
  return qs.toString();
}

export function useCommandCenterContext(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['command-center', 'context'],
    queryFn: () => api<CommandCenterContext>('/command-center/context'),
    staleTime: 60_000,
  });
}

export function useExecutiveDashboard(p: PeriodChoice, userId: string | undefined, enabled = true) {
  return useQuery({
    enabled: enabled && (p.period !== 'custom' || (!!p.from && !!p.to)),
    queryKey: ['command-center', 'executive', p, userId ?? ''],
    queryFn: () =>
      api<ExecutiveDashboard>(`/command-center/executive?${periodQuery(p, { userId })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
  });
}

export function useManagerDashboard(p: PeriodChoice, userId: string | undefined, enabled = true) {
  return useQuery({
    enabled: enabled && (p.period !== 'custom' || (!!p.from && !!p.to)),
    queryKey: ['command-center', 'manager', p, userId ?? ''],
    queryFn: () => api<ManagerDashboard>(`/command-center/manager?${periodQuery(p, { userId })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
  });
}

export function useSeniorDashboard(p: PeriodChoice, departmentId: string | undefined, enabled = true) {
  return useQuery({
    enabled: enabled && (p.period !== 'custom' || (!!p.from && !!p.to)),
    queryKey: ['command-center', 'senior', p, departmentId ?? ''],
    queryFn: () => api<SeniorDashboard>(`/command-center/senior?${periodQuery(p, { departmentId })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 300_000,
  });
}

export interface DrillTarget {
  metric: DrillMetric;
  scope: 'me' | 'team' | 'org';
  userId?: string;
  departmentId?: string;
  /** The card's label, shown as the panel title. */
  title: string;
}

export function useDrill(target: DrillTarget | null, p: PeriodChoice) {
  return useQuery({
    enabled: !!target,
    queryKey: [
      'command-center',
      'drill',
      target?.metric,
      target?.scope,
      target?.userId ?? '',
      target?.departmentId ?? '',
      p,
    ],
    queryFn: () =>
      api<DrillResult>(
        `/command-center/drill?${periodQuery(p, { metric: target!.metric, scope: target!.scope, userId: target!.userId, departmentId: target!.departmentId })}`,
      ),
  });
}

export function useSaveCommandCenterLayout(tier: DashboardTier) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (layout: CommandCenterLayout | null) =>
      api<{ layout: CommandCenterLayout | null }>(`/command-center/layout/${tier}`, {
        method: 'PUT',
        json: { layout },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['command-center'] }),
  });
}

export function useSetTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { period: string; userId: string; amount: number }) =>
      api('/command-center/targets', { method: 'PUT', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['command-center'] }),
  });
}

// ─── Lead transfers ───

export function useLeadTransfers(
  box: 'mine' | 'toDecide' | 'all',
  filter: { companyId?: string; status?: string } = {},
  enabled = true,
) {
  const qs = new URLSearchParams({ box });
  for (const [k, v] of Object.entries(filter)) if (v) qs.set(k, v);
  return useQuery({
    enabled,
    queryKey: ['lead-transfers', box, filter],
    queryFn: () => api<LeadTransferRow[]>(`/lead-transfers?${qs}`),
  });
}

function useInvalidateTransfers() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [
        ['lead-transfers'],
        ['command-center'],
        ['companies'],
        ['company'],
        ['owner-history'],
        ['notifications'],
      ].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );
}

export function useTransferMutations() {
  const invalidate = useInvalidateTransfers();
  const opts = { onSuccess: invalidate };
  return {
    request: useMutation({
      mutationFn: (input: LeadTransferInput) =>
        api<LeadTransferRow>('/lead-transfers', { method: 'POST', json: input }),
      ...opts,
    }),
    decide: useMutation({
      mutationFn: ({ id, input }: { id: string; input: LeadTransferDecision }) =>
        api<LeadTransferRow>(`/lead-transfers/${id}/decision`, { method: 'POST', json: input }),
      ...opts,
    }),
    cancel: useMutation({
      mutationFn: (id: string) =>
        api<LeadTransferRow>(`/lead-transfers/${id}/cancel`, { method: 'POST', json: {} }),
      ...opts,
    }),
  };
}

// ─── Revenue records ───

export function useRevenueRecord(id: string | null) {
  return useQuery({
    enabled: !!id,
    queryKey: ['revenue-records', id],
    queryFn: () => api<RevenueRecordRow>(`/revenue-records/${id}`),
  });
}

export function useRevenueRecordMutations(id: string) {
  const qc = useQueryClient();
  const opts = {
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['revenue-records'] }),
        qc.invalidateQueries({ queryKey: ['command-center'] }),
      ]),
  };
  return {
    update: useMutation({
      mutationFn: (input: RevenueRecordUpdate) =>
        api<RevenueRecordRow>(`/revenue-records/${id}`, { method: 'PATCH', json: input }),
      ...opts,
    }),
    setCredits: useMutation({
      mutationFn: (credits: { userId: string; percent: number }[]) =>
        api<RevenueRecordRow>(`/revenue-records/${id}/credits`, {
          method: 'PUT',
          json: { credits },
        }),
      ...opts,
    }),
    reset: useMutation({
      mutationFn: () => api(`/revenue-records/${id}/credits/reset`, { method: 'POST', json: {} }),
      ...opts,
    }),
  };
}

// ─── Instructions ───

export function useInstructions(box: 'received' | 'sent', status: 'open' | 'all' = 'open', enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['instructions', box, status],
    queryFn: () => api<InstructionRow[]>(`/instructions?box=${box}&status=${status}`),
  });
}

export function useInstructionMutations() {
  const qc = useQueryClient();
  const opts = {
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['instructions'] }),
        qc.invalidateQueries({ queryKey: ['notifications'] }),
      ]),
  };
  return {
    send: useMutation({
      mutationFn: (input: InstructionInput) => api<InstructionRow>('/instructions', { method: 'POST', json: input }),
      ...opts,
    }),
    progress: useMutation({
      mutationFn: ({ id, input }: { id: string; input: InstructionProgress }) =>
        api<InstructionRow>(`/instructions/${id}/progress`, { method: 'POST', json: input }),
      ...opts,
    }),
    cancel: useMutation({
      mutationFn: (id: string) => api<InstructionRow>(`/instructions/${id}/cancel`, { method: 'POST', json: {} }),
      ...opts,
    }),
  };
}

// ─── Client concerns ───

export function useClientConcerns(
  box: 'mine' | 'team' | 'escalated',
  filter: { status?: 'open' | 'resolved' | 'all'; companyId?: string } = {},
  enabled = true,
) {
  const qs = new URLSearchParams({ box, status: filter.status ?? 'open' });
  if (filter.companyId) qs.set('companyId', filter.companyId);
  return useQuery({
    enabled,
    queryKey: ['client-concerns', box, filter],
    queryFn: () => api<ClientConcernRow[]>(`/client-concerns?${qs}`),
  });
}

export function useConcernMutations() {
  const qc = useQueryClient();
  const opts = {
    onSuccess: () =>
      Promise.all(
        [['client-concerns'], ['command-center'], ['company'], ['notifications']].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      ),
  };
  return {
    raise: useMutation({
      mutationFn: (input: ClientConcernInput) => api<ClientConcernRow>('/client-concerns', { method: 'POST', json: input }),
      ...opts,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ClientConcernUpdate }) =>
        api<ClientConcernRow>(`/client-concerns/${id}`, { method: 'PATCH', json: input }),
      ...opts,
    }),
    escalate: useMutation({
      mutationFn: ({ id, toUserId, note }: { id: string; toUserId?: string | null; note?: string | null }) =>
        api<ClientConcernRow>(`/client-concerns/${id}/escalate`, { method: 'POST', json: { toUserId: toUserId ?? null, note: note ?? null } }),
      ...opts,
    }),
    resolve: useMutation({
      mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
        api<ClientConcernRow>(`/client-concerns/${id}/resolve`, { method: 'POST', json: { resolution } }),
      ...opts,
    }),
  };
}
