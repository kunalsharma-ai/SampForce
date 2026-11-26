'use client';

import { AVAILABILITY_LABEL, type AvailabilityMe, type AvailabilityStatus, CHOOSABLE_STATUSES, sessionMinutes, type WorkSessionView } from '@dealflow/types';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@dealflow/ui';
import { Check, ChevronDown, Coffee, LogIn, LogOut, Play, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type AvailabilityAction, minutesSince, useAvailability, useAvailabilityActions, useNow } from '@/lib/availability';
import { type MessageKey, useT } from '@/lib/i18n';

/** The colour of each status: a dot and a soft ring; text always stays the normal foreground colour for contrast. */
export const STATUS_TONE: Record<AvailabilityStatus, { dot: string; ring: string; glow: string }> = {
  WORKING: { dot: 'bg-success', ring: 'ring-success/40', glow: 'from-success/15' },
  AVAILABLE: { dot: 'bg-info', ring: 'ring-info/40', glow: 'from-info/15' },
  ON_BREAK: { dot: 'bg-warning', ring: 'ring-warning/40', glow: 'from-warning/20' },
  AWAY: { dot: 'bg-accent', ring: 'ring-accent/40', glow: 'from-accent/15' },
  CHECKED_OUT: { dot: 'bg-muted-foreground', ring: 'ring-border', glow: 'from-muted/40' },
};

/** A status dot; it pulses gently while the person is working or on a break. */
export function StatusDot({ status, className }: { status: AvailabilityStatus; className?: string }) {
  const live = status === 'WORKING' || status === 'ON_BREAK';
  return (
    <span aria-hidden className={cn('relative inline-flex size-2.5 shrink-0', className)}>
      {live && <span className={cn('absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping', STATUS_TONE[status].dot)} />}
      <span className={cn('relative inline-flex size-2.5 rounded-full', STATUS_TONE[status].dot)} />
    </span>
  );
}

/** "2 h 05 min" / "45 min", translated. */
export function useMinutes() {
  const t = useT();
  return (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? t('{h} h {m} min', { h, m: String(m).padStart(2, '0') }) : t('{m} min', { m });
  };
}

function liveMinutes(s: WorkSessionView | null, now: Date) {
  if (!s) return { breakMinutes: 0, workedMinutes: 0 };
  return sessionMinutes(
    { checkedInAt: new Date(s.checkedInAt), checkedOutAt: s.checkedOutAt ? new Date(s.checkedOutAt) : null, breaks: s.breaks.map((b) => ({ start: new Date(b.start), end: b.end ? new Date(b.end) : null })) },
    now,
  );
}

/** The words after the status: "09:42 AM" while working (since check-in), "12 min" on a break. */
function sinceText(me: AvailabilityMe, now: Date, time: (iso: string) => string, minutes: (n: number) => string): string | null {
  if (!me.since) return null;
  if (me.status === 'ON_BREAK' || me.status === 'AWAY') return minutes(minutesSince(me.since, now));
  if (me.status === 'CHECKED_OUT') return me.session?.checkedOutAt ? time(me.session.checkedOutAt) : null;
  return me.session ? time(me.session.checkedInAt) : null;
}

const ACTION_LABEL: Record<AvailabilityAction, MessageKey> = { 'check-in': 'Check in', break: 'Break', resume: 'Resume', 'check-out': 'Check out' };
const ACTION_ICON = { 'check-in': LogIn, break: Coffee, resume: Play, 'check-out': LogOut } as const;

/**
 * The header's working status (ADR 0081): a status pill with the time, and the next steps as buttons (Check in;
 * Break and Check out; Resume and Check out). The pill opens today's times and the status choice.
 */
