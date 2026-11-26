import { z } from 'zod';
import { GEO_COUNTRY_ROWS } from './geo-countries';
import { GEO_CITY_ZONES, GEO_COUNTRY_FACTS, GEO_STATE_ZONES } from './geo-zones';

/**
 * Client time and the best time to connect (ADR 0088). Everything here is worked out from the company's (or the
 * employee's) address with the offline country and zone data: no AI and no outside service. Daylight saving comes from
 * the IANA rules in the platform's Intl data, never from a fixed offset.
 */

// ───────────── Country profile ─────────────

export const WORLD_REGIONS = ['APAC', 'MENA', 'Europe', 'North America', 'Central America & Caribbean', 'South America', 'Sub-Saharan Africa', 'Antarctica'] as const;
export type WorldRegion = (typeof WORLD_REGIONS)[number];

/** The Middle East and North Africa, as sales teams usually draw it (the Arab League plus Iran and Israel). */
const MENA = new Set(['AE', 'BH', 'DZ', 'EG', 'IQ', 'IR', 'IL', 'JO', 'KW', 'LB', 'LY', 'MA', 'MR', 'OM', 'PS', 'QA', 'SA', 'SD', 'SY', 'TN', 'YE', 'EH']);
const NORTH_AMERICA = new Set(['US', 'CA', 'BM', 'GL', 'PM', 'UM']);

function regionOf(code: string, subregion: string): WorldRegion {
  if (MENA.has(code)) return 'MENA';
  if (NORTH_AMERICA.has(code)) return 'North America';
  if (subregion === 'South America') return 'South America';
  if (subregion === 'Central America' || subregion === 'Caribbean' || code === 'MX') return 'Central America & Caribbean';
  if (/Europe/.test(subregion)) return 'Europe';
  if (/Africa/.test(subregion)) return 'Sub-Saharan Africa';
  if (/Asia|Australia|Melanesia|Micronesia|Polynesia/.test(subregion)) return 'APAC';
  return code === 'AQ' ? 'Antarctica' : 'APAC';
}

export interface CountryProfile {
  /** ISO 3166-1 alpha-2, such as US. */
  code: string;
  /** ISO 3166-1 alpha-3, such as USA. */
  alpha3: string;
  name: string;
  /** International dialling code with the plus, such as +1. */
  callingCode: string;
  region: WorldRegion;
  /** UN subregion, such as Northern Europe. */
  subregion: string;
  currency: { code: string; name: string; symbol: string };
  /** Every IANA zone the country uses; the first is where most of its business runs. */
  zones: string[];
}

const ROWS = new Map(GEO_COUNTRY_ROWS.map((r) => [r[0], r]));

function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}
function currencySymbol(code: string, locale: string): string {
  try {
    const narrow = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value;
    const plain = new Intl.NumberFormat(locale, { style: 'currency', currency: code }).formatToParts(0).find((p) => p.type === 'currency')?.value;
    // "$" alone is ambiguous between dollars, so a non-US dollar keeps its prefix (A$, CA$); others take the narrow sign.
    if (narrow === '$' && plain && plain !== '$' && code !== 'USD') return plain;
    return narrow ?? plain ?? code;
  } catch {
    return code;
  }
}

/** Codes, region and currency of a country, or null for an unknown code. Names come in the reader's language. */
export function countryProfile(code: string | null | undefined, locale = 'en'): CountryProfile | null {
  const cc = code?.trim().toUpperCase();
  const row = cc ? ROWS.get(cc) : undefined;
  if (!cc || !row) return null;
  const [alpha3, subregion, main] = GEO_COUNTRY_FACTS[cc] ?? ['', '', row[4][0] ?? 'UTC'];
  let name = row[1];
  try {
    name = new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(cc) ?? name;
  } catch {
    /* English name */
  }
  const zones = [main, ...row[4].filter((z) => z !== main)];
  return {
    code: cc,
    alpha3,
    name,
    callingCode: `+${row[2]}`,
    region: regionOf(cc, subregion),
    subregion,
    currency: { code: row[3], name: currencyName(row[3], locale), symbol: currencySymbol(row[3], locale) },
    zones,
  };
}

