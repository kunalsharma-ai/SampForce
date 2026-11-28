'use client';

import { cn, Popover, PopoverContent, PopoverTrigger } from '@dealflow/ui';
import type { ConsoleSystemStatus, SystemState } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { Database, Server, Timer } from 'lucide-react';
import { api } from '@/lib/api';

const LABEL: Record<SystemState, string> = {
  ok: 'All systems normal',
  degraded: 'Background work delayed',
  down: 'Database unreachable',
};

const DOT: Record<SystemState, string> = {
  ok: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-critical',
};

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** The system status in the Console header (control-center K1): database, worker and event backlog, every minute. */
export function SystemStatus() {
  const q = useQuery({
    queryKey: ['operator', 'system-status'],
    queryFn: () => api<ConsoleSystemStatus>('/operator/system/status'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const s = q.data;
  const state: SystemState | null = s?.status ?? (q.isError ? 'down' : null);
  const rows = s
    ? [
        {
          icon: Database,
          label: 'Database',
          value: s.database.ok ? `Reachable · ${s.database.latencyMs ?? 0} ms` : 'Not reachable',
          ok: s.database.ok,
        },
        {
          icon: Server,
          label: 'Background worker',
          value: s.worker.ok ? `Running · beat ${ago(s.worker.lastBeatAt)}` : `Last beat ${ago(s.worker.lastBeatAt)}`,
          ok: s.worker.ok,
        },
        {
          icon: Timer,
          label: 'Event queue',
          value: s.backlog.events
            ? `${s.backlog.events} waiting over 2 min`
            : 'Up to date',
          ok: s.backlog.events === 0,
        },
      ]
    : [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hidden h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface/70 px-3 text-xs font-medium transition-colors hover:border-primary/40 lg:flex"
          data-system-status={state ?? 'loading'}
          aria-label={state ? `Systems: ${LABEL[state]}` : 'Systems: checking'}
        >
          <span className="relative flex size-2.5" aria-hidden>
            {state === 'ok' && (
              <span className="absolute inline-flex size-full rounded-full bg-success/60 motion-safe:animate-ping" />
            )}
            <span className={cn('relative inline-flex size-2.5 rounded-full', state ? DOT[state] : 'bg-muted-foreground')} />
          </span>
          <span className="hidden 2xl:inline">{state ? LABEL[state] : 'Checking…'}</span>
          <span className="2xl:hidden">{state === 'ok' ? 'Normal' : state ? 'Attention' : 'Checking…'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <p className="text-sm font-semibold">System status</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {state ? LABEL[state] : 'Checking…'}
          {s ? ` · checked ${ago(s.checkedAt)}` : ''}
        </p>
        {q.isError && <p className="mt-3 text-sm text-critical">The status could not be read. The API may be down.</p>}
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <r.icon className={cn('size-4 shrink-0', r.ok ? 'text-success' : 'text-warning')} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.value}</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
