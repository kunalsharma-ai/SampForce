'use client';

import { CALL_SORTS, CALL_STATUS_LABELS, CALL_STATUSES, type CallListQuery, type CallRow, type CallStatus, providerOf } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Disc, Handshake, LayoutList, Mail, Pencil, Table2, Timer } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ProviderMark } from '@/components/calls/dialer-settings';
import { OutcomeChip, OutcomeIcon, readableOn, useOutcomeLabel, useOutcomeLookup } from '@/components/calls/outcomes';
import { formatDateTime } from '@/components/crm/follow-ups';
import { Select, Textarea } from '@/components/crm/select';
import { talkTime, useCallMutations, useCalls, useDialers } from '@/lib/calls';
import { type MessageKey, useT } from '@/lib/i18n';

export type Target = { companyId: string | null; contactId: string | null };
type Scope = 'mine' | 'team' | 'all';
const SCOPES: { value: Scope; label: MessageKey }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'team', label: 'My team' },
  { value: 'all', label: 'Everyone' },
];
const SORT_LABEL: Record<(typeof CALL_SORTS)[number], MessageKey> = { newest: 'Newest first', oldest: 'Oldest first', longest: 'Longest first', company: 'By company' };
const VIEW_KEY = 'sampforce.calls.history-view';
const dayStart = (v: string) => (v ? new Date(`${v}T00:00:00`).toISOString() : undefined);
const dayEnd = (v: string) => (v ? new Date(new Date(`${v}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined);

/**
 * The call history (ADR 0101): every call with who it was with, the caller, the dialer, direction, times, talk time,
 * status, outcome, notes, recording, follow-up and deal. Search, filters, a date range and sorting; a table or a
 * day-by-day activity view.
 */
export function CallHistory({ onLog, onPick, onRecording }: { onLog: (id: string) => void; onPick: (t: Target) => void; onRecording: (id: string) => void }) {
  const t = useT();
  const outcomes = useOutcomeLookup();
  const label = useOutcomeLabel();
  const dialers = useDialers();
  const [view, setView] = React.useState<'table' | 'activity'>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'activity' ? 'activity' : 'table';
    } catch {
      return 'table';
    }
  });
  const [scope, setScope] = React.useState<Scope>('mine');
  const [outcome, setOutcome] = React.useState('');
  const [status, setStatus] = React.useState<CallStatus | ''>('');
  const [direction, setDirection] = React.useState<'' | 'OUTGOING' | 'INCOMING'>('');
  const [dialerId, setDialerId] = React.useState('');
  const [hasRecording, setHasRecording] = React.useState(false);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [sort, setSort] = React.useState<(typeof CALL_SORTS)[number]>('newest');
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [limit, setLimit] = React.useState(50);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const query: Partial<CallListQuery> = { scope, outcome: outcome || undefined, status: status || undefined, direction: direction || undefined, dialerId: dialerId || undefined, hasRecording: hasRecording || undefined, from: dayStart(from), to: dayEnd(to), sort, q: debounced || undefined, limit };
  const list = useCalls(query);
  const [editing, setEditing] = React.useState<CallRow | null>(null);
  const changeView = (v: 'table' | 'activity') => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Remembering the view is a convenience only.
    }
  };
  const filtered = !!(outcome || status || direction || dialerId || hasRecording || from || to || debounced);
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
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search calls')} aria-label={t('Search calls')} className="h-9 w-full sm:w-56" />
        <span className="flex-1" />
        <div role="radiogroup" aria-label={t('View')} className="flex rounded-full bg-muted p-0.5">
          {(
            [
              ['table', 'Table', Table2],
              ['activity', 'Activity', LayoutList],
            ] as const
          ).map(([k, l, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => changeView(k)} className={cn('flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium', view === k ? 'bg-surface shadow-sm' : 'text-muted-foreground')}>
              <Icon aria-hidden className="size-3.5" /> {t(l)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label={t('Filters')}>
        <Select aria-label={t('Outcome')} className="h-9" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">{t('All outcomes')}</option>
          {outcomes.list.map((o) => (
            <option key={o.key} value={o.key}>
              {label(o)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('Status')} className="h-9" value={status} onChange={(e) => setStatus(e.target.value as CallStatus | '')}>
          <option value="">{t('Any status')}</option>
          {CALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.maybe(CALL_STATUS_LABELS[s])}
            </option>
          ))}
        </Select>
        <Select aria-label={t('Direction')} className="h-9" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
          <option value="">{t('In and out')}</option>
          <option value="OUTGOING">{t('Outgoing')}</option>
          <option value="INCOMING">{t('Incoming')}</option>
        </Select>
        <Select aria-label={t('Dialer')} className="h-9" value={dialerId} onChange={(e) => setDialerId(e.target.value)}>
          <option value="">{t('Any dialer')}</option>
          {dialers.data?.dialers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label={t('From')} className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} />
        <Input type="date" aria-label={t('To')} className="h-9" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hasRecording} onChange={(e) => setHasRecording(e.target.checked)} className="size-4" /> {t('With a recording')}
        </label>
        <label className="flex items-center gap-2">
          {t('Sort')}
          <Select aria-label={t('Sort')} className="h-8 w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            {CALL_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(SORT_LABEL[s])}
              </option>
            ))}
          </Select>
        </label>
        {filtered && (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => {
              setOutcome('');
              setStatus('');
              setDirection('');
              setDialerId('');
              setHasRecording(false);
              setFrom('');
              setTo('');
              setQ('');
            }}
          >
            {t('Clear filters')}
          </button>
        )}
      </div>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.error ? (
        <p role="alert" className="text-sm text-critical">
          {list.error.message}
        </p>
      ) : !list.data?.length ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{filtered ? t('No calls match these filters.') : t('No calls here yet.')}</p>
      ) : view === 'table' ? (
        <HistoryTable rows={list.data} scope={scope} onLog={onLog} onPick={onPick} onEdit={setEditing} onRecording={onRecording} />
      ) : (
        <HistoryActivity rows={list.data} scope={scope} onLog={onLog} onPick={onPick} onEdit={setEditing} onRecording={onRecording} />
      )}
      {list.data && list.data.length >= limit && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => Math.min(200, l + 50))} disabled={limit >= 200}>
            {t('Show more')}
          </Button>
        </div>
      )}
      <EditCallDialog call={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

type RowProps = { rows: CallRow[]; scope: Scope; onLog: (id: string) => void; onPick: (t: Target) => void; onEdit: (c: CallRow) => void; onRecording: (id: string) => void };

function Direction({ c }: { c: CallRow }) {
  const t = useT();
  return c.direction === 'INCOMING' ? (
    <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300" title={t('Incoming')}>
      <ArrowDownLeft aria-hidden className="size-3.5" /> <span className="sr-only">{t('Incoming')}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300" title={t('Outgoing')}>
      <ArrowUpRight aria-hidden className="size-3.5 rtl:-scale-x-100" /> <span className="sr-only">{t('Outgoing')}</span>
    </span>
  );
}

function StatusBadge({ c }: { c: CallRow }) {
  const t = useT();
  const tone = c.status === 'LOGGED' ? 'success' : c.status === 'FAILED' || c.status === 'MISSED' ? 'critical' : c.status === 'ENDED' || c.status === 'OPEN' ? 'warning' : 'primary';
  return <Badge tone={tone}>{c.status === 'ENDED' || c.status === 'OPEN' ? t('Not logged') : t.maybe(CALL_STATUS_LABELS[c.status])}</Badge>;
}

function Actions({ c, scope, onLog, onEdit }: { c: CallRow; scope: Scope; onLog: (id: string) => void; onEdit: (c: CallRow) => void }) {
  const t = useT();
  if (scope !== 'mine') return null;
  return c.status !== 'LOGGED' ? (
    <Button size="sm" onClick={() => onLog(c.id)}>
      {t('Log call')}
    </Button>
  ) : (
    <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit call')} onClick={() => onEdit(c)}>
      <Pencil aria-hidden className="size-3.5" />
    </Button>
  );
}

function HistoryTable({ rows, scope, onLog, onPick, onEdit, onRecording }: RowProps) {
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[68rem] text-sm" aria-label={t('Call history')}>
        <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
          <tr>
            {(['Date and time', 'Company', 'Contact', 'Phone', 'Called by', 'Dialer', 'Talk time', 'Status', 'Outcome', 'Next follow-up', ''] as const).map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-start font-medium">
                {h ? t(h as MessageKey) : <span className="sr-only">{t('Actions')}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((c) => (
            <tr key={c.id} data-testid="call-row" className="align-top hover:bg-muted/30">
              <td className="whitespace-nowrap px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <Direction c={c} /> {formatDateTime(c.startedAt)}
                </span>
              </td>
              <td className="px-3 py-2">
                {c.company ? (
                  <Link href={`/app/companies/${c.company.id}`} className="font-medium hover:underline">
                    {c.company.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                {c.deal && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300">
                    <Handshake aria-hidden className="size-3" /> {c.deal.name}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {c.employee ? (
                  <button type="button" className="text-start font-medium hover:underline" onClick={() => onPick({ companyId: c.company?.id ?? null, contactId: c.employee!.id })}>
                    {c.employee.name}
                  </button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                {c.employee?.designation && <span className="block text-xs text-muted-foreground">{c.employee.designation}</span>}
                {c.employee?.email && (
                  <a href={`mailto:${c.employee.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Mail aria-hidden className="size-3" /> {c.employee.email}
                  </a>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                {c.number}
                {c.callerId && <span className="block text-muted-foreground">{t('from {number}', { number: c.callerId })}</span>}
              </td>
              <td className="px-3 py-2 text-xs">{c.by?.name ?? '—'}</td>
              <td className="px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <ProviderMark provider={providerOf({ provider: c.dialer.provider ?? (c.dialer.id ? null : 'phone'), kind: c.dialer.kind })} size="sm" />
                  {c.dialer.name}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                {talkTime(c.durationSec)}
                {c.recording && (
                  <button type="button" onClick={() => onRecording(c.recording!.id)} className="mt-0.5 flex items-center gap-1 font-sans text-rose-700 hover:underline dark:text-rose-300">
                    <Disc aria-hidden className="size-3" /> {t('Recording')}
                  </button>
                )}
              </td>
              <td className="px-3 py-2">
                <StatusBadge c={c} />
              </td>
              <td className="px-3 py-2">
                {c.outcome ? <OutcomeChip outcome={c.outcome} /> : <span className="text-muted-foreground">—</span>}
                {c.remarks && <p className="mt-1 line-clamp-2 max-w-56 text-xs text-muted-foreground" title={c.remarks}>{c.remarks}</p>}
              </td>
              <td className="px-3 py-2 text-xs">{c.nextCall ? <span className={cn(c.nextCall.status !== 'OPEN' && 'line-through opacity-70')}>{formatDateTime(c.nextCall.dueAt)}</span> : '—'}</td>
              <td className="px-3 py-2 text-end">
                <Actions c={c} scope={scope} onLog={onLog} onEdit={onEdit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The activity view: calls by day, each one as a card on a timeline. */
function HistoryActivity({ rows, scope, onLog, onPick, onEdit, onRecording }: RowProps) {
  const t = useT();
  const { get } = useOutcomeLookup();
  const days = new Map<string, CallRow[]>();
  for (const c of rows) {
    const k = new Date(c.startedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    days.set(k, [...(days.get(k) ?? []), c]);
  }
  return (
    <div className="space-y-5" aria-label={t('Call history')}>
      {[...days.entries()].map(([day, list]) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</h3>
          <ol className="relative space-y-3 border-s-2 border-border ps-5">
            {list.map((c) => {
              const def = c.outcome ? get(c.outcome) : null;
              return (
                <li key={c.id} data-testid="call-row" className="relative rounded-xl border border-border bg-surface p-3">
                  <span aria-hidden className="absolute -start-[1.95rem] top-3 flex size-7 items-center justify-center rounded-full text-white ring-4 ring-surface" style={{ backgroundColor: readableOn(def?.color ?? '#64748b') }}>
                    {def ? <OutcomeIcon def={def} className="size-3.5" /> : <Timer className="size-3.5" />}
                  </span>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <Direction c={c} />
                        <button type="button" className="font-semibold hover:underline disabled:no-underline" disabled={!c.company && !c.employee} onClick={() => onPick({ companyId: c.company?.id ?? null, contactId: c.employee?.id ?? null })}>
                          {c.employee?.name ?? c.company?.name ?? c.number}
                        </button>
                        {c.employee && c.company && <span className="text-muted-foreground">{[c.employee.designation, c.company.name].filter(Boolean).join(' · ')}</span>}
                        {c.outcome ? <OutcomeChip outcome={c.outcome} /> : <StatusBadge c={c} />}
                      </p>
                      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{new Date(c.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                        <span className="font-mono">{c.number}</span>
                        <span className="inline-flex items-center gap-1">
                          <Timer aria-hidden className="size-3" /> {talkTime(c.durationSec)}
                        </span>
                        <span>{c.dialer.name}</span>
                        {c.by && scope !== 'mine' && <span>{t('By {name}', { name: c.by.name })}</span>}
                        {c.deal && (
                          <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
                            <Handshake aria-hidden className="size-3" /> {c.deal.name}
                          </span>
                        )}
                      </p>
                      {c.remarks && <p className="whitespace-pre-line text-sm">{c.remarks}</p>}
                      <div className="flex flex-wrap gap-2">
                        {c.nextCall && (
                          <span className={cn('inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300', c.nextCall.status !== 'OPEN' && 'line-through opacity-70')}>
                            <CalendarClock aria-hidden className="size-3" /> {t('Next follow-up {when}', { when: formatDateTime(c.nextCall.dueAt) })}
                          </span>
                        )}
                        {c.recording && (
                          <button type="button" onClick={() => onRecording(c.recording!.id)} className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs text-rose-700 hover:underline dark:text-rose-300">
                            <Disc aria-hidden className="size-3" /> {t('Play the recording')}
                          </button>
                        )}
                      </div>
                    </div>
                    <Actions c={c} scope={scope} onLog={onLog} onEdit={onEdit} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EditCallDialog({ call, onClose }: { call: CallRow | null; onClose: () => void }) {
  const t = useT();
  const m = useCallMutations();
  const outcomes = useOutcomeLookup();
  const label = useOutcomeLabel();
  const [outcome, setOutcome] = React.useState('CONNECTED');
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
      <DialogContent className="max-w-lg p-5">
        <DialogTitle className="text-lg font-semibold">{t('Edit call')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('The call on the company’s interactions changes too.')}</DialogDescription>
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
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {outcomes.list.filter((o) => o.active || o.key === call?.outcome).map((o) => (
                <option key={o.key} value={o.key}>
                  {label(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="edit-call-remarks" label={t('Notes')}>
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
