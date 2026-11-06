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
import { inSentence, type Translator, useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';

const TARGET_SOURCE: Record<NonNullable<PlanTarget['source']>, string> = {
  set: 'Set for this period',
  from_parts: 'Sum of the targets set inside this period',
  share_of_quarter: 'A third of the quarter target (no month target set)',
};

const signedGap = (gap: number, money: (v: number) => string, t: Translator) => (gap > 0 ? t('{value} short', { value: money(gap) }) : gap < 0 ? t('{value} ahead', { value: money(-gap) }) : t('On target'));

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
  const t = useT();
  const tg = p.target;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{t('Target and gap')}</CardTitle>
          <InfoTip topic="forecasting.gap" />
        </div>
      </CardHeader>
      <CardContent>
        {tg.amount === null ? (
          <p className="text-sm text-muted-foreground">
            {t('No target for {period}. Set one below (whole team or per person) to see attainment, the gap to target and pipeline coverage.', { period: p.period.label })}
          </p>
        ) : (
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Stat label={t('Target')} value={money(tg.amount)} detail={tg.source ? t.maybe(TARGET_SOURCE[tg.source]) : ''} />
            <Stat label={t('Attainment')} value={p.attainment === null ? '—' : `${p.attainment}%`} detail={t('{value} won so far', { value: money(p.totals.won) })} />
            <Stat label={t('Gap at base')} value={p.gap ? signedGap(p.gap.base, money, t) : '—'} detail={t('Target minus won and weighted open deals')} tone={p.gap && p.gap.base > 0 ? 'critical' : 'success'} />
            <Stat label={t('Gap at best')} value={p.gap ? signedGap(p.gap.best, money, t) : '—'} detail={t('Worst case: {value}', { value: p.gap ? signedGap(p.gap.worst, money, t) : '—' })} />
            <Stat label={t('Pipeline coverage')} value={p.coverage === null ? '—' : `${p.coverage}×`} detail={t('Open pipeline ÷ what is still needed. Under 3× is usually thin.')} tone={p.coverage !== null && p.coverage < 1 ? 'critical' : undefined} />
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
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('By salesperson')}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {p.byOwner.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No deals or personal targets in this period.')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">{t('Person')}</th>
                <th className="pb-2 text-end font-medium">{t('Target')}</th>
                <th className="pb-2 text-end font-medium">{t('Won')}</th>
                <th className="pb-2 text-end font-medium">{t('Base')}</th>
                <th className="pb-2 text-end font-medium">{t('Gap')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.byOwner.map((o) => (
                <tr key={o.owner?.id ?? 'none'}>
                  <td className="py-2 pe-2">{o.owner?.name ?? t('Unassigned')}</td>
                  <td className="py-2 text-end tabular-nums">{o.target.amount === null ? '—' : money(o.target.amount)}</td>
                  <td className="py-2 text-end tabular-nums">
                    {money(o.totals.won)}
                    {o.attainment !== null && <span className="block text-xs text-muted-foreground">{o.attainment}%</span>}
                  </td>
                  <td className="py-2 text-end tabular-nums">{money(o.totals.base)}</td>
                  <td className={`py-2 text-end tabular-nums ${o.gap !== null && o.gap > 0 ? 'text-critical' : ''}`}>{o.gap === null ? '—' : signedGap(o.gap, money, t)}</td>
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
  const t = useT();
  const groups: [string, string, PlanRisk, typeof CalendarX2][] = [
    ['overdue', t('Close date has passed'), p.risks.overdue, CalendarX2],
    ['stale', t('No activity in 30 days'), p.risks.stale, AlertTriangle],
    ['high', t('High risk on deal health'), p.risks.highRisk, HeartPulse],
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{t('Pipeline risks in this period')}</CardTitle>
          <InfoTip topic="forecasting.risks" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {groups.map(([key, title, r, Icon]) => (
          <section key={key} aria-label={title}>
            <p className="flex items-center gap-2 font-medium">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {title}
              <span className="ms-auto tabular-nums text-muted-foreground">
                {t.plural('count.deals', r.count)} · {money(r.amount)}
              </span>
            </p>
            {r.deals.length > 0 && (
              <ul className="mt-1 space-y-0.5 ps-6">
                {r.deals.slice(0, 4).map((d) => (
                  <li key={d.id} className="flex gap-2 text-xs">
                    <Link href={`/app/deals/${d.id}`} className="truncate text-primary underline underline-offset-2">
                      {d.name}
                    </Link>
                    <span className="text-muted-foreground">{t.maybe(d.detail)}</span>
                    <span className="ms-auto tabular-nums text-muted-foreground">{money(d.amount)}</span>
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
  const t = useT();
  const plan = useForecastPlan(period);
  const canManage = useCan('pipelines:manage');
  const [editing, setEditing] = useState(false);
  if (!plan.data) return null;
  const s = plan.data.settings;
  const src = plan.data.probabilitySources;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('Forecast assumptions')}</CardTitle>
        {canManage && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {t('Change assumptions')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {editing ? (
          <SettingsForm initial={s} onDone={() => setEditing(false)} />
        ) : (
          <div className="space-y-1">
            <p>
              {t('Probability:')} <strong>{s.method === 'history' ? t('stage win rate over the last {months} months (stages with at least {min} closed deals), otherwise the stage probability', { months: s.historyMonths, min: s.minSample }) : t('the probability set on each stage')}</strong>. {t('A probability entered on a deal always wins.')}
            </p>
            <p>
              {t('Commit from {commit}%, best case from {best}%.', { commit: s.commitThreshold, best: s.bestCaseThreshold })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('Open deals this period: {deal} with their own probability, {stage} from the stage, {history} from win history.', { deal: src.deal, stage: src.stage, history: src.history })}
              {s.updatedBy && s.updatedAt && ` ${t('Changed by {name} {when}.', { name: s.updatedBy.name, when: relativeTime(s.updatedAt) })}`}
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="mb-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Win rate by stage, deals closed in the last {months} months', { months: s.historyMonths })}</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">{t('Stage')}</th>
                <th className="pb-2 text-end font-medium">{t('Stage probability')}</th>
                <th className="pb-2 text-end font-medium">{t('Won')}</th>
                <th className="pb-2 text-end font-medium">{t('Lost')}</th>
                <th className="pb-2 text-end font-medium">{t('Win rate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {plan.data.stageRates.map((r) => (
                <tr key={r.stageId}>
                  <td className="py-1.5 pe-2">
                    {r.stage}
                    <span className="block text-xs text-muted-foreground">{r.pipeline}</span>
                  </td>
                  <td className="py-1.5 text-end tabular-nums">{r.stageProbability}%</td>
                  <td className="py-1.5 text-end tabular-nums">{r.won}</td>
                  <td className="py-1.5 text-end tabular-nums">{r.lost}</td>
                  <td className="py-1.5 text-end tabular-nums">
                    {r.rate === null ? '—' : `${r.rate}%`}
                    {r.rate !== null && !r.usable && <span className="block text-xs text-muted-foreground">{t('too few to use')}</span>}
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
  const t = useT();
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
        if (!r.success) return setError(t.maybe(r.error.issues[0]!.message));
        setError(null);
        save.mutate(r.data);
      }}
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="fs-method" className="text-xs font-medium">
            {t('Probability of open deals')}
          </label>
          <Select id="fs-method" className="w-auto" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as ForecastSettingsInput['method'] })}>
            <option value="stage">{t('Stage probability')}</option>
            <option value="history">{t('Stage win rate from history')}</option>
          </Select>
        </div>
        {num('commitThreshold', t('Commit from'), 1, 100, '%')}
        {num('bestCaseThreshold', t('Best case from'), 0, 99, '%')}
        {num('historyMonths', t('History window'), 3, 36, t('months'))}
        {num('minSample', t('Minimum closed deals per stage'), 3, 200, t('deals'))}
      </div>
      <p className="text-xs text-muted-foreground">{t('Changes apply to the live forecast and to new snapshots. Existing snapshots keep the assumptions they were taken with.')}</p>
      {(error || save.error) && <p role="alert" className="text-sm text-critical">{error ?? save.error?.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {t('Save assumptions')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}

const TREND_COUNT: Record<PeriodGranularity, number> = { month: 12, quarter: 8, year: 4 };
const GRANULARITY: Record<PeriodGranularity, string> = { month: 'Month', quarter: 'Quarter', year: 'Year' };

/** Won revenue per period with win rate, cycle, and how the first snapshot compared. */
export function Trends({ granularity }: { granularity: PeriodGranularity }) {
  const t = useT();
  const trends = useForecastTrends(granularity, TREND_COUNT[granularity]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Win and loss trends')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {trends.isPending ? <Skeleton className="h-40" /> : trends.error ? <p role="alert" className="text-sm text-critical">{trends.error.message}</p> : <TrendView tr={trends.data} />}
      </CardContent>
    </Card>
  );
}

function TrendView({ tr }: { tr: ForecastTrends }) {
  const t = useT();
  const money = (v: number) => formatMoney(v, tr.currency);
  const max = Math.max(1, ...tr.points.map((p) => p.won));
  return (
    <>
      <figure>
        <div className="flex h-40 items-end gap-2 border-b border-border" role="img" aria-label={t('Won revenue per {period}. The table below has the figures.', { period: inSentence(t, t.maybe(GRANULARITY[tr.granularity])) })}>
          {tr.points.map((p) => (
            <div key={p.period} className="group relative flex h-full flex-1 items-end justify-center" title={t('{period}: {value} won · {won} won, {lost} lost', { period: p.period, value: money(p.won), won: p.wonCount, lost: p.lostCount })}>
              {p.won > 0 && <div className="w-full max-w-9 rounded-t bg-primary transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(2, (p.won / max) * 100)}%` }} />}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-2" aria-hidden>
          {tr.points.map((p) => (
            <span key={p.period} className="flex-1 truncate text-center text-[11px] text-muted-foreground">
              {p.period}
            </span>
          ))}
        </div>
        <figcaption className="mt-1 text-xs text-muted-foreground">{t('Won revenue per {period}. Hover a bar for details.', { period: inSentence(t, t.maybe(GRANULARITY[tr.granularity])) })}</figcaption>
      </figure>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-start text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">{t('Period')}</th>
              <th className="pb-2 text-end font-medium">{t('Won')}</th>
              <th className="pb-2 text-end font-medium">{t('Won / lost')}</th>
              <th className="pb-2 text-end font-medium">{t('Win rate')}</th>
              <th className="pb-2 text-end font-medium">{t('Avg. cycle')}</th>
              <th className="pb-2 text-end font-medium">{t('First forecast')}</th>
              <th className="pb-2 text-end font-medium">{t('Accuracy')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tr.points.map((p) => (
              <tr key={p.period}>
                <td className="py-1.5">{p.period}</td>
                <td className="py-1.5 text-end tabular-nums">{money(p.won)}</td>
                <td className="py-1.5 text-end tabular-nums">
                  {p.wonCount} / {p.lostCount}
                </td>
                <td className="py-1.5 text-end tabular-nums">{p.winRate === null ? '—' : `${p.winRate}%`}</td>
                <td className="py-1.5 text-end tabular-nums">{p.avgCycleDays === null ? '—' : new Intl.NumberFormat(t.language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(p.avgCycleDays)}</td>
                <td className="py-1.5 text-end tabular-nums">{p.forecastAtStart === null ? '—' : money(p.forecastAtStart)}</td>
                <td className="py-1.5 text-end tabular-nums">
                  {p.errorPercent === null ? (p.forecastAtStart !== null ? <span className="text-xs text-muted-foreground">{t('in progress')}</span> : '—') : `${p.errorPercent > 0 ? '+' : ''}${p.errorPercent}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('Accuracy compares what was won with the base forecast of the first snapshot taken for that period. Take a snapshot at the start of each period to track it.')}</p>
      {tr.topLossReasons.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Top loss reasons')}</p>
          <ul className="flex flex-wrap gap-2">
            {tr.topLossReasons.map((r) => (
              <li key={r.reason}>
                <Badge tone="neutral">
                  {t.maybe(r.reason)} · {r.count}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
