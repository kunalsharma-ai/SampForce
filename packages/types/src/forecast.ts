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
  /** Where `probability` came from: the deal's own override, its stage, or the workspace's win history for that stage. */
  probabilitySource?: ProbabilitySource;
}

export type ProbabilitySource = 'deal' | 'stage' | 'history';

/** Category cut-offs. Managers can change them; a snapshot stores the ones it used so it recomputes exactly. */
export interface ForecastThresholds {
  commit: number;
  bestCase: number;
}
export const DEFAULT_THRESHOLDS: ForecastThresholds = { commit: 70, bestCase: 30 };

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

/** How many deal lines the forecast view returns. Snapshots keep every line. */
export const FORECAST_MAX_LINES = 300;

export interface ForecastView {
  method: string;
  assumptions: ForecastThresholds;
  period: ForecastPeriod;
  currency: string;
  totals: ForecastTotals;
  byOwner: { owner: { id: string; name: string } | null; totals: ForecastTotals }[];
  /** The largest deals first, at most FORECAST_MAX_LINES; the totals always cover every deal (lineCount). */
  lines: (ForecastLine & { category: ForecastCategory })[];
  lineCount: number;
  /** Deals left out, and why, so the totals are never silently partial (otherCurrency: no exchange rate set). */
  excluded: { otherCurrency: number; noCloseDate: number };
}

