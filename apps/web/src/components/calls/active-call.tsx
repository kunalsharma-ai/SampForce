'use client';

import { CALL_STATUS_LABELS, type CallFollowUpInput, type CallOutcomeDef, type CallRow, DIALER_CAPABILITIES, type DialerCapabilities, type DialerCapability, providerOf, RECORDING_MAX_BYTES } from '@dealflow/types';
import { Button, cn, Field, Input, Skeleton } from '@dealflow/ui';
import { ArrowDownLeft, ArrowUpRight, Ban, CalendarClock, Circle, Flag, Handshake, Mail, Mic, MicOff, Pause, Phone, PhoneOff, Play, ShieldCheck, Square, Upload, Users, Webhook } from 'lucide-react';
import * as React from 'react';
import { ProviderMark } from '@/components/calls/dialer-settings';
import { OutcomeIcon, readableOn, useOutcomeLabel, useOutcomeLookup } from '@/components/calls/outcomes';
import { Select, Textarea } from '@/components/crm/select';
import { playConnected, playEnded, startRingback } from '@/lib/call-sounds';
import { talkTime, useCall, useCallDetails, useCallMutations, useDialers, useRecordingMutations, useRecordingPolicy } from '@/lib/calls';
import { fromLocalInput, toLocalInput } from '@/lib/company-work';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** The phone app and dialers saved before capabilities: they open elsewhere, so SampForce can only note the call ended. */
const PHONE_APP_CAPS = { placeCalls: true, opensApp: true } as Partial<DialerCapabilities>;
const LIVE: CallRow['status'][] = ['OPEN', 'REQUESTED', 'RINGING', 'IN_PROGRESS', 'ON_HOLD'];
const REPORTS_BACK: CallRow['dialer']['kind'][] = ['API', 'TWILIO'];
/** The in-call controls a dialer may have. Only the ones it really has are shown as buttons. */
const CONTROL_CAPS: DialerCapability[] = ['endCalls', 'mute', 'hold', 'dtmf', 'transfer', 'conference', 'recordings'];

const FOLLOW_UP_OF: Record<CallOutcomeDef['action'], CallFollowUpInput['type'] | null> = { NONE: null, CALLBACK: 'CALL', NEXT_CALL: 'CALL', EMAIL_TASK: 'EMAIL', MEETING: 'MEETING', FLAG_NUMBER: null, DEAL: null, NOT_INTERESTED: null };

const at = (minutes: number) => toLocalInput(new Date(Date.now() + minutes * 60_000));
const tomorrowAt = (days: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d);
};

export function useElapsed(since: string | null, running: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 1000)) : 0;
}

/**
 * The call in progress (ADR 0101): who it is with, the timer and status as the dialer reports them, the controls the
 * dialer really has, recording with consent, then what happened, the follow-up it suggests and saving it.
 */
