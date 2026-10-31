'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { type ForecastPlan, type ForecastSettingsInput, forecastSettingsSchema, type ForecastTrends, type PeriodGranularity, type PlanRisk, type PlanTarget } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarX2, HeartPulse } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { useForecastPlan, useForecastTrends } from '@/lib/ai';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const TARGET_SOURCE: Record<NonNullable<PlanTarget['source']>, string> = {
  set: 'Set for this period',
  from_parts: 'Sum of the targets set inside this period',
  share_of_quarter: 'A third of the quarter target (no month target set)',
};

const signedGap = (gap: number, money: (v: number) => string) => (gap > 0 ? `${money(gap)} short` : gap < 0 ? `${money(-gap)} ahead` : 'On target');

/** Target, attainment, gaps, coverage, salespeople, and risks for the chosen period. */
export function PlanSection({ period }: { period: string }) {
  const plan = useForecastPlan(period);
  if (plan.isPending) return <Skeleton className="h-64" />;
  if (plan.error) return <p role="alert" className="text-sm text-critical">{plan.error.message}</p>;
  const p = plan.data;
  const money = (v: number) => formatMoney(v, p.currency);
  return (
    <div className="space-y-4">
      <TargetCard p={p} money={money} />
      <div className="grid gap-4 lg:grid-cols-2">
        <People p={p} money={money} />
        <Risks p={p} money={money} />
      </div>
    </div>
  );
}

