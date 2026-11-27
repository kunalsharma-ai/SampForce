'use client';

import { CALL_OUTCOME_LABELS, CALL_OUTCOMES, CALL_REACHED, CALL_WINDOW_LABELS, type CallDetails, type CallOutcome, type CallRow, type CallTarget, type CallWindow } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  Clock,
  Delete as Backspace,
  History,
  Mail,
  Pencil,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Search,
  Timer,
  UserRound,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { MyDialers } from '@/components/calls/dialer-settings';
import { CompanyLogo } from '@/components/crm/company-logo';
import { formatDateTime } from '@/components/crm/follow-ups';
import { Select, Textarea } from '@/components/crm/select';
import { openDialer, talkTime, useCall, useCallDetails, useCallMutations, useCalls, useCallSearch, useCallStats, useDialers } from '@/lib/calls';
import { fromLocalInput, toLocalInput, useFollowUps } from '@/lib/company-work';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

type Target = { companyId: string | null; contactId: string | null };

/** Each outcome's own colour, so the history reads at a glance. */
const OUTCOME_TONE: Record<CallOutcome, string> = {
  CONNECTED: 'bg-emerald-500 text-white',
  CALL_BACK: 'bg-sky-500 text-white',
  NOT_INTERESTED: 'bg-slate-500 text-white',
  NO_ANSWER: 'bg-amber-500 text-white',
  BUSY: 'bg-orange-500 text-white',
  VOICEMAIL: 'bg-violet-500 text-white',
  WRONG_NUMBER: 'bg-rose-500 text-white',
};
const WINDOW_TONE: Record<CallWindow['kind'], string> = {
  GOOD: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/40 dark:text-emerald-300',
  LUNCH: 'bg-amber-500/15 text-amber-700 ring-amber-500/40 dark:text-amber-300',
  EARLY: 'bg-rose-500/15 text-rose-700 ring-rose-500/40 dark:text-rose-300',
  LATE: 'bg-rose-500/15 text-rose-700 ring-rose-500/40 dark:text-rose-300',
  WEEKEND: 'bg-slate-500/15 text-slate-700 ring-slate-500/40 dark:text-slate-300',
};
const SCOPES: { value: 'mine' | 'team' | 'all'; label: MessageKey }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'team', label: 'My team' },
  { value: 'all', label: 'Everyone' },
];

/**
 * The Calls section (ADR 0088): find who to call (or type a number), see everything about them on the call card,
 * call through your own dialer, then log the outcome, remarks and the next call. History and next calls below.
 */
