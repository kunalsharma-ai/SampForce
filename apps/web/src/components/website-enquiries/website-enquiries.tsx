'use client';

import {
  ENQUIRY_CATEGORY_LABELS,
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_STATUSES,
  ENQUIRY_TYPE_LABELS,
  type EnquiryCount,
  type EnquiryRow,
  type EnquirySummary,
  type EnquiryType,
  type EnquiryView,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, cn, Input, Skeleton } from '@dealflow/ui';
import {
  BellRing,
  CheckCheck,
  Inbox,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { InfoTip } from '@/components/info-tip';
import { Select } from '@/components/crm/select';
import { relativeTime } from '@/lib/format';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { type EnquiryFilters, flagOf, initialsOf, NO_FILTERS, useEnquiries, useEnquiryMutations, useEnquirySummary } from '@/lib/website-enquiries';
import { EnquirySheet } from './enquiry-sheet';
import { NewPill, STATUS_TONE, TYPE_STYLE } from './enquiry-style';

const VIEWS: { value: EnquiryView; label: MessageKey }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'open', label: 'Open' },
  { value: 'starred', label: 'Starred' },
  { value: 'converted', label: 'Converted' },
];

const PAGE = 30;

function readFilters(p: URLSearchParams): EnquiryFilters {
  const list = (k: string) => (p.get(k) ?? '').split(',').filter(Boolean);
  const view = p.get('view');
  return {
    view: VIEWS.some((v) => v.value === view) ? (view as EnquiryView) : 'all',
    q: p.get('q') ?? '',
    status: list('status'),
    type: list('type'),
    category: list('category'),
    form: p.get('form') ?? '',
  };
}

/**
 * The Website Enquiry section (ADR 0095): everything the company website receives (enquiry and download forms, live
 * chat enquirys, newsletter sign-ups and reviews) the moment it arrives, with counts by type, category and form, a list
 * to work through, and a panel to follow each one up and convert it into a company and employee.
 */
