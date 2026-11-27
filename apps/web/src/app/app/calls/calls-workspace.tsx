'use client';

import { CALL_WINDOW_LABELS, CALLING_CODES, type CallTarget, type CallWindow, providerOf } from '@dealflow/types';
import { Badge, Button, cn, Input, Skeleton } from '@dealflow/ui';
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  Clock,
  Delete as Backspace,
  Disc,
  Flag,
  Handshake,
  History,
  Mail,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  Search,
  Settings2,
  Star,
  Timer,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { ActiveCall } from '@/components/calls/active-call';
import { CallHistory, type Target } from '@/components/calls/call-history';
import { SoundsToggle, WorkspaceCallSettings } from '@/components/calls/call-settings';
import { DialerSettingsPanel, ProviderMark } from '@/components/calls/dialer-settings';
import { OutcomeChip } from '@/components/calls/outcomes';
import { CallRecordings } from '@/components/calls/recordings';
import { CompanyLogo } from '@/components/crm/company-logo';
import { formatDateTime } from '@/components/crm/follow-ups';
import { Select } from '@/components/crm/select';
import { playIncoming, playKey } from '@/lib/call-sounds';
import { openDialer, talkTime, useCallDetails, useCallFavorites, useCallMutations, useCalls, useCallSearch, useCallStats, useClearNumberFlag, useDialers, useFavoriteMutation } from '@/lib/calls';
import { useFollowUps } from '@/lib/company-work';
import { fmtLocale, type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

const WINDOW_TONE: Record<CallWindow['kind'], string> = {
  GOOD: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/40 dark:text-emerald-300',
  LUNCH: 'bg-amber-500/15 text-amber-700 ring-amber-500/40 dark:text-amber-300',
  EARLY: 'bg-rose-500/15 text-rose-700 ring-rose-500/40 dark:text-rose-300',
  LATE: 'bg-rose-500/15 text-rose-700 ring-rose-500/40 dark:text-rose-300',
  WEEKEND: 'bg-slate-500/15 text-slate-700 ring-slate-500/40 dark:text-slate-300',
};
/** The day's name; the day starts at midnight on the workspace clock, so noon is the same day everywhere. */
const weekday = (iso: string, weekday: 'short' | 'long') => new Date(new Date(iso).getTime() + 12 * 3600_000).toLocaleDateString(fmtLocale(), { weekday });
type Tab = 'dialer' | 'history' | 'next' | 'recordings' | 'settings';
const TABS: { key: Tab; label: MessageKey; icon: typeof Phone }[] = [
  { key: 'dialer', label: 'Dialer', icon: Phone },
  { key: 'history', label: 'Call history', icon: History },
  { key: 'next', label: 'Next calls', icon: CalendarClock },
  { key: 'recordings', label: 'Recordings', icon: Disc },
  { key: 'settings', label: 'Dialer settings', icon: Settings2 },
];

/**
 * The Calls section (ADR 0088, redesigned in ADR 0101): a dialer with a keypad, contact search, favourites and recents;
 * the call card; the call in progress with the controls the dialer really has; the history, next calls, recordings
 * and the dialer settings, each in its own tab.
 */
export function CallsWorkspace() {
  const t = useT();
  const params = useSearchParams();
  const canCall = useCan('activities:write');
  const [tab, setTabState] = React.useState<Tab>(() => (TABS.some((x) => x.key === params.get('tab')) ? (params.get('tab') as Tab) : 'dialer'));
  const [target, setTarget] = React.useState<Target | null>(() => {
    const companyId = params.get('company');
    const contactId = params.get('contact');
    return companyId || contactId ? { companyId, contactId } : null;
  });
  const [focusRecording, setFocusRecording] = React.useState<string | null>(params.get('recording'));
  const [dialerId, setDialerId] = React.useState<string | null>(null);
  const [callerId, setCallerId] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const dialers = useDialers();
  const usable = (dialers.data?.dialers ?? []).filter((d) => d.active);
  const chosen = dialerId === 'phone' ? undefined : dialerId ? usable.find((d) => d.id === dialerId) : usable.find((d) => d.isDefault);
  const watchIncoming = usable.some((d) => d.capabilities.incoming);
  const url = (next: { tab?: Tab; target?: Target | null }) => {
    const qs = new URLSearchParams();
    const tb = next.tab ?? tab;
    const tg = next.target === undefined ? target : next.target;
    if (tb !== 'dialer') qs.set('tab', tb);
    if (tg?.companyId) qs.set('company', tg.companyId);
    if (tg?.contactId) qs.set('contact', tg.contactId);
    window.history.replaceState(null, '', `/app/calls${qs.size ? `?${qs}` : ''}`);
  };
  const setTab = (next: Tab) => {
    setTabState(next);
    url({ tab: next });
  };
  const pick = (next: Target) => {
    setTarget(next);
    setTabState('dialer');
    url({ tab: 'dialer', target: next });
  };
  const started = (id: string) => {
    setActiveId(id);
    setTabState('dialer');
    url({ tab: 'dialer' });
  };
  return (
    <div className="space-y-5">
      <CallStatsStrip watchIncoming={watchIncoming} onAnswer={started} />
      <div role="tablist" aria-label={t('Calls')} className="flex gap-1 overflow-x-auto rounded-full bg-muted p-1">
        {TABS.filter((x) => canCall || (x.key !== 'settings' && x.key !== 'dialer')).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn('flex min-h-9 shrink-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-medium transition', tab === key ? 'bg-surface shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            <Icon aria-hidden className="size-4" /> {t(label)}
          </button>
        ))}
      </div>
      {tab === 'dialer' && canCall && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 space-y-5">
            <DialerPhone dialerId={chosen?.id ?? null} onDialer={setDialerId} callerId={callerId} onCallerId={setCallerId} onPick={pick} onStarted={started} />
          </div>
          <div className="min-w-0 space-y-5">
            {activeId && <ActiveCall key={activeId} id={activeId} onDone={() => setActiveId(null)} />}
            {target ? <CallCard target={target} dialerName={chosen?.name ?? t('Phone app')} dialerId={chosen?.id ?? null} callerId={callerId} canCall={canCall} onPick={pick} onStarted={started} /> : !activeId && <EmptyCard />}
          </div>
        </div>
      )}
      {(tab !== 'dialer' || !canCall) && (
        <section role="tabpanel" aria-label={t(TABS.find((x) => x.key === tab)!.label)} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          {tab === 'history' || (tab === 'dialer' && !canCall) ? (
            <CallHistory
              onLog={started}
              onPick={pick}
              onRecording={(id) => {
                setFocusRecording(id);
                setTab('recordings');
              }}
            />
          ) : tab === 'next' ? (
            <NextCalls onPick={pick} />
          ) : tab === 'recordings' ? (
            <CallRecordings focus={focusRecording} />
          ) : (
            <div className="space-y-6">
              <DialerSettingsPanel />
              <WorkspaceCallSettings />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Numbers for today, and incoming calls ───

function CallStatsStrip({ watchIncoming, onAnswer }: { watchIncoming: boolean; onAnswer: (id: string) => void }) {
  const t = useT();
  const s = useCallStats(watchIncoming);
  const ringing = React.useMemo(() => s.data?.ringing ?? [], [s.data?.ringing]);
  const heard = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const c of ringing) {
      if (!heard.current.has(c.id)) {
        heard.current.add(c.id);
        playIncoming();
      }
    }
  }, [ringing]);
  const max = Math.max(1, ...(s.data?.week ?? []).map((d) => d.calls));
  const tiles: { label: MessageKey; value: string; icon: typeof Phone; tone: string; testid: string }[] = [
    { label: 'Calls today', value: s.data ? String(s.data.today.calls) : '…', icon: PhoneCall, tone: 'from-emerald-500 to-teal-500', testid: 'calls-today' },
    { label: 'Reached', value: s.data ? String(s.data.today.reached) : '…', icon: UserRound, tone: 'from-sky-500 to-indigo-500', testid: 'calls-reached' },
    { label: 'Talk time', value: s.data ? talkTime(s.data.today.talkSec) : '…', icon: Timer, tone: 'from-violet-500 to-fuchsia-500', testid: 'calls-talk' },
    { label: 'Next calls today', value: s.data ? String(s.data.nextCallsToday) : '…', icon: CalendarClock, tone: 'from-amber-500 to-orange-500', testid: 'calls-next' },
  ];
  return (
    <div className="space-y-3">
      {ringing.map((c) => (
        <div key={c.id} role="alert" data-testid="incoming-call" className="flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 p-4 text-white shadow-lg">
          <span className="relative flex size-11 items-center justify-center rounded-full bg-white/20">
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-white/30 motion-reduce:hidden" />
            <PhoneIncoming aria-hidden className="relative size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('Incoming call: {name}', { name: c.employee?.name ?? c.company?.name ?? c.number })}</p>
            <p className="text-sm opacity-90">{[c.employee && c.company?.name, c.number, t('on {dialer}', { dialer: c.dialer.name })].filter(Boolean).join(' · ')}</p>
          </div>
          <Button className="bg-white text-indigo-700 hover:bg-white/90" onClick={() => onAnswer(c.id)}>
            {t('Open the call')}
          </Button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.label} data-testid={x.testid} className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-sm', x.tone)}>
            <x.icon aria-hidden className="absolute -end-2 -top-2 size-16 opacity-20" />
            <p className="text-2xl font-bold tabular-nums">{x.value}</p>
            <p className="text-xs font-medium opacity-90">{t(x.label)}</p>
          </div>
        ))}
        <div className="col-span-2 rounded-2xl border border-border bg-surface p-3 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">{t('This week')}</p>
          <div className="mt-2 flex h-12 items-end gap-1" aria-label={t('Calls this week')} role="img">
            {(s.data?.week ?? []).map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-0.5" title={`${weekday(d.day, 'long')}: ${d.calls} / ${d.reached}`}>
                <div className="relative w-full rounded-sm bg-emerald-500/25" style={{ height: `${(d.calls / max) * 40 + 2}px` }}>
                  <div className="absolute inset-x-0 bottom-0 rounded-sm bg-emerald-500" style={{ height: `${d.calls ? (d.reached / d.calls) * 100 : 0}%` }} />
                </div>
                <span className="text-[0.6rem] text-muted-foreground">{weekday(d.day, 'short')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {s.data && (s.data.overdueCalls > 0 || s.data.today.notLogged > 0 || s.data.outcomes.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {s.data.overdueCalls > 0 && <Badge tone="critical">{t('{count} overdue calls', { count: String(s.data.overdueCalls) })}</Badge>}
          {s.data.today.notLogged > 0 && <Badge tone="warning">{s.data.today.notLogged === 1 ? t('1 call still to log') : t('{count} calls still to log', { count: String(s.data.today.notLogged) })}</Badge>}
          {s.data.outcomes.slice(0, 6).map((o) => (
            <span key={o.outcome} className="inline-flex items-center gap-1">
              <OutcomeChip outcome={o.outcome} /> <span className="font-semibold tabular-nums">{o.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── The dialer: search, keypad, favourites and recents ───

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];
const CODE_KEY = 'sampforce.calls.country';

function DialerPhone({ dialerId, onDialer, callerId, onCallerId, onPick, onStarted }: { dialerId: string | null; onDialer: (id: string | null) => void; callerId: string | null; onCallerId: (v: string | null) => void; onPick: (t: Target) => void; onStarted: (id: string) => void }) {
  const t = useT();
  const dialers = useDialers();
  const usable = (dialers.data?.dialers ?? []).filter((d) => d.active);
  const chosen = usable.find((d) => d.id === dialerId);
  const provider = chosen ? providerOf(chosen) : providerOf({ provider: 'phone', kind: 'LINK' });
  const [number, setNumber] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const m = useCallMutations();
  React.useEffect(() => {
    let saved = '';
    try {
      saved = window.localStorage.getItem(CODE_KEY) ?? '';
    } catch {
      saved = '';
    }
    setCode(chosen?.config.defaultCountryCode ?? saved);
  }, [chosen?.id, chosen?.config.defaultCountryCode]);
  React.useEffect(() => {
    if (callerId && !chosen?.config.callerIds.includes(callerId)) onCallerId(null);
  }, [chosen, callerId, onCallerId]);
  const press = (k: string) => {
    playKey(k);
    setNumber((n) => (n + k).slice(0, 40));
  };
  const call = async () => {
    setError(null);
    try {
      const r = await m.start.mutateAsync({ numberSource: 'OTHER', number, dialerId, phoneApp: !dialerId, countryCode: code || null, callerId });
      if (r.launchUrl) openDialer(r.launchUrl);
      onStarted(r.call.id);
      setNumber('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not start the call.'));
    }
  };
  const typed = !/^\s*(\+|00)/.test(number);
  return (
    <section aria-labelledby="dialer-phone" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-md">
      <div className="space-y-3 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 p-4 text-white">
        <div className="flex items-center gap-2">
          <h2 id="dialer-phone" className="sr-only">
            {t('Dialer')}
          </h2>
          <ProviderMark provider={provider} size="sm" />
          <Select aria-label={t('Call with')} value={dialerId ?? 'phone'} onChange={(e) => onDialer(e.target.value === 'phone' ? 'phone' : e.target.value)} className="h-9 flex-1 border-white/20 bg-white/10 text-white [&>option]:text-foreground">
            <option value="phone">{t('Phone app')}</option>
            {usable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <SoundsToggle compact />
        </div>
        {chosen && chosen.config.callerIds.length > 0 && (
          <Select aria-label={t('Caller id')} value={callerId ?? chosen.config.callerIds[0]} onChange={(e) => onCallerId(e.target.value)} className="h-9 border-white/20 bg-white/10 font-mono text-xs text-white [&>option]:text-foreground">
            {chosen.config.callerIds.map((n) => (
              <option key={n} value={n}>
                {t('Shows {number}', { number: n })}
              </option>
            ))}
          </Select>
        )}
        <div className="flex items-center gap-2">
          <Select aria-label={t('Country code')} value={code} onChange={(e) => {
            setCode(e.target.value);
            try {
              window.localStorage.setItem(CODE_KEY, e.target.value);
            } catch {
              // Remembering the code is a convenience only.
            }
          }} className="h-12 w-28 border-white/20 bg-white/10 text-white [&>option]:text-foreground" disabled={!typed}>
            <option value="">{t('No code')}</option>
            {CALLING_CODES.map((c) => (
              <option key={`${c.country}${c.code}`} value={c.code}>
                {c.country} {c.code}
              </option>
            ))}
          </Select>
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && number.trim()) void call();
              else if (/^[\d*#+]$/.test(e.key)) playKey(e.key);
            }}
            inputMode="tel"
            placeholder={t('Number')}
            aria-label={t('Number to call')}
            className="h-12 flex-1 border-white/20 bg-white/10 text-center font-mono text-2xl tracking-wider text-white placeholder:text-white/40"
          />
          <Button size="icon" variant="ghost" className="size-12 text-white hover:bg-white/10" aria-label={t('Delete the last digit')} onClick={() => setNumber((n) => n.slice(0, -1))} disabled={!number}>
            <Backspace aria-hidden className="rtl:-scale-x-100" />
          </Button>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="mx-auto grid max-w-72 grid-cols-3 gap-3" role="group" aria-label={t('Keypad')}>
          {KEYS.map(([k, letters]) => (
            <button
              key={k}
              type="button"
              aria-label={k}
              onClick={() => press(k)}
              onContextMenu={(e) => {
                if (k === '0') {
                  e.preventDefault();
                  press('+');
                }
              }}
              className="flex h-16 flex-col items-center justify-center rounded-full border border-border bg-gradient-to-b from-surface to-muted/60 font-mono shadow-sm transition hover:border-emerald-500 hover:shadow active:scale-95 active:bg-emerald-500/15"
            >
              <span className="text-2xl font-semibold leading-none">{k}</span>
              <span className="mt-0.5 h-3 text-[0.6rem] font-semibold tracking-widest text-muted-foreground">{letters}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void call()}
          disabled={!number.trim() || m.start.isPending}
          aria-label={t('Call this number')}
          className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
        >
          <PhoneCall aria-hidden className="size-7" />
        </button>
        {error && (
          <p role="alert" className="text-center text-sm text-critical">
            {error}
          </p>
        )}
        <p className="text-center text-xs text-muted-foreground">{t('Calls with {dialer}', { dialer: chosen?.name ?? t('Phone app') })}</p>
        <FindToCall onPick={onPick} />
        <QuickPicks onPick={onPick} onNumber={setNumber} />
      </div>
    </section>
  );
}

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
    <div className="space-y-2">
      <label className="relative block">
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Company, employee, email or number')} aria-label={t('Find who to call')} className="ps-9" />
      </label>
      {debounced.trim().length >= 2 && (
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-1" aria-label={t('Search results')}>
          {res.isPending ? (
            <Skeleton className="h-14" />
          ) : !res.data?.length ? (
            <li className="p-3 text-center text-sm text-muted-foreground">{t('Nobody matches “{q}”.', { q: debounced })}</li>
          ) : (
            res.data.map((r) => (
              <TargetRow
                key={`${r.kind}-${r.contactId ?? r.companyId}`}
                r={r}
                onPick={() => {
                  onPick({ companyId: r.companyId, contactId: r.contactId });
                  setQ('');
                }}
              />
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function TargetRow({ r, onPick }: { r: CallTarget; onPick: () => void }) {
  const t = useT();
  return (
    <li>
      <button type="button" onClick={onPick} className="flex w-full items-center gap-3 rounded-lg p-2 text-start transition hover:bg-muted">
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

/** Favourites and recent calls, one tap away. */
function QuickPicks({ onPick, onNumber }: { onPick: (t: Target) => void; onNumber: (n: string) => void }) {
  const t = useT();
  const favs = useCallFavorites();
  const recent = useCalls({ scope: 'mine', limit: 12 });
  const seen = new Set<string>();
  const recents = (recent.data ?? []).filter((c) => {
    const k = c.employee?.id ?? c.company?.id ?? c.number;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);
  return (
    <div className="space-y-3">
      {!!favs.data?.length && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Star aria-hidden className="size-3.5 fill-amber-400 text-amber-400" /> {t('Favourites')}
          </p>
          <div className="flex flex-wrap gap-1.5" aria-label={t('Favourites')}>
            {favs.data.map((f) => (
              <button key={f.id} type="button" onClick={() => onPick({ companyId: f.companyId, contactId: f.contactId })} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 px-3 text-xs font-medium hover:bg-amber-400/20">
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {recents.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <History aria-hidden className="size-3.5" /> {t('Recent calls')}
          </p>
          <ul className="space-y-1" aria-label={t('Recent calls')}>
            {recents.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => (c.company || c.employee ? onPick({ companyId: c.company?.id ?? null, contactId: c.employee?.id ?? null }) : onNumber(c.number))}
                  className="flex w-full items-center gap-2 rounded-lg p-1.5 text-start text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{c.employee?.name ?? c.company?.name ?? c.number}</span>
                  {c.outcome && <OutcomeChip outcome={c.outcome} className="max-w-40 truncate" />}
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(c.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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

function CallCard({ target, dialerId, dialerName, callerId, canCall, onPick, onStarted }: { target: Target; dialerId: string | null; dialerName: string; callerId: string | null; canCall: boolean; onPick: (t: Target) => void; onStarted: (id: string) => void }) {
  const t = useT();
  const details = useCallDetails(target);
  const m = useCallMutations();
  const fav = useFavoriteMutation();
  const clearFlag = useClearNumberFlag();
  const [error, setError] = React.useState<string | null>(null);
  const [dealId, setDealId] = React.useState('');
  const d = details.data;
  const call = async (numberSource: 'EMPLOYEE' | 'COMPANY') => {
    setError(null);
    try {
      const r = await m.start.mutateAsync({ companyId: d?.company?.id ?? null, contactId: d?.employee?.id ?? null, numberSource, dialerId, phoneApp: !dialerId, callerId, dealId: dealId || null });
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
  const flagged = (d.employee?.phoneFlagged ?? false) || (!d.employee && d.company?.phoneFlagged);
  return (
    <section aria-labelledby="call-card-title" data-testid="call-card" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="relative bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-600 p-5 text-white">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(255,255,255,0.25),transparent_45%)]" />
        <div className="relative flex flex-wrap items-start gap-4">
          {d.company ? (
            <CompanyLogo company={{ name: d.company.name, logo: d.company.logo, country: d.company.country }} size="md" className="ring-2 ring-white/60" />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-2xl bg-white/20">
              <UserRound aria-hidden className="size-7" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">{t('Call card')}</p>
            <h2 id="call-card-title" className="truncate text-xl font-bold">
              {d.employee?.name ?? d.company?.name}
            </h2>
            {d.employee && d.company && <p className="truncate text-sm opacity-90">{[d.employee.designation, d.company.name].filter(Boolean).join(' · ')}</p>}
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {d.company?.leadNumber && <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono">{d.company.leadNumber}</span>}
              <span className="rounded-full bg-white/20 px-2 py-0.5">{t('{count} calls, {reached} reached', { count: String(d.callCount), reached: String(d.reachedCount) })}</span>
              {d.employee?.notInterested && <span className="rounded-full bg-slate-900/40 px-2 py-0.5">{t('Not interested')}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={d.favorite}
              aria-label={d.favorite ? t('Remove from favourites') : t('Add to favourites')}
              onClick={() => fav.mutate({ companyId: d.company?.id ?? null, contactId: d.employee?.id ?? null, on: !d.favorite })}
              className="flex size-9 items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30"
            >
              <Star aria-hidden className={cn('size-4', d.favorite && 'fill-amber-300 text-amber-300')} />
            </button>
            {d.company && (
              <Link href={`/app/companies/${d.company.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold text-teal-700 shadow-sm transition hover:bg-white/90">
                <Building2 aria-hidden className="size-4" /> {t('Open company')} <ArrowUpRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
              </Link>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-4 p-5">
        {d.localTime && <LocalTime w={d.localTime} />}
        {flagged && (
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            <Flag aria-hidden className="size-4" /> {t('This number was flagged as possibly wrong.')}
            <button type="button" className="ms-auto text-xs font-semibold underline" onClick={() => clearFlag.mutate({ companyId: d.employee ? null : (d.company?.id ?? null), contactId: d.employee?.id ?? null })}>
              {t('It is right')}
            </button>
          </p>
        )}
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
            {d.deals.length > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <Handshake aria-hidden className="size-4 text-violet-600" />
                <span className="shrink-0 font-medium">{t('About the deal')}</span>
                <Select aria-label={t('About the deal')} value={dealId} onChange={(e) => setDealId(e.target.value)} className="h-8 text-xs">
                  <option value="">{t('No deal')}</option>
                  {d.deals.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
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
        {value ? (
          href ? (
            <a href={href} className="text-primary hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          '—'
        )}
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

// ─── Next calls ───

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
