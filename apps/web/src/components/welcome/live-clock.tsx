'use client';

import { cn } from '@dealflow/ui';
import * as React from 'react';

/** The current time, updated on each new second (null until the page runs in the browser, so the server and the first paint agree). */
export function useNow(): Date | null {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 1000 - d.getMilliseconds() + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/** Splits the time into the parts the clock draws, in the reader's language and clock style (12 or 24 hours). */
export function clockParts(d: Date, locale?: string) {
  const parts = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const zone = new Intl.DateTimeFormat(locale, { timeZoneName: 'long' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return {
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
    dayPeriod: part('dayPeriod'),
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d),
    date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d),
    zone,
  };
}

/**
 * A live clock for the welcome banner (Kunal, 2026-11-27): the day, the date with month and year, and the hours,
 * minutes and seconds, in the person's own time zone and language. It is a timer (not announced on every tick) and
 * is drawn in the workspace's colours, with a seconds bar that fills over each minute.
 */
export function LiveClock({ locale, label, className }: { locale?: string; label: string; className?: string }) {
  const now = useNow();
  const p = now ? clockParts(now, locale) : null;
  const seconds = now?.getSeconds() ?? 0;
  return (
    <div role="timer" aria-label={label} data-welcome-clock className={cn('sf-clock', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground" data-clock-weekday>
          <span aria-hidden className="sf-clock-dot" />
          {p?.weekday ?? ' '}
        </div>
        <time dateTime={now?.toISOString()} className="flex items-center gap-1.5 font-black leading-none tabular-nums text-foreground" data-clock-time>
          <span className="text-3xl tracking-tight sm:text-4xl">
            {p?.hour ?? '--'}
            <span aria-hidden className="sf-clock-colon">
              :
            </span>
            {p?.minute ?? '--'}
          </span>
          <span className="sf-clock-seconds" data-clock-seconds>
            {p?.second ?? '--'}
          </span>
          {p?.dayPeriod && <span className="text-xs font-bold uppercase text-muted-foreground">{p.dayPeriod}</span>}
        </time>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 sf-clock-meta">
        <span className="text-sm font-semibold text-foreground" data-clock-date>
          {p?.date ?? ' '}
        </span>
        <span className="truncate text-xs text-muted-foreground" data-clock-zone>
          {p?.zone ?? ' '}
        </span>
      </div>
      <span aria-hidden className="sf-clock-bar">
        <span key={seconds === 0 ? 'start' : 'run'} style={{ transform: `scaleX(${(seconds + 1) / 60})` }} />
      </span>
    </div>
  );
}
