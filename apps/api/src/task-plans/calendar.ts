import { startOfDayIn, type TaskCadence } from '@dealflow/types';

/** Calendar days (YYYY-MM-DD) in the organisation's time zone, and the instants they start at (ADR 0096). */

const DAY = 86_400_000;

export function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The hour (0-23) on the wall clock in `tz`. */
export function localHour(at: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(at));
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function weekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Midnight at the start of `day` in `tz`. */
export function dayStart(day: string, tz: string): Date {
  let probe = new Date(Date.parse(`${day}T12:00:00Z`));
  // Zones far from UTC put noon UTC on the day before or after: step back onto the day itself.
  const seen = localDay(probe, tz);
  if (seen > day) probe = new Date(probe.getTime() - 12 * 3_600_000);
  else if (seen < day) probe = new Date(probe.getTime() + 12 * 3_600_000);
  return startOfDayIn(probe, tz);
}

export interface Period {
  cadence: TaskCadence;
  /** First and last day of the period inside the plan (both included). */
  first: string;
  last: string;
}

/**
 * The period of one cadence that holds `day`, cut to the plan's dates. Daily periods exist only on working days that
 * are not days off. Weeks run Monday to Sunday and months by the calendar.
 */
export function periodOf(cadence: TaskCadence, day: string, plan: { startsOn: string; endsOn: string; workingDays: number[]; skipDates: string[] }): Period | null {
  if (day < plan.startsOn || day > plan.endsOn) return null;
  let first: string;
  let last: string;
  if (cadence === 'DAY') {
    if (!plan.workingDays.includes(weekday(day)) || plan.skipDates.includes(day)) return null;
    first = last = day;
  } else if (cadence === 'WEEK') {
    first = addDays(day, 1 - weekday(day));
    last = addDays(first, 6);
  } else {
    first = `${day.slice(0, 8)}01`;
    const [y, m] = day.split('-').map(Number) as [number, number];
    last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  return { cadence, first: first < plan.startsOn ? plan.startsOn : first, last: last > plan.endsOn ? plan.endsOn : last };
}