function TargetCard({ p, money }: { p: ForecastPlan; money: (v: number) => string }) {
  const t = p.target;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Target and gap</CardTitle>
      </CardHeader>
      <CardContent>
        {t.amount === null ? (
          <p className="text-sm text-muted-foreground">
            No target for {p.period.label}. Set one below (whole team or per person) to see attainment, the gap to target and pipeline coverage.
          </p>
        ) : (
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Target" value={money(t.amount)} detail={t.source ? TARGET_SOURCE[t.source] : ''} />
            <Stat label="Attainment" value={p.attainment === null ? '—' : `${p.attainment}%`} detail={`${money(p.totals.won)} won so far`} />
            <Stat label="Gap at base" value={p.gap ? signedGap(p.gap.base, money) : '—'} detail="Target minus won and weighted open deals" tone={p.gap && p.gap.base > 0 ? 'critical' : 'success'} />
            <Stat label="Gap at best" value={p.gap ? signedGap(p.gap.best, money) : '—'} detail={`Worst case: ${p.gap ? signedGap(p.gap.worst, money) : '—'}`} />
            <Stat label="Pipeline coverage" value={p.coverage === null ? '—' : `${p.coverage}×`} detail="Open pipeline ÷ what is still needed. Under 3× is usually thin." tone={p.coverage !== null && p.coverage < 1 ? 'critical' : undefined} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'critical' | 'success' }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === 'critical' ? 'text-critical' : tone === 'success' ? 'text-success' : ''}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function People({ p, money }: { p: ForecastPlan; money: (v: number) => string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">By salesperson</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {p.byOwner.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals or personal targets in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Person</th>
                <th className="pb-2 text-right font-medium">Target</th>
                <th className="pb-2 text-right font-medium">Won</th>
                <th className="pb-2 text-right font-medium">Base</th>
                <th className="pb-2 text-right font-medium">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.byOwner.map((o) => (
                <tr key={o.owner?.id ?? 'none'}>
                  <td className="py-2 pr-2">{o.owner?.name ?? 'Unassigned'}</td>
                  <td className="py-2 text-right tabular-nums">{o.target.amount === null ? '—' : money(o.target.amount)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {money(o.totals.won)}
                    {o.attainment !== null && <span className="block text-xs text-muted-foreground">{o.attainment}%</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(o.totals.base)}</td>
                  <td className={`py-2 text-right tabular-nums ${o.gap !== null && o.gap > 0 ? 'text-critical' : ''}`}>{o.gap === null ? '—' : signedGap(o.gap, money)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function Risks({ p, money }: { p: ForecastPlan; money: (v: number) => string }) {
  const groups: [string, string, PlanRisk, typeof CalendarX2][] = [
    ['overdue', 'Close date has passed', p.risks.overdue, CalendarX2],
    ['stale', 'No activity in 30 days', p.risks.stale, AlertTriangle],
    ['high', 'High risk on deal health', p.risks.highRisk, HeartPulse],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline risks in this period</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {groups.map(([key, title, r, Icon]) => (
          <section key={key} aria-label={title}>
            <p className="flex items-center gap-2 font-medium">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {title}
              <span className="ml-auto tabular-nums text-muted-foreground">
                {r.count} deal{r.count === 1 ? '' : 's'} · {money(r.amount)}
              </span>
            </p>
            {r.deals.length > 0 && (
              <ul className="mt-1 space-y-0.5 pl-6">
                {r.deals.slice(0, 4).map((d) => (
                  <li key={d.id} className="flex gap-2 text-xs">
                    <Link href={`/app/deals/${d.id}`} className="truncate text-primary underline underline-offset-2">
                      {d.name}
                    </Link>
                    <span className="text-muted-foreground">{d.detail}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">{money(d.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

/** How probabilities and categories are worked out, with the stage win history behind the history method. */
export function Assumptions({ period }: { period: string }) {
  const plan = useForecastPlan(period);
  const canManage = useCan('pipelines:manage');
  const [editing, setEditing] = useState(false);
  if (!plan.data) return null;
  const s = plan.data.settings;
  const src = plan.data.probabilitySources;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Forecast assumptions</CardTitle>
        {canManage && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Change assumptions
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {editing ? (
          <SettingsForm initial={s} onDone={() => setEditing(false)} />
        ) : (
          <div className="space-y-1">
            <p>
              Probability: <strong>{s.method === 'history' ? `stage win rate over the last ${s.historyMonths} months (stages with at least ${s.minSample} closed deals), otherwise the stage probability` : 'the probability set on each stage'}</strong>. A probability entered on a deal always wins.
            </p>
            <p>
              Commit from <strong>{s.commitThreshold}%</strong>, best case from <strong>{s.bestCaseThreshold}%</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              Open deals this period: {src.deal} with their own probability, {src.stage} from the stage, {src.history} from win history.
              {s.updatedBy && s.updatedAt && ` Changed by ${s.updatedBy.name} ${relativeTime(s.updatedAt)}.`}
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="mb-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Win rate by stage, deals closed in the last {s.historyMonths} months</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Stage</th>
                <th className="pb-2 text-right font-medium">Stage probability</th>
                <th className="pb-2 text-right font-medium">Won</th>
                <th className="pb-2 text-right font-medium">Lost</th>
                <th className="pb-2 text-right font-medium">Win rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {plan.data.stageRates.map((r) => (
                <tr key={r.stageId}>
                  <td className="py-1.5 pr-2">
                    {r.stage}
                    <span className="block text-xs text-muted-foreground">{r.pipeline}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.stageProbability}%</td>
                  <td className="py-1.5 text-right tabular-nums">{r.won}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.lost}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.rate === null ? '—' : `${r.rate}%`}
                    {r.rate !== null && !r.usable && <span className="block text-xs text-muted-foreground">too few to use</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsForm({ initial, onDone }: { initial: ForecastSettingsInput; onDone: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<ForecastSettingsInput>({ method: initial.method, commitThreshold: initial.commitThreshold, bestCaseThreshold: initial.bestCaseThreshold, historyMonths: initial.historyMonths, minSample: initial.minSample });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: ForecastSettingsInput) => api('/forecast/settings', { method: 'PUT', json: body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['forecast'] });
      onDone();
    },
  });
  const num = (k: keyof ForecastSettingsInput, label: string, min: number, max: number, suffix: string) => (
    <div className="space-y-1">
      <label htmlFor={`fs-${k}`} className="text-xs font-medium">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <Input id={`fs-${k}`} type="number" min={min} max={max} className="w-24" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const r = forecastSettingsSchema.safeParse(v);
        if (!r.success) return setError(r.error.issues[0]!.message);
        setError(null);
        save.mutate(r.data);
      }}
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="fs-method" className="text-xs font-medium">
            Probability of open deals
          </label>
          <Select id="fs-method" className="w-auto" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as ForecastSettingsInput['method'] })}>
            <option value="stage">Stage probability</option>
            <option value="history">Stage win rate from history</option>
          </Select>
        </div>
        {num('commitThreshold', 'Commit from', 1, 100, '%')}
        {num('bestCaseThreshold', 'Best case from', 0, 99, '%')}
        {num('historyMonths', 'History window', 3, 36, 'months')}
        {num('minSample', 'Minimum closed deals per stage', 3, 200, 'deals')}
      </div>
      <p className="text-xs text-muted-foreground">Changes apply to the live forecast and to new snapshots. Existing snapshots keep the assumptions they were taken with.</p>
      {(error || save.error) && <p role="alert" className="text-sm text-critical">{error ?? save.error?.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save assumptions
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const TREND_COUNT: Record<PeriodGranularity, number> = { month: 12, quarter: 8, year: 4 };

/** Won revenue per period with win rate, cycle, and how the first snapshot compared. */
export function Trends({ granularity }: { granularity: PeriodGranularity }) {
  const trends = useForecastTrends(granularity, TREND_COUNT[granularity]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Win and loss trends</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {trends.isPending ? <Skeleton className="h-40" /> : trends.error ? <p role="alert" className="text-sm text-critical">{trends.error.message}</p> : <TrendView t={trends.data} />}
      </CardContent>
    </Card>
  );
}

function TrendView({ t }: { t: ForecastTrends }) {
  const money = (v: number) => formatMoney(v, t.currency);
  const max = Math.max(1, ...t.points.map((p) => p.won));
  const W = 640;
  const H = 160;
  const step = W / t.points.length;
  const bar = Math.min(36, step * 0.6);
  return (
    <>
      <figure>
        <svg viewBox={`0 0 ${W} ${H + 24}`} className="h-auto w-full" role="img" aria-label={`Won revenue per ${t.granularity}. The table below has the figures.`}>
          <line x1={0} x2={W} y1={H} y2={H} className="stroke-border" strokeWidth={1} />
          {t.points.map((p, i) => {
            const h = (p.won / max) * (H - 12);
            const x = i * step + (step - bar) / 2;
            return (
              <g key={p.period}>
                <rect x={i * step} y={0} width={step} height={H} fill="transparent">
                  <title>{`${p.period}: ${money(p.won)} won, ${p.wonCount} won / ${p.lostCount} lost`}</title>
                </rect>
                {h > 0 && <path d={`M${x},${H} V${H - h + 4} q0,-4 4,-4 h${bar - 8} q4,0 4,4 V${H} Z`} className="fill-primary" pointerEvents="none" />}
                <text x={i * step + step / 2} y={H + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {p.period}
                </text>
              </g>
            );
          })}
        </svg>
        <figcaption className="text-xs text-muted-foreground">Won revenue per {t.granularity}. Hover a bar for details.</figcaption>
      </figure>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Period</th>
              <th className="pb-2 text-right font-medium">Won</th>
              <th className="pb-2 text-right font-medium">Won / lost</th>
              <th className="pb-2 text-right font-medium">Win rate</th>
              <th className="pb-2 text-right font-medium">Avg. cycle</th>
              <th className="pb-2 text-right font-medium">First forecast</th>
              <th className="pb-2 text-right font-medium">Accuracy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {t.points.map((p) => (
              <tr key={p.period}>
                <td className="py-1.5">{p.period}</td>
                <td className="py-1.5 text-right tabular-nums">{money(p.won)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {p.wonCount} / {p.lostCount}
                </td>
                <td className="py-1.5 text-right tabular-nums">{p.winRate === null ? '—' : `${p.winRate}%`}</td>
                <td className="py-1.5 text-right tabular-nums">{p.avgCycleDays === null ? '—' : `${p.avgCycleDays} days`}</td>
                <td className="py-1.5 text-right tabular-nums">{p.forecastAtStart === null ? '—' : money(p.forecastAtStart)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {p.errorPercent === null ? (p.forecastAtStart !== null ? <span className="text-xs text-muted-foreground">in progress</span> : '—') : `${p.errorPercent > 0 ? '+' : ''}${p.errorPercent}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Accuracy compares what was won with the base forecast of the first snapshot taken for that period. Take a snapshot at the start of each period to track it.</p>
      {t.topLossReasons.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top loss reasons</p>
          <ul className="flex flex-wrap gap-2">
            {t.topLossReasons.map((r) => (
              <li key={r.reason}>
                <Badge tone="neutral">
                  {r.reason} · {r.count}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
