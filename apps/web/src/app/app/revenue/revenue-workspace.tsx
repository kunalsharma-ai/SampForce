'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { quarterPeriod, type RevenueAnalytics } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, formatMoney, useMembers } from '@/lib/crm';
import { todayIso, useExchangeRates, useRevenue, useTargets } from '@/lib/revenue';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n';

function quarterOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = -4; i <= 1; i++) out.push(quarterPeriod(undefined, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i * 3, 1))).label);
  return out;
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export function RevenueWorkspace() {
  const t = useT();
  const options = useMemo(quarterOptions, []);
  const [period, setPeriod] = useState(options[4]!);
  const data = useRevenue(period);
  return (
    <div className="space-y-6">
      <Field id="rev-period" label={t('Quarter')}>
        <Select id="rev-period" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-36">
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </Field>
      {data.isPending ? <Skeleton className="h-72" /> : data.error ? <ErrorText error={data.error} /> : <Report a={data.data} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Targets period={period} />
        <Rates />
      </div>
    </div>
  );
}

function Report({ a }: { a: RevenueAnalytics }) {
  const t = useT();
  const money = (v: number | null) => formatMoney(v, a.currency);
  const maxMonth = Math.max(1, ...a.byMonth.map((m) => m.won));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('Won')} value={money(a.won.total)} hint={t.plural('count.dealsClosedWon', a.won.deals)} />
        <Tile label={t('Win rate')} value={pct(a.closed.winRate)} hint={t('{won} won, {lost} lost', { won: a.closed.won, lost: a.closed.lost })} />
        <Tile label={t('Average deal')} value={money(a.won.avgDealSize)} hint={a.won.avgCycleDays === null ? t('No closed deals yet') : t('{time} from created to won', { time: new Intl.NumberFormat(t.language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(a.won.avgCycleDays) })} />
        <Tile
          label={t('Target')}
          value={a.target.amount === null ? t('Not set') : pct(a.target.attainment)}
          hint={a.target.amount === null ? t('Set a team target below') : `${t('of {target} · open in quarter {open}', { target: money(a.target.amount), open: money(a.target.openInPeriod) })}${a.target.coverage !== null ? ` ${t('({n}× the gap)', { n: a.target.coverage })}` : ''}`}
        />
      </div>
      {a.excluded.noExchangeRate > 0 && (
        <p role="note" className="text-sm text-warning">
          {t.plural('count.amountsNoRate', a.excluded.noExchangeRate)}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('Won by month')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {a.byMonth.map((m) => (
                <li key={m.month} className="grid grid-cols-[5rem_1fr_7rem] items-center gap-2">
                  <span className="text-muted-foreground">{new Date(`${m.month}-01T00:00:00`).toLocaleDateString(fmtLocale(), { month: 'short', year: 'numeric' })}</span>
                  <span className="h-3 rounded bg-muted" aria-hidden>
                    <span className="block h-3 rounded bg-primary" style={{ width: `${(m.won / maxMonth) * 100}%` }} />
                  </span>
                  <span className="text-end tabular-nums">
                    {money(m.won)} <span className="text-xs text-muted-foreground">({m.deals})</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Lead funnel')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-xs text-muted-foreground">{t('Leads created this quarter')}</p>
            <Line label={t('Leads')} value={String(a.funnel.leads)} />
            <Line label={t('Qualified or converted')} value={String(a.funnel.qualified)} />
            <Line label={t('Converted')} value={String(a.funnel.converted)} />
            <Line label={t('Became won deals')} value={String(a.funnel.wonFromLeads)} />
            <p className="pt-2 text-xs text-muted-foreground">
              {t('Sales velocity: {velocity} ({deals})', { velocity: a.velocity.perDay === null ? t('not enough closed history yet') : t('{value} per day', { value: money(a.velocity.perDay) }), deals: t.plural('count.openDeals', a.velocity.openDeals) })}
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('By owner')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {a.byOwner.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No closed deals or targets this quarter.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">{t('Owner')}</th>
                  <th className="pb-2 text-end font-medium">{t('Won')}</th>
                  <th className="pb-2 text-end font-medium">{t('Deals')}</th>
                  <th className="pb-2 text-end font-medium">{t('Lost')}</th>
                  <th className="pb-2 text-end font-medium">{t('Win rate')}</th>
                  <th className="pb-2 text-end font-medium">{t('Target')}</th>
                  <th className="pb-2 text-end font-medium">{t('Attainment')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.byOwner.map((o) => (
                  <tr key={o.owner?.id ?? 'none'}>
                    <td className="py-2">{o.owner?.name ?? t('Unassigned')}</td>
                    <td className="py-2 text-end tabular-nums">{money(o.won)}</td>
                    <td className="py-2 text-end tabular-nums">{o.deals}</td>
                    <td className="py-2 text-end tabular-nums">{o.lost}</td>
                    <td className="py-2 text-end tabular-nums">{pct(o.winRate)}</td>
                    <td className="py-2 text-end tabular-nums">{money(o.target)}</td>
                    <td className="py-2 text-end tabular-nums">{pct(o.attainment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <ListCard title={t('By lead source')} empty={t('No won deals.')} rows={a.bySource.map((s) => [t.maybe(s.source), `${money(s.won)} · ${s.deals}`])} />
        <ListCard title={t('By product (accepted quotes)')} empty={t('No accepted quotes on won deals.')} rows={a.byProduct.map((p) => [p.name, `${money(p.revenue)} · ${t('qty {n}', { n: p.quantity })}`])} />
        <ListCard title={t('Loss reasons')} empty={t('No lost deals.')} rows={a.lossReasons.map((l) => [t.maybe(l.reason), `${l.deals} · ${money(l.amount)}`])} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Forecast against actual')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {a.actualVsForecast.length === 0 ? (
            <p className="text-muted-foreground">{t('Take a forecast snapshot early in a quarter to compare it with what actually closed.')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {a.actualVsForecast.map((f) => (
                <li key={f.period} className="flex flex-wrap gap-x-4 py-2">
                  <span className="font-medium">{f.period}</span>
                  <span className="text-muted-foreground">{t('first snapshot {date}', { date: formatDate(f.snapshotAt) })}</span>
                  <span className="ms-auto tabular-nums">
                    {t('predicted {predicted} · actual {actual}', { predicted: money(f.predicted), actual: money(f.actual) })} · {f.errorPercent === null ? '—' : `${f.errorPercent > 0 ? '+' : ''}${f.errorPercent}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between tabular-nums">
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}

function ListCard({ title, rows, empty }: { title: string; rows: [string, string][]; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2 py-1.5">
                <span>{k}</span>
                <span className="tabular-nums text-muted-foreground">{v}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function Targets({ period }: { period: string }) {
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('pipelines:manage');
  const targets = useTargets(period);
  const members = useMembers();
  const base = useExchangeRates().data?.base;
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['analytics'] }), qc.invalidateQueries({ queryKey: ['forecast'] })]);
  const save = useMutation({
    mutationFn: () => api('/analytics/targets', { method: 'PUT', json: { period, userId: userId || null, amount: Number(amount) } }),
    onSuccess: async () => {
      setAmount('');
      await done();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/analytics/targets/${id}`, { method: 'DELETE' }), onSuccess: done });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Targets for {period}', { period })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!targets.data?.length ? (
          <p className="text-muted-foreground">{t('No targets for this period.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {targets.data.map((tg) => (
              <li key={tg.id} className="flex items-center gap-2 py-1.5">
                <span>{tg.user?.name ?? t('Whole team')}</span>
                <span className="ms-auto tabular-nums">{formatMoney(tg.amount, base)}</span>
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(tg.id)} aria-label={t('Remove target for {name}', { name: tg.user?.name ?? t('whole team') })}>
                    {t('Remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount !== '') save.mutate();
            }}
          >
            <Field id="target-user" label={t('For')}>
              <Select id="target-user" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-44">
                <option value="">{t('Whole team')}</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="target-amount" label={t('Amount')}>
              <Input id="target-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-32" />
            </Field>
            <Button type="submit" size="sm" variant="outline" disabled={save.isPending}>
              {t('Set target')}
            </Button>
          </form>
        )}
        <ErrorText error={save.error ?? remove.error} />
      </CardContent>
    </Card>
  );
}

function Rates() {
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('catalog:manage');
  const rates = useExchangeRates();
  const [currency, setCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayIso());
  const save = useMutation({
    mutationFn: () => api('/analytics/exchange-rates', { method: 'PUT', json: { currency, rate: Number(rate), effectiveDate: date } }),
    onSuccess: async () => {
      setRate('');
      await Promise.all([qc.invalidateQueries({ queryKey: ['analytics'] }), qc.invalidateQueries({ queryKey: ['forecast'] })]);
    },
  });
  const base = rates.data?.base;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Exchange rates')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {t('Rates you enter convert other currencies into {base} for analytics and forecasts. The latest rate per currency is used. There is no automatic rate feed.', { base: base ?? t('your workspace currency') })}
        </p>
        {!rates.data?.rates.length ? (
          <p className="text-muted-foreground">{t('No rates yet.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rates.data.rates.map((r) => (
              <li key={r.id} className="flex gap-2 py-1.5 tabular-nums">
                <span>
                  1 {r.currency} = {r.rate} {base}
                </span>
                <span className="ms-auto text-muted-foreground">{t('from {date}', { date: formatDate(r.effectiveDate) })}</span>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (currency && rate) save.mutate();
            }}
          >
            <Field id="fx-currency" label={t('Currency')}>
              <Input id="fx-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="w-20 uppercase" placeholder="EUR" />
            </Field>
            <Field id="fx-rate" label={t('Rate to {base}', { base: base ?? t('base') })}>
              <Input id="fx-rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="w-28" />
            </Field>
            <Field id="fx-date" label={t('From')}>
              <Input id="fx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" variant="outline" disabled={save.isPending}>
              {t('Save rate')}
            </Button>
          </form>
        )}
        <ErrorText error={save.error} />
      </CardContent>
    </Card>
  );
}
