import { z } from 'zod';
import type { OwnerRef } from './crm';

/**
 * Revenue analytics, targets, exchange rates and customer health. Every figure is computed from records
 * by these functions; nothing here is estimated by a model.
 */
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');
const period = z.string().regex(/^\d{4}-Q[1-4]$/, 'Use YYYY-Qn');

export const exchangeRateInputSchema = z.object({
  currency: currencyCode,
  rate: z.coerce.number().positive('Enter a rate above 0').max(1e9),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

export const salesTargetInputSchema = z.object({
  period,
  userId: z.string().uuid().nullable(),
  amount: z.coerce.number().min(0).max(1e13),
});

export const analyticsQuerySchema = z.object({ period: period.optional() });

export interface ExchangeRateRow {
  id: string;
  currency: string;
  rate: number;
  effectiveDate: string;
  source: string;
  createdAt: string;
}

export interface SalesTargetRow {
  id: string;
  period: string;
  user: OwnerRef | null;
  amount: number;
}

export type RateTable = Map<string, number>;

/** Converts into the base currency; null when no rate is known (the caller reports it as excluded). */
export function toBase(amount: number, currency: string, base: string, rates: RateTable): number | null {
  if (currency === base) return amount;
  const r = rates.get(currency);
  return r === undefined ? null : Math.round(amount * r * 100) / 100;
}

export function winRate(won: number, lost: number): number | null {
  return won + lost === 0 ? null : Math.round((won / (won + lost)) * 1000) / 10;
}

/**
 * Sales velocity per day: open deals × win rate × average won deal size ÷ average sales cycle in days.
 * Null until there is enough closed history to measure each input.
 */
export function salesVelocity(openDeals: number, winRatePercent: number | null, avgDealSize: number | null, avgCycleDays: number | null): number | null {
  if (winRatePercent === null || avgDealSize === null || !avgCycleDays) return null;
  return Math.round(((openDeals * (winRatePercent / 100) * avgDealSize) / avgCycleDays) * 100) / 100;
}

export interface RevenueAnalytics {
  period: { start: string; end: string; label: string };
  currency: string;
  won: { total: number; deals: number; avgDealSize: number | null; avgCycleDays: number | null };
  closed: { won: number; lost: number; winRate: number | null };
  byMonth: { month: string; won: number; deals: number }[];
  byOwner: { owner: OwnerRef | null; won: number; deals: number; lost: number; winRate: number | null; target: number | null; attainment: number | null }[];
  bySource: { source: string; won: number; deals: number }[];
  byProduct: { productId: string; name: string; revenue: number; quantity: number }[];
  lossReasons: { reason: string; deals: number; amount: number }[];
  velocity: { openDeals: number; perDay: number | null };
  target: { amount: number | null; attainment: number | null; openInPeriod: number; coverage: number | null };
  funnel: { leads: number; qualified: number; converted: number; wonFromLeads: number };
  actualVsForecast: { period: string; predicted: number; snapshotAt: string; actual: number; errorPercent: number | null }[];
  excluded: { noExchangeRate: number };
}

// ───────────── Customer health ─────────────

export const escalationInputSchema = z.object({
  companyId: z.string().uuid(),
  contractId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, 'Enter a title').max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  ownerId: z.string().uuid().nullable().optional(),
});
export const escalationResolveSchema = z.object({ resolution: z.string().trim().min(1, 'Describe the resolution').max(5000) });

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface EscalationRow {
  id: string;
  company: { id: string; name: string };
  contractId: string | null;
  title: string;
  description: string | null;
  severity: Severity;
  status: 'OPEN' | 'RESOLVED';
  owner: OwnerRef | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export type HealthBand = 'healthy' | 'watch' | 'at_risk';

export interface HealthInput {
  lastActivityDays: number | null;
  openEscalations: Severity[];
  /** Days until the nearest active contract ends; null if none ends. */
  daysToRenewal: number | null;
  renewalInProgress: boolean;
  overdueTasks: number;
}

export interface HealthSignal {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export const HEALTH_VERSION = 'health-v1';
const SEVERITY_POINTS: Record<Severity, number> = { LOW: 5, MEDIUM: 10, HIGH: 20, CRITICAL: 35 };

/** Rule-based customer health: starts at 100 and loses points per risk signal, each explained. */
export function customerHealth(h: HealthInput): { score: number; band: HealthBand; signals: HealthSignal[] } {
  const signals: HealthSignal[] = [];
  if (h.lastActivityDays === null) signals.push({ key: 'no_activity', label: 'No logged activity', points: 30, detail: 'No calls, emails, meetings or notes recorded.' });
  else if (h.lastActivityDays >= 60) signals.push({ key: 'quiet_60', label: 'Quiet for 60+ days', points: 30, detail: `Last activity ${h.lastActivityDays} days ago.` });
  else if (h.lastActivityDays >= 30) signals.push({ key: 'quiet_30', label: 'Quiet for 30+ days', points: 15, detail: `Last activity ${h.lastActivityDays} days ago.` });
  for (const s of h.openEscalations) signals.push({ key: `escalation_${s.toLowerCase()}`, label: `Open ${s.toLowerCase()} escalation`, points: SEVERITY_POINTS[s], detail: 'Unresolved escalation.' });
  if (h.daysToRenewal !== null && h.daysToRenewal <= 60 && !h.renewalInProgress) {
    const near = h.daysToRenewal <= 30;
    signals.push({ key: near ? 'renewal_30' : 'renewal_60', label: near ? 'Renewal within 30 days' : 'Renewal within 60 days', points: near ? 25 : 15, detail: h.daysToRenewal < 0 ? `Contract ended ${-h.daysToRenewal} days ago with no renewal.` : `Contract ends in ${h.daysToRenewal} days and no renewal has been started.` });
  }
  if (h.overdueTasks > 0) signals.push({ key: 'overdue_tasks', label: 'Overdue tasks', points: Math.min(15, h.overdueTasks * 5), detail: `${h.overdueTasks} overdue task${h.overdueTasks === 1 ? '' : 's'}.` });
  const score = Math.max(0, 100 - signals.reduce((a, s) => a + s.points, 0));
  return { score, band: score >= 70 ? 'healthy' : score >= 40 ? 'watch' : 'at_risk', signals };
}

export interface CustomerRow {
  company: { id: string; name: string };
  owner: OwnerRef | null;
  activeContracts: number;
  contractValue: number;
  currency: string;
  nextRenewal: { contractId: string; reference: string; endDate: string; daysToEnd: number } | null;
  openEscalations: number;
  health: { score: number; band: HealthBand; signals: HealthSignal[]; computedAt: string };
}
