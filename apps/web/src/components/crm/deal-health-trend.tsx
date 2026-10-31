'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { DEAL_RISK_LABELS, type DealHealthDetail, type DealRisk } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';

const TONE: Record<DealRisk, 'success' | 'warning' | 'critical'> = { low: 'success', medium: 'warning', high: 'critical' };

/** The deal health monitor's stored score for one deal and its daily trend (no AI involved). */
export function DealHealthTrend({ dealId }: { dealId: string }) {
  const q = useQuery({ queryKey: ['deal-health', dealId], queryFn: () => api<DealHealthDetail>(`/deals/${dealId}/health`) });
  const points = q.data?.history ?? [];
  const w = 240;
  const h = 48;
  const path = points.length > 1 ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - (p.health / 100) * h).toFixed(1)}`).join(' ') : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-muted-foreground" aria-hidden /> Health monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {q.isPending ? (
          <Skeleton className="h-16" />
        ) : q.error ? (
          <p role="alert" className="text-sm text-critical">
            {q.error.message}
          </p>
        ) : !q.data.current ? (
          <p className="text-sm text-muted-foreground">Not scored yet. Open deals are scored every hour.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{q.data.current.health}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <Badge tone={TONE[q.data.current.risk]}>{DEAL_RISK_LABELS[q.data.current.risk]}</Badge>
              {q.data.current.change7d !== null && q.data.current.change7d !== 0 && (
                <span className={`text-xs ${q.data.current.change7d > 0 ? 'text-success' : 'text-critical'}`}>
                  {q.data.current.change7d > 0 ? '+' : ''}
                  {q.data.current.change7d} in 7 days
                </span>
              )}
            </div>
            {path && (
              <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full text-primary" role="img" aria-label={`Health over the last ${points.length} days, from ${points[0]!.health} to ${points[points.length - 1]!.health}`} preserveAspectRatio="none">
                <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            {q.data.current.signals.length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {q.data.current.signals.map((s) => (
                  <li key={s.key}>
                    {s.label}: {s.detail}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Scored {relativeTime(q.data.current.computedAt)} from activity, stage age, tasks and dates.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