export interface ForecastSnapshotRow {
  id: string;
  label: string | null;
  period: { start: string; end: string };
  currency: string;
  method: string;
  /** Null on snapshots taken before thresholds could be changed: those used DEFAULT_THRESHOLDS. */
  assumptions: ForecastThresholds | null;
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

/** A forecast period: a month (2026-11), a quarter (2026-Q4) or a year (2026). */
export const PERIOD_PATTERN = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/;
export const anyPeriodSchema = z.string().regex(PERIOD_PATTERN, 'Use YYYY, YYYY-Qn or YYYY-MM');

export const forecastQuerySchema = z.object({
  period: anyPeriodSchema.optional(),
});

export const snapshotInputSchema = z.object({
  period: anyPeriodSchema.optional(),
  label: z.string().trim().max(120).optional(),
});

export function categoryOf(line: Pick<ForecastLine, 'status' | 'probability'>, t: ForecastThresholds = DEFAULT_THRESHOLDS): ForecastCategory {
  if (line.status === 'WON') return 'won';
  if (line.probability >= t.commit) return 'commit';
  if (line.probability >= t.bestCase) return 'best_case';
  return 'pipeline';
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function computeTotals(lines: ForecastLine[], thresholds: ForecastThresholds = DEFAULT_THRESHOLDS): ForecastTotals {
  const t = { won: 0, commit: 0, bestCase: 0, pipeline: 0, weighted: 0 };
  for (const l of lines) {
    const c = categoryOf(l, thresholds);
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

export function totalsByOwner(lines: ForecastLine[], thresholds: ForecastThresholds = DEFAULT_THRESHOLDS): ForecastView['byOwner'] {
  const groups = new Map<string, { owner: ForecastLine['owner']; lines: ForecastLine[] }>();
  for (const l of lines) {
    const key = l.owner?.id ?? '';
    const g = groups.get(key) ?? { owner: l.owner, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ owner: g.owner, totals: computeTotals(g.lines, thresholds) }))
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

export type PeriodGranularity = 'month' | 'quarter' | 'year';

export interface ForecastPeriod {
  start: string;
  /** Exclusive. */
  end: string;
  label: string;
  granularity: PeriodGranularity;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Bounds for "YYYY", "YYYY-Qn" or "YYYY-MM"; without a period, the current quarter. End is exclusive. */
export function forecastPeriod(period: string | undefined, now = new Date()): ForecastPeriod {
  if (!period || /-Q/.test(period)) return { ...quarterPeriod(period, now), granularity: 'quarter' };
  const year = Number(period.slice(0, 4));
  if (period.length === 4) return { start: `${year}-01-01`, end: `${year + 1}-01-01`, label: `${year}`, granularity: 'year' };
  const m = Number(period.slice(5, 7));
  return { start: iso(new Date(Date.UTC(year, m - 1, 1))), end: iso(new Date(Date.UTC(year, m, 1))), label: period, granularity: 'month' };
}

/** The label of the period of the same size that contains `date`. */
export function periodLabelOf(date: Date, granularity: PeriodGranularity): string {
  const y = date.getUTCFullYear();
  if (granularity === 'year') return `${y}`;
  if (granularity === 'quarter') return `${y}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  return `${y}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The `count` periods ending with (and including) `label`, oldest first. */
export function previousPeriods(label: string, count: number): string[] {
  const p = forecastPeriod(label);
  const out: string[] = [];
  let d = new Date(`${p.start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.unshift(periodLabelOf(d, p.granularity));
    d = p.granularity === 'year' ? new Date(Date.UTC(d.getUTCFullYear() - 1, 0, 1)) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (p.granularity === 'quarter' ? 3 : 1), 1));
  }
  return out;
}

/** The quarters in a year, or the months in a quarter: what a target can be built from when it is not set. */
export function childPeriods(label: string): string[] {
  const p = forecastPeriod(label);
  const y = Number(label.slice(0, 4));
  if (p.granularity === 'year') return [1, 2, 3, 4].map((q) => `${y}-Q${q}`);
  if (p.granularity === 'quarter') {
    const q = Number(label.slice(6));
    return [1, 2, 3].map((i) => `${y}-${String((q - 1) * 3 + i).padStart(2, '0')}`);
  }
  return [];
}

// ───────────── Forecast planning (enhancement feature 10) ─────────────

export type ForecastProbabilityMethod = 'stage' | 'history';

export const forecastSettingsSchema = z
  .object({
    method: z.enum(['stage', 'history']),
    commitThreshold: z.number().int().min(1).max(100),
    bestCaseThreshold: z.number().int().min(0).max(99),
    historyMonths: z.number().int().min(3).max(36),
    minSample: z.number().int().min(3).max(200),
  })
  .refine((v) => v.bestCaseThreshold < v.commitThreshold, { message: 'Best case must start below commit', path: ['bestCaseThreshold'] });
export type ForecastSettingsInput = z.infer<typeof forecastSettingsSchema>;

export interface ForecastSettings extends ForecastSettingsInput {
  updatedBy: { id: string; name: string } | null;
  updatedAt: string | null;
}

export const DEFAULT_FORECAST_SETTINGS: ForecastSettingsInput = { method: 'stage', commitThreshold: 70, bestCaseThreshold: 30, historyMonths: 12, minSample: 10 };

/** How often deals that reached a stage were won, from deals closed in the history window. */
export interface StageWinRate {
  stageId: string;
  stage: string;
  pipeline: string;
  stageProbability: number;
  won: number;
  lost: number;
  /** Percent, or null when no closed deal passed through the stage. */
  rate: number | null;
  /** True when the sample is large enough for the history method to use it. */
  usable: boolean;
}

export type TargetSource = 'set' | 'from_parts' | 'share_of_quarter';

export interface PlanTarget {
  amount: number | null;
  /** set: entered for this period. from_parts: sum of the quarters (or months) that have one. share_of_quarter: a third of the quarter. */
  source: TargetSource | null;
}

export interface PlanRisk {
  count: number;
  amount: number;
  deals: { id: string; name: string; amount: number; owner: string | null; detail: string }[];
}

export interface ForecastPlan {
  period: ForecastPeriod;
  currency: string;
  settings: ForecastSettings;
  totals: ForecastTotals;
  target: PlanTarget;
  /** Won as a percent of the target. */
  attainment: number | null;
  /** Target minus each scenario. Positive means short of the target. */
  gap: { worst: number; base: number; best: number } | null;
  /** Open pipeline divided by what is still needed (target − won). */
  coverage: number | null;
  byOwner: { owner: { id: string; name: string } | null; target: PlanTarget; totals: ForecastTotals; attainment: number | null; gap: number | null }[];
  risks: { overdue: PlanRisk; stale: PlanRisk; highRisk: PlanRisk };
  stageRates: StageWinRate[];
  /** Open deals whose probability came from each source. */
  probabilitySources: Record<ProbabilitySource, number>;
}

export interface ForecastTrendPoint {
  period: string;
  won: number;
  wonCount: number;
  lostCount: number;
  /** Won ÷ (won + lost) by count, percent. */
  winRate: number | null;
  avgCycleDays: number | null;
  /** The base forecast of the first snapshot taken for this period, if any, and how far the actual was from it. */
  forecastAtStart: number | null;
  errorPercent: number | null;
}

export interface ForecastTrends {
  granularity: PeriodGranularity;
  currency: string;
  points: ForecastTrendPoint[];
  topLossReasons: { reason: string; count: number }[];
}
