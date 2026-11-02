'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { FlowStage, PipelineFlow } from '@dealflow/types';
import { useState } from 'react';
import { ErrorText } from '@/components/revenue/tabs';
import { useMotionLevel } from '@/lib/motion';
import { formatValue, useFlow } from '@/lib/reports';
import { WindowControls } from '../window-controls';
import { useT } from '@/lib/i18n';

const W = 150;
const H = 96;
const GAP = 46;
const TOP = 120;

function order(stages: FlowStage[]): FlowStage[] {
  const rank = { OPEN: 0, WON: 1, LOST: 2 } as const;
  return [...stages].sort((a, b) => rank[a.category] - rank[b.category] || a.position - b.position);
}

export function FlowExplorer() {
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const [days, setDays] = useState(90);
  const flow = useFlow({ pipelineId, days });
  return (
    <div className="space-y-4">
      <WindowControls id="flow" pipelineId={pipelineId} setPipelineId={setPipelineId} days={days} setDays={setDays} />
      {flow.isPending ? <Skeleton className="h-96" /> : flow.error ? <ErrorText error={flow.error} /> : <Flow f={flow.data} days={days} />}
    </div>
  );
}

function Flow({ f, days }: { f: PipelineFlow; days: number }) {
  const t = useT();
  const motion = useMotionLevel();
  const stages = order(f.stages);
  const x = new Map(stages.map((s, i) => [s.id, i * (W + GAP)]));
  const name = new Map(stages.map((s) => [s.id, s.name]));
  const max = Math.max(1, ...f.transitions.map((tr) => tr.deals));
  const width = stages.length * (W + GAP) - GAP;
  const height = TOP + H + 120;
  const total = f.transitions.reduce((s, tr) => s + tr.deals, 0);
  const color = (to: string) => {
    const s = stages.find((x) => x.id === to);
    return s?.category === 'WON' ? 'hsl(var(--chart-3))' : s?.category === 'LOST' ? 'hsl(var(--chart-5))' : 'hsl(var(--chart-1))';
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{f.pipelineName}</CardTitle>
          <p className="text-sm text-muted-foreground">{total === 0 ? t.plural('count.noStageChangesInDays', days) : `${t.plural('count.stageChanges', total)} ${t.plural('count.inLastDays', days)} ${t('Forward moves arc above the stages, moves back arc below.')}`}</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <svg viewBox={`-10 0 ${width + 20} ${height}`} style={{ minWidth: Math.min(width, 900) }} className="h-auto w-full" role="img" aria-label={t('Pipeline flow diagram for {name}. The tables below hold the same figures.', { name: f.pipelineName })}>
            <style>{'@keyframes df-flow{to{stroke-dashoffset:-28}} .df-moving{animation:df-flow 1.4s linear infinite}'}</style>
            {f.transitions.map((tr) => {
              const a = x.get(tr.from);
              const b = x.get(tr.to);
              if (a === undefined || b === undefined) return null;
              const forward = b > a;
              const x1 = a + W / 2 + (forward ? 12 : -12);
              const x2 = b + W / 2 + (forward ? -12 : 12);
              const y = forward ? TOP : TOP + H;
              const lift = Math.min(110, 30 + Math.abs(b - a) / 5) * (forward ? -1 : 1);
              const d = `M${x1} ${y} C${x1} ${y + lift} ${x2} ${y + lift} ${x2} ${y}`;
              const w = 1.5 + 8 * (tr.deals / max);
              return (
                <g key={`${tr.from}-${tr.to}`}>
                  <path d={d} fill="none" stroke={color(tr.to)} strokeOpacity={0.25} strokeWidth={w} strokeLinecap="round" />
                  <path d={d} fill="none" stroke={color(tr.to)} strokeWidth={Math.max(1.5, w / 2.5)} strokeDasharray="2 12" strokeLinecap="round" className={motion === 'full' ? 'df-moving' : undefined} />
                  <title>{`${name.get(tr.from)} → ${name.get(tr.to)}: ${t.plural('count.deals', tr.deals)}`}</title>
                </g>
              );
            })}
            {stages.map((s) => {
              const sx = x.get(s.id)!;
              const tone = s.category === 'WON' ? 'var(--chart-3)' : s.category === 'LOST' ? 'var(--chart-5)' : 'var(--chart-1)';
              return (
                <g key={s.id} transform={`translate(${sx} ${TOP})`}>
                  <rect width={W} height={H} rx={10} fill="hsl(var(--surface-raised))" stroke={`hsl(${tone})`} strokeOpacity={0.6} />
                  <text x={12} y={22} fontSize={13} fontWeight={600} fill="hsl(var(--foreground))">{s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name}</text>
                  {s.category === 'OPEN' ? (
                    <>
                      <text x={12} y={44} fontSize={12} fill="hsl(var(--muted-foreground))">{t('{n} open', { n: s.openDeals })} · {formatValue(s.openValue, f.currency)}</text>
                      <text x={12} y={64} fontSize={12} fill="hsl(var(--muted-foreground))">{s.medianDays === null ? t('No time data yet') : t('Typically {n} d here', { n: s.medianDays })}</text>
                    </>
                  ) : (
                    <text x={12} y={44} fontSize={12} fill="hsl(var(--muted-foreground))">{s.category === 'WON' ? t('Closed won') : t('Closed lost')}</text>
                  )}
                </g>
              );
            })}
          </svg>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('Stages')}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('Open deals, value and typical time in each stage')}</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 font-medium">{t('Stage')}</th>
                  <th scope="col" className="py-1 text-end font-medium">{t('Open deals')}</th>
                  <th scope="col" className="py-1 text-end font-medium">{t('Open value')}</th>
                  <th scope="col" className="py-1 text-end font-medium">{t('Median days')}</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {stages.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <th scope="row" className="py-1 text-start font-normal">{s.name}</th>
                    <td className="py-1 text-end">{s.category === 'OPEN' ? s.openDeals : '—'}</td>
                    <td className="py-1 text-end">{s.category === 'OPEN' ? formatValue(s.openValue, f.currency) : '—'}</td>
                    <td className="py-1 text-end">{s.medianDays ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('Moves in the period')}</CardTitle></CardHeader>
          <CardContent>
            {f.transitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('No moves recorded in this period.')}</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">{t('Deals that moved between stages')}</caption>
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 font-medium">{t('From')}</th>
                    <th scope="col" className="py-1 font-medium">{t('To')}</th>
                    <th scope="col" className="py-1 text-end font-medium">{t('Deals')}</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {[...f.transitions].sort((a, b) => b.deals - a.deals).map((tr) => (
                    <tr key={`${tr.from}-${tr.to}`} className="border-t border-border">
                      <td className="py-1">{name.get(tr.from) ?? t('Removed stage')}</td>
                      <td className="py-1">{name.get(tr.to) ?? t('Removed stage')}</td>
                      <td className="py-1 text-end">{tr.deals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