export function ActiveCall({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useT();
  const [live, setLive] = React.useState(true);
  const q = useCall(id, live);
  const c = q.data;
  const dialers = useDialers();
  const policy = useRecordingPolicy();
  const m = useCallMutations();
  React.useEffect(() => setLive(!!c && REPORTS_BACK.includes(c.dialer.kind) && LIVE.includes(c.status)), [c]);
  // Sounds: the ring-back while it rings, a tone when it connects and when it ends.
  const status = c?.status;
  const prev = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!c) return;
    const p = prev.current;
    prev.current = status;
    if (p && p !== status && status === 'IN_PROGRESS') playConnected();
    if (p && LIVE.includes(p as CallRow['status']) && (status === 'ENDED' || status === 'FAILED' || status === 'MISSED')) playEnded();
    if (status === 'RINGING' && REPORTS_BACK.includes(c.dialer.kind)) return startRingback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const elapsed = useElapsed(c?.answeredAt ?? c?.startedAt ?? null, !!c && LIVE.includes(c.status));
  if (!c) return <Skeleton className="h-72 rounded-2xl" />;
  const row = dialers.data?.dialers.find((d) => d.id === c.dialer.id);
  const caps: Partial<DialerCapabilities> = row?.capabilities ?? PHONE_APP_CAPS;
  const provider = providerOf({ provider: c.dialer.provider ?? (c.dialer.id ? null : 'phone'), kind: c.dialer.kind });
  const who = c.employee?.name ?? c.company?.name ?? c.number;
  const isLive = LIVE.includes(c.status);
  const recordable = !!policy.data?.enabled && !!caps.recordings && row?.config.recording !== 'OFF';
  const missing = CONTROL_CAPS.filter((k) => !caps[k]);
  const control = (action: Parameters<typeof m.control.mutate>[0]['action']) => m.control.mutate({ id, action });
  const tone = c.status === 'FAILED' || c.status === 'MISSED' ? 'from-rose-600 to-rose-500' : c.status === 'IN_PROGRESS' ? 'from-emerald-600 to-teal-500' : c.status === 'ON_HOLD' ? 'from-amber-500 to-orange-500' : isLive ? 'from-sky-600 to-indigo-500' : 'from-slate-600 to-slate-500';
  return (
    <section aria-labelledby="active-call" data-testid="active-call" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
      <div className={cn('relative bg-gradient-to-br p-5 text-white', tone)}>
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.25),transparent_45%)]" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="relative flex size-14 items-center justify-center rounded-full bg-white/20">
            {isLive && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-white/25 motion-reduce:hidden" />}
            {c.direction === 'INCOMING' ? <ArrowDownLeft aria-hidden className="relative size-6" /> : <ArrowUpRight aria-hidden className="relative size-6 rtl:-scale-x-100" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="active-call" className="truncate text-xl font-bold">
              {t('Call with {name}', { name: who })}
            </h2>
            <p className="truncate text-sm opacity-90">{[c.employee?.designation, c.employee && c.company?.name].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-xs opacity-90">
              <span>{c.number}</span>
              {c.callerId && <span>· {t('shows {number}', { number: c.callerId })}</span>}
            </p>
          </div>
          <div className="text-end">
            <p className="font-mono text-3xl font-bold tabular-nums" aria-label={t('Call time')} data-testid="call-timer">
              {talkTime(c.durationSec ?? elapsed)}
            </p>
            <p className="text-sm font-medium" data-testid="call-status">
              {c.dialer.kind === 'LINK' && c.status === 'OPEN' ? t('In your dialer') : t.maybe(CALL_STATUS_LABELS[c.status])}
            </p>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-1">
            <ProviderMark provider={provider} size="sm" /> {c.dialer.name}
          </span>
          {c.recordingActive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-1 font-semibold">
              <Circle aria-hidden className="size-2.5 animate-pulse fill-current" /> {t('Recording')}
            </span>
          )}
          {c.muted && <span className="rounded-full bg-white/15 px-2 py-1">{t('Muted')}</span>}
        </div>
      </div>

      {isLive && (
        <div className="flex flex-wrap items-center justify-center gap-3 border-b border-border bg-muted/30 p-4" role="group" aria-label={t('Call controls')}>
          {caps.mute && (
            <RoundControl label={c.muted ? t('Unmute') : t('Mute')} active={c.muted} onClick={() => control(c.muted ? 'UNMUTE' : 'MUTE')}>
              {c.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
            </RoundControl>
          )}
          {caps.hold && (
            <RoundControl label={c.onHold ? t('Resume') : t('Hold')} active={c.onHold} onClick={() => control(c.onHold ? 'RESUME' : 'HOLD')}>
              {c.onHold ? <Play aria-hidden /> : <Pause aria-hidden />}
            </RoundControl>
          )}
          {recordable && row?.config.recording === 'ON_DEMAND' && (
            <RoundControl label={c.recordingActive ? t('Stop recording') : t('Record')} active={c.recordingActive} danger disabled={!c.recordingActive && !!policy.data?.requireConsent && !c.recordingConsent} onClick={() => control(c.recordingActive ? 'RECORD_STOP' : 'RECORD_START')}>
              {c.recordingActive ? <Square aria-hidden /> : <Circle aria-hidden />}
            </RoundControl>
          )}
          <button
            type="button"
            onClick={() => control('HANGUP')}
            disabled={m.control.isPending}
            className="flex min-h-14 items-center gap-2 rounded-full bg-rose-600 px-6 font-semibold text-white shadow-lg transition hover:bg-rose-700 active:scale-95 disabled:opacity-60"
          >
            <PhoneOff aria-hidden className="size-5" /> {caps.endCalls ? t('End call') : t('Mark as ended')}
          </button>
        </div>
      )}
      <div className="space-y-2 px-4 pt-3 text-xs">
        {isLive && missing.length > 0 && (
          <p className="text-muted-foreground" data-testid="not-available">
            {t('Not available with {dialer}: {list}', { dialer: c.dialer.name, list: missing.map((k) => t.maybe(DIALER_CAPABILITIES[k])).join(', ') })}
          </p>
        )}
        {m.control.error && (
          <p role="alert" className="text-critical">
            {m.control.error.message}
          </p>
        )}
        {c.webhook && (
          <p className={cn('flex items-center gap-1.5', c.webhook.status === 'SENT' ? 'text-success' : 'text-critical')}>
            <Webhook aria-hidden className="size-3.5" /> {c.webhook.status === 'SENT' ? t('Details sent to your dialer.') : t('Your dialer did not take the details: {error}', { error: c.webhook.error ?? '' })}
          </p>
        )}
        {c.error && <p className="text-critical">{c.error}</p>}
      </div>
      <RecordingConsent call={c} recordable={recordable} />
      <LogCall call={c} elapsed={elapsed} onDone={onDone} />
    </section>
  );
}

function RoundControl({ label, active, danger, disabled, onClick, children }: { label: string; active?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} className="flex w-16 flex-col items-center gap-1 text-[0.7rem] font-medium disabled:opacity-50">
      <span className={cn('flex size-12 items-center justify-center rounded-full border transition [&_svg]:size-5', active ? (danger ? 'border-rose-600 bg-rose-600 text-white' : 'border-foreground bg-foreground text-background') : 'border-border bg-surface hover:bg-muted')}>{children}</span>
      {label}
    </button>
  );
}

