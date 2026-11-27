'use client';

import type { DealsBreakdownRow, DealsSummary } from '@dealflow/types';
import { cn, Input, Skeleton } from '@dealflow/ui';
import {
  AlarmClock,
  BadgePercent,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CircleDollarSign,
  CircleX,
  Coins,
  Gauge,
  Hourglass,
  Layers,
  type LucideIcon,
  Scale,
  Timer,
  TrendingUp,
  Trophy,
  UserCog,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { UserAvatar } from '@/components/people/user-avatar';
import { formatDate, formatMoney } from '@/lib/crm';
import { type DealViewFilter, useDealsSummary, ymd } from '@/lib/deal-views';
import { type MessageKey, useT } from '@/lib/i18n';
import { initials } from './deal-badges';
import { dealStageIcon, Icon3D, LOST_COLOUR, stageColours, tone, WON_COLOUR } from './deal-look';

/*
 * The Deals dashboard (ADR 0096): every number comes from GET /deals/summary, which reads the deals the person can
 * see. Charts are plain HTML bars with the value written next to each, so nothing depends on colour or hovering.
 */

const C = { blue: '#257de0', orange: '#f47230', aqua: '#00b894', yellow: '#f2a600', magenta: '#ee7fac', violet: '#6a4ce2', teal: '#0e9fb5', slate: '#64748b' };

type Preset = 'month' | 'quarter' | 'year' | '12m' | 'all' | 'custom';
const PRESETS: { key: Preset; label: MessageKey }[] = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom dates' },
];

function presetRange(p: Preset, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === 'month') return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (p === 'quarter') return { from: ymd(new Date(y, Math.floor(m / 3) * 3, 1)), to: ymd(new Date(y, Math.floor(m / 3) * 3 + 3, 0)) };
  if (p === 'year') return { from: ymd(new Date(y, 0, 1)), to: ymd(new Date(y, 11, 31)) };
  if (p === '12m') return { from: ymd(new Date(y - 1, m, now.getDate() + 1)), to: ymd(now) };
  return { from: '', to: '' };
}

/** The headline row shown above the board and the other views: four tiles, linking to the full dashboard. */
export function DealsKpiStrip({ filter, onOpenDashboard }: { filter: DealViewFilter; onOpenDashboard: () => void }) {
  const t = useT();
  const range = presetRange('month');
  const q = useDealsSummary({ ...filter, ...range });
  if (q.isPending) return <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[5.5rem] rounded-2xl" />)}</div>;
  if (!q.data) return null;
  const s = q.data;
  const money = (v: number) => formatMoney(v, s.currency);
  return (
    <section aria-label={t('Deals at a glance')} className="mb-4" data-deals-kpi-strip>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Layers} colour={C.blue} label="Open pipeline" value={money(s.open.value)} sub={t.plural('count.openDeals', s.open.count)} />
        <Kpi icon={Scale} colour={C.violet} label="Weighted pipeline" value={money(s.open.weighted)} sub={t('By stage probability')} />
        <Kpi icon={Trophy} colour={WON_COLOUR} label="Won this month" value={money(s.won.value)} sub={t.plural('count.deals', s.won.count)} />
        <Kpi icon={AlarmClock} colour={s.overdue.count ? LOST_COLOUR : C.slate} label="Overdue" value={String(s.overdue.count)} sub={money(s.overdue.value)} />
      </div>
      <button type="button" onClick={onOpenDashboard} className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline">
        {t('Open the full deals dashboard')}
      </button>
    </section>
  );
}

function Kpi({ icon, colour, label, value, sub, testId }: { icon: LucideIcon; colour: string; label: MessageKey; value: string; sub?: string; testId?: string }) {
  const t = useT();
  return (
    <div className="sf-kpi sf-lift" style={tone(colour)} data-kpi={testId ?? label}>
      <Icon3D icon={icon} colour={colour} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground sm:truncate">{t(label)}</p>
        <p className="break-words text-lg font-bold tabular-nums leading-tight sm:text-xl" title={value}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground sm:truncate" title={sub}>{sub}</p>}
      </div>
    </div>
  );
}