export function CallsWorkspace() {
  const t = useT();
  const params = useSearchParams();
  const canCall = useCan('activities:write');
  const [target, setTarget] = React.useState<Target | null>(() => {
    const companyId = params.get('company');
    const contactId = params.get('contact');
    return companyId || contactId ? { companyId, contactId } : null;
  });
  const [dialerId, setDialerId] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'history' | 'next'>('history');
  const dialers = useDialers();
  const chosen = dialerId ? dialers.data?.dialers.find((d) => d.id === dialerId) : dialers.data?.dialers.find((d) => d.isDefault);
  const pick = (next: Target) => {
    setTarget(next);
    const qs = new URLSearchParams();
    if (next.companyId) qs.set('company', next.companyId);
    if (next.contactId) qs.set('contact', next.contactId);
    window.history.replaceState(null, '', `/app/calls${qs.size ? `?${qs}` : ''}`);
  };
  return (
    <div className="space-y-5">
      <CallStatsStrip />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 space-y-5">
          <FindToCall onPick={pick} />
          {canCall && <Keypad dialerId={chosen?.id ?? null} onStarted={setActiveId} />}
          {canCall && <MyDialers dialerId={chosen?.id ?? null} onChoose={setDialerId} />}
        </div>
        <div className="min-w-0 space-y-5">
          {activeId && <ActiveCall id={activeId} onDone={() => setActiveId(null)} />}
          {target ? <CallCard target={target} dialerName={chosen?.name ?? t('Phone app')} dialerId={chosen?.id ?? null} canCall={canCall} onPick={pick} onStarted={setActiveId} /> : <EmptyCard />}
        </div>
      </div>
      <section aria-label={t('Calls')} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div role="tablist" aria-label={t('Calls')} className="mb-4 flex gap-1 rounded-full bg-muted p-1 sm:w-fit">
          {(
            [
              ['history', 'Call history', History],
              ['next', 'Next calls', CalendarClock],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn('flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition', tab === key ? 'bg-surface shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon aria-hidden className="size-4" /> {t(label)}
            </button>
          ))}
        </div>
        {tab === 'history' ? <CallHistory onLog={setActiveId} onPick={pick} /> : <NextCalls onPick={pick} />}
      </section>
    </div>
  );
}

// ─── Numbers for today ───

function CallStatsStrip() {
  const t = useT();
  const s = useCallStats();
  const tiles: { label: MessageKey; value: string; icon: typeof Phone; tone: string; testid: string }[] = [
    { label: 'Calls today', value: s.data ? String(s.data.today.calls) : '…', icon: PhoneCall, tone: 'from-emerald-500 to-teal-500', testid: 'calls-today' },
    { label: 'Reached', value: s.data ? String(s.data.today.reached) : '…', icon: UserRound, tone: 'from-sky-500 to-indigo-500', testid: 'calls-reached' },
    { label: 'Talk time', value: s.data ? talkTime(s.data.today.talkSec) : '…', icon: Timer, tone: 'from-violet-500 to-fuchsia-500', testid: 'calls-talk' },
    { label: 'Next calls today', value: s.data ? String(s.data.nextCallsToday) : '…', icon: CalendarClock, tone: 'from-amber-500 to-orange-500', testid: 'calls-next' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((x) => (
        <div key={x.label} data-testid={x.testid} className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-sm', x.tone)}>
          <x.icon aria-hidden className="absolute -end-2 -top-2 size-16 opacity-20" />
          <p className="text-2xl font-bold tabular-nums">{x.value}</p>
          <p className="text-xs font-medium opacity-90">{t(x.label)}</p>
        </div>
      ))}
      {s.data && (s.data.overdueCalls > 0 || s.data.today.notLogged > 0) && (
        <p className="col-span-2 flex flex-wrap gap-3 text-xs lg:col-span-4">
          {s.data.overdueCalls > 0 && <Badge tone="critical">{t('{count} overdue calls', { count: String(s.data.overdueCalls) })}</Badge>}
          {s.data.today.notLogged > 0 && <Badge tone="warning">{s.data.today.notLogged === 1 ? t('1 call still to log') : t('{count} calls still to log', { count: String(s.data.today.notLogged) })}</Badge>}
        </p>
      )}
    </div>
  );
}

// ─── Finding who to call ───

function FindToCall({ onPick }: { onPick: (t: Target) => void }) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(id);
  }, [q]);
  const res = useCallSearch(debounced);
  return (
    <section aria-labelledby="find-to-call" className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <h2 id="find-to-call" className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-7 items-center justify-center rounded-full bg-sky-500 text-white"><Search aria-hidden className="size-3.5" /></span>
        {t('Find who to call')}
      </h2>
      <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Company, employee, email or number')} aria-label={t('Find who to call')} />
      {debounced.trim().length >= 2 && (
        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto" aria-label={t('Search results')}>
          {res.isPending ? (
            <Skeleton className="h-14" />
          ) : !res.data?.length ? (
            <li className="p-3 text-center text-sm text-muted-foreground">{t('Nobody matches “{q}”.', { q: debounced })}</li>
          ) : (
            res.data.map((r) => <TargetRow key={`${r.kind}-${r.contactId ?? r.companyId}`} r={r} onPick={() => onPick({ companyId: r.companyId, contactId: r.contactId })} />)
          )}
        </ul>
      )}
    </section>
  );
}

