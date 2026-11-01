'use client';

import { Button, Card, cn, Input, Skeleton } from '@dealflow/ui';
import type { DealRow } from '@dealflow/types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDate, formatMoney, useRecordList } from '@/lib/crm';
import { type DealViewFilter, useDealForecast, useDealsClosing, usePriorityDeals, ymd } from '@/lib/deal-views';
import { useIsPhone } from '@/lib/use-is-phone';
import { initials, PriorityBadge, RiskIndicator } from './deal-badges';
import { DealPanel } from './deal-panel';
import { fmtLocale } from '@/lib/i18n/locale';

type Open = (id: string) => void;

function Loading() {
  return <Skeleton className="h-80" aria-label="Loading deals" />;
}
function Failed({ error }: { error: Error }) {
  return (
    <p role="alert" className="text-sm text-critical">
      {error.message}
    </p>
  );
}

/** Opens the deal in the side panel; a real link underneath so it can also be opened in a new tab. */
export function DealLink({ deal, onOpen, className }: { deal: Pick<DealRow, 'id' | 'name'>; onOpen: Open; className?: string }) {
  return (
    <a
      href={`/app/deals/${deal.id}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(deal.id);
      }}
      className={cn('font-medium hover:text-primary hover:underline', className)}
    >
      {deal.name}
    </a>
  );
}

function Owner({ deal }: { deal: DealRow }) {
  if (!deal.owner) return <span className="text-xs text-muted-foreground">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="grid size-5 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary" aria-hidden>
        {initials(deal.owner.name)}
      </span>
      {deal.owner.name}
    </span>
  );
}

// ───────────── Priority ─────────────

export function PriorityView({ filter, onOpen }: { filter: DealViewFilter; onOpen: Open }) {
  const q = usePriorityDeals(filter);
  if (q.isPending) return <Loading />;
  if (q.error) return <Failed error={q.error} />;
  return (
    <section aria-labelledby="priority-heading" className="space-y-3">
      <div>
        <h2 id="priority-heading" className="text-base font-semibold">
          Where to focus
        </h2>
        <p className="text-sm text-muted-foreground">
          Open deals ranked by health risk, how close (or overdue) the close date is, size, and the priority your team set. Each card says why it is here.
        </p>
      </div>
      {q.data.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No open deals to rank.</Card>
      ) : (
        <ol className="space-y-2" aria-label="Deals by priority">
          {q.data.map(({ deal, reasons }, i) => (
            <li key={deal.id}>
              <Card className="flex flex-wrap items-start gap-3 p-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold tabular" aria-label={`Rank ${i + 1}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DealLink deal={deal} onOpen={onOpen} />
                    <PriorityBadge priority={deal.priority} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {deal.company?.name ?? 'No company'} · {deal.stage.name} · {deal.expectedCloseDate ? `close ${formatDate(deal.expectedCloseDate)}` : 'no close date'}
                  </p>
                  <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Reasons">
                    {reasons.map((r) => (
                      <li key={r} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="tabular text-sm font-semibold">{formatMoney(deal.amount, deal.currency)}</span>
                  <RiskIndicator health={deal.health} />
                  <Owner deal={deal} />
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ───────────── Forecast ─────────────

export function ForecastView({ filter, onOpen }: { filter: DealViewFilter; onOpen: Open }) {
  const q = useDealForecast(filter);
  if (q.isPending) return <Loading />;
  if (q.error) return <Failed error={q.error} />;
  const { buckets, currency } = q.data;
  const money = (v: number) => formatMoney(v, currency);
  const total = buckets.reduce((s, b) => s + b.value, 0);
  const weighted = buckets.reduce((s, b) => s + b.weighted, 0);
  const shown = buckets.filter((b) => b.count > 0 || /^\d{4}-\d{2}$/.test(b.key));
  return (
    <section aria-labelledby="forecast-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="forecast-heading" className="text-base font-semibold">
            Open deals by expected close
          </h2>
          <p className="text-sm text-muted-foreground">Weighted value is the amount times each deal’s probability. Overdue and undated deals are kept apart so they get fixed.</p>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Open </span>
          <span className="tabular font-semibold">{money(total)}</span>
          <span className="text-muted-foreground"> · weighted </span>
          <span className="tabular font-semibold">{money(weighted)}</span>
        </p>
      </div>
      <div className="overflow-x-auto pb-2" role="region" aria-label="Forecast columns" tabIndex={0}>
        <ul className="flex gap-3">
          {shown.map((b) => (
            <li key={b.key} className="w-64 shrink-0">
              <section aria-labelledby={`fc-${b.key}`} className={cn('flex h-full flex-col rounded-lg border bg-muted/30', b.key === 'overdue' && b.count ? 'border-critical/50' : 'border-border')}>
                <header className="border-b border-border p-3">
                  <h3 id={`fc-${b.key}`} className={cn('text-sm font-semibold', b.key === 'overdue' && b.count && 'text-critical')}>
                    {b.label}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {b.count} {b.count === 1 ? 'deal' : 'deals'} · {money(b.value)} · weighted {money(b.weighted)}
                  </p>
                </header>
                <ul className="flex flex-1 flex-col gap-2 p-2" aria-label={`Deals closing ${b.label}`}>
                  {b.deals.map((d) => (
                    <li key={d.id} className="rounded-md border border-border bg-surface p-2.5 text-sm">
                      <DealLink deal={d} onOpen={onOpen} className="block truncate" />
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="tabular">{formatMoney(d.amount, d.currency)}</span>
                        <span>{d.expectedCloseDate ? formatDate(d.expectedCloseDate) : d.stage.name}</span>
                      </div>
                    </li>
                  ))}
                  {b.count === 0 && <li className="px-2 py-4 text-center text-xs text-muted-foreground">Nothing expected</li>}
                  {b.count > b.deals.length && <li className="px-2 text-center text-xs text-muted-foreground">and {b.count - b.deals.length} more</li>}
                </ul>
              </section>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ───────────── Calendar ─────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarView({ filter, onOpen }: { filter: DealViewFilter; onOpen: Open }) {
  const phone = useIsPhone();
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const q = useDealsClosing({ ...filter, from: ymd(month), to: ymd(last) });
  const byDay = useMemo(() => {
    const m = new Map<string, DealRow[]>();
    for (const d of q.data?.items ?? []) m.set(d.expectedCloseDate!, [...(m.get(d.expectedCloseDate!) ?? []), d]);
    return m;
  }, [q.data]);
  const title = month.toLocaleDateString(fmtLocale(), { month: 'long', year: 'numeric' });
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const lead = (month.getDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: Math.ceil((lead + last.getDate()) / 7) * 7 }, (_, i) => {
    const day = i - lead + 1;
    return day >= 1 && day <= last.getDate() ? new Date(month.getFullYear(), month.getMonth(), day) : null;
  });
  const today = ymd(new Date());
  const items = q.data?.items ?? [];
  const value = items.reduce((s, d) => s + d.amount, 0);

  return (
    <section aria-labelledby="cal-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="rtl:-scale-x-100" aria-hidden />
          </Button>
          <h2 id="cal-heading" className="min-w-40 text-center text-base font-semibold" aria-live="polite">
            {title}
          </h2>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {items.length} open {items.length === 1 ? 'deal' : 'deals'} expected to close · {formatMoney(value, items[0]?.currency ?? 'USD')}
          {q.data && q.data.total > items.length ? ` (first ${items.length} of ${q.data.total})` : ''}
        </p>
      </div>
      {q.error ? (
        <Failed error={q.error} />
      ) : q.isPending ? (
        <Loading />
      ) : phone ? (
        <ol className="space-y-2" aria-label={`Deals closing in ${title}`}>
          {[...byDay.entries()].map(([day, deals]) => (
            <li key={day}>
              <Card className="p-3">
                <h3 className="text-sm font-semibold">{formatDate(day)}</h3>
                <ul className="mt-1 space-y-1">
                  {deals.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2 text-sm">
                      <DealLink deal={d} onOpen={onOpen} className="truncate" />
                      <span className="tabular text-muted-foreground">{formatMoney(d.amount, d.currency)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
          {byDay.size === 0 && <li className="py-6 text-center text-sm text-muted-foreground">No open deals are expected to close this month.</li>}
        </ol>
      ) : (
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Open deals by expected close date, {title}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((w) => (
                <th key={w} scope="col" className="pb-1 text-start text-xs font-medium text-muted-foreground">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: cells.length / 7 }, (_, r) => (
              <tr key={r}>
                {cells.slice(r * 7, r * 7 + 7).map((c, i) => {
                  const key = c ? ymd(c) : `x${r}-${i}`;
                  const deals = c ? (byDay.get(ymd(c)) ?? []) : [];
                  return (
                    <td key={key} className={cn('h-28 border border-border p-1 align-top', !c && 'bg-muted/20', c && ymd(c) === today && 'bg-primary/5')}>
                      {c && (
                        <>
                          <span className={cn('text-xs', ymd(c) === today ? 'font-semibold text-primary' : 'text-muted-foreground')} aria-label={c.toLocaleDateString(fmtLocale(), { weekday: 'long', month: 'long', day: 'numeric' })}>
                            {c.getDate()}
                          </span>
                          <ul className="mt-0.5 space-y-0.5">
                            {deals.slice(0, 3).map((d) => (
                              <li key={d.id} className="truncate rounded bg-primary/10 px-1 py-0.5 text-xs">
                                <DealLink deal={d} onOpen={onOpen} />
                              </li>
                            ))}
                            {deals.length > 3 && <li className="px-1 text-xs text-muted-foreground">+{deals.length - 3} more</li>}
                          </ul>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ───────────── Timeline ─────────────

const DAY = 86_400_000;

export function TimelineView({ filter, onOpen }: { filter: DealViewFilter; onOpen: Open }) {
  const [start] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 14);
  });
  const end = new Date(start.getTime() + 120 * DAY);
  const q = useDealsClosing({ ...filter, from: ymd(start), to: ymd(end) });
  const span = end.getTime() - start.getTime();
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - start.getTime()) / span) * 100));
  const months = Array.from({ length: 5 }, (_, i) => new Date(start.getFullYear(), start.getMonth() + i + 1, 1)).filter((m) => m < end);
  const todayPct = pos(Date.now());

  if (q.isPending) return <Loading />;
  if (q.error) return <Failed error={q.error} />;
  const deals = q.data.items;
  return (
    <section aria-labelledby="tl-heading" className="space-y-3">
      <div>
        <h2 id="tl-heading" className="text-base font-semibold">
          Timeline to close
        </h2>
        <p className="text-sm text-muted-foreground">
          Each bar runs from when the deal was opened to its expected close; red bars run from a missed close date to today. Open deals closing between {formatDate(ymd(start))} and {formatDate(ymd(end))}.
        </p>
      </div>
      {deals.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No open deals are expected to close in this window. Deals without a close date do not appear here.</Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          <div className="min-w-[640px]">
            <div className="relative ms-48 h-6 border-b border-border text-xs text-muted-foreground" aria-hidden>
              {months.map((m) => (
                <span key={m.toISOString()} className="absolute -translate-x-1/2" style={{ left: `${pos(m.getTime())}%` }}>
                  {m.toLocaleDateString(fmtLocale(), { month: 'short' })}
                </span>
              ))}
            </div>
            <ol aria-label="Deals by expected close" className="relative">
              <span className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary" style={{ left: `calc(12rem + (100% - 12rem) * ${todayPct / 100})` }} aria-hidden />
              {deals.map((d) => {
                const close = new Date(`${d.expectedCloseDate}T12:00:00`).getTime();
                const overdue = d.expectedCloseDate! < ymd(new Date());
                // Overdue deals show how far past their close date they are (close date to today) in red.
                const from = pos(overdue ? close : Math.min(new Date(d.createdAt).getTime(), close));
                const to = pos(overdue ? Date.now() : close);
                return (
                  <li key={d.id} className="flex h-9 items-center border-b border-border/50 last:border-0">
                    <div className="w-48 shrink-0 truncate pe-3 text-sm">
                      <DealLink deal={d} onOpen={onOpen} />
                    </div>
                    <div className="relative h-5 flex-1">
                      <div
                        className={cn('absolute inset-y-0 rounded-full', overdue ? 'bg-critical/70' : 'bg-gradient-to-r from-primary/40 to-primary')}
                        style={{ left: `${from}%`, width: `${Math.max(1.5, to - from)}%` }}
                        title={`${formatMoney(d.amount, d.currency)} · close ${formatDate(d.expectedCloseDate)}`}
                      />
                      <span className="sr-only">
                        {formatMoney(d.amount, d.currency)}, {d.stage.name}, expected close {formatDate(d.expectedCloseDate)}
                        {overdue ? ', overdue' : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </Card>
      )}
      {q.data.total > deals.length && <p className="text-xs text-muted-foreground">Showing the first {deals.length} of {q.data.total} deals.</p>}
    </section>
  );
}

// ───────────── Split screen ─────────────

export function SplitView({ filter, selected, onOpen }: { filter: DealViewFilter; selected: string | null; onOpen: Open }) {
  const [q, setQ] = useState('');
  const list = useRecordList<DealRow>('deals', { q: q || undefined, pipelineId: filter.pipelineId, ownerId: filter.ownerId, sort: '-updatedAt', pageSize: 50 });
  const rows = list.data?.items ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(240px,320px)_1fr]">
      <Card className="flex max-h-[calc(100vh-12rem)] flex-col overflow-hidden">
        <div className="border-b border-border p-2">
          <label htmlFor="split-search" className="sr-only">
            Search deals
          </label>
          <Input id="split-search" placeholder="Search deals" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.error ? (
          <div className="p-3">
            <Failed error={list.error} />
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto" aria-label="Deals">
            {rows.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onOpen(d.id)}
                  aria-current={selected === d.id ? 'true' : undefined}
                  className={cn('w-full border-b border-border px-3 py-2.5 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected === d.id && 'bg-primary/10')}
                >
                  <span className="block truncate text-sm font-medium">{d.name}</span>
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="tabular">{formatMoney(d.amount, d.currency)}</span>
                    <span className="truncate">{d.stage.name}</span>
                  </span>
                </button>
              </li>
            ))}
            {list.isPending && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
            {!list.isPending && rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">No deals match.</li>}
          </ul>
        )}
      </Card>
      <Card className="hidden min-h-[60vh] overflow-hidden p-0 md:block" aria-label="Selected deal" role="region">
        {selected ? <DealPanel key={selected} id={selected} /> : <p className="p-8 text-center text-sm text-muted-foreground">Choose a deal on the left to work on it here.</p>}
      </Card>
    </div>
  );
}
