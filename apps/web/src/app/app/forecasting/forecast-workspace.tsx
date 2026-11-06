'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { type ForecastChange, type ForecastComparison, type ForecastView, type PeriodGranularity, periodLabelOf } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Sparkles, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Select } from '@/components/crm/select';
import { aiErrorMessage, agentReason, type ForecastExplanation, useAiStatus, useForecast, useSnapshots } from '@/lib/ai';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { Targets } from '../revenue/revenue-workspace';
import { Assumptions, PlanSection, Trends } from './forecast-plan';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';

const CATEGORY = {
  won: { label: 'Won', tone: 'success' },
  commit: { label: 'Commit', tone: 'primary' },
  best_case: { label: 'Best case', tone: 'accent' },
  pipeline: { label: 'Pipeline', tone: 'neutral' },
} as const;

const CHANGE_LABEL: Record<ForecastChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  won: 'Won',
  amount: 'Amount',
  probability: 'Probability',
  close_date: 'Close date',
  stage: 'Stage',
};

const RANGE: Record<PeriodGranularity, [number, number, number]> = { month: [-3, 3, 1], quarter: [-2, 2, 3], year: [-1, 1, 12] };
const GRANULARITY_LABEL: Record<PeriodGranularity, string> = { month: 'Month', quarter: 'Quarter', year: 'Year' };

/** A few periods back and ahead of the current one; the current one is in the middle. */
function periodOptions(g: PeriodGranularity): string[] {
  const now = new Date();
  const [from, to, months] = RANGE[g];
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(periodLabelOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i * months, 1)), g));
  return out;
}

