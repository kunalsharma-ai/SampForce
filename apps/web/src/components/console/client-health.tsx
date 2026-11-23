'use client';

import { Badge, Button, Card, Skeleton } from '@dealflow/ui';
import type { ClientHealth, ClientHealthBand, ClientHealthKey, ClientHealthSignal, ClientHealthSummary } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, RefreshCw } from 'lucide-react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { fmtLocale } from '@/lib/i18n/locale';

export const HEALTH_BAND_LABEL: Record<ClientHealthBand, string> = { HEALTHY: 'Healthy', AT_RISK: 'At risk', CRITICAL: 'Critical' };
const TONE: Record<ClientHealthBand, 'success' | 'warning' | 'critical'> = { HEALTHY: 'success', AT_RISK: 'warning', CRITICAL: 'critical' };
const DOT: Record<ClientHealthBand, string> = { HEALTHY: 'bg-success', AT_RISK: 'bg-warning', CRITICAL: 'bg-critical' };

export const HEALTH_SIGNAL_LABEL: Record<ClientHealthKey, string> = {
  login: 'Sign-ins',
  workspaces: 'Workspace use',
  features: 'Feature adoption',
  mobile: 'Mobile use',
  payment: 'Payment',
  support: 'Support load',
  subscription: 'Subscription',
};

const STATUS: Record<string, string> = {
  PAID: 'paid',
  PENDING: 'payment pending',
  OVERDUE: 'payment overdue',
  WAIVED: 'payment waived',
  PAST_DUE: 'past due',
  UNPAID: 'unpaid',
  ACTIVE: 'active',
  TRIALING: 'on trial',
  CANCELED: 'cancelled',
  SUSPENDED: 'client suspended',
  DEACTIVATED: 'client deactivated',
  NONE: 'no subscription',
  OFF: 'mobile access off',
  REQUESTED: 'mobile access requested',
  REJECTED: 'mobile access rejected',
  REVOKED: 'mobile access revoked',
};

/** The raw figure a signal was measured from, in words. */
export function signalFigure(s: ClientHealthSignal): string {
  switch (s.key) {
    case 'login':
      return `${s.count} of ${s.total} ${s.total === 1 ? 'person' : 'people'} signed in in the last 14 days`;
    case 'workspaces':
      return s.applies ? `${s.count} of ${s.total} Manager and Executive Workspaces in use` : 'No workspace limits to fill';
    case 'features':
      return `${s.count} of ${s.total} parts of the CRM used in the last 30 days`;
    case 'mobile':
      return s.applies ? `${s.count} of ${s.total} phone seats used in the last 14 days` : `${capital(STATUS[s.status ?? 'OFF'] ?? s.status ?? '')}`;
    case 'payment':
      return s.applies ? `Subscription ${STATUS[s.status ?? ''] ?? s.status}` : 'No payment status to measure';
    case 'support':
      return s.count === 0 ? 'No open tickets' : `${s.count} open ${s.count === 1 ? 'ticket' : 'tickets'}${s.total ? `, ${s.total} older than 48 hours` : ''}`;
    case 'subscription':
      return `Subscription ${STATUS[s.status ?? ''] ?? s.status}`;
  }
}

/** A coloured dot with the score; "Not measured" before the worker's first pass. */
export function HealthPill({ health, size = 'sm' }: { health: ClientHealthSummary | null; size?: 'sm' | 'md' }) {
  if (!health) return <span className="text-xs text-muted-foreground">Not measured</span>;
  if (size === 'md')
    return (
      <Badge tone={TONE[health.band]} data-health-band={health.band}>
        <span className={`me-1 inline-block size-2 rounded-full ${DOT[health.band]}`} aria-hidden />
        {HEALTH_BAND_LABEL[health.band]} · {health.score}
      </Badge>
    );
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm tabular" data-health-band={health.band}>
      <span className={`inline-block size-2.5 rounded-full ${DOT[health.band]}`} aria-hidden />
      {health.score}
      <span className="sr-only">, {HEALTH_BAND_LABEL[health.band]}</span>
    </span>
  );
}

/** The client page's health card: the score, each signal's points and the figure behind it, and a fresh measurement. */
export function ClientHealthCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const key = ['operator', 'client', clientId, 'health'];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ health: ClientHealth | null }>(`/operator/clients/${clientId}/health`) });
  const measure = useMutation({
    mutationFn: () => api<{ health: ClientHealth }>(`/operator/clients/${clientId}/health`, { method: 'POST' }),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      // The header badge and the clients list show the new score too.
      void qc.invalidateQueries({ queryKey: ['operator', 'client', clientId], exact: true });
      void qc.invalidateQueries({ queryKey: ['operator', 'clients', 'page'] });
    },
  });
  const h = q.data?.health ?? null;
  return (
    <Card className="p-5" aria-labelledby="health-h" data-client-health="">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="health-h" className="flex items-center gap-2 font-medium">
            <Activity className="size-4 text-muted-foreground" aria-hidden />
            Health score
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {h ? `Measured ${new Date(h.at).toLocaleString(fmtLocale())}. Advisory only: it never blocks anything.` : 'Measured once a day by the background worker. Advisory only: it never blocks anything.'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => measure.mutate()} disabled={measure.isPending}>
          <RefreshCw className={`size-4 ${measure.isPending ? 'animate-spin' : ''}`} aria-hidden /> Measure now
        </Button>
      </div>
      <ErrorText error={q.error ?? measure.error} />
      {q.isPending && <Skeleton className="mt-4 h-40" />}
      {q.data && !h && <p className="mt-4 text-sm text-muted-foreground">Not measured yet.</p>}
      {h && (
        <div className="mt-4 grid gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            <ScoreRing score={h.score} band={h.band} />
            <HealthPill health={h} size="md" />
            {h.history.length > 1 && <Trend history={h.history} />}
          </div>
          <ul className="space-y-3 text-sm" data-health-signals="">
            {h.signals.map((s) => (
              <li key={s.key} data-signal={s.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{HEALTH_SIGNAL_LABEL[s.key]}</span>
                  <span className="tabular text-muted-foreground">{s.applies && s.maxPoints > 0 ? `${fmt(s.points)} of ${fmt(s.maxPoints)} points` : 'Not counted'}</span>
                </div>
                <div className={`mt-1 h-1.5 overflow-hidden rounded-full ${s.applies && s.maxPoints > 0 ? 'bg-muted' : 'border border-dashed border-border'}`} aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${s.maxPoints ? (s.points / s.maxPoints) * 100 : 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{signalFigure(s)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function ScoreRing({ score, band }: { score: number; band: ClientHealthBand }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = band === 'HEALTHY' ? 'hsl(var(--success))' : band === 'AT_RISK' ? 'hsl(var(--warning))' : 'hsl(var(--critical))';
  return (
    <svg viewBox="0 0 80 80" className="size-24" role="img" aria-label={`Health score ${score} out of 100`}>
      <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
      <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 40 40)" />
      <text x="40" y="46" textAnchor="middle" className="fill-foreground text-xl font-semibold">
        {score}
      </text>
    </svg>
  );
}

/** The last 30 measurements as a small line. */
function Trend({ history }: { history: { day: string; score: number }[] }) {
  const w = 120;
  const h = 28;
  const pts = history.map((p, i) => `${(i / (history.length - 1)) * w},${h - (p.score / 100) * h}`).join(' ');
  const first = history[0]!;
  const last = history[history.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-28" role="img" aria-label={`Score went from ${first.score} on ${first.day} to ${last.score} on ${last.day}`}>
      <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" />
    </svg>
  );
}
