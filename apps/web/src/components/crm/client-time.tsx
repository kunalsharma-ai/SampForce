'use client';

import {
  type CompanyAddress,
  type ConnectAdvice,
  countryOfZone,
  countryProfile,
  formatDuration,
  type Place,
  standardHours,
  wallClock,
  type WorkingHours,
  zoneAbbreviation,
  zoneOffset,
} from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, CalendarOff, Clock3, Coins, Globe2, Hash, Moon, Phone, Pencil, Sparkles, Sun, Sunrise, Sunset, ThumbsUp, Timer } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { type ClientTime, useClientTime } from '@/lib/client-time';
import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { CountryFlag } from './status-chip';

/*
 * Client time and the best time to connect (ADR 0088): their clock next to mine, why now is (or is not) a good moment,
 * their working day drawn on my clock, and the country facts (codes, region, currency) from the address. Everything is
 * worked out from offline data, so existing companies show it as soon as their country is known.
 */

type Tone = ConnectAdvice['tone'];

const STATUS: Record<ConnectAdvice['status'], { title: MessageKey; icon: typeof Sun }> = {
  perfect: { title: 'Perfect timing', icon: ThumbsUp },
  'ending-soon': { title: 'Working hours ending soon', icon: Timer },
  'starting-soon': { title: 'Their day starts soon', icon: Sunrise },
  outside: { title: 'Outside their working hours', icon: Moon },
  weekend: { title: 'Weekend there', icon: CalendarOff },
  holiday: { title: 'Public holiday there', icon: CalendarOff },
  unknown: { title: 'Time unknown', icon: Clock3 },
};

const TONE_CLASS: Record<Tone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  critical: 'border-critical/40 bg-critical/10 text-critical',
  info: 'border-info/40 bg-info/10 text-info',
};

/** The sky at that hour, dark enough that white text stays readable at every stop. */
function sky(minutes: number): { background: string; icon: typeof Sun; label: MessageKey } {
  const h = minutes / 60;
  if (h >= 5 && h < 7.5) return { background: 'linear-gradient(135deg,#9a3412 0%,#be185d 100%)', icon: Sunrise, label: 'Morning' };
  if (h >= 7.5 && h < 17) return { background: 'linear-gradient(135deg,#0369a1 0%,#1e40af 100%)', icon: Sun, label: 'Daytime' };
  if (h >= 17 && h < 20) return { background: 'linear-gradient(135deg,#86198f 0%,#9a3412 100%)', icon: Sunset, label: 'Evening' };
  return { background: 'linear-gradient(135deg,#1e1b4b 0%,#0f172a 100%)', icon: Moon, label: 'Night' };
}

function timeIn(zone: string, at: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(at);
}
function dayIn(zone: string, at: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
}
function weekdayName(day: number, locale: string, style: 'long' | 'short' = 'long'): string {
  // 4 January 1970 was a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(1970, 0, 4 + day)));
}
function daysLabel(days: number[], locale: string): string {
  const sorted = [...days].sort();
  // Runs read as "Mon–Fri"; anything else is listed.
  const run = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (run && sorted.length > 2) return `${weekdayName(sorted[0]!, locale, 'short')}–${weekdayName(sorted[sorted.length - 1]!, locale, 'short')}`;
  return sorted.map((d) => weekdayName(d, locale, 'short')).join(', ');
}

function AnalogClock({ minutes, label }: { minutes: number; label: string }) {
  const hour = ((minutes / 60) % 12) * 30;
  const minute = (minutes % 60) * 6;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 drop-shadow-md sm:size-20" role="img" aria-label={label}>
      <circle cx="32" cy="32" r="30" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="32" y1="5" x2="32" y2={i % 3 === 0 ? 10 : 8} stroke="white" strokeWidth={i % 3 === 0 ? 2.2 : 1.2} strokeLinecap="round" transform={`rotate(${i * 30} 32 32)`} opacity={0.85} />
      ))}
      <line x1="32" y1="32" x2="32" y2="17" stroke="white" strokeWidth="3.2" strokeLinecap="round" transform={`rotate(${hour} 32 32)`} />
      <line x1="32" y1="32" x2="32" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round" transform={`rotate(${minute} 32 32)`} />
      <circle cx="32" cy="32" r="2.6" fill="#fbbf24" />
    </svg>
  );
}

