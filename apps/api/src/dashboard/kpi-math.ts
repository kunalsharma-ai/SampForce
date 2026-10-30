/** Pure helpers for KPI derivation, kept separate so they can be unit-tested. */

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Percentage change from previous to current; null when there is no baseline. */
export function growth(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

export function quarterBounds(now: Date): { start: Date; end: Date } {
  const q = Math.floor(now.getUTCMonth() / 3);
  const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1));
  return { start, end };
}

export function round(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