export function WebsiteEnquiryWorkspace() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = readFilters(params);
  const openId = params.get('open');
  const [limit, setLimit] = React.useState(PAGE);
  const [search, setSearch] = React.useState(filters.q);
  const summary = useEnquirySummary();
  const list = useEnquiries(filters, limit);

  const go = React.useCallback(
    (next: Partial<EnquiryFilters> & { open?: string | null }) => {
      const f = { ...readFilters(params), ...next };
      const qs = new URLSearchParams();
      if (f.view !== 'all') qs.set('view', f.view);
      if (f.q) qs.set('q', f.q);
      for (const k of ['status', 'type', 'category'] as const) if (f[k].length) qs.set(k, f[k].join(','));
      if (f.form) qs.set('form', f.form);
      const open = 'open' in next ? next.open : params.get('open');
      if (open) qs.set('open', open);
      router.replace(`${pathname}${qs.size ? `?${qs}` : ''}`, { scroll: false });
      if (!('open' in next)) setLimit(PAGE);
    },
    [params, pathname, router],
  );

  // Typing waits a moment before searching.
  React.useEffect(() => {
    if (search === filters.q) return;
    const id = setTimeout(() => go({ q: search }), 300);
    return () => clearTimeout(id);
  }, [search, filters.q, go]);

  const toggle = (k: 'type' | 'category', key: string) => go({ [k]: filters[k].includes(key) ? filters[k].filter((x) => x !== key) : [...filters[k], key] });
  const filtered = filters.q || filters.status.length || filters.type.length || filters.category.length || filters.form;

  if (summary.isPending) return <Skeleton className="h-96" />;
  if (summary.isError || !summary.data) return <p className="text-sm text-critical">{summary.error?.message ?? t('Could not load website enquiries.')}</p>;
  const s = summary.data;

  return (
    <div className="space-y-6">
      <Hero summary={s} onOpen={(id) => go({ open: id })} />
      <TypeTiles counts={s.byType} active={filters.type} onToggle={(k) => toggle('type', k)} />
      <div className="grid gap-4 lg:grid-cols-5">
        <TrendCard summary={s} className="lg:col-span-3" />
        <FormsCard forms={s.byForm} active={filters.form} onPick={(f) => go({ form: filters.form === f ? '' : f })} className="lg:col-span-2" />
      </div>

      <section aria-labelledby="enquiry-list-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h2 id="enquiry-list-title" className="text-lg font-semibold">
              {t('All enquiries')}
            </h2>
            <InfoTip topic="enquiries.convert" />
          </div>
          <div role="tablist" aria-label={t('Views')} className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={filters.view === v.value}
                onClick={() => go({ view: v.value })}
                className={cn('rounded-md px-3 py-1 text-sm font-medium transition-colors', filters.view === v.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {t(v.label)}
                {v.value === 'unread' && s.unread > 0 && <span className="ms-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{s.unread}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Name, email, company, message…')} aria-label={t('Search enquiries')} className="ps-8" />
          </div>
          <Select aria-label={t('Status')} value={filters.status[0] ?? ''} onChange={(e) => go({ status: e.target.value ? [e.target.value] : [] })} className="w-44">
            <option value="">{t('Every status')}</option>
            {ENQUIRY_STATUSES.map((k) => (
              <option key={k} value={k}>
                {t.maybe(ENQUIRY_STATUS_LABELS[k])}
              </option>
            ))}
          </Select>
          <Select aria-label={t('Category')} value={filters.category.length === 1 ? filters.category[0] : ''} onChange={(e) => go({ category: e.target.value ? [e.target.value] : [] })} className="w-44">
            <option value="">{t('Every category')}</option>
            {s.byCategory
              .filter((c) => c.count > 0)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {t.maybe(ENQUIRY_CATEGORY_LABELS[c.key])} ({c.count})
                </option>
              ))}
          </Select>
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                go({ ...NO_FILTERS, view: filters.view });
              }}
            >
              <X aria-hidden />
              {t('Clear filters')}
            </Button>
          ) : null}
        </div>
        {(filters.type.length > 0 || filters.form) && (
          <div className="flex flex-wrap gap-2" aria-label={t('Active filters')}>
            {filters.type.map((k) => (
              <Chip key={k} label={t.maybe(ENQUIRY_TYPE_LABELS[k as EnquiryType] ?? k)} onRemove={() => toggle('type', k)} />
            ))}
            {filters.form && <Chip label={filters.form} onRemove={() => go({ form: '' })} />}
          </div>
        )}

        {list.isPending ? (
          <Skeleton className="h-64" />
        ) : list.isError ? (
          <p className="text-sm text-critical">{list.error.message}</p>
        ) : list.data.items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Inbox className="size-8 text-muted-foreground" aria-hidden />
              <p className="font-medium">{filtered || filters.view !== 'all' ? t('No enquiries match these filters.') : t('No website enquiries yet.')}</p>
              {!filtered && filters.view === 'all' && <p className="max-w-md text-sm text-muted-foreground">{t('They appear here the moment someone fills in a form, starts a chat, subscribes or leaves a review on the website.')}</p>}
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('Showing {shown} of {total}', { shown: list.data.items.length, total: list.data.total })}
            </p>
            <ul className="space-y-2" aria-label={t('Website enquiries')}>
              {list.data.items.map((r) => (
                <EnquiryCard key={r.id} row={r} onOpen={() => go({ open: r.id })} />
              ))}
            </ul>
            {list.data.items.length < list.data.total && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => setLimit((n) => Math.min(n + PAGE, 200))} disabled={limit >= 200}>
                  {t('Show more')}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <EnquirySheet id={openId} onClose={() => go({ open: null })} />
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pe-1 ps-3 text-sm">
      {label}
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-primary/20" aria-label={t('Remove filter {name}', { name: label })}>
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/** The top of the page: live status, the unread count that glows, the day's numbers and the newest arrivals. */
function Hero({ summary: s, onOpen }: { summary: EnquirySummary; onOpen: (id: string) => void }) {
  const t = useT();
  const canWrite = useCan('enquiries:write');
  const m = useEnquiryMutations();
  const [said, setSaid] = React.useState<string | null>(null);
  const live = s.connected && s.sync.configured;
  const lastHeard = [s.sync.lastDelivery?.at, s.sync.lastPull?.at].filter(Boolean).sort().at(-1) ?? null;
  return (
    <section aria-labelledby="enquiry-hero-title" className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-background to-accent/15 p-5 shadow-sm sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -end-16 -top-20 size-64 rounded-full bg-primary/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 start-1/3 size-64 rounded-full bg-accent/20 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1', live ? 'bg-emerald-500/15 text-emerald-800 ring-emerald-500/40 dark:text-emerald-200' : 'bg-amber-500/15 text-amber-800 ring-amber-500/40 dark:text-amber-200')}>
              <span className="relative flex size-2.5" aria-hidden>
                {live && <span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-75 motion-safe:animate-ping" />}
                <span className={cn('relative inline-flex size-2.5 rounded-full', live ? 'bg-emerald-500' : 'bg-amber-500')} />
              </span>
              {live ? t('Live from your website') : t('Not connected to the website yet')}
            </span>
            <InfoTip topic="enquiries.sync" />
          </div>
          <h2 id="enquiry-hero-title" className="flex items-baseline gap-3 text-3xl font-bold tracking-tight sm:text-4xl">
            <span className={cn('tabular-nums', s.unread > 0 && 'bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent drop-shadow-[0_0_18px_hsl(var(--primary)/0.45)]')}>{s.unread}</span>
            <span className="text-lg font-semibold text-foreground sm:text-xl">{s.unread === 1 ? t('new enquiry waiting') : t('new enquiries waiting')}</span>
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {live
              ? lastHeard
                ? t('Last heard from the website {when}.', { when: relativeTime(lastHeard) })
                : t('Waiting for the first enquiry from the website.')
              : t('A platform admin connects the website in the Console under Providers > Website enquiries. Until then nothing arrives here.')}
            {s.sync.lastPull && !s.sync.lastPull.ok && <span className="block text-critical">{t('The last sync failed: {reason}', { reason: s.sync.lastPull.message })}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.unread > 0 && (
            <Button variant="outline" onClick={() => m.seenAll.mutate()} disabled={m.seenAll.isPending}>
              <CheckCheck aria-hidden />
              {t('Mark all as read')}
            </Button>
          )}
          {canWrite && live && (
            <Button
              onClick={() =>
                m.sync.mutate(undefined, {
                  onSuccess: (r) => setSaid(r.ran ? (r.received ? t('{count} new from the website.', { count: r.received }) : t('Up to date.')) : r.message),
                  onError: (e) => setSaid(e.message),
                })
              }
              disabled={m.sync.isPending}
            >
              <RefreshCw className={cn(m.sync.isPending && 'motion-safe:animate-spin')} aria-hidden />
              {m.sync.isPending ? t('Syncing…') : t('Sync now')}
            </Button>
          )}
        </div>
      </div>
      {said && (
        <p role="status" className="relative mt-2 text-sm font-medium">
          {said}
        </p>
      )}

      <dl className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={t('Today')} value={s.today} icon={BellRing} glow={s.today > 0} />
        <Kpi label={t('This week')} value={s.week} icon={TrendingUp} />
        <Kpi label={t('All time')} value={s.total} icon={Inbox} />
        <Kpi label={t('Converted')} value={s.converted} icon={Sparkles} hint={s.conversionRate !== null ? t('{rate}% of enquiries', { rate: s.conversionRate }) : undefined} />
        <Kpi label={t('Average rating')} value={s.averageRating !== null ? s.averageRating.toFixed(1) : '–'} icon={Star} hint={s.averageRating !== null ? '★'.repeat(Math.round(s.averageRating)) : t('No reviews yet')} />
      </dl>

      {s.latest.length > 0 && (
        <div className="relative mt-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Radio className="size-4 text-primary" aria-hidden />
            {t('Just in')}
          </h3>
          <ul className="flex gap-3 overflow-x-auto pb-1">
            {s.latest.map((r) => {
              const st = TYPE_STYLE[r.type];
              return (
                <li key={r.id} className="w-64 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className="group flex h-full w-full flex-col gap-1 rounded-xl border border-primary/40 bg-background/80 p-3 text-start shadow-[0_0_0_1px_hsl(var(--primary)/0.15),0_8px_24px_-12px_hsl(var(--primary)/0.6)] transition hover:-translate-y-0.5 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', st.text)}>
                        <st.icon className="size-3.5" aria-hidden />
                        {r.form.name ?? t.maybe(ENQUIRY_TYPE_LABELS[r.type])}
                      </span>
                      <NewPill />
                    </span>
                    <span className="truncate font-semibold">{r.name ?? r.email ?? t('Someone')}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{r.message ?? r.resource ?? r.service ?? r.company ?? ''}</span>
                    <span className="mt-auto text-xs text-muted-foreground">{relativeTime(r.submittedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, icon: Icon, hint, glow }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; hint?: string; glow?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-background/70 p-3 backdrop-blur', glow ? 'border-primary/50 shadow-[0_0_24px_-8px_hsl(var(--primary)/0.7)]' : 'border-border')}>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** One tile per kind of arrival; pressing one filters the list to it. */
function TypeTiles({ counts, active, onToggle }: { counts: EnquiryCount<EnquiryType>[]; active: string[]; onToggle: (k: EnquiryType) => void }) {
  const t = useT();
  return (
    <section aria-labelledby="enquiry-types-title">
      <h2 id="enquiry-types-title" className="sr-only">
        {t('By type')}
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {counts.map((c) => {
          const st = TYPE_STYLE[c.key];
          const on = active.includes(c.key);
          return (
            <li key={c.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(c.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-start transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'border-primary ring-2 ring-primary/40' : 'border-border',
                )}
              >
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white shadow-sm', st.tile)}>
                  <st.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xl font-bold leading-tight tabular-nums">{c.count}</span>
                  <span className="block text-xs leading-tight text-muted-foreground">{t.maybe(c.label)}</span>
                  {c.unread > 0 && <span className={cn('block text-xs font-semibold', st.text)}>{t('{count} new', { count: c.unread })}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Arrivals over the last 14 days, as bars, with the categories underneath. */
function TrendCard({ summary: s, className }: { summary: EnquirySummary; className?: string }) {
  const t = useT();
  const max = Math.max(1, ...s.daily.map((d) => d.count));
  const cats = s.byCategory.filter((c) => c.count > 0);
  const catMax = Math.max(1, ...cats.map((c) => c.count));
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(t.formatLocale, { day: 'numeric', month: 'short' });
  return (
    <Card className={className}>
      <CardContent className="space-y-5 p-5">
        <div>
          <h2 className="text-sm font-semibold">{t('Last 14 days')}</h2>
          <div role="img" aria-label={t('Enquiries per day for the last 14 days: {list}', { list: s.daily.map((d) => `${day(d.day)} ${d.count}`).join(', ') })} className="mt-3 flex h-32 items-end gap-1.5">
            {s.daily.map((d, i) => (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-muted-foreground">{d.count || ''}</span>
                <div
                  className={cn('w-full rounded-t-md bg-gradient-to-t', i === s.daily.length - 1 ? 'from-primary to-accent' : 'from-primary/60 to-primary/30')}
                  style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" aria-hidden>
            <span>{s.daily[0] ? day(s.daily[0].day) : ''}</span>
            <span>{t('Today')}</span>
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold">{t('By category')}</h2>
          {cats.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('Nothing yet.')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {cats.map((c) => (
                <li key={c.key} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-sm">
                  <span className="truncate">{t.maybe(ENQUIRY_CATEGORY_LABELS[c.key])}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${(c.count / catMax) * 100}%` }} />
                  </span>
                  <span className="text-end tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FormsCard({ forms, active, onPick, className }: { forms: EnquiryCount[]; active: string; onPick: (form: string) => void; className?: string }) {
  const t = useT();
  const max = Math.max(1, ...forms.map((f) => f.count));
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold">{t('By form')}</h2>
        {forms.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('Nothing yet.')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {forms.map((f) => (
              <li key={f.key}>
                <button
                  type="button"
                  aria-pressed={active === f.label}
                  onClick={() => onPick(f.label)}
                  className={cn('w-full rounded-lg p-2 text-start transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active === f.label && 'bg-primary/10 ring-1 ring-primary/40')}
                >
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{t.maybe(f.label)}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      {f.unread > 0 && <Badge tone="primary">{t('{count} new', { count: f.unread })}</Badge>}
                      {f.count}
                    </span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-gradient-to-r from-accent to-primary" style={{ width: `${(f.count / max) * 100}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** One row of the list: who, what they asked, when, and whether anyone has looked at it yet. */
function EnquiryCard({ row: r, onOpen }: { row: EnquiryRow; onOpen: () => void }) {
  const t = useT();
  const st = TYPE_STYLE[r.type];
  const m = useEnquiryMutations();
  const canWrite = useCan('enquiries:write');
  const snippet = r.message ?? (r.resource ? t('Downloaded {name}', { name: r.resource }) : r.service) ?? '';
  return (
    <li className={cn('group relative flex items-stretch overflow-hidden rounded-xl border bg-card transition hover:shadow-md', r.unread ? 'border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.2),0_10px_30px_-18px_hsl(var(--primary)/0.8)]' : 'border-border')}>
      <span aria-hidden className={cn('w-1.5 shrink-0', st.bar)} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-bold text-white', st.tile)} aria-hidden>
          {initialsOf(r.name, r.email)}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn('truncate', r.unread ? 'font-bold' : 'font-medium')}>{r.name ?? r.email ?? t('Someone')}</span>
            {r.unread && <NewPill />}
            {r.company && <span className="truncate text-sm text-muted-foreground">· {r.company}</span>}
            {r.countryCode && (
              <span className="text-sm" title={r.country ?? undefined}>
                <span aria-hidden>{flagOf(r.countryCode)}</span>
                <span className="sr-only">{r.country ?? r.countryCode}</span>
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={cn('inline-flex items-center gap-1 font-semibold', st.text)}>
              <st.icon className="size-3.5" aria-hidden />
              {r.form.name ?? t.maybe(ENQUIRY_TYPE_LABELS[r.type])}
            </span>
            {r.category === 'rfq' && <Badge tone="warning">{t('RFQ')}</Badge>}
            {r.rating !== null && <span className="text-yellow-700 dark:text-yellow-300" aria-label={t('{rating} out of 5', { rating: r.rating })}>{'★'.repeat(r.rating)}</span>}
            {r.converted && <Badge tone="success">{t('Converted')}</Badge>}
            {r.assignee && <span className="text-muted-foreground">{t('Owner: {name}', { name: r.assignee.name })}</span>}
          </span>
          {snippet && <span className="line-clamp-1 block text-sm text-muted-foreground">{snippet}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold ring-1', STATUS_TONE[r.status])}>{t.maybe(ENQUIRY_STATUS_LABELS[r.status])}</span>
          <time dateTime={r.submittedAt} className="text-xs text-muted-foreground">
            {relativeTime(r.submittedAt)}
          </time>
        </span>
      </button>
      {canWrite && (
        <button
          type="button"
          aria-pressed={r.starred}
          aria-label={r.starred ? t('Remove star from {name}', { name: r.name ?? r.email ?? '' }) : t('Star {name}', { name: r.name ?? r.email ?? '' })}
          onClick={() => m.update.mutate({ id: r.id, body: { starred: !r.starred } })}
          className="grid w-10 shrink-0 place-items-center text-muted-foreground hover:text-yellow-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Star className={cn('size-4', r.starred && 'fill-yellow-400 text-yellow-500')} aria-hidden />
        </button>
      )}
    </li>
  );
}