function ClockFace({ who, zone, place, now, testId }: { who: string; zone: string; place: React.ReactNode; now: Date; testId: string }) {
  const t = useT();
  const local = wallClock(zone, now);
  const s = sky(local.minutes);
  const time = timeIn(zone, now, t.formatLocale);
  const abbr = zoneAbbreviation(zone, now);
  return (
    <div className="relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl p-3 text-white shadow-inner sm:gap-4 sm:p-4" style={{ background: s.background }} data-testid={testId}>
      <s.icon aria-hidden className="pointer-events-none absolute -end-3 -top-3 size-20 opacity-15" />
      <AnalogClock minutes={local.minutes} label={`${who}: ${time} ${abbr}`} />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/85">{who}</p>
        <p className="flex flex-wrap items-baseline gap-x-2 leading-tight">
          <span className="text-2xl font-extrabold tabular-nums sm:text-3xl" data-clock-time>
            {time}
          </span>
          <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-bold" data-clock-abbr>
            {abbr}
          </span>
        </p>
        <p className="truncate text-sm text-white/90">
          {dayIn(zone, now, t.formatLocale)} · {t(s.label)}
        </p>
        <p className="truncate text-xs text-white/85">{place}</p>
      </div>
    </div>
  );
}

/** Their working day drawn on my 24-hour clock, with the best slot, my own hours and now. */
function DayStrip({ ct, now }: { ct: ClientTime; now: Date }) {
  const t = useT();
  const a = ct.advice!;
  const myZone = ct.me.timeZone;
  const dayStart = useMemo(() => {
    const c = wallClock(myZone, now);
    return now.getTime() - c.minutes * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
  }, [myZone, now]);
  const pct = (at: Date) => ((at.getTime() - dayStart) / 86_400_000) * 100;
  // Their hours repeat every day, so draw today's and the neighbouring days' windows that touch my day.
  const segments = (w: { start: Date; end: Date } | null) => {
    if (!w) return [];
    const out: { left: number; width: number }[] = [];
    for (const shift of [-1, 0, 1]) {
      const s = pct(new Date(w.start.getTime() + shift * 86_400_000));
      const e = pct(new Date(w.end.getTime() + shift * 86_400_000));
      const left = Math.max(0, s);
      const right = Math.min(100, e);
      if (right > left) out.push({ left, width: right - left });
    }
    return out;
  };
  const toMin = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  const myStart = (toMin(ct.me.start) / 1440) * 100;
  const myEnd = (toMin(ct.me.end) / 1440) * 100;
  const nowPct = pct(now);
  const mine = myStart <= myEnd ? [{ left: myStart, width: myEnd - myStart }] : [{ left: 0, width: myEnd }, { left: myStart, width: 100 - myStart }];
  const myAbbr = zoneAbbreviation(myZone, now);
  return (
    <figure className="space-y-1.5" aria-label={t('Their working day on your clock')}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{t('Their working day on your clock ({zone})', { zone: myAbbr })}</span>
        <span className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-4 rounded-sm bg-success/45" />{t('Their working hours')}</span>
          <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-4 rounded-sm bg-success" />{t('Best time')}</span>
          <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-4 rounded-sm border border-dashed border-primary" />{t('Your calling hours')}</span>
        </span>
      </figcaption>
      <div className="relative h-9 overflow-hidden rounded-lg border border-border bg-muted/50" data-testid="day-strip">
        {mine.map((m, i) => (
          <span key={`m${i}`} aria-hidden className="absolute inset-y-1 rounded-md border border-dashed border-primary/70" style={{ insetInlineStart: `${m.left}%`, width: `${m.width}%` }} />
        ))}
        {segments(a.window).map((s, i) => (
          <span key={`w${i}`} aria-hidden className="absolute inset-y-2 rounded bg-success/45" style={{ insetInlineStart: `${s.left}%`, width: `${s.width}%` }} />
        ))}
        {segments(a.best).map((s, i) => (
          <span key={`b${i}`} aria-hidden className="absolute inset-y-2 rounded bg-success" style={{ insetInlineStart: `${s.left}%`, width: `${s.width}%` }} />
        ))}
        <span aria-hidden className="absolute inset-y-0 w-0.5" style={{ insetInlineStart: `${nowPct}%`, background: '#b91c1c', boxShadow: '0 0 6px #ef4444' }}>
          <span className={cn('absolute -top-0.5 whitespace-nowrap rounded px-1 text-[10px] font-bold leading-4 text-white', nowPct > 90 ? 'end-1' : 'start-1')} style={{ background: '#b91c1c' }}>{t('Now')}</span>
        </span>
      </div>
      <div aria-hidden className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{timeIn('UTC', new Date(Date.UTC(1970, 0, 1, h % 24)), t.formatLocale)}</span>
        ))}
      </div>
    </figure>
  );
}