export function ForecastWorkspace() {
  const t = useT();
  const [granularity, setGranularity] = useState<PeriodGranularity>('quarter');
  const options = useMemo(() => periodOptions(granularity), [granularity]);
  const [period, setPeriod] = useState(() => periodOptions('quarter')[2]!);
  const forecast = useForecast(period);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="forecast-granularity" className="text-sm font-medium">
            {t('Forecast by')}
          </label>
          <Select
            id="forecast-granularity"
            value={granularity}
            className="w-32"
            onChange={(e) => {
              const g = e.target.value as PeriodGranularity;
              setGranularity(g);
              setPeriod(periodLabelOf(new Date(), g));
            }}
          >
            {(Object.keys(GRANULARITY_LABEL) as PeriodGranularity[]).map((g) => (
              <option key={g} value={g}>
                {t.maybe(GRANULARITY_LABEL[g])}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="forecast-period" className="text-sm font-medium">
            {t.maybe(GRANULARITY_LABEL[granularity])}
          </label>
          <Select id="forecast-period" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-36">
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </div>
        {forecast.data && (
          <p className="pb-2 text-xs text-muted-foreground">
            {t('{start} to {end}', { start: formatDate(forecast.data.period.start), end: formatDate(new Date(Date.parse(forecast.data.period.end) - 86_400_000).toISOString().slice(0, 10)) })} · {t('method {method}', { method: forecast.data.method })} · {forecast.data.currency}
          </p>
        )}
      </div>

      {forecast.isPending ? (
        <Skeleton className="h-64" />
      ) : forecast.error ? (
        <p role="alert" className="text-sm text-critical">
          {forecast.error.message}
        </p>
      ) : (
        <>
          <Summary view={forecast.data} />
          <PlanSection period={period} />
          <Lines view={forecast.data} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Targets period={period} />
            <div className="lg:col-span-2">
              <Assumptions period={period} />
            </div>
          </div>
          <Trends granularity={granularity} />
          <Snapshots period={period} currency={forecast.data.currency} />
        </>
      )}
    </div>
  );
}

function Summary({ view }: { view: ForecastView }) {
  const t = useT();
  const tot = view.totals;
  const money = (v: number) => formatMoney(v, view.currency);
  const tiles: [string, number, string][] = [
    [t('Won'), tot.won, t('Closed won in the period')],
    [t('Commit'), tot.commit, t('Open deals at {n}% or more', { n: view.assumptions.commit })],
    [t('Best case'), tot.bestCase, t('Open deals at {from}–{to}%', { from: view.assumptions.bestCase, to: view.assumptions.commit - 1 })],
    [t('Pipeline'), tot.pipeline, t('Open deals under {n}%', { n: view.assumptions.bestCase })],
    [t('Weighted'), tot.weighted, t('Open amount × probability')],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value, hint]) => (
          <Card key={label}>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{money(value)}</p>
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{t('Scenarios')}</CardTitle>
            <InfoTip topic="forecasting.scenarios" />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <Scenario label={t('Worst')} value={money(tot.worst)} detail={t('Only what is already won.')} />
          <Scenario label={t('Base')} value={money(tot.base)} detail={t('Won plus the weighted open pipeline.')} />
          <Scenario label={t('Best')} value={money(tot.best)} detail={t('Won plus every commit and best-case deal.')} />
        </CardContent>
      </Card>
      {(view.excluded.otherCurrency > 0 || view.excluded.noCloseDate > 0) && (
        <p role="note" className="text-sm text-muted-foreground">
          {t('Not included: {items}.', {
            items: new Intl.ListFormat(t.language, { type: 'conjunction' }).format(
              [
                view.excluded.otherCurrency > 0 ? t.plural('count.dealsOtherCurrency', view.excluded.otherCurrency) : '',
                view.excluded.noCloseDate > 0 ? t.plural('count.openDealsNoCloseDate', view.excluded.noCloseDate) : '',
              ].filter(Boolean),
            ),
          })}
        </p>
      )}
    </div>
  );
}

function Scenario({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Lines({ view }: { view: ForecastView }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Deals in this forecast ({n})', { n: view.lineCount })}</CardTitle>
        {view.lineCount > view.lines.length && (
          <p className="text-sm text-muted-foreground">{t('Showing the {shown} largest. The totals above include all {total}.', { shown: view.lines.length, total: view.lineCount })}</p>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {view.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No open or won deals with a close date in this period.')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">{t('Deal')}</th>
                <th className="pb-2 font-medium">{t('Category')}</th>
                <th className="pb-2 text-end font-medium">{t('Amount')}</th>
                <th className="pb-2 text-end font-medium">{t('Prob.')}</th>
                <th className="pb-2 font-medium">{t('Close')}</th>
                <th className="pb-2 font-medium">{t('Owner')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.lines.map((l) => (
                <tr key={l.dealId}>
                  <td className="py-2 pe-2">
                    <Link href={`/app/deals/${l.dealId}`} className="text-primary hover:underline">
                      {l.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{l.stage}</span>
                  </td>
                  <td className="py-2 pe-2">
                    <Badge tone={CATEGORY[l.category].tone}>{t.maybe(CATEGORY[l.category].label)}</Badge>
                  </td>
                  <td className="py-2 text-end tabular-nums">{formatMoney(l.amount, view.currency)}</td>
                  <td className="py-2 text-end tabular-nums">
                    {l.status === 'WON' ? '—' : `${l.probability}%`}
                    {l.status === 'OPEN' && l.probabilitySource && <span className="block text-[11px] text-muted-foreground">{l.probabilitySource === 'deal' ? t('set on deal') : l.probabilitySource === 'history' ? t('win history') : t('stage')}</span>}
                  </td>
                  <td className="py-2 ps-2">{formatDate(l.closeDate)}</td>
                  <td className="py-2">{l.owner?.name ?? t('Unassigned')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function Snapshots({ period, currency }: { period: string; currency: string }) {
  const t = useT();
  const snapshots = useSnapshots(period);
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const money = (v: number) => formatMoney(v, currency);

  const take = useMutation({
    mutationFn: () => api('/forecast/snapshots', { method: 'POST', json: { period, label: label.trim() || undefined } }),
    onSuccess: async () => {
      setLabel('');
      await qc.invalidateQueries({ queryKey: ['forecast', period, 'snapshots'] });
    },
  });
  const verify = useMutation({
    mutationFn: (id: string) => api<{ matches: boolean }>(`/forecast/snapshots/${id}/verify`).then((r) => ({ id, ...r })),
    onSuccess: (r) => setVerified((v) => ({ ...v, [r.id]: r.matches })),
  });
  const compare = useMutation({
    mutationFn: () => api<ForecastComparison>(`/forecast/compare?from=${from}&to=${to}`),
  });

  const rows = snapshots.data ?? [];
  const nameOf = (id: string) => {
    const s = rows.find((r) => r.id === id);
    return s ? `${s.label ?? t('Snapshot')} · ${new Date(s.createdAt).toLocaleString(fmtLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
  };

  return (
    <section aria-labelledby="snapshots-heading" className="space-y-4">
      <div className="flex items-center gap-1.5">
        <h2 id="snapshots-heading" className="text-sm font-semibold">
          {t('Snapshots')}
        </h2>
        <InfoTip topic="forecasting.snapshots" />
      </div>
      <Card>
        <CardContent className="space-y-4 p-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              take.mutate();
            }}
          >
            <div className="space-y-1">
              <label htmlFor="snapshot-label" className="text-sm font-medium">
                {t('Label (optional)')}
              </label>
              <Input id="snapshot-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder={t('Monday pipeline review')} className="w-64" />
            </div>
            <Button type="submit" size="sm" disabled={take.isPending}>
              <Camera aria-hidden /> {t('Take snapshot')}
            </Button>
            <p className="w-full text-xs text-muted-foreground">{t('A snapshot stores every deal line as it is now, so its totals can be recomputed and checked later. Snapshots cannot be edited.')}</p>
          </form>
          {take.error && <p role="alert" className="text-sm text-critical">{take.error.message}</p>}

          {snapshots.isPending ? (
            <Skeleton className="h-20" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No snapshots for {period} yet.', { period })}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {rows.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">{s.label ?? t('Snapshot')}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.createdBy?.name ?? t('Someone')} · {relativeTime(s.createdAt)}
                  </span>
                  <span className="ms-auto tabular-nums">{t('Base {value}', { value: money(s.totals.base) })}</span>
                  {s.id in verified ? (
                    verified[s.id] ? (
                      <Badge tone="success">
                        <CheckCircle2 className="me-1 size-3" aria-hidden /> {t('Totals match')}
                      </Badge>
                    ) : (
                      <Badge tone="critical">
                        <XCircle className="me-1 size-3" aria-hidden /> {t('Totals differ')}
                      </Badge>
                    )
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => verify.mutate(s.id)} disabled={verify.isPending}>
                      {t('Recompute')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {rows.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Compare snapshots')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (from && to && from !== to) compare.mutate();
              }}
            >
              <SnapshotSelect id="compare-from" label={t('From')} value={from} onChange={setFrom} rows={rows} nameOf={nameOf} />
              <SnapshotSelect id="compare-to" label={t('To')} value={to} onChange={setTo} rows={rows} nameOf={nameOf} />
              <Button type="submit" size="sm" variant="outline" disabled={!from || !to || from === to || compare.isPending}>
                {t('Compare')}
              </Button>
            </form>
            {compare.error && <p role="alert" className="text-sm text-critical">{compare.error.message}</p>}
            {compare.data && <ComparisonView cmp={compare.data} money={money} />}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function SnapshotSelect({ id, label, value, onChange, rows, nameOf }: { id: string; label: string; value: string; onChange: (v: string) => void; rows: { id: string }[]; nameOf: (id: string) => string }) {
  const t = useT();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-72">
        <option value="">{t('Choose a snapshot')}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {nameOf(r.id)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ComparisonView({ cmp, money }: { cmp: ForecastComparison; money: (v: number) => string }) {
  const t = useT();
  const status = useAiStatus();
  const canExplain = useCan('ai:use');
  const reason = agentReason(status.data, 'forecast_explainer');
  const explain = useMutation({
    mutationFn: () => api<ForecastExplanation>('/ai/forecast/explain', { method: 'POST', json: { from: cmp.from.id, to: cmp.to.id } }),
  });
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;
  const keys: [keyof ForecastComparison['delta'], string][] = [
    ['won', t('Won')],
    ['weighted', t('Weighted')],
    ['base', t('Base')],
    ['best', t('Best')],
  ];
  const fmtChange = (c: ForecastChange, v: string | number | null) =>
    v === null ? '—' : c.kind === 'probability' ? `${v}%` : c.kind === 'close_date' ? formatDate(String(v)) : c.kind === 'stage' ? String(v) : money(Number(v));
  const explanation = explain.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {keys.map(([k, l]) => (
          <div key={k}>
            <p className="text-xs font-medium text-muted-foreground">{l}</p>
            <p className={`text-lg font-semibold tabular-nums ${cmp.delta[k] > 0 ? 'text-success' : cmp.delta[k] < 0 ? 'text-critical' : ''}`}>{signed(cmp.delta[k])}</p>
          </div>
        ))}
      </div>
      {cmp.changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No deal-level changes between these snapshots.')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {cmp.changes.map((c, i) => (
            <li key={`${c.dealId}-${c.kind}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Badge>{t.maybe(CHANGE_LABEL[c.kind])}</Badge>
              <Link href={`/app/deals/${c.dealId}`} className="text-primary hover:underline">
                {c.name}
              </Link>
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                {fmtChange(c, c.from)} → {fmtChange(c, c.to)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canExplain && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => explain.mutate()} disabled={explain.isPending || !!reason}>
              <Sparkles aria-hidden /> {explain.isPending ? t('Explaining…') : t('Explain with AI')}
            </Button>
            <span className="text-xs text-muted-foreground">{reason ? t.maybe(reason) : t('Writes a short explanation from the changes above. It does not change any number.')}</span>
          </div>
          {explain.error && <p role="alert" className="text-sm text-critical">{aiErrorMessage(explain.error)}</p>}
          {explanation && (
            <p className="whitespace-pre-wrap text-sm">{explanation.explanation ?? explanation.explanationUnavailable}</p>
          )}
        </div>
      )}
    </div>
  );
}

