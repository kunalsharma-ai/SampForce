import type { WorkingHours } from '@dealflow/types';

/*
 * Office hours a company publishes in its schema.org data (ADR 0089): `openingHoursSpecification` objects or the short
 * `openingHours` text ("Mo-Fr 09:00-17:30"). Pure, so it is tested on its own. The result is one office day: the days
 * that have hours, and the hours most of them share. Nothing is guessed: no published hours, no result.
 */

const DAY_NAMES: Record<string, number> = { su: 0, sun: 0, sunday: 0, mo: 1, mon: 1, monday: 1, tu: 2, tue: 2, tuesday: 2, we: 3, wed: 3, wednesday: 3, th: 4, thu: 4, thursday: 4, fr: 5, fri: 5, friday: 5, sa: 6, sat: 6, saturday: 6 };

const dayOf = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null;
  const key = raw.replace(/^https?:\/\/schema\.org\//i, '').trim().toLowerCase();
  return key in DAY_NAMES ? DAY_NAMES[key]! : null;
};

const timeOf = (raw: unknown, closing = false): string | null => {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h === 24 || (closing && h === 0 && min === 0) ? '23:59' : `${String(h).padStart(2, '0')}:${m[2]}`;
};

type Slot = { day: number; start: string; end: string };

function fromSpecification(spec: unknown): Slot[] {
  const out: Slot[] = [];
  for (const s of Array.isArray(spec) ? spec : spec ? [spec] : []) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const start = timeOf(o.opens);
    const end = timeOf(o.closes, true);
    if (!start || !end || start >= end) continue;
    for (const d of Array.isArray(o.dayOfWeek) ? o.dayOfWeek : [o.dayOfWeek]) {
      const day = dayOf(d);
      if (day !== null) out.push({ day, start, end });
    }
  }
  return out;
}

function fromText(text: unknown): Slot[] {
  const out: Slot[] = [];
  for (const line of (Array.isArray(text) ? text : [text]).filter((t): t is string => typeof t === 'string')) {
    for (const m of line.matchAll(/([A-Za-z]{2,3}(?:\s*-\s*[A-Za-z]{2,3})?(?:\s*,\s*[A-Za-z]{2,3}(?:\s*-\s*[A-Za-z]{2,3})?)*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)) {
      const start = timeOf(m[2]);
      const end = timeOf(m[3], true);
      if (!start || !end || start >= end) continue;
      for (const range of m[1]!.split(',')) {
        const [a, b] = range.split('-').map((x) => dayOf(x.trim()));
        if (a === null || a === undefined) continue;
        if (b === null || b === undefined) {
          out.push({ day: a, start, end });
          continue;
        }
        for (let d = a, n = 0; n < 7; d = (d + 1) % 7, n++) {
          out.push({ day: d, start, end });
          if (d === b) break;
        }
      }
    }
  }
  return out;
}

export function openingHoursOf(org: Record<string, unknown>): WorkingHours | null {
  const slots = [...fromSpecification(org.openingHoursSpecification), ...fromText(org.openingHours)];
  if (!slots.length) return null;
  // The hours most days share ("09:00-17:30" on Monday to Friday beats a short Saturday).
  const counts = new Map<string, number>();
  for (const s of slots) counts.set(`${s.start}-${s.end}`, (counts.get(`${s.start}-${s.end}`) ?? 0) + 1);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [start, end] = best![0].split('-') as [string, string];
  const days = [...new Set(slots.map((s) => s.day))].sort();
  // Open around the clock is a shop or a support line, not an office day.
  if (start === '00:00' && end === '23:59') return null;
  return { days, start, end, source: 'website' };
}