/** Why now is or is not a good time, in words, with both clocks. */
export function adviceText(t: ReturnType<typeof useT>, ct: ClientTime, placeName: string, countryLabel: string): string {
  const a = ct.advice!;
  const loc = t.formatLocale;
  const now = new Date();
  const their = (d: Date) => timeIn(a.clientZone, d, loc);
  const mine = (d: Date) => `${timeIn(a.myZone, d, loc)} ${zoneAbbreviation(a.myZone, d)}`;
  const when = (d: Date) => `${dayIn(a.clientZone, d, loc)}, ${their(d)}`;
  const w = a.window;
  let text: string;
  switch (a.status) {
    case 'perfect':
      text = t('It is {time} in {place}, inside their working hours ({start} to {end}). They have {left} of their day left, so this is a good time to connect.', { time: their(now), place: placeName, start: their(w!.start), end: their(w!.end), left: formatDuration(a.minutes ?? 0) });
      break;
    case 'ending-soon':
      text = t('Their working day ends at {end} ({mine}), in {left}. Contact them now, or plan for their next working day.', { end: their(w!.end), mine: mine(w!.end), left: formatDuration(a.minutes ?? 0) });
      break;
    case 'starting-soon':
      text = t('Their working day starts at {start} ({mine}), in {left}. Wait a little, so your message arrives at the top of their inbox.', { start: their(w!.start), mine: mine(w!.start), left: formatDuration(a.minutes ?? 0) });
      break;
    case 'weekend':
      text = t('It is {day} in {place}, their weekend. Their next working day starts {when} ({mine}). Consider contacting them then.', { day: weekdayName(wallClock(a.clientZone, now).weekday, loc), place: placeName, when: w ? when(w.start) : '—', mine: w ? mine(w.start) : '—' });
      break;
    case 'holiday':
      text = t('Today is {holiday} in {country}, a public holiday. Their next working day starts {when} ({mine}).', { holiday: a.holiday!.name, country: countryLabel, when: w ? when(w.start) : '—', mine: w ? mine(w.start) : '—' });
      break;
    default:
      text = t('It is {time} in {place}, outside their working hours. Their next working day starts {when} ({mine}), in {left}. Consider scheduling your call or email for then.', { time: their(now), place: placeName, when: w ? when(w.start) : '—', mine: w ? mine(w.start) : '—', left: formatDuration(a.minutes ?? 0) });
  }
  if ((a.status === 'perfect' || a.status === 'ending-soon') && !ct.advice!.insideMyHours) text += ` ${t('It is outside your own calling hours ({start} to {end}), so only reach out if you are free.', { start: ct.me.start, end: ct.me.end })}`;
  return text;
}