export function StatusControl() {
  const t = useT();
  const me = useAvailability().data;
  const { act, choose } = useAvailabilityActions();
  const now = useNow(15_000);
  const minutes = useMinutes();
  const [open, setOpen] = useState(false);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(t.formatLocale, { hour: '2-digit', minute: '2-digit' });

  if (!me) return <span className="hidden h-control w-44 animate-pulse rounded-full bg-muted md:inline-block" aria-hidden />;

  const status = me.status;
  const since = sinceText(me, now, time, minutes);
  const label = t(AVAILABILITY_LABEL[status] as MessageKey);
  const actions: AvailabilityAction[] = status === 'CHECKED_OUT' ? ['check-in'] : status === 'ON_BREAK' ? ['resume', 'check-out'] : ['break', 'check-out'];
  const busy = act.isPending || choose.isPending;
  const mins = liveMinutes(me.session, now);
  const run = (a: AvailabilityAction) => act.mutate(a);

  return (
    <div className="flex items-center gap-1.5" data-availability={status}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={since ? t('Your status: {status}, {since}', { status: label, since }) : t('Your status: {status}', { status: label })}
            className={cn(
              'group relative flex h-control min-w-0 items-center gap-2 overflow-hidden rounded-full border border-border bg-gradient-to-r to-transparent px-3 text-sm ring-1 transition-[box-shadow,transform] duration-300 hover:shadow-md motion-safe:active:scale-[0.98]',
              STATUS_TONE[status].glow,
              STATUS_TONE[status].ring,
            )}
          >
            <StatusDot status={status} />
            <span key={status} className="whitespace-nowrap font-semibold motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1">
              {label}
            </span>
            {since && (
              <span className="hidden whitespace-nowrap text-muted-foreground tabular-nums xl:inline" data-status-since="">
                <span aria-hidden>— </span>
                {since}
              </span>
            )}
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className={cn('rounded-t-md bg-gradient-to-br to-transparent px-4 pb-3 pt-4', STATUS_TONE[status].glow)}>
            <p className="flex items-center gap-2 text-base font-semibold">
              <StatusDot status={status} /> {label}
              {since && <span className="font-normal text-muted-foreground">· {since}</span>}
            </p>
            {me.autoAway && <p className="mt-1 text-xs text-muted-foreground">{t('No SampForce page was open for a while, so you show as away. Any click brings you back.')}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-border px-4 py-3 text-sm" data-today-times="">
            <div>
              <dt className="text-xs text-muted-foreground">{t('Checked in')}</dt>
              <dd className="font-medium tabular-nums">{me.session ? time(me.session.checkedInAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('Checked out')}</dt>
              <dd className="font-medium tabular-nums">{me.session?.checkedOutAt ? time(me.session.checkedOutAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('Worked today')}</dt>
              <dd className="font-medium tabular-nums">{minutes(mins.workedMinutes)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('Breaks')}</dt>
              <dd className="font-medium tabular-nums">
                {t('{n} · {time}', { n: me.session?.breaks.length ?? 0, time: minutes(mins.breakMinutes) })}
              </dd>
            </div>
          </dl>
          {status !== 'CHECKED_OUT' && (
            <div className="px-2 py-2" role="group" aria-label={t('Set your status')}>
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t('Set your status')}</p>
              {CHOOSABLE_STATUSES.map((s) => {
                const current = status === s && !me.autoAway;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    aria-pressed={current}
                    onClick={() => choose.mutate(s)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
                  >
                    <StatusDot status={s} />
                    <span className="flex-1 text-start">{t(AVAILABILITY_LABEL[s] as MessageKey)}</span>
                    {current && <Check className="size-4 text-primary" aria-hidden />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
            {actions.map((a) => {
              const Icon = ACTION_ICON[a];
              return (
                <Button key={a} size="sm" variant={a === 'check-out' ? 'outline' : 'default'} disabled={busy} onClick={() => run(a)} className="flex-1">
                  <Icon aria-hidden /> {t(ACTION_LABEL[a])}
                </Button>
              );
            })}
          </div>
          <Link href="/app/team-status" onClick={() => setOpen(false)} className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <Users className="size-4" aria-hidden /> {t('Team status')}
          </Link>
        </PopoverContent>
      </Popover>
      <div className="hidden items-center gap-1.5 md:flex">
        {actions.map((a, i) => {
          const Icon = ACTION_ICON[a];
          return (
            <Button
              key={a}
              size="sm"
              variant={i === 0 ? (a === 'break' ? 'outline' : 'default') : 'ghost'}
              disabled={busy}
              onClick={() => run(a)}
              className={cn('whitespace-nowrap', a === 'check-out' && 'hidden lg:inline-flex')}
              data-availability-action={a}
            >
              <Icon aria-hidden /> {t(ACTION_LABEL[a])}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
