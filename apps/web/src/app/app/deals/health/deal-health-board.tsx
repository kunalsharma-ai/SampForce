'use client';

import { Badge, Button, Card, CardContent, Skeleton } from '@dealflow/ui';
import { DEAL_RISKS, type DealHealthRow, type DealHealthSummary, type DealRisk } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/crm';
import { relativeTime } from '@/lib/format';

const TONE: Record<DealRisk, 'success' | 'warning' | 'critical'> = { low: 'success', medium: 'warning', high: 'critical' };
const LABEL: Record<DealRisk, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' };

export function DealHealthBoard() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const risk = (DEAL_RISKS as readonly string[]).includes(params.get('risk') ?? '') ? (params.get('risk') as DealRisk) : undefined;
  const mine = params.get('mine') === 'true';
  const setFilter = (next: { risk?: DealRisk; mine?: boolean }) => {
    const q = new URLSearchParams();
    const r = 'risk' in next ? next.risk : risk;
    const m = 'mine' in next ? next.mine : mine;
    if (r) q.set('risk', r);
    if (m) q.set('mine', 'true');
    router.replace(`/app/deals/health${q.size ? `?${q}` : ''}`);
  };
  const summary = useQuery({ queryKey: ['deal-health', 'summary'], queryFn: () => api<DealHealthSummary>('/deal-health/summary') });
  const rows = useQuery({
    queryKey: ['deal-health', 'list', risk, mine],
    queryFn: () => api<DealHealthRow[]>(`/deal-health?${new URLSearchParams({ ...(risk ? { risk } : {}), ...(mine ? { mine: 'true' } : {}) })}`),
  });
  const refresh = useMutation({
    mutationFn: () => api<DealHealthSummary>('/deal-health/refresh', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deal-health'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Risk">
          <Button size="sm" variant={!risk ? 'default' : 'ghost'} aria-pressed={!risk} onClick={() => setFilter({ risk: undefined })}>
            All
          </Button>
          {(['high', 'medium', 'low'] as const).map((r) => (
            <Button key={r} size="sm" variant={risk === r ? 'default' : 'ghost'} aria-pressed={risk === r} onClick={() => setFilter({ risk: r })}>
              {LABEL[r]} {summary.data ? `(${summary.data.counts[r]})` : ''}
            </Button>
          ))}
        </div>
        <Button size="sm" variant={mine ? 'default' : 'outline'} aria-pressed={mine} onClick={() => setFilter({ mine: !mine })}>
          Only my deals
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {summary.data?.lastSweepAt && <span>Last scored {relativeTime(summary.data.lastSweepAt)}</span>}
          <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} aria-hidden /> Score now
          </Button>
        </div>
      </div>
      {summary.data && summary.data.unscored > 0 && <p className="text-xs text-muted-foreground">{summary.data.unscored} new open deal(s) are not scored yet; they are included in the next hourly run or when you score now.</p>}
      {refresh.error && (
        <p role="alert" className="text-sm text-critical">
          {refresh.error.message}
        </p>
      )}
      {rows.isPending ? (
        <Skeleton className="h-60" />
      ) : rows.error ? (
        <p role="alert" className="text-sm text-critical">
          {rows.error.message}
        </p>
      ) : rows.data.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">No deals match. {summary.data?.lastSweepAt ? '' : 'Deals are scored within the hour, or press Score now.'}</Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Open deals by health, lowest first</caption>
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Deal</th>
                  <th scope="col" className="px-4 py-2 font-medium">Health</th>
                  <th scope="col" className="px-4 py-2 font-medium">Why</th>
                  <th scope="col" className="px-4 py-2 font-medium">Owner</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.data.map((r) => (
                  <tr key={r.deal.id} className="align-top">
                    <td className="px-4 py-3">
                      <Link href={`/app/deals/${r.deal.id}`} className="font-medium text-primary hover:underline">
                        {r.deal.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {r.deal.stage}
                        {r.deal.expectedCloseDate ? ` · closes ${formatDate(r.deal.expectedCloseDate)}` : ''}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="mr-2 font-semibold tabular-nums">{r.health}</span>
                      <Badge tone={TONE[r.risk]}>{LABEL[r.risk]}</Badge>
                      {r.change7d !== null && r.change7d !== 0 && (
                        <p className={`text-xs ${r.change7d > 0 ? 'text-success' : 'text-critical'}`}>
                          {r.change7d > 0 ? '+' : ''}
                          {r.change7d} in 7 days
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.signals.length ? r.signals.map((s) => s.label).join(', ') : 'No risk signals'}</td>
                    <td className="px-4 py-3 text-xs">{r.owner?.name ?? 'Unassigned'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(r.deal.amount, r.deal.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
