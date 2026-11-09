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

export type BucketUnit = 'week' | 'month';

/** Start of the UTC week (Monday, ISO weeks) or month containing `d`. */
export function bucketStart(d: Date, unit: BucketUnit): Date {
  if (unit === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

/** Every bucket start from the one containing `from` to the one containing `to`, inclusive. */
export function buckets(from: Date, to: Date, unit: BucketUnit): Date[] {
  const out: Date[] = [];
  for (let b = bucketStart(from, unit); b <= to; ) {
    out.push(b);
    b = unit === 'month' ? new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1)) : new Date(b.getTime() + 7 * 86_400_000);
  }
  return out;
}

export interface FunnelStage {
  id: string;
  position: number;
  category: 'OPEN' | 'WON' | 'LOST';
}

/**
 * How many deals reached each open stage (or later) and how many were won. A deal counts as having passed every
 * open stage up to the furthest one it entered; a won deal passed them all. Lost stages are not part of the funnel.
 */
export function stageFunnel(
  stages: FunnelStage[],
  deals: { status: 'OPEN' | 'WON' | 'LOST'; currentStageId: string; enteredStageIds: string[] }[],
): { stageId: string; reached: number; conversion: number | null }[] {
  const open = stages.filter((s) => s.category === 'OPEN').sort((a, b) => a.position - b.position);
  const won = stages.find((s) => s.category === 'WON');
  const rank = new Map(open.map((s, i) => [s.id, i]));
  const furthest = deals.map((d) => {
    if (d.status === 'WON') return open.length - 1;
    const ids = d.status === 'OPEN' ? [...d.enteredStageIds, d.currentStageId] : d.enteredStageIds;
    return Math.max(-1, ...ids.map((id) => rank.get(id) ?? -1));
  });
  const rows = open.map((s, i) => ({ stageId: s.id, reached: furthest.filter((f) => f >= i).length }));
  if (won) rows.push({ stageId: won.id, reached: deals.filter((d) => d.status === 'WON').length });
  return rows.map((r, i) => ({ ...r, conversion: i === 0 ? null : ratio(r.reached, rows[i - 1]!.reached) }));
}