export function DealsDashboard({ filter, onOpen }: { filter: DealViewFilter; onOpen: (id: string) => void }) {
  const t = useT();
  const [preset, setPreset] = useState<Preset>('quarter');
  const [custom, setCustom] = useState(() => presetRange('quarter'));
  const range = preset === 'custom' ? custom : presetRange(preset);
  const q = useDealsSummary({ ...filter, ...range });

  const toolbar = (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label={t('Dashboard period')}>
      <div className="sf-views inline-flex flex-wrap gap-0.5 p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={preset === p.key}
            onClick={() => setPreset(p.key)}
            className="h-8 shrink-0 rounded-[0.7rem] px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t(p.label)}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('From')}
            <Input type="date" className="h-8 w-36 text-xs" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('To')}
            <Input type="date" className="h-8 w-36 text-xs" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );

  if (q.error) return <p role="alert" className="text-sm text-critical">{q.error.message}</p>;
  if (q.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        {toolbar}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  const s = q.data;
  const money = (v: number) => formatMoney(v, s.currency);
  const period = range.from || range.to ? `${range.from ? formatDate(range.from) : '…'} – ${range.to ? formatDate(range.to) : '…'}` : t('All time');
  return (
    <section aria-labelledby="deals-dashboard-heading" className="space-y-5" data-deals-dashboard>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="deals-dashboard-heading" className="text-lg font-semibold">
            {t('Deals dashboard')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Created, won, lost and conversion cover {period}. Open pipeline is as of now.', { period })}</p>
        </div>
        {toolbar}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Kpi icon={Briefcase} colour={C.slate} label="Total deals" value={s.total.count.toLocaleString(t.formatLocale)} sub={money(s.total.value)} />
        <Kpi icon={Layers} colour={C.blue} label="Open deals" value={s.open.count.toLocaleString(t.formatLocale)} sub={money(s.open.value)} />
        <Kpi icon={Trophy} colour={WON_COLOUR} label="Won deals" value={s.won.count.toLocaleString(t.formatLocale)} sub={money(s.won.value)} />
        <Kpi icon={CircleX} colour={LOST_COLOUR} label="Lost deals" value={s.lost.count.toLocaleString(t.formatLocale)} sub={money(s.lost.value)} />
        <Kpi icon={CircleDollarSign} colour={C.aqua} label="Total pipeline value" value={money(s.open.value)} sub={t.plural('count.openDeals', s.open.count)} />
        <Kpi icon={Scale} colour={C.violet} label="Weighted pipeline" value={money(s.open.weighted)} sub={t('By stage probability')} />
        <Kpi icon={Coins} colour={C.yellow} label="Average deal value" value={s.averageWon === null ? '—' : money(s.averageWon)} sub={s.averageOpen === null ? t('Won deals') : t('Open deals average {value}', { value: money(s.averageOpen) })} />
        <Kpi icon={BadgePercent} colour={C.orange} label="Conversion rate" value={s.conversionRate === null ? '—' : `${s.conversionRate}%`} sub={t('{won} won of {closed} closed', { won: s.won.count, closed: s.won.count + s.lost.count })} />
        <Kpi icon={CalendarPlus} colour={C.teal} label="Created this month" value={s.createdThisMonth.count.toLocaleString(t.formatLocale)} sub={money(s.createdThisMonth.value)} />
        <Kpi icon={CalendarCheck} colour={C.magenta} label="Closed this month" value={s.closedThisMonth.count.toLocaleString(t.formatLocale)} sub={money(s.closedThisMonth.value)} />
        <Kpi icon={Timer} colour={C.blue} label="Average time to win" value={s.averageCycleDays === null ? '—' : t('{n} days', { n: s.averageCycleDays })} sub={t('From created to won')} />
        <Kpi icon={AlarmClock} colour={s.overdue.count ? LOST_COLOUR : C.slate} label="Overdue" value={s.overdue.count.toLocaleString(t.formatLocale)} sub={money(s.overdue.value)} />
      </div>
      {s.otherCurrencyCount > 0 && (
        <p className="text-xs text-muted-foreground">{t('{count} deals in other currencies are counted but not added to the values.', { count: s.otherCurrencyCount })}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <StageFunnel s={s} money={money} className="xl:col-span-3" />
        <Trend s={s} money={money} className="xl:col-span-2" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Breakdown title="Deals by employee" icon={Users} colour={C.blue} rows={s.byOwner} money={money} kind="person" empty="Unassigned" />
        <Breakdown title="Deals by manager" icon={UserCog} colour={C.violet} rows={s.byManager} money={money} kind="person" empty="No manager set" />
        <Breakdown title="Deals by company" icon={Building2} colour={C.aqua} rows={s.byCompany} money={money} kind="company" empty="No company" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Upcoming s={s} money={money} onOpen={onOpen} />
        <Attention s={s} money={money} />
      </div>
    </section>
  );
}

function Panel({ title, icon, colour, children, className, aside }: { title: MessageKey; icon: LucideIcon; colour: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  const t = useT();
  const id = `panel-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className={cn('sf-panel p-4 sm:p-5', className)}>
      <header className="mb-4 flex flex-wrap items-center gap-2.5">
        <Icon3D icon={icon} colour={colour} size="sm" />
        <h3 id={id} className="min-w-0 flex-1 text-sm font-semibold">
          {t(title)}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function StageFunnel({ s, money, className }: { s: DealsSummary; money: (v: number) => string; className?: string }) {
  const t = useT();
  const colours = stageColours(s.stages.map((st) => ({ id: st.id, category: st.category })));
  const max = Math.max(1, ...s.stages.map((st) => st.value));
  return (
    <Panel title="Deals by stage" icon={Layers} colour={C.blue} className={className} aside={s.pipeline && <span className="truncate text-xs text-muted-foreground">{s.pipeline.name}</span>}>
      {s.stages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No pipeline yet.')}</p>
      ) : (
        <ol className="space-y-2.5" aria-label={t('Deals by stage')}>
          {s.stages.map((st, i) => {
            const colour = colours.get(st.id)!;
            const Icon = dealStageIcon({ name: st.name, category: st.category, position: i });
            return (
              <li key={st.id} style={tone(colour)} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]" data-stage-row>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <Icon aria-hidden className="sf-ink size-4 shrink-0" />
                  <span className="truncate" title={st.name}>{st.name}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-muted/60">
                    <span className="sf-bar block h-full rounded-md transition-[width] duration-700" style={{ width: `${st.value > 0 ? Math.max(3, (st.value / max) * 100) : 0}%` }} />
                  </span>
                  <span className="w-28 shrink-0 text-end text-xs tabular-nums">
                    <span className="font-semibold">{money(st.value)}</span>
                    <span className="block text-muted-foreground">{t.plural('count.deals', st.count)}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('Open stages show deals open now; won and lost stages show deals closed in the period.')}</p>
    </Panel>
  );
}

function Trend({ s, money, className }: { s: DealsSummary; money: (v: number) => string; className?: string }) {
  const t = useT();
  const max = Math.max(1, ...s.trend.map((m) => m.wonValue));
  const label = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(t.formatLocale, { month: 'short' });
  return (
    <Panel title="Won value, last six months" icon={TrendingUp} colour={WON_COLOUR} className={className}>
      <ol className="flex h-52 items-end gap-2" aria-label={t('Won value by month')} style={tone(WON_COLOUR)}>
        {s.trend.map((m) => (
          <li key={m.month} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${label(m.month)}: ${money(m.wonValue)} · ${t('{won} won, {lost} lost, {created} created', { won: m.won, lost: m.lost, created: m.created })}`}>
            <span className="max-w-full truncate text-[11px] font-semibold tabular-nums">{m.wonValue ? money(m.wonValue) : ''}</span>
            <span className="sf-bar block w-full max-w-10 rounded-t-md opacity-90 transition-[height] duration-700 group-hover:opacity-100" style={{ height: `${m.wonValue ? Math.max(4, (m.wonValue / max) * 100) : 0}%`, minHeight: m.wonValue ? 4 : 2 }} />
            <span className="text-xs text-muted-foreground">{label(m.month)}</span>
            <span className="sr-only">{t('{won} won, {lost} lost, {created} created', { won: m.won, lost: m.lost, created: m.created })}</span>
          </li>
        ))}
      </ol>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-xs">
        <div>
          <dt className="text-muted-foreground">{t('Created')}</dt>
          <dd className="text-sm font-semibold tabular-nums">{s.trend.reduce((n, m) => n + m.created, 0)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('Won')}</dt>
          <dd className="text-sm font-semibold tabular-nums">{s.trend.reduce((n, m) => n + m.won, 0)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('Lost')}</dt>
          <dd className="text-sm font-semibold tabular-nums">{s.trend.reduce((n, m) => n + m.lost, 0)}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function Breakdown({ title, icon, colour, rows, money, kind, empty }: { title: MessageKey; icon: LucideIcon; colour: string; rows: DealsBreakdownRow[]; money: (v: number) => string; kind: 'person' | 'company'; empty: MessageKey }) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.open.value + r.won.value));
  return (
    <Panel title={title} icon={icon} colour={colour}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No deals yet.')}</p>
      ) : (
        <ol className="space-y-3" aria-label={t(title)} style={tone(colour)}>
          {rows.map((r, i) => {
            const name = r.ref?.name || t(empty);
            return (
              <li key={r.ref?.id ?? `none-${i}`} className="flex items-center gap-3">
                {kind === 'person' ? (
                  <UserAvatar userId={r.ref?.id} name={name} showMood={false} className="size-8 shrink-0 text-[10px] ring-0" />
                ) : (
                  <span aria-hidden className="sf-chip grid size-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold">
                    {initials(name)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    {kind === 'company' && r.ref ? (
                      <Link href={`/app/companies/${r.ref.id}`} className="truncate text-sm font-medium hover:text-primary hover:underline" title={name}>
                        {name}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium" title={name}>{name}</span>
                    )}
                    <span className="shrink-0 text-xs font-semibold tabular-nums">{money(r.open.value)}</span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="sf-bar h-full" style={{ width: `${(r.open.value / max) * 100}%` }} />
                    <span className="h-full bg-success" style={{ width: `${(r.won.value / max) * 100}%`, marginInlineStart: r.open.value && r.won.value ? 2 : 0 }} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t('{open} open · {won} won ({value}) · {lost} lost', { open: r.open.count, won: r.won.count, value: money(r.won.value), lost: r.lost })}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5" style={tone(colour)}><span className="sf-bar size-2.5 rounded-sm" /> {t('Open value')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success" /> {t('Won value')}</span>
      </p>
    </Panel>
  );
}

function Upcoming({ s, money, onOpen }: { s: DealsSummary; money: (v: number) => string; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <Panel title="Upcoming closing dates" icon={CalendarClock} colour={C.orange} aside={<span className="text-xs text-muted-foreground">{t('Next 30 days')}</span>}>
      {s.upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No open deals are expected to close in the next 30 days.')}</p>
      ) : (
        <ol className="space-y-2" aria-label={t('Upcoming closing dates')}>
          {s.upcoming.map((d) => {
            const date = new Date(`${d.expectedCloseDate}T12:00:00`);
            return (
              <li key={d.id}>
                <button type="button" onClick={() => onOpen(d.id)} className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-start transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="sf-chip grid w-12 shrink-0 place-items-center rounded-lg py-1 text-center leading-tight" style={tone(C.orange)}>
                    <span className="text-[10px] font-semibold uppercase">{date.toLocaleDateString(t.formatLocale, { month: 'short' })}</span>
                    <span className="text-lg font-bold tabular-nums">{date.getDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[d.company?.name, d.stage, d.owner?.name].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{money(d.amount)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('{count} open deals worth {value} close in the next 30 days.', { count: s.closingNext30Days.count, value: money(s.closingNext30Days.value) })}</p>
    </Panel>
  );
}

function Attention({ s, money }: { s: DealsSummary; money: (v: number) => string }) {
  const t = useT();
  const total = Math.max(1, s.open.count);
  const parts = [
    { key: 'HIGH', label: 'High' as MessageKey, n: s.priorities.HIGH, colour: LOST_COLOUR },
    { key: 'MEDIUM', label: 'Medium' as MessageKey, n: s.priorities.MEDIUM, colour: C.yellow },
    { key: 'LOW', label: 'Low' as MessageKey, n: s.priorities.LOW, colour: C.blue },
    { key: 'NONE', label: 'Not set' as MessageKey, n: s.priorities.NONE, colour: C.slate },
  ];
  const rows: { icon: LucideIcon; colour: string; label: MessageKey; value: string; hint: string }[] = [
    { icon: AlarmClock, colour: LOST_COLOUR, label: 'Past their close date', value: String(s.overdue.count), hint: money(s.overdue.value) },
    { icon: Hourglass, colour: C.orange, label: 'Untouched for 14 days', value: String(s.stalled), hint: t('Open deals nobody changed') },
    { icon: CalendarClock, colour: C.slate, label: 'No close date', value: String(s.noCloseDate), hint: t('Add one so they show in the forecast') },
  ];
  return (
    <Panel title="Needs attention" icon={Gauge} colour={LOST_COLOUR}>
      <ul className="grid gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <li key={r.label} className="sf-kpi flex-col gap-2 p-3" style={tone(r.colour)}>
            <Icon3D icon={r.icon} colour={r.colour} size="sm" />
            <span className="text-2xl font-bold tabular-nums leading-none">{r.value}</span>
            <span className="text-xs font-medium">{t(r.label)}</span>
            <span className="truncate text-xs text-muted-foreground" title={r.hint}>{r.hint}</span>
          </li>
        ))}
      </ul>
      <h4 className="mb-2 mt-4 text-xs font-semibold text-muted-foreground">{t('Open deals by priority')}</h4>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {parts.filter((p) => p.n > 0).map((p) => (
          <span key={p.key} className="sf-bar h-full first:rounded-s-full last:rounded-e-full" style={{ ...tone(p.colour), width: `${(p.n / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t('Open deals by priority')}>
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5" style={tone(p.colour)}>
            <span aria-hidden className="sf-bar size-2.5 rounded-sm" />
            {t(p.label)} <span className="font-semibold tabular-nums">{p.n}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