/** The country a zone belongs to (Asia/Kolkata → IN), for naming my own clock. */
export function countryOfZone(zone: string): string | null {
  for (const [code, facts] of Object.entries(GEO_COUNTRY_FACTS)) if (facts[2] === zone) return code;
  for (const r of GEO_COUNTRY_ROWS) if (r[4].includes(zone)) return r[0];
  return null;
}

// ───────────── Which zone ─────────────

export const foldName = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function isZoneName(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** How the zone was found: typed or auto-filled on the record, from the state, from the city, or the country's main zone. */
export type ZoneBasis = 'record' | 'state' | 'city' | 'country' | 'none';

export interface Place {
  country?: string | null;
  state?: string | null;
  city?: string | null;
  /** Free-text headquarters ("Austin, Texas, USA"), searched for a state or city when those are empty. */
  headquarters?: string | null;
  timezone?: string | null;
}

export interface ResolvedZone {
  zone: string | null;
  basis: ZoneBasis;
  /** False when a country spans several zones and nothing narrowed it down; the card then asks for the state. */
  exact: boolean;
}

/** The IANA zone for an address. A zone saved on the record wins; then the state, the city, then the country. */
export function resolveZone(place: Place): ResolvedZone {
  if (isZoneName(place.timezone)) return { zone: place.timezone, basis: 'record', exact: true };
  const cc = place.country?.trim().toUpperCase();
  const profile = cc ? countryProfile(cc) : null;
  if (!cc || !profile) return { zone: null, basis: 'none', exact: false };
  const main = profile.zones[0]!;
  const states = GEO_STATE_ZONES[cc];
  if (!states) return { zone: main, basis: 'country', exact: true };
  const cities = GEO_CITY_ZONES[cc] ?? {};
  const stateZone = (s: string | null | undefined) => (s ? (states[s.trim().toUpperCase()] ?? states[foldName(s)]) : undefined);
  const byState = stateZone(place.state);
  if (byState) return { zone: byState, basis: 'state', exact: true };
  const cityZone = (s: string | null | undefined) => {
    const hit = s ? cities[foldName(s)] : undefined;
    return hit === undefined ? undefined : hit || main;
  };
  const byCity = cityZone(place.city);
  if (byCity) return { zone: byCity, basis: 'city', exact: true };
  for (const piece of (place.headquarters ?? '').split(/[,;/|]/)) {
    const s = stateZone(piece);
    if (s) return { zone: s, basis: 'state', exact: true };
    const c = cityZone(piece);
    if (c) return { zone: c, basis: 'city', exact: true };
  }
  // Nothing narrowed it down: the country's main zone, marked as a guess so the card can ask for the state.
  return { zone: main, basis: 'country', exact: false };
}

// ───────────── Clocks ─────────────

/** Short names people know ("EDT", "IST", "CET") come from the locale of the zone's own region where it has them. */
function abbreviationLocale(zone: string): string {
  if (/^Asia\/(Kolkata|Calcutta)$/.test(zone)) return 'en-IN';
  if (zone.startsWith('Australia/')) return 'en-AU';
  if (zone === 'Pacific/Auckland' || zone === 'Pacific/Chatham') return 'en-NZ';
  if (zone === 'Africa/Johannesburg') return 'en-ZA';
  if (zone.startsWith('Europe/') || zone.startsWith('Atlantic/') || zone === 'Africa/Casablanca') return 'en-GB';
  return 'en-US';
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** Minutes east of UTC at that instant (330 for IST, -240 for New York in summer). */
export function zoneOffset(zone: string, at: Date): number {
  const name = part(new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at), 'timeZoneName');
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

export function zoneAbbreviation(zone: string, at: Date): string {
  const short = part(new Intl.DateTimeFormat(abbreviationLocale(zone), { timeZone: zone, timeZoneName: 'short' }).formatToParts(at), 'timeZoneName');
  if (short && !/^(GMT|UTC)[+-]/.test(short)) return short;
  const off = zoneOffset(zone, at);
  if (off === 0) return 'GMT';
  const h = Math.floor(Math.abs(off) / 60);
  const mm = Math.abs(off) % 60;
  return `UTC${off < 0 ? '−' : '+'}${h}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

/** The wall-clock date and time in a zone. */
export function wallClock(zone: string, at: Date): { year: number; month: number; day: number; weekday: number; minutes: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part(p, 'weekday'));
  return { year: Number(part(p, 'year')), month: Number(part(p, 'month')), day: Number(part(p, 'day')), weekday, minutes: Number(part(p, 'hour')) * 60 + Number(part(p, 'minute')) };
}

/** The instant a wall-clock time happens in a zone (daylight-saving safe). */
export function zonedInstant(zone: string, year: number, month: number, day: number, minutes: number): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 0, minutes);
  let at = new Date(utcGuess - zoneOffset(zone, new Date(utcGuess)) * 60_000);
  at = new Date(utcGuess - zoneOffset(zone, at) * 60_000);
  return at;
}

const ymd = (c: { year: number; month: number; day: number }) => `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;

// ───────────── Working hours ─────────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 09:00');
export const WORKING_HOURS_SOURCES = ['website', 'user', 'standard'] as const;
export type WorkingHoursSource = (typeof WORKING_HOURS_SOURCES)[number];

/** Office hours on the client's own clock. Days are 0 (Sunday) to 6 (Saturday). */
export const workingHoursSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((d) => [...new Set(d)].sort()),
    start: hhmm,
    end: hhmm,
    /** website = read from the company's own published opening hours; user = typed; standard = the usual office day. */
    source: z.enum(WORKING_HOURS_SOURCES),
  })
  .refine((h) => h.start < h.end, { message: 'The day must end after it starts', path: ['end'] });
export type WorkingHours = z.infer<typeof workingHoursSchema>;

/** Weekends that are not Saturday and Sunday. */
const WEEKENDS: Record<string, number[]> = {
  SA: [5, 6], KW: [5, 6], QA: [5, 6], BH: [5, 6], OM: [5, 6], EG: [5, 6], IQ: [5, 6], JO: [5, 6], YE: [5, 6], DZ: [5, 6], LY: [5, 6],
  SY: [5, 6], SD: [5, 6], IL: [5, 6], PS: [5, 6], BD: [5, 6], MV: [5, 6], AF: [4, 5], IR: [5], NP: [6], BN: [0, 5],
};

export function weekendOf(country: string | null | undefined): number[] {
  return WEEKENDS[country?.toUpperCase() ?? ''] ?? [0, 6];
}

/** The usual office day for a country (9:00 to 18:00 outside its weekend), used until real hours are known. */
export function standardHours(country: string | null | undefined): WorkingHours {
  const weekend = weekendOf(country);
  return { days: [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d)), start: '09:00', end: '18:00', source: 'standard' };
}

