'use client';

import Link from 'next/link';
import type { DashboardCharts } from '@dealflow/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatKpi } from '@/lib/format';
import { type MessageKey, useT } from '@/lib/i18n';
import { usePreferences } from '@/stores/preferences';
import { axisTick, ChartCard, tooltipStyle } from './chart-card';

const useAnimate = () => usePreferences((s) => s.appearance.motion !== 'off' && s.appearance.motion !== 'minimal');
const pct = (v: number | null) => (v === null ? '—' : formatKpi(v, 'percent', 'USD'));
const num = (v: number) => formatKpi(v, 'number', 'USD');

/** Won revenue per week or month across the period. */
export function RevenueTrendChart({ data }: { data: DashboardCharts }) {
  const t = useT();
  const animate = useAnimate();
  const money = (v: number) => formatKpi(v, 'currency', data.currency);
  const total = data.revenueTrend.reduce((s, p) => s + p.won, 0);
  const best = data.revenueTrend.reduce((b, p) => (p.won > b.won ? p : b), data.revenueTrend[0] ?? { label: '', won: 0 });
  return (
    <ChartCard
      title={t('Revenue trajectory')}
      description={data.revenueTrend.length > 14 ? t('Closed-won revenue by month in {currency}.', { currency: data.currency }) : t('Closed-won revenue by week in {currency}.', { currency: data.currency })}
      summary={
        total
          ? t('Area chart of won revenue over {periods} periods, {total} in total, highest in the period starting {start} at {best}.', { periods: data.revenueTrend.length, total: money(total), start: best.label, best: money(best.won) })
          : t('Area chart of won revenue over {periods} periods, {total} in total.', { periods: data.revenueTrend.length, total: money(total) })
      }
      filename="revenue-trajectory.csv"
      empty={total === 0 ? t('No deals won in this period yet.') : null}
      table={{
        caption: t('Won revenue by period'),
        header: [t('Period starting'), t('Won revenue'), t('Deals won')],
        rows: data.revenueTrend.map((p) => [p.start, p.won, p.wonCount]),
        display: data.revenueTrend.map((p) => [p.label, money(p.won), num(p.wonCount)]),
        numeric: [1, 2],
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.revenueTrend} margin={{ left: 8, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
              <stop offset="1" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tickFormatter={money} tick={axisTick} tickLine={false} axisLine={false} width={72} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), t('Won')]} />
          <Area type="monotone" dataKey="won" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#trendFill)" isAnimationActive={animate} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** How many deals created in the period reached each stage, and the share that moved on from the stage before. */
export function StageConversionChart({ data }: { data: DashboardCharts }) {
  const t = useT();
  const animate = useAnimate();
  const sc = data.stageConversion;
  const stages = sc?.stages ?? [];
  const first = stages[0]?.reached ?? 0;
  return (
    <ChartCard
      title={t('Stage conversion')}
      description={sc ? t('{pipeline}: deals created in this period, by the furthest stage they reached.', { pipeline: sc.name }) : t('No pipeline yet.')}
      summary={t('Funnel of {deals} deals across {stages} stages; {won} won.', { deals: first, stages: stages.length, won: stages.at(-1)?.reached ?? 0 })}
      filename="stage-conversion.csv"
      empty={!sc ? t('No pipeline configured.') : first === 0 ? t('No deals were created in this period.') : null}
      table={{
        caption: t('Deals reaching each stage and conversion from the previous stage'),
        header: [t('Stage'), t('Deals reached'), t('Conversion from previous')],
        rows: stages.map((s) => [s.name, s.reached, s.conversion]),
        display: stages.map((s) => [s.name, num(s.reached), pct(s.conversion)]),
        numeric: [1, 2],
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={stages} layout="vertical" margin={{ left: 8, right: 40 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={110} tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, _n, p) => [t('{deals} deals · {share} from previous', { deals: num(v), share: pct((p.payload as { conversion: number | null }).conversion) }), t('Reached')]} />
          <Bar dataKey="reached" radius={[0, 6, 6, 0]} isAnimationActive={animate} label={{ position: 'right', fill: 'hsl(var(--foreground))', fontSize: 11 }}>
            {stages.map((s, i) => (
              <Cell key={s.stageId} fill={`hsl(var(--chart-${(i % 6) + 1}))`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Won against lost in the period, with the most common loss reasons. */
export function WinLossChart({ data }: { data: DashboardCharts }) {
  const t = useT();
  const animate = useAnimate();
  const w = data.winLoss;
  const money = (v: number) => formatKpi(v, 'currency', data.currency);
  const bars = [
    { name: t('Won'), count: w.wonCount, value: w.won, color: 'hsl(var(--success))' },
    { name: t('Lost'), count: w.lostCount, value: w.lost, color: 'hsl(var(--critical))' },
  ];
  return (
    <ChartCard
      title={t('Win and loss')}
      description={
        w.lossReasons.length
          ? t('Win rate {rate} · top loss reason: {reason}.', { rate: pct(w.winRate), reason: w.lossReasons[0]!.reason })
          : t('Win rate {rate}.', { rate: pct(w.winRate) })
      }
      summary={t('{won} deals won worth {wonValue} and {lost} lost worth {lostValue}.', { won: w.wonCount, wonValue: money(w.won), lost: w.lostCount, lostValue: money(w.lost) })}
      filename="win-loss.csv"
      empty={w.wonCount + w.lostCount === 0 ? t('No deals closed in this period yet.') : null}
      table={{
        caption: t('Deals won and lost, and loss reasons'),
        header: [t('Outcome'), t('Deals'), t('Value')],
        rows: [...bars.map((b) => [b.name, b.count, b.value]), ...w.lossReasons.map((r) => [t('Lost: {reason}', { reason: r.reason }), r.count, null])],
        display: [...bars.map((b) => [b.name, num(b.count), money(b.value)]), ...w.lossReasons.map((r) => [t('Lost: {reason}', { reason: r.reason }), num(r.count), '—'])],
        numeric: [1, 2],
      }}
    >
      <div className="grid h-full grid-cols-2 gap-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ left: 0, right: 8, top: 8 }}>
            <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={28} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, _n, p) => [t('{deals} deals · {value}', { deals: num(v), value: money((p.payload as { value: number }).value) }), '']} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive={animate}>
              {bars.map((b) => (
                <Cell key={b.name} fill={b.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="min-w-0 self-center">
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t('Why deals were lost')}</p>
          {w.lossReasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No losses.')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {w.lossReasons.map((r) => (
                <li key={r.reason} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{r.reason}</span>
                  <span className="tabular text-muted-foreground">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ChartCard>
  );
}

/** Won revenue and open pipeline by owner. */
export function TeamChart({ data }: { data: DashboardCharts }) {
  const t = useT();
  const animate = useAnimate();
  const money = (v: number) => formatKpi(v, 'currency', data.currency);
  const rows = data.team.slice(0, 8);
  return (
    <ChartCard
      title={t('Team performance')}
      description={t('Won revenue in the period and open pipeline, by owner.')}
      summary={
        rows[0]
          ? t('Grouped bar chart for {people} people; {name} leads with {won} won.', { people: rows.length, name: rows[0].name, won: money(rows[0].won) })
          : t('Grouped bar chart for {people} people.', { people: rows.length })
      }
      filename="team-performance.csv"
      empty={rows.length === 0 ? t('No deals or activities yet.') : null}
      table={{
        caption: t('Team performance by owner'),
        header: [t('Owner'), t('Won'), t('Deals won'), t('Open pipeline'), t('Open deals'), t('Activities')],
        rows: data.team.map((m) => [m.name, m.won, m.wonCount, m.openValue, m.openCount, m.activities]),
        display: data.team.map((m) => [m.name, money(m.won), num(m.wonCount), money(m.openValue), num(m.openCount), num(m.activities)]),
        numeric: [1, 2, 3, 4, 5],
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
          <YAxis tickFormatter={money} tick={axisTick} tickLine={false} axisLine={false} width={72} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, name: string) => [money(v), name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="won" name={t('Won')} fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
          <Bar dataKey="openValue" name={t('Open pipeline')} fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

const RISK_LABEL: Record<'high' | 'medium' | 'low' | 'unscored', MessageKey> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk', unscored: 'Not scored yet' };
const RISK_COLOR = { high: 'hsl(var(--critical))', medium: 'hsl(var(--warning))', low: 'hsl(var(--success))', unscored: 'hsl(var(--muted-foreground))' } as const;

/** Open deals by health risk, from the deal health scores. */
export function RiskChart({ data }: { data: DashboardCharts }) {
  const t = useT();
  const animate = useAnimate();
  const money = (v: number) => formatKpi(v, 'currency', data.currency);
  const rows = data.risk.map((r) => ({ ...r, label: t(RISK_LABEL[r.risk]) }));
  const open = rows.reduce((s, r) => s + r.count, 0);
  const high = rows.find((r) => r.risk === 'high');
  return (
    <ChartCard
      title={t('Deal risk')}
      description={t('Open deals by health risk, from activity, close dates and stage age.')}
      summary={t('{open} open deals; {high} high risk worth {value}.', { open, high: high?.count ?? 0, value: money(high?.value ?? 0) })}
      filename="deal-risk.csv"
      empty={open === 0 ? t('No open deals.') : null}
      table={{
        caption: t('Open deals by risk'),
        header: [t('Risk'), t('Deals'), t('Value')],
        rows: rows.map((r) => [r.label, r.count, r.value]),
        display: rows.map((r) => [r.label, num(r.count), money(r.value)]),
        numeric: [1, 2],
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={28} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, _n, p) => [t('{deals} deals · {value}', { deals: num(v), value: money((p.payload as { value: number }).value) }), '']} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive={animate}>
            {rows.map((r) => (
              <Cell key={r.risk} fill={RISK_COLOR[r.risk]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Progress against this quarter's target. */
export function GoalCard({ data, canSetTargets }: { data: DashboardCharts; canSetTargets: boolean }) {
  const t = useT();
  const g = data.goal;
  const money = (v: number) => formatKpi(v, 'currency', data.currency);
  const share = g ? Math.min(1, g.attainment) : 0;
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{t('Goal attainment')}</CardTitle>
        <CardDescription>{g ? t('{period} target, won deals only.', { period: g.period }) : t('Progress against the quarter target.')}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {!g ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('No target is set for this quarter.')}{' '}
            {canSetTargets && (
              <Link href="/app/forecasting" className="text-primary underline underline-offset-2">
                {t('Set one in Forecasting')}
              </Link>
            )}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-3xl font-semibold tabular">{pct(g.attainment)}</p>
            <div
              role="progressbar"
              aria-label={t('Target attainment')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}
              aria-valuetext={t('{won} of {target}', { won: money(g.won), target: money(g.target) })}
              className="h-3 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t('{won} won of {target}.', { won: money(g.won), target: money(g.target) })} {g.won >= g.target ? t('Target reached.') : t('{left} to go.', { left: money(g.target - g.won) })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