/** Recording only with the person's agreement when the workspace asks for it; any call can have a recording uploaded. */
function RecordingConsent({ call, recordable }: { call: CallRow; recordable: boolean }) {
  const t = useT();
  const policy = useRecordingPolicy();
  const m = useCallMutations();
  const r = useRecordingMutations();
  const file = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const p = policy.data;
  if (!p?.enabled) return null;
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (f.size > RECORDING_MAX_BYTES) return setError(t('Recordings can be up to 12 MB.'));
    const duration = await new Promise<number | null>((resolve) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
      a.onerror = () => resolve(null);
      a.src = URL.createObjectURL(f);
    });
    try {
      await r.upload.mutateAsync({ callId: call.id, file: f, source: 'UPLOAD', durationSec: duration });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not upload the recording.'));
    }
  };
  return (
    <div className="mx-4 mt-3 space-y-2 rounded-xl border border-border p-3 text-xs">
      {recordable && p.requireConsent && (
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck aria-hidden className={cn('size-4', call.recordingConsent ? 'text-emerald-600' : 'text-amber-600')} />
          <span className="min-w-0 flex-1">
            {call.recordingConsent ? t('They agreed to be recorded.') : t('Before recording, tell them: “{notice}”', { notice: p.consentNotice })}
          </span>
          {!call.recordingConsent && (
            <Button size="sm" variant="outline" onClick={() => m.consent.mutate(call.id)} disabled={m.consent.isPending}>
              {t('They agreed')}
            </Button>
          )}
        </div>
      )}
      {!recordable && call.dialer.id && <p className="text-muted-foreground">{t('{dialer} does not send recordings to SampForce. You can upload one after the call.', { dialer: call.dialer.name })}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept="audio/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} data-testid="recording-upload" />
        <Button size="sm" variant="ghost" onClick={() => file.current?.click()} disabled={r.upload.isPending}>
          <Upload aria-hidden /> {r.upload.isPending ? t('Uploading…') : t('Upload a recording')}
        </Button>
        {call.recording && <span className="text-muted-foreground">{t('A recording is saved with this call.')}</span>}
      </div>
      {error && (
        <p role="alert" className="text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

/** Logging the call: the outcome, what it suggests next, remarks, talk time, and the records it updates. */
function LogCall({ call: c, elapsed, onDone }: { call: CallRow; elapsed: number; onDone: () => void }) {
  const t = useT();
  const m = useCallMutations();
  const outcomes = useOutcomeLookup();
  const label = useOutcomeLabel();
  const canDeals = useCan('deals:write');
  const details = useCallDetails(c.company || c.employee ? { companyId: c.company?.id ?? null, contactId: c.employee?.id ?? null } : null);
  const [outcome, setOutcome] = React.useState<CallOutcomeDef | null>(null);
  const [remarks, setRemarks] = React.useState('');
  const [sentiment, setSentiment] = React.useState<'' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'>('');
  const [minutes, setMinutes] = React.useState('');
  const [plan, setPlan] = React.useState(false);
  const [fuType, setFuType] = React.useState<CallFollowUpInput['type']>('CALL');
  const [fuAt, setFuAt] = React.useState('');
  const [fuNote, setFuNote] = React.useState('');
  const [flag, setFlag] = React.useState(false);
  const [notInterested, setNotInterested] = React.useState(false);
  const [dealId, setDealId] = React.useState(c.deal?.id ?? '');
  const [newDeal, setNewDeal] = React.useState(false);
  const [dealName, setDealName] = React.useState('');
  const [dealAmount, setDealAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const choose = (o: CallOutcomeDef) => {
    setOutcome(o);
    const type = FOLLOW_UP_OF[o.action];
    // The outcome suggests what happens next; the person can change or drop it.
    setPlan(!!type && !!c.company);
    if (type) {
      setFuType(type);
      setFuAt(o.followUpInMinutes ? at(o.followUpInMinutes) : tomorrowAt(1));
      setFuNote('');
    }
    setFlag(o.action === 'FLAG_NUMBER' && c.numberSource !== 'OTHER');
    setNotInterested(o.action === 'NOT_INTERESTED' && !!c.employee);
    setNewDeal(o.action === 'DEAL' && canDeals && !!c.company && !dealId);
    if (o.action === 'DEAL' && !dealName && c.company) setDealName(`${c.company.name} – ${label(o)}`);
  };
  const durationSec = minutes ? Math.round(Number(minutes.replace(',', '.')) * 60) : (c.durationSec ?? (REPORTS_BACK.includes(c.dialer.kind) ? null : elapsed));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) return setError(t('Choose what happened on the call.'));
    setError(null);
    try {
      await m.log.mutateAsync({
        id: c.id,
        input: {
          outcome: outcome.key,
          remarks: remarks || null,
          sentiment: sentiment || null,
          durationSec: Number.isFinite(durationSec) ? durationSec : null,
          followUp: plan && fuAt ? { type: fuType, at: fromLocalInput(fuAt)!, note: fuNote || null } : null,
          flagNumber: flag || undefined,
          markNotInterested: notInterested || undefined,
          dealId: !newDeal && dealId ? dealId : null,
          createDeal: newDeal ? { name: dealName, amount: Number(dealAmount) || 0 } : null,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  const deals = details.data?.deals ?? [];
  const groups: { label: MessageKey; list: CallOutcomeDef[] }[] = [
    { label: 'Nobody answered', list: outcomes.active.filter((o) => !o.reached && o.tone !== 'stop') },
    { label: 'Spoke to them', list: outcomes.active.filter((o) => o.reached && o.tone !== 'stop') },
    { label: 'Stop or check', list: outcomes.active.filter((o) => o.tone === 'stop') },
  ];
  return (
    <form onSubmit={save} className="space-y-4 p-4" noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('What happened?')}</legend>
        <div className="space-y-2">
          {groups.map(
            (g) =>
              g.list.length > 0 && (
                <div key={g.label}>
                  <p className="mb-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{t(g.label)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.list.map((o) => {
                      const on = outcome?.key === o.key;
                      return (
                        <button
                          key={o.key}
                          type="button"
                          aria-pressed={on}
                          data-outcome={o.key}
                          onClick={() => choose(o)}
                          className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition', on ? 'border-transparent text-white shadow' : 'border-border hover:border-foreground/30')}
                          style={on ? { backgroundColor: readableOn(o.color) } : undefined}
                        >
                          <span className={cn('flex size-5 items-center justify-center rounded-full', on ? 'bg-white/25' : 'text-white')} style={on ? undefined : { backgroundColor: o.color }}>
                            <OutcomeIcon def={o} className="size-3" />
                          </span>
                          {label(o)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ),
          )}
        </div>
      </fieldset>

      {outcome && (
        <div className="space-y-3">
          {c.company && (
            <div className="space-y-2 rounded-xl border border-dashed border-sky-500/50 bg-sky-500/5 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} className="size-4 accent-sky-600" />
                <CalendarClock aria-hidden className="size-4 text-sky-600" /> {t('Plan a follow-up')}
              </label>
              {plan && (
                <>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('Follow-up')}>
                    {(
                      [
                        ['CALL', 'Call again', Phone],
                        ['EMAIL', 'Email the details', Mail],
                        ['MEETING', 'Meeting', Users],
                      ] as const
                    ).map(([k, l, Icon]) => (
                      <button key={k} type="button" role="radio" aria-checked={fuType === k} onClick={() => setFuType(k)} className={cn('inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-xs', fuType === k ? 'border-sky-600 bg-sky-600 text-white' : 'border-sky-500/40 hover:bg-sky-500/10')}>
                        <Icon aria-hidden className="size-3.5" /> {t(l)}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['In 1 hour', () => at(60)],
                        ['Tomorrow 10:00', () => tomorrowAt(1)],
                        ['In 3 days', () => tomorrowAt(3)],
                        ['Next week', () => tomorrowAt(7)],
                      ] as const
                    ).map(([l, f]) => (
                      <button key={l} type="button" onClick={() => setFuAt(f())} className="min-h-8 rounded-full border border-sky-500/40 px-3 text-xs hover:bg-sky-500/10">
                        {t(l)}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="call-next" label={t('Date and time')}>
                      <Input type="datetime-local" value={fuAt} onChange={(e) => setFuAt(e.target.value)} />
                    </Field>
                    <Field id="call-next-note" label={t('What it is for')}>
                      <Input value={fuNote} onChange={(e) => setFuNote(e.target.value)} maxLength={500} />
                    </Field>
                  </div>
                </>
              )}
            </div>
          )}
          {(outcome.action === 'FLAG_NUMBER' || flag) && c.numberSource !== 'OTHER' && (
            <label className="flex items-start gap-2 rounded-xl bg-rose-500/10 p-3 text-sm">
              <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} className="mt-0.5 size-4 accent-rose-600" />
              <span>
                <span className="flex items-center gap-1 font-medium">
                  <Flag aria-hidden className="size-3.5" /> {t('Flag {number} for checking', { number: c.number })}
                </span>
                <span className="block text-xs text-muted-foreground">{t('The record shows the number may be wrong until someone checks it.')}</span>
              </span>
            </label>
          )}
          {outcome.action === 'NOT_INTERESTED' && c.employee && (
            <label className="flex items-start gap-2 rounded-xl bg-slate-500/10 p-3 text-sm">
              <input type="checkbox" checked={notInterested} onChange={(e) => setNotInterested(e.target.checked)} className="mt-0.5 size-4" />
              <span>
                <span className="flex items-center gap-1 font-medium">
                  <Ban aria-hidden className="size-3.5" /> {t('Mark {name} not interested', { name: c.employee.name })}
                </span>
                <span className="block text-xs text-muted-foreground">{t('Only the employee. The company is not marked lost.')}</span>
              </span>
            </label>
          )}
          {c.company && (deals.length > 0 || canDeals) && (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Handshake aria-hidden className="size-4 text-violet-600" /> {t('Deal')}
              </p>
              {deals.length > 0 && !newDeal && (
                <Select aria-label={t('Link the call to a deal')} value={dealId} onChange={(e) => setDealId(e.target.value)}>
                  <option value="">{t('No deal')}</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
              {canDeals && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newDeal} onChange={(e) => setNewDeal(e.target.checked)} className="size-4 accent-violet-600" />
                  {t('Create a deal from this call')}
                </label>
              )}
              {newDeal && (
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                  <Field id="call-deal-name" label={t('Deal name')}>
                    <Input value={dealName} onChange={(e) => setDealName(e.target.value)} maxLength={200} />
                  </Field>
                  <Field id="call-deal-amount" label={t('Amount')}>
                    <Input value={dealAmount} onChange={(e) => setDealAmount(e.target.value)} inputMode="decimal" />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Field id="call-remarks" label={t('Notes')}>
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t('What was said, what they need, objections…')} maxLength={10_000} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="call-minutes" label={t('Talk time (minutes)')} hint={REPORTS_BACK.includes(c.dialer.kind) ? t('Your provider fills this in when the call ends.') : t('From the timer, change it if needed.')}>
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
      {c.company && <p className="text-xs text-muted-foreground">{t('Saving adds the call to the company and employee timelines and updates their last call.')}</p>}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {c.status !== 'LOGGED' && (
          <Button type="button" variant="ghost" onClick={() => window.confirm(t('Remove this call? Use this only for a call placed by mistake.')) && m.discard.mutateAsync(c.id).then(onDone)}>
            <PhoneOff aria-hidden /> {t('Remove call')}
          </Button>
        )}
        <Button type="submit" className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={m.log.isPending}>
          {m.log.isPending ? t('Saving…') : t('Save call')}
        </Button>
      </div>
    </form>
  );
}