function TargetRow({ r, onPick }: { r: CallTarget; onPick: () => void }) {
  const t = useT();
  return (
    <li>
      <button type="button" onClick={onPick} className="flex w-full items-center gap-3 rounded-xl p-2 text-start transition hover:bg-muted">
        {r.kind === 'company' ? (
          <CompanyLogo company={{ name: r.name, logo: r.logo }} size="xs" />
        ) : (
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 text-[0.65rem] font-bold text-white">
            {initials(r.name)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{r.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{r.subtitle ?? (r.kind === 'company' ? t('Company') : t('Employee'))}</span>
        </span>
        <span className="shrink-0 text-end font-mono text-[0.7rem] text-muted-foreground">
          {r.phone && <span className="block">{r.phone}</span>}
          {r.companyPhone && <span className="block opacity-75">{r.companyPhone}</span>}
          {!r.phone && !r.companyPhone && <span>{t('No number')}</span>}
        </span>
      </button>
    </li>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '#'];

/** Dial any number: typed or pasted, or tapped on the keypad. */
function Keypad({ dialerId, onStarted }: { dialerId: string | null; onStarted: (id: string) => void }) {
  const t = useT();
  const [number, setNumber] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const m = useCallMutations();
  const call = async () => {
    setError(null);
    try {
      const r = await m.start.mutateAsync({ numberSource: 'OTHER', number, dialerId });
      if (r.launchUrl) openDialer(r.launchUrl);
      onStarted(r.call.id);
      setNumber('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not start the call.'));
    }
  };
  return (
    <section aria-labelledby="keypad" className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <h2 id="keypad" className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white"><Phone aria-hidden className="size-3.5" /></span>
        {t('Dial a number')}
      </h2>
      <div className="flex gap-2">
        <Input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="+44 7700 900123" aria-label={t('Number to call')} className="font-mono text-base" onKeyDown={(e) => e.key === 'Enter' && number && void call()} />
        <Button size="icon" variant="ghost" aria-label={t('Delete the last digit')} onClick={() => setNumber((n) => n.slice(0, -1))}>
          <Backspace aria-hidden className="rtl:-scale-x-100" />
        </Button>
      </div>
      <div className="mx-auto mt-3 grid max-w-64 grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button key={k} type="button" onClick={() => setNumber((n) => n + k)} className="h-11 rounded-full border border-border bg-muted/40 font-mono text-lg font-semibold transition hover:border-emerald-500 hover:bg-emerald-500/10 active:scale-95">
            {k}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      )}
      <Button className="mt-3 w-full bg-emerald-700 text-white hover:bg-emerald-800" disabled={!number.trim() || m.start.isPending} onClick={() => void call()}>
        <PhoneCall aria-hidden /> {t('Call this number')}
      </Button>
    </section>
  );
}

// ─── The call card ───

function EmptyCard() {
  const t = useT();
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-gradient-to-br from-emerald-500/5 via-sky-500/5 to-violet-500/5 p-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-sky-500 text-white shadow-lg">
        <PhoneCall aria-hidden className="size-6" />
      </span>
      <p className="font-semibold">{t('Choose who to call')}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{t('Search for a company or employee, or press Call on a company or contact page. Their details come across to the call card and your dialer.')}</p>
    </div>
  );
}

function CallCard({ target, dialerId, dialerName, canCall, onPick, onStarted }: { target: Target; dialerId: string | null; dialerName: string; canCall: boolean; onPick: (t: Target) => void; onStarted: (id: string) => void }) {
  const t = useT();
  const details = useCallDetails(target);
  const m = useCallMutations();
  const [error, setError] = React.useState<string | null>(null);
  const d = details.data;
  const call = async (numberSource: 'EMPLOYEE' | 'COMPANY') => {
    setError(null);
    try {
      const r = await m.start.mutateAsync({ companyId: d?.company?.id ?? null, contactId: d?.employee?.id ?? null, numberSource, dialerId });
      if (r.launchUrl) openDialer(r.launchUrl);
      onStarted(r.call.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not start the call.'));
    }
  };
  if (details.isPending) return <Skeleton className="h-96 rounded-2xl" />;
  if (details.error || !d) {
    return (
      <p role="alert" className="rounded-2xl border border-critical/40 bg-critical/5 p-6 text-sm text-critical">
        {details.error?.message ?? t('Could not load these details.')}
      </p>
    );
  }
  return (
    <section aria-labelledby="call-card-title" data-testid="call-card" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="relative bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-600 p-5 text-white">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(255,255,255,0.25),transparent_45%)]" />
        <div className="relative flex flex-wrap items-start gap-4">
          {d.company ? (
            <CompanyLogo company={{ name: d.company.name, logo: d.company.logo, country: d.company.country }} size="md" className="ring-2 ring-white/60" />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-2xl bg-white/20"><UserRound aria-hidden className="size-7" /></span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">{t('Call card')}</p>
            <h2 id="call-card-title" className="truncate text-xl font-bold">
              {d.employee?.name ?? d.company?.name}
            </h2>
            {d.employee && d.company && <p className="truncate text-sm opacity-90">{[d.employee.designation, d.company.name].filter(Boolean).join(' · ')}</p>}
            {d.company?.leadNumber && <p className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 font-mono text-xs">{d.company.leadNumber}</p>}
          </div>
          {d.company && (
            <Link href={`/app/companies/${d.company.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold text-teal-700 shadow-sm transition hover:bg-white/90">
              <Building2 aria-hidden className="size-4" /> {t('Open company')} <ArrowUpRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
            </Link>
          )}
        </div>
      </div>
      <div className="space-y-4 p-5">
        {d.localTime && <LocalTime w={d.localTime} />}
        <dl className="grid gap-3 sm:grid-cols-2" aria-label={t('Details for the call')}>
          <Detail icon={Building2} label="Company name" value={d.company?.name} tone="bg-teal-500" />
          <Detail icon={UserRound} label="Employee name" value={d.employee?.name} tone="bg-sky-500" />
          <Detail icon={UserRound} label="Designation" value={d.employee?.designation} tone="bg-indigo-500" />
          <Detail icon={Mail} label="Employee email" value={d.employee?.email} href={d.employee?.email ? `mailto:${d.employee.email}` : undefined} tone="bg-violet-500" />
          <Detail icon={Phone} label="Employee phone" value={d.employee?.phone} mono tone="bg-emerald-500" />
          <Detail icon={Phone} label="Company phone" value={d.company?.phone} mono tone="bg-amber-500" />
        </dl>
        {d.detailsHidden && <p className="text-xs text-muted-foreground">{t('Some details are hidden: your role does not show the contact details of records other people own.')}</p>}
        {canCall && (
          <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
            <div className="flex flex-wrap gap-2">
              {d.employee && (
                <Button className="flex-1 bg-emerald-700 text-white hover:bg-emerald-800" disabled={!d.employee.phone || m.start.isPending} onClick={() => void call('EMPLOYEE')}>
                  <PhoneCall aria-hidden /> {d.employee.phone ? t('Call {name}', { name: d.employee.name.split(' ')[0]! }) : t('No employee phone')}
                </Button>
              )}
              {d.company && (
                <Button variant={d.employee ? 'outline' : 'default'} className={cn('flex-1', !d.employee && 'bg-emerald-700 text-white hover:bg-emerald-800')} disabled={!d.company.phone || m.start.isPending} onClick={() => void call('COMPANY')}>
                  <PhoneForwarded aria-hidden /> {d.company.phone ? t('Call the company') : t('No company phone')}
                </Button>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">{t('Calls with {dialer}', { dialer: dialerName })}</p>
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <History aria-hidden className="size-3.5" /> {t('Last call')}
            </p>
            {d.lastCall ? (
              <>
                <p className="flex flex-wrap items-center gap-1.5">
                  {d.lastCall.outcome && <OutcomeChip outcome={d.lastCall.outcome} />}
                  <span>{formatDateTime(d.lastCall.at)}</span>
                </p>
                {d.lastCall.remarks && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.lastCall.remarks}</p>}
                {d.lastCall.by && <p className="mt-1 text-xs text-muted-foreground">{t('By {name}', { name: d.lastCall.by })}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">{t('No calls yet.')}</p>
            )}
          </div>
          <div className="rounded-xl border border-border p-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <CalendarClock aria-hidden className="size-3.5" /> {t('Next call')}
            </p>
            {d.nextCall ? (
              <>
                <p className={cn('font-medium', new Date(d.nextCall.dueAt).getTime() < Date.now() && 'text-critical')}>{formatDateTime(d.nextCall.dueAt)}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.nextCall.title}</p>
              </>
            ) : (
              <p className="text-muted-foreground">{t('Not scheduled.')}</p>
            )}
          </div>
        </div>
        {d.colleagues.length > 1 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('Others at {company}', { company: d.company?.name ?? '' })}</p>
            <div className="flex flex-wrap gap-1.5">
              {d.colleagues.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick({ companyId: d.company?.id ?? null, contactId: c.id })}
                  aria-pressed={c.id === d.employee?.id}
                  className={cn('inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition', c.id === d.employee?.id ? 'border-emerald-500 bg-emerald-500/10 font-semibold' : 'border-border hover:border-emerald-400')}
                >
                  {c.name}
                  {c.designation && <span className="text-muted-foreground">· {c.designation}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Detail({ icon: Icon, label, value, href, mono, tone }: { icon: typeof Phone; label: MessageKey; value: string | null | undefined; href?: string; mono?: boolean; tone: string }) {
  const t = useT();
  return (
    <div className="relative min-w-0 rounded-xl border border-border py-2.5 pe-2.5 ps-[3.25rem]">
      <dt className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        <span aria-hidden className={cn('absolute start-2.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-white', tone)}>
          <Icon className="size-4" />
        </span>
        {t(label)}
      </dt>
      <dd className={cn('truncate text-sm font-medium', mono && 'font-mono', !value && 'font-normal text-muted-foreground')} title={value ?? undefined}>
        {value ? href ? <a href={href} className="text-primary hover:underline">{value}</a> : value : '—'}
      </dd>
    </div>
  );
}

function LocalTime({ w }: { w: CallWindow }) {
  const t = useT();
  return (
    <p data-testid="call-local-time" className={cn('flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1', WINDOW_TONE[w.kind])}>
      <Clock aria-hidden className="size-4" />
      <span className="font-semibold">{t.maybe(CALL_WINDOW_LABELS[w.kind])}</span>
      <span>{t('{time} there ({zone})', { time: `${t.maybe(w.weekday)} ${w.time}`, zone: w.timeZone })}</span>
    </p>
  );
}

function OutcomeChip({ outcome }: { outcome: CallOutcome }) {
  const t = useT();
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', OUTCOME_TONE[outcome])}>{t.maybe(CALL_OUTCOME_LABELS[outcome])}</span>;
}

// ─── The call in progress, and logging it ───

const quick = (days: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d);
};

function ActiveCall({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useT();
  const [live, setLive] = React.useState(true);
  const q = useCall(id, live);
  const c = q.data;
  React.useEffect(() => setLive(!!c && c.dialer.kind === 'TWILIO' && (c.status === 'RINGING' || c.status === 'IN_PROGRESS')), [c]);
  const m = useCallMutations();
  const [outcome, setOutcome] = React.useState<CallOutcome | null>(null);
  const [remarks, setRemarks] = React.useState('');
  const [sentiment, setSentiment] = React.useState<'' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'>('');
  const [next, setNext] = React.useState('');
  const [note, setNote] = React.useState('');
  const [minutes, setMinutes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const elapsed = useElapsed(c?.answeredAt ?? c?.startedAt ?? null, !c?.endedAt && c?.status !== 'LOGGED');
  if (!c) return <Skeleton className="h-64 rounded-2xl" />;
  const durationSec = minutes ? Math.round(Number(minutes.replace(',', '.')) * 60) : c.durationSec ?? (c.dialer.kind === 'TWILIO' ? null : elapsed);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) return setError(t('Choose what happened on the call.'));
    setError(null);
    try {
      await m.log.mutateAsync({ id, input: { outcome, remarks: remarks || null, sentiment: sentiment || null, durationSec: Number.isFinite(durationSec) ? durationSec : null, nextCallAt: fromLocalInput(next), nextCallNote: note || null } });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  const who = c.employee?.name ?? c.company?.name ?? c.number;
  return (
    <section aria-labelledby="active-call" data-testid="active-call" className="overflow-hidden rounded-2xl border-2 border-emerald-500 bg-surface shadow-lg">
      <div className="flex flex-wrap items-center gap-3 bg-emerald-500/10 p-4">
        <span className="relative flex size-11 items-center justify-center rounded-full bg-emerald-500 text-white">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-emerald-500/40 motion-reduce:hidden" />
          <PhoneCall aria-hidden className="relative size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="active-call" className="truncate font-semibold">
            {t('Call with {name}', { name: who })}
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            {c.number} · {c.dialer.name}
          </p>
        </div>
        <div className="text-end">
          <p className="font-mono text-2xl font-bold tabular-nums" aria-label={t('Call time')}>
            {talkTime(c.durationSec ?? elapsed)}
          </p>
          <p className="text-xs text-muted-foreground">{t.maybe(STATUS_LABEL[c.status])}</p>
        </div>
      </div>
      <div className="space-y-1 px-4 pt-3 text-xs">
        {c.webhook && (
          <p className={cn('flex items-center gap-1.5', c.webhook.status === 'SENT' ? 'text-success' : 'text-critical')}>
            <Webhook aria-hidden className="size-3.5" /> {c.webhook.status === 'SENT' ? t('Details sent to your dialer.') : t('Your dialer did not take the details: {error}', { error: c.webhook.error ?? '' })}
          </p>
        )}
        {c.error && <p className="text-critical">{c.error}</p>}
      </div>
      <form onSubmit={save} className="space-y-4 p-4" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('What happened?')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {CALL_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={outcome === o}
                onClick={() => setOutcome(o)}
                className={cn('min-h-9 rounded-full border px-3 text-xs font-semibold transition', outcome === o ? cn(OUTCOME_TONE[o], 'border-transparent shadow') : 'border-border hover:border-emerald-400')}
              >
                {t.maybe(CALL_OUTCOME_LABELS[o])}
              </button>
            ))}
          </div>
        </fieldset>
        <Field id="call-remarks" label={t('Remarks')}>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t('What was said, what they need, objections…')} maxLength={10_000} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="call-minutes" label={t('Talk time (minutes)')} hint={c.dialer.kind === 'TWILIO' ? t('Twilio fills this in when the call ends.') : t('From the timer, change it if needed.')}>
            <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="decimal" placeholder={durationSec != null ? (durationSec / 60).toFixed(1) : ''} />
          </Field>
          <Field id="call-sentiment" label={t('How did they respond?')}>
            <Select value={sentiment} onChange={(e) => setSentiment(e.target.value as typeof sentiment)}>
              <option value="">{t('Not set')}</option>
              <option value="POSITIVE">{t('Positive')}</option>
              <option value="NEUTRAL">{t('Neutral')}</option>
              <option value="NEGATIVE">{t('Negative')}</option>
            </Select>
          </Field>
        </div>
        {c.company && (
          <div className="space-y-2 rounded-xl border border-dashed border-sky-500/50 bg-sky-500/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarClock aria-hidden className="size-4 text-sky-600" /> {t('Next call')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['Tomorrow 10:00', 1],
                  ['In 3 days', 3],
                  ['Next week', 7],
                ] as const
              ).map(([label, days]) => (
                <button key={label} type="button" onClick={() => setNext(quick(days))} className="min-h-8 rounded-full border border-sky-500/40 px-3 text-xs hover:bg-sky-500/10">
                  {t(label)}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="call-next" label={t('Date and time')}>
                <Input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
              <Field id="call-next-note" label={t('What the next call is for')}>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </Field>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {c.status !== 'LOGGED' && (
            <Button type="button" variant="ghost" onClick={() => window.confirm(t('Remove this call? Use this only for a call placed by mistake.')) && m.discard.mutateAsync(id).then(onDone)}>
              <PhoneOff aria-hidden /> {t('Remove call')}
            </Button>
          )}
          <Button type="submit" className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={m.log.isPending}>
            {m.log.isPending ? t('Saving…') : t('Save call')}
          </Button>
        </div>
      </form>
    </section>
  );
}

const STATUS_LABEL: Record<CallRow['status'], string> = { OPEN: 'In your dialer', RINGING: 'Ringing', IN_PROGRESS: 'Connected', ENDED: 'Ended', FAILED: 'Not connected', LOGGED: 'Logged' };

function useElapsed(since: string | null, running: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 1000)) : 0;
}

// ─── History and next calls ───

function CallHistory({ onLog, onPick }: { onLog: (id: string) => void; onPick: (t: Target) => void }) {
  const t = useT();
  const [scope, setScope] = React.useState<'mine' | 'team' | 'all'>('mine');
  const [outcome, setOutcome] = React.useState<CallOutcome | ''>('');
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const list = useCalls({ scope, outcome: outcome || undefined, q: debounced || undefined, limit: 50 });
  const [editing, setEditing] = React.useState<CallRow | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t('Whose calls')} className="flex gap-1">
          {SCOPES.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={scope === s.value} onClick={() => setScope(s.value)} className={cn('h-9 rounded-full border px-4 text-sm font-medium', scope === s.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-muted')}>
              {t(s.label)}
            </button>
          ))}
        </div>
        <Select aria-label={t('Outcome')} className="h-9 w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome | '')}>
          <option value="">{t('All outcomes')}</option>
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t.maybe(CALL_OUTCOME_LABELS[o])}
            </option>
          ))}
        </Select>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search calls')} aria-label={t('Search calls')} className="h-9 w-full sm:w-56" />
      </div>
      {list.isPending ? (
        <Skeleton className="h-32" />
      ) : list.error ? (
        <p role="alert" className="text-sm text-critical">
          {list.error.message}
        </p>
      ) : !list.data?.length ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('No calls here yet.')}</p>
      ) : (
        <ol className="space-y-2" aria-label={t('Call history')}>
          {list.data.map((c) => (
            <li key={c.id} data-testid="call-row" className="flex flex-wrap items-start gap-3 rounded-xl border border-border p-3 transition hover:border-emerald-400/60">
              <span aria-hidden className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-white', c.outcome ? OUTCOME_TONE[c.outcome] : 'bg-muted-foreground/50')}>
                {c.outcome && !CALL_REACHED.has(c.outcome) ? <PhoneOff className="size-4" /> : <PhoneCall className="size-4" />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <button type="button" className="font-semibold hover:underline disabled:no-underline" disabled={!c.company && !c.employee} onClick={() => onPick({ companyId: c.company?.id ?? null, contactId: c.employee?.id ?? null })}>
                    {c.employee?.name ?? c.company?.name ?? c.number}
                  </button>
                  {c.employee && c.company && <span className="text-muted-foreground">{[c.employee.designation, c.company.name].filter(Boolean).join(' · ')}</span>}
                  {c.outcome ? <OutcomeChip outcome={c.outcome} /> : <Badge tone="warning">{t('Not logged')}</Badge>}
                </p>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{formatDateTime(c.startedAt)}</span>
                  <span className="font-mono">{c.number}</span>
                  <span className="inline-flex items-center gap-1">
                    <Timer aria-hidden className="size-3" /> {talkTime(c.durationSec)}
                  </span>
                  <span>{c.dialer.name}</span>
                  {c.by && scope !== 'mine' && <span>{t('By {name}', { name: c.by.name })}</span>}
                </p>
                {c.remarks && <p className="whitespace-pre-line text-sm">{c.remarks}</p>}
                {c.nextCall && (
                  <p className={cn('inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300', c.nextCall.status !== 'OPEN' && 'line-through opacity-70')}>
                    <CalendarClock aria-hidden className="size-3" /> {t('Next call {when}', { when: formatDateTime(c.nextCall.dueAt) })}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                {c.status !== 'LOGGED' && c.by?.id && scope === 'mine' && (
                  <Button size="sm" onClick={() => onLog(c.id)}>
                    {t('Log call')}
                  </Button>
                )}
                {c.status === 'LOGGED' && scope === 'mine' && (
                  <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit call')} onClick={() => setEditing(c)}>
                    <Pencil aria-hidden className="size-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <EditCallDialog call={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EditCallDialog({ call, onClose }: { call: CallRow | null; onClose: () => void }) {
  const t = useT();
  const m = useCallMutations();
  const [outcome, setOutcome] = React.useState<CallOutcome>('CONNECTED');
  const [remarks, setRemarks] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (call) {
      setOutcome(call.outcome ?? 'CONNECTED');
      setRemarks(call.remarks ?? '');
      setError(null);
    }
  }, [call]);
  return (
    <Dialog open={!!call} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t('Edit call')}</DialogTitle>
        <DialogDescription>{t('The call on the company’s interactions changes too.')}</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await m.update.mutateAsync({ id: call!.id, input: { outcome, remarks: remarks || null } });
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : t('Could not save.'));
            }
          }}
        >
          <Field id="edit-call-outcome" label={t('Outcome')}>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {t.maybe(CALL_OUTCOME_LABELS[o])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="edit-call-remarks" label={t('Remarks')}>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={10_000} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={m.update.isPending}>
              {t('Save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NextCalls({ onPick }: { onPick: (t: Target) => void }) {
  const t = useT();
  const [bucket, setBucket] = React.useState<'today' | 'overdue' | 'upcoming'>('today');
  const list = useFollowUps({ type: 'CALL', bucket, scope: 'mine' });
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t('When')} className="flex flex-wrap gap-1">
        {(
          [
            ['today', 'Today'],
            ['overdue', 'Overdue'],
            ['upcoming', 'Upcoming'],
          ] as const
        ).map(([b, label]) => (
          <button key={b} type="button" role="radio" aria-checked={bucket === b} onClick={() => setBucket(b)} className={cn('h-9 rounded-full border px-4 text-sm font-medium', bucket === b ? 'border-sky-600 bg-sky-600 text-white' : 'border-border bg-surface hover:bg-muted')}>
            {t(label)}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <Skeleton className="h-24" />
      ) : !list.data?.length ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('No calls scheduled here.')}</p>
      ) : (
        <ul className="space-y-2" aria-label={t('Next calls')}>
          {list.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
              <span aria-hidden className={cn('flex size-9 items-center justify-center rounded-full text-white', f.due === 'OVERDUE' ? 'bg-rose-500' : f.due === 'TODAY' ? 'bg-amber-500' : 'bg-sky-500')}>
                <CalendarClock className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{f.title}</p>
                <p className="truncate text-xs text-muted-foreground">{[f.contact?.name, f.company?.name, formatDateTime(f.dueAt)].filter(Boolean).join(' · ')}</p>
              </div>
              <Button size="sm" className="bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => onPick({ companyId: f.company?.id ?? null, contactId: f.contact?.id ?? null })}>
                <PhoneCall aria-hidden /> {t('Call now')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