export function normalizeWorkingHours(raw: unknown): WorkingHours | null {
  const p = workingHoursSchema.safeParse(raw);
  return p.success ? p.data : null;
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ───────────── My own hours ─────────────

export const contactTimesSchema = z
  .object({
    /** The person's own zone; IST unless they choose another. */
    timeZone: z.string().trim().max(64).refine(isZoneName, 'Choose a time zone from the list'),
    /** When the person is happy to call or email from their own desk, on their own clock. */
    start: hhmm,
    end: hhmm,
    /** Ask "is now a good time?" before every email or call. On by default. */
    confirmBeforeContact: z.boolean(),
  })
  .strict();
export type ContactTimes = z.infer<typeof contactTimesSchema>;

export const DEFAULT_CONTACT_TIMES: ContactTimes = { timeZone: 'Asia/Kolkata', start: '09:00', end: '23:00', confirmBeforeContact: true };

export interface ContactTimesResponse {
  contactTimes: ContactTimes;
  source: 'user' | 'default';
}

// ───────────── Advice ─────────────

export interface PublicHoliday {
  /** YYYY-MM-DD on the client's calendar. */
  date: string;
  name: string;
}

export type ConnectStatus = 'perfect' | 'ending-soon' | 'starting-soon' | 'outside' | 'weekend' | 'holiday' | 'unknown';

export interface ConnectAdvice {
  status: ConnectStatus;
  /** success / warning / critical / info, for the badge colour. */
  tone: 'success' | 'warning' | 'critical' | 'info';
  clientZone: string;
  myZone: string;
  /** My clock minus theirs, in minutes (570 = India is 9 h 30 m ahead of New York in summer). */
  difference: number;
  /** Their working day today (or the next one), as instants, so it can be shown on either clock. */
  window: { start: Date; end: Date } | null;
  /** The late-morning slot on their clock, the usual best time to reach someone. */
  best: { start: Date; end: Date } | null;
  /** Minutes until they finish (open) or start (closed). */
  minutes: number | null;
  /** When their working day is today on their clock and inside my own hours. */
  insideMyHours: boolean;
  holiday: PublicHoliday | null;
  weekendDay: boolean;
}

const SOON = 60;

/**
 * Whether now is a good time to contact the client, and why. "Ending soon" is the last hour of their day; "starting
 * soon" the hour before it begins. The window and the best slot are for today when they are still ahead or running,
 * otherwise for their next working day.
 */
export function connectAdvice(opts: {
  clientZone: string;
  hours: WorkingHours;
  holidays?: readonly PublicHoliday[];
  me: Pick<ContactTimes, 'timeZone' | 'start' | 'end'>;
  now: Date;
}): ConnectAdvice {
  const { clientZone, hours, now } = opts;
  const holidays = new Map((opts.holidays ?? []).map((h) => [h.date, h]));
  const myZone = opts.me.timeZone;
  const difference = zoneOffset(myZone, now) - zoneOffset(clientZone, now);
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  const today = wallClock(clientZone, now);
  const isOpenDay = (c: { year: number; month: number; day: number; weekday: number }) => hours.days.includes(c.weekday) && !holidays.has(ymd(c));
  const windowOn = (c: { year: number; month: number; day: number }) => ({ start: zonedInstant(clientZone, c.year, c.month, c.day, start), end: zonedInstant(clientZone, c.year, c.month, c.day, end) });
  const bestOn = (c: { year: number; month: number; day: number }) => {
    const from = Math.min(start + 60, end);
    const to = Math.min(from + 120, end);
    return { start: zonedInstant(clientZone, c.year, c.month, c.day, from), end: zonedInstant(clientZone, c.year, c.month, c.day, to) };
  };

  let window: ConnectAdvice['window'] = null;
  let day = today;
  for (let i = 0; i < 14; i++) {
    const probe = wallClock(clientZone, new Date(zonedInstant(clientZone, today.year, today.month, today.day, 12 * 60).getTime() + i * 86_400_000));
    if (!isOpenDay(probe)) continue;
    const w = windowOn(probe);
    if (w.end.getTime() <= now.getTime()) continue;
    window = w;
    day = probe;
    break;
  }
  const holiday = holidays.get(ymd(today)) ?? null;
  const weekendDay = !hours.days.includes(today.weekday);
  const best = window ? bestOn(day) : null;
  const myStart = toMinutes(opts.me.start);
  const myEnd = toMinutes(opts.me.end);
  const myNow = wallClock(myZone, now).minutes;
  const insideMyHours = myStart <= myEnd ? myNow >= myStart && myNow < myEnd : myNow >= myStart || myNow < myEnd;

  const base = { clientZone, myZone, difference, window, best, insideMyHours, holiday, weekendDay };
  if (holiday) return { ...base, status: 'holiday', tone: 'critical', minutes: window ? Math.round((window.start.getTime() - now.getTime()) / 60_000) : null };
  if (weekendDay) return { ...base, status: 'weekend', tone: 'critical', minutes: window ? Math.round((window.start.getTime() - now.getTime()) / 60_000) : null };
  if (window && window.start.getTime() <= now.getTime()) {
    const left = Math.round((window.end.getTime() - now.getTime()) / 60_000);
    return { ...base, status: left <= SOON ? 'ending-soon' : 'perfect', tone: left <= SOON ? 'warning' : 'success', minutes: left };
  }
  const until = window ? Math.round((window.start.getTime() - now.getTime()) / 60_000) : null;
  if (until !== null && until <= SOON) return { ...base, status: 'starting-soon', tone: 'info', minutes: until };
  return { ...base, status: 'outside', tone: 'critical', minutes: until };
}

/** "9 h 30 m" for 570 minutes. */
export function formatDuration(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} m`;
  return r ? `${h} h ${r} m` : `${h} h`;
}
