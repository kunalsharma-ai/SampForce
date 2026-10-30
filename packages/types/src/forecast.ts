import { z } from 'zod';

/**
 * Rule-based forecast. Every number is a deterministic function of the deal lines, so a snapshot that
 * stores its lines can be recomputed exactly (acceptance test 9). These are projections, not promises.
 */
export const FORECAST_METHOD = 'weighted-probability-v1';

export type ForecastCategory = 'won' | 'commit' | 'best_case' | 'pipeline';

export interface ForecastLine {
  dealId: string;
  name: string;
  amount: number;
  /** Deal probability override, or the stage probability. */
  probability: number;
  status: 'OPEN' | 'WON';
  stage: string;
  owner: { id: string; name: string } | null;
  /** YYYY-MM-DD: expected close for open deals, close date for won deals. */
  closeDate: string;
  /** Set when the deal is in another currency; `amount` is then converted at the latest exchange rate. */
  originalAmount?: number;
  originalCurrency?: string;
}

export interface ForecastTotals {
  won: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  weighted: number;
  /** Scenarios: worst = won only; base = won + weighted open; best = won + commit + best case. */
  worst: number;
  base: number;
  best: number;
  dealCount: number;
}

export interface ForecastView {
  method: string;
  period: { start: string; end: string; label: string };
  currency: string;
  totals: ForecastTotals;
  byOwner: { owner: { id: string; name: string } | null; totals: ForecastTotals }[];
  lines: (ForecastLine & { category: ForecastCategory })[];
  /** Deals left out, and why, so the totals are never silently partial (otherCurrency: no exchange rate set). */
  excluded: { otherCurrency: number; noCloseDate: number };
}

export interface ForecastSnapshotRow {
  id: string;
  label: string | null;
  period: { start: string; end: string };
  currency: string;
  method: string;
  totals: ForecastTotals;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface ForecastChange {
  dealId: string;
  name: string;
  kind: 'added' | 'removed' | 'won' | 'amount' | 'probability' | 'close_date' | 'stage';
  from: string | number | null;
  to: string | number | null;
}

export interface ForecastComparison {
  from: ForecastSnapshotRow;
  to: ForecastSnapshotRow;
  delta: Pick<ForecastTotals, 'won' | 'weighted' | 'base' | 'best'>;
  changes: ForecastChange[];
}

export const forecastQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-Q[1-4]$/, 'Use YYYY-Qn').optional(),
});

export const snapshotInputSchema = z.object({
  period: z.string().regex(/^\d{4}-Q[1-4]$/, 'Use YYYY-Qn').optional(),
  label: z.string().trim().max(120).optional(),
});

export function categoryOf(line: Pick<ForecastLine, 'status' | 'probability'>): ForecastCategory {
  if (line.status === 'WON') return 'won';
  if (line.probability >= 70) return 'commit';
  if (line.probability >= 30) return 'best_case';
  return 'pipeline';
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function computeTotals(lines: ForecastLine[]): ForecastTotals {
  const t = { won: 0, commit: 0, bestCase: 0, pipeline: 0, weighted: 0 };
  for (const l of lines) {
    const c = categoryOf(l);
    if (c === 'won') t.won += l.amount;
    else {
      t.weighted += (l.amount * l.probability) / 100;
      if (c === 'commit') t.commit += l.amount;
      else if (c === 'best_case') t.bestCase += l.amount;
      else t.pipeline += l.amount;
    }
  }
  const won = cents(t.won);
  const weighted = cents(t.weighted);
  return {
    won,
    commit: cents(t.commit),
    bestCase: cents(t.bestCase),
    pipeline: cents(t.pipeline),
    weighted,
    worst: won,
    base: cents(won + weighted),
    best: cents(won + t.commit + t.bestCase),
    dealCount: lines.length,
  };
}

export function totalsByOwner(lines: ForecastLine[]): ForecastView['byOwner'] {
  const groups = new Map<string, { owner: ForecastLine['owner']; lines: ForecastLine[] }>();
  for (const l of lines) {
    const key = l.owner?.id ?? '';
    const g = groups.get(key) ?? { owner: l.owner, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ owner: g.owner, totals: computeTotals(g.lines) }))
    .sort((a, b) => b.totals.base - a.totals.base);
}

/** Quarter bounds for "YYYY-Qn" (or the quarter containing `now`). End is exclusive. */
export function quarterPeriod(period: string | undefined, now = new Date()): { start: string; end: string; label: string } {
  let year = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  if (period) {
    year = Number(period.slice(0, 4));
    q = Number(period.slice(6));
  }
  const start = new Date(Date.UTC(year, (q - 1) * 3, 1));
  const end = new Date(Date.UTC(year, q * 3, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: `${year}-Q${q}` };
}

/** Deal-level differences between two snapshots of the same period, largest amount first. */
export function compareLines(before: ForecastLine[], after: ForecastLine[]): ForecastChange[] {
  const prev = new Map(before.map((l) => [l.dealId, l]));
  const next = new Map(after.map((l) => [l.dealId, l]));
  const changes: ForecastChange[] = [];
  for (const a of after) {
    const b = prev.get(a.dealId);
    if (!b) {
      changes.push({ dealId: a.dealId, name: a.name, kind: a.status === 'WON' ? 'won' : 'added', from: null, to: a.amount });
      continue;
    }
    // A win also moves the stage and the close date; report it once.
    if (b.status !== 'WON' && a.status === 'WON') {
      changes.push({ dealId: a.dealId, name: a.name, kind: 'won', from: b.amount, to: a.amount });
      continue;
    }
    if (b.amount !== a.amount) changes.push({ dealId: a.dealId, name: a.name, kind: 'amount', from: b.amount, to: a.amount });
    if (a.status === 'OPEN' && b.probability !== a.probability) changes.push({ dealId: a.dealId, name: a.name, kind: 'probability', from: b.probability, to: a.probability });
    if (b.stage !== a.stage) changes.push({ dealId: a.dealId, name: a.name, kind: 'stage', from: b.stage, to: a.stage });
    if (b.closeDate !== a.closeDate) changes.push({ dealId: a.dealId, name: a.name, kind: 'close_date', from: b.closeDate, to: a.closeDate });
  }
  for (const b of before) if (!next.has(b.dealId)) changes.push({ dealId: b.dealId, name: b.name, kind: 'removed', from: b.amount, to: null });
  const size = (c: ForecastChange) => Math.max(typeof c.from === 'number' ? c.from : 0, typeof c.to === 'number' ? c.to : 0);
  return changes.sort((x, y) => size(y) - size(x));
}