export interface ClientTimeSubject {
  kind: 'company' | 'contact';
  id: string;
  /** Who is being contacted, for the sentences. */
  name: string;
  place: Place;
  /** The record's own working hours. */
  hours: unknown;
  /** For an employee: their company's hours, used when they have none of their own. */
  companyHours?: unknown;
  /** For an employee whose location is their company's. */
  placeFromCompany?: boolean;
  /** A company's further offices; picking one shows its time instead of the head office's. */
  offices?: CompanyAddress[];
}

/** The header card. Lives near the top of the company and employee pages. */
export function ClientTimeCard({ subject }: { subject: ClientTimeSubject }) {
  const t = useT();
  const id = useId();
  const [office, setOffice] = useState(-1);
  const offices = (subject.offices ?? []).filter((o) => o.country);
  const chosen = office >= 0 ? offices[office] : null;
  const place: Place = chosen ? { country: chosen.country, state: chosen.state, city: chosen.city } : subject.place;
  const ct = useClientTime(place, chosen ? null : subject.hours, subject.companyHours);
  const [editing, setEditing] = useState(false);
  const now = new Date();
  const profile = countryProfile(place.country, t.formatLocale);
  const placeName = [...new Set([place.city, place.state, profile?.name].filter(Boolean))].join(', ') || profile?.name || '';

  if (!profile || !ct.zone.zone || !ct.advice) {
    return (
      <section aria-labelledby={`${id}-t`} data-testid="client-time" className="mb-4 flex items-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-4">
        <Globe2 aria-hidden className="size-6 shrink-0 text-primary" />
        <div>
          <h2 id={`${id}-t`} className="text-sm font-semibold">{t('Client time and best time to connect')}</h2>
          <p className="text-sm text-muted-foreground">{t('Add the country of the headquarters (or of this employee) to see their local time and the best time to connect.')}</p>
        </div>
      </section>
    );
  }

  const a = ct.advice;
  const status = STATUS[a.status];
  const myProfile = countryProfile(countryOfZone(ct.me.timeZone), t.formatLocale);
  const diff = a.difference;
  const myAbbr = zoneAbbreviation(ct.me.timeZone, now);
  const theirAbbr = zoneAbbreviation(a.clientZone, now);
  const relation = diff === 0 ? t('Same time as you') : diff > 0 ? t('You are {diff} ahead', { diff: formatDuration(diff) }) : t('You are {diff} behind', { diff: formatDuration(diff) });
  const h = ct.hours;
  const hoursWindow = a.window;
  const hoursNote: MessageKey = ct.hoursFrom === 'company' ? 'From the company' : h.source === 'website' ? 'Published on their website' : h.source === 'user' ? 'Set by you' : 'Usual office day there, estimated';
  const zoneNote: MessageKey | null =
    ct.zone.basis === 'record' ? 'Saved on the record' : ct.zone.basis === 'state' || ct.zone.basis === 'city' ? (subject.kind === 'contact' && !subject.placeFromCompany && !chosen ? 'From the employee’s location' : 'From the address') : ct.zone.exact ? 'From the country' : null;
  const offset = zoneOffset(a.clientZone, now);
  const utc = `UTC${offset < 0 ? '−' : '+'}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, '0')}` : ''}`;

  return (
    <section aria-labelledby={`${id}-t`} data-testid="client-time" data-status={a.status} className="relative mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-accent to-success" />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-t`} className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Globe2 aria-hidden className="size-4 text-primary" /> {t('Global contact intelligence')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {offices.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {t('Office')}
                <select className="h-8 max-w-48 rounded-md border border-input bg-surface px-2 text-xs text-foreground" value={office} onChange={(e) => setOffice(Number(e.target.value))}>
                  <option value={-1}>{t('Headquarters')}</option>
                  {offices.map((o, i) => (
                    <option key={i} value={i}>
                      {[o.label, o.city, o.country].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold', TONE_CLASS[a.tone])} data-testid="client-time-badge">
              <status.icon aria-hidden className="size-3.5" />
              {t(status.title)}
            </span>
          </div>
        </div>

        <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
          <ClockFace who={t('Their time')} zone={a.clientZone} now={now} testId="their-clock" place={<><CountryFlag code={profile.code} decorative /> {placeName}</>} />
          <div className="flex flex-row items-center justify-center gap-2 text-center md:flex-col md:px-1">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold tabular-nums text-primary" data-testid="time-difference">
              {diff === 0 ? '±0' : `${diff > 0 ? '+' : '−'}${formatDuration(diff)}`}
            </span>
            <span className="max-w-32 text-xs text-muted-foreground">{relation}</span>
          </div>
          <ClockFace who={t('Your time')} zone={ct.me.timeZone} now={now} testId="my-clock" place={myProfile ? <><CountryFlag code={myProfile.code} decorative /> {myProfile.name}</> : ct.me.timeZone.replace(/_/g, ' ')} />
        </div>

        <div role="status" className={cn('flex items-start gap-3 rounded-xl border p-3', TONE_CLASS[a.tone])}>
          <status.icon aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 text-foreground">
            <p className="font-semibold">{t(status.title)}</p>
            <p className="text-sm" data-testid="client-time-advice">{adviceText(t, ct, placeName, profile.name)}</p>
          </div>
        </div>

        <DayStrip ct={ct} now={now} />

        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="country-facts">
          <Fact icon={Globe2} label={t('Country and region')}>
            <span className="inline-flex items-center gap-1.5"><CountryFlag code={profile.code} decorative /> {profile.name}</span>
            <span className="block text-xs text-muted-foreground">{profile.region} · {profile.subregion}</span>
          </Fact>
          <Fact icon={Hash} label={t('Country codes')}>
            <span className="font-mono" data-testid="iso-codes">{profile.code} · {profile.alpha3}</span>
            <span className="block text-xs text-muted-foreground">{t('Calling code {code}', { code: profile.callingCode })}</span>
          </Fact>
          <Fact icon={Coins} label={t('Currency')}>
            <span data-testid="currency"><span className="font-bold">{profile.currency.symbol}</span> {profile.currency.code}</span>
            <span className="block text-xs text-muted-foreground">{profile.currency.name}</span>
          </Fact>
          <Fact icon={Clock3} label={t('Time zone')}>
            <span className="break-all font-mono text-xs" data-testid="iana-zone">{a.clientZone}</span>
            <span className="block text-xs text-muted-foreground">
              {theirAbbr} · {utc}
              {zoneNote && <> · {t(zoneNote)}</>}
            </span>
          </Fact>
          <Fact icon={Sun} label={t('Working hours')} wide>
            <span data-testid="working-hours">
              {daysLabel(h.days, t.formatLocale)}, {h.start}–{h.end} {theirAbbr}
              {hoursWindow && <> → {timeIn(ct.me.timeZone, hoursWindow.start, t.formatLocale)}–{timeIn(ct.me.timeZone, hoursWindow.end, t.formatLocale)} {myAbbr}</>}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {t(hoursNote)}
              {!chosen && (
                <button type="button" className="inline-flex min-h-6 items-center gap-1 font-medium text-primary hover:underline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden className="size-3" /> {t('Edit working hours')}
                </button>
              )}
            </span>
          </Fact>
          <Fact icon={Sparkles} label={t('Best time to reach them')} wide>
            {a.best ? (
              <span data-testid="best-window">
                {timeIn(a.clientZone, a.best.start, t.formatLocale)}–{timeIn(a.clientZone, a.best.end, t.formatLocale)} {theirAbbr} → {timeIn(ct.me.timeZone, a.best.start, t.formatLocale)}–{timeIn(ct.me.timeZone, a.best.end, t.formatLocale)} {myAbbr}
              </span>
            ) : (
              '—'
            )}
            <span className="block text-xs text-muted-foreground">
              {a.best && dayIn(a.clientZone, a.best.start, t.formatLocale)} · {t('Late morning, after they settle in')}
            </span>
          </Fact>
          <Fact icon={AlarmClock} label={t('Public holidays')} wide>
            <Holidays ct={ct} />
          </Fact>
        </dl>
        {!ct.zone.exact && (
          <p className="text-xs font-medium text-warning" data-testid="zone-guess">
            {t('{country} has several time zones. Add the state or city for an exact time; this shows {zone}.', { country: profile.name, zone: a.clientZone })}
          </p>
        )}
      </div>
      {editing && <WorkingHoursDialog subject={subject} hours={ct.hoursFrom === 'record' ? h : null} fallback={standardHours(place.country)} onClose={() => setEditing(false)} />}
    </section>
  );
}

function Holidays({ ct }: { ct: ClientTime }) {
  const t = useT();
  if (ct.holidaysCovered === null) return <span className="text-muted-foreground">…</span>;
  if (!ct.holidaysCovered) return <span className="text-muted-foreground">{t('Not checked for this country')}</span>;
  const a = ct.advice!;
  if (a.holiday) return <span data-testid="holiday">{t('Today: {name}', { name: a.holiday.name })}</span>;
  const next = ct.holidays[0];
  if (!next) return <span className="text-muted-foreground" data-testid="holiday">{t('None in the next three weeks')}</span>;
  const date = new Intl.DateTimeFormat(t.formatLocale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${next.date}T12:00:00Z`));
  return <span data-testid="holiday">{t('Next: {name}, {date}', { name: next.name, date })}</span>;
}

function Fact({ icon: Icon, label, children, wide }: { icon: typeof Sun; label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0 space-y-1 rounded-xl border border-border bg-background/60 p-3', wide && 'lg:col-span-2')}>
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        {label}
      </dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function WorkingHoursDialog({ subject, hours, fallback, onClose }: { subject: ClientTimeSubject; hours: WorkingHours | null; fallback: WorkingHours; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<WorkingHours>(hours ?? { ...fallback, source: 'user' });
  const entity = subject.kind === 'company' ? 'companies' : 'contacts';
  const save = useMutation({
    mutationFn: (value: WorkingHours | null) => api(`/${entity}/${subject.id}`, { method: 'PATCH', json: { workingHours: value } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [entity, 'detail', subject.id] });
      onClose();
    },
  });
  const valid = draft.days.length > 0 && draft.start < draft.end;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle>{t('Working hours of {name}', { name: subject.name })}</DialogTitle>
        <DialogDescription>{t('On their own clock. The card converts them to your time.')}</DialogDescription>
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium">{t('Working days')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = draft.days.includes(d);
              return (
                <label key={d} className={cn('inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm', on ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>
                  <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={on} onChange={() => setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort() })} />
                  {weekdayName(d, t.formatLocale, 'short')}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm font-medium" htmlFor={`${id}-s`}>
            {t('Starts')}
            <input id={`${id}-s`} type="time" className="h-control w-full rounded-md border border-input bg-surface px-3" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </label>
          <label className="space-y-1 text-sm font-medium" htmlFor={`${id}-e`}>
            {t('Ends')}
            <input id={`${id}-e`} type="time" className="h-control w-full rounded-md border border-input bg-surface px-3" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
        </div>
        {!valid && <p className="mt-2 text-sm text-critical">{t('Choose at least one day, and an end after the start.')}</p>}
        {save.error && <p role="alert" className="mt-2 text-sm text-critical">{save.error.message}</p>}
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <Button variant="ghost" disabled={save.isPending || !hours} onClick={() => save.mutate(null)}>
            {t('Use the usual hours')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button disabled={!valid || save.isPending} onClick={() => save.mutate({ ...draft, source: 'user' })}>{t('Save')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── "Is now a good time?" before an email or call ─────────────

/**
 * Wraps a page: every email or call link inside it (mailto:, tel:, or a button marked data-connect="email|call")
 * first asks whether now is a good time to reach the client, with their time, mine and why. Nothing is ever blocked:
 * "Yes, connect now" goes ahead at once, and the question can be switched off in Settings or from the dialog.
 */
export function ConnectCheck({ subject, children }: { subject: ClientTimeSubject; children: React.ReactNode }) {
  const ct = useClientTime(subject.place, subject.hours, subject.companyHours);
  const [pending, setPending] = useState<{ kind: 'email' | 'call'; go: () => void } | null>(null);
  const onClickCapture = (e: React.MouseEvent) => {
    if (!ct.me.confirmBeforeContact || !ct.advice) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('a[href^="mailto:"], a[href^="tel:"], [data-connect]');
    if (!el || el.dataset.connectApproved === '1') return;
    const kind = el.dataset.connect === 'call' || el.getAttribute('href')?.startsWith('tel:') ? 'call' : 'email';
    e.preventDefault();
    e.stopPropagation();
    setPending({
      kind,
      go: () => {
        el.dataset.connectApproved = '1';
        el.click();
        delete el.dataset.connectApproved;
      },
    });
  };
  return (
    <div onClickCapture={onClickCapture}>
      {children}
      {pending && <ConnectDialog subject={subject} ct={ct} kind={pending.kind} onCancel={() => setPending(null)} onGo={() => { const go = pending.go; setPending(null); go(); }} />}
    </div>
  );
}

function ConnectDialog({ subject, ct, kind, onCancel, onGo }: { subject: ClientTimeSubject; ct: ClientTime; kind: 'email' | 'call'; onCancel: () => void; onGo: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [stopAsking, setStopAsking] = useState(false);
  const a = ct.advice!;
  const status = STATUS[a.status];
  const now = new Date();
  const profile = countryProfile(subject.place.country, t.formatLocale);
  const placeName = [subject.place.city, profile?.name].filter(Boolean).join(', ');
  const go = async () => {
    if (stopAsking) {
      const body = { ...ct.me, confirmBeforeContact: false };
      await api('/me/contact-times', { method: 'PUT', json: body }).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ['me', 'contact-times'] });
    }
    onGo();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg p-6" data-testid="connect-check">
        <DialogTitle className="flex items-center gap-2">
          {kind === 'call' ? <Phone aria-hidden className="size-5 text-primary" /> : <Sparkles aria-hidden className="size-5 text-primary" />}
          {kind === 'call' ? t('Call {name} now?', { name: subject.name }) : t('Email {name} now?', { name: subject.name })}
        </DialogTitle>
        <DialogDescription>{t('A quick check of their local time before you reach out.')}</DialogDescription>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl p-3 text-white" style={{ background: sky(wallClock(a.clientZone, now).minutes).background }}>
            <p className="text-xs font-semibold uppercase text-white/85">{t('Their time')}</p>
            <p className="text-xl font-extrabold tabular-nums">{timeIn(a.clientZone, now, t.formatLocale)} <span className="text-xs">{zoneAbbreviation(a.clientZone, now)}</span></p>
          </div>
          <div className="rounded-xl p-3 text-white" style={{ background: sky(wallClock(a.myZone, now).minutes).background }}>
            <p className="text-xs font-semibold uppercase text-white/85">{t('Your time')}</p>
            <p className="text-xl font-extrabold tabular-nums">{timeIn(a.myZone, now, t.formatLocale)} <span className="text-xs">{zoneAbbreviation(a.myZone, now)}</span></p>
          </div>
        </div>
        <div className={cn('mt-3 flex items-start gap-3 rounded-xl border p-3', TONE_CLASS[a.tone])}>
          <status.icon aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="text-foreground">
            <p className="font-semibold">{t(status.title)}</p>
            <p className="text-sm">{adviceText(t, ct, placeName, profile?.name ?? '')}</p>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={stopAsking} onChange={(e) => setStopAsking(e.target.checked)} />
          {t('Don’t ask me again (you can turn it back on in Settings)')}
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>{t('Not now')}</Button>
          <Button onClick={() => void go()} data-testid="connect-go">
            {kind === 'call' ? t('Yes, call now') : t('Yes, email now')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
