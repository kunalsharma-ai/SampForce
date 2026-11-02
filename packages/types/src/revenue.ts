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
  /** A quarter, a month or a year. */
  period: z.string().regex(/^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/, 'Use YYYY, YYYY-Qn or YYYY-MM'),
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
  /** Logged activity plus email both ways, last 30 days against the 30 before (feature 13). */
  engagement?: { last30: number; previous30: number };
  /** Open customer requests from the client portal, the support data DealFlow has. */
  openRequests?: { count: number; oldestDays: number };
  /** Deals with this company lost in the last 90 days. */
  lostDeals90?: number;
}

export interface HealthSignal {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export const HEALTH_VERSION = 'health-v2';
const SEVERITY_POINTS: Record<Severity, number> = { LOW: 5, MEDIUM: 10, HIGH: 20, CRITICAL: 35 };

/** Rule-based customer health: starts at 100 and loses points per risk signal, each explained. */
export function customerHealth(h: HealthInput): { score: number; band: HealthBand; signals: HealthSignal[] } {
  const signals: HealthSignal[] = [];
  if (h.lastActivityDays === null) signals.push({ key: 'no_activity', label: 'No logged activity', points: 30, detail: 'No calls, emails, meetings or notes recorded.' });
  else if (h.lastActivityDays >= 60) signals.push({ key: 'quiet_60', label: 'Quiet for 60+ days', points: 30, detail: `Last activity ${h.lastActivityDays} days ago.` });
  else if (h.lastActivityDays >= 30) signals.push({ key: 'quiet_30', label: 'Quiet for 30+ days', points: 15, detail: `Last activity ${h.lastActivityDays} days ago.` });
  for (const s of h.openEscalations) signals.push({ key: `escalation_${s.toLowerCase()}`, label: { LOW: 'Open low escalation', MEDIUM: 'Open medium escalation', HIGH: 'Open high escalation', CRITICAL: 'Open critical escalation' }[s], points: SEVERITY_POINTS[s], detail: 'Unresolved escalation.' });
  if (h.daysToRenewal !== null && h.daysToRenewal <= 60 && !h.renewalInProgress) {
    const near = h.daysToRenewal <= 30;
    signals.push({ key: near ? 'renewal_30' : 'renewal_60', label: near ? 'Renewal within 30 days' : 'Renewal within 60 days', points: near ? 25 : 15, detail: h.daysToRenewal < 0 ? `Contract ended ${-h.daysToRenewal} days ago with no renewal.` : `Contract ends in ${h.daysToRenewal} days and no renewal has been started.` });
  }
  if (h.overdueTasks > 0) signals.push({ key: 'overdue_tasks', label: 'Overdue tasks', points: Math.min(15, h.overdueTasks * 5), detail: h.overdueTasks === 1 ? '1 overdue task.' : `${h.overdueTasks} overdue tasks.` });
  if (h.engagement && engagementTrend(h.engagement) === 'declining')
    signals.push({ key: 'declining_engagement', label: 'Engagement is falling', points: 15, detail: `${h.engagement.last30} touches in the last 30 days, down from ${h.engagement.previous30} the 30 days before.` });
  if (h.openRequests && h.openRequests.count > 0)
    signals.push({
      key: 'open_requests',
      label: 'Open customer requests',
      points: Math.min(15, h.openRequests.count * 5),
      detail: (h.openRequests.count === 1
        ? h.openRequests.oldestDays === 1 ? '{n} open request in the client portal, oldest {days} day.' : '{n} open request in the client portal, oldest {days} days.'
        : h.openRequests.oldestDays === 1 ? '{n} open requests in the client portal, oldest {days} day.' : '{n} open requests in the client portal, oldest {days} days.'
      ).replace('{n}', String(h.openRequests.count)).replace('{days}', String(h.openRequests.oldestDays)),
    });
  if (h.lostDeals90 && h.lostDeals90 > 0) signals.push({ key: 'lost_deal', label: 'Recently lost a deal', points: 10, detail: h.lostDeals90 === 1 ? '1 deal with them lost in the last 90 days.' : `${h.lostDeals90} deals with them lost in the last 90 days.` });
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
  /** Feature 13: what the churn-risk view adds. */
  engagement: { last30: number; previous30: number; trend: EngagementTrend; lastInboundAt: string | null };
  deals: { won: number; open: number; lost90: number };
  openRequests: number;
  /** Daily scores, oldest first, up to 90 days. History starts when the customer was first scored. */
  history: { day: string; score: number }[];
  plan: RetentionPlan;
}

export type EngagementTrend = 'none' | 'rising' | 'steady' | 'declining';

/** Same rule as the record intelligence panel, so both say the same thing. */
export function engagementTrend(e: { last30: number; previous30: number }): EngagementTrend {
  const { last30, previous30 } = e;
  return last30 === 0 && previous30 === 0 ? 'none' : previous30 >= 3 && last30 * 2 <= previous30 ? 'declining' : last30 > previous30 * 1.5 && last30 >= 3 ? 'rising' : 'steady';
}

/** Churn risk is the inverse view of health: at risk = high, watch = medium, healthy = low. */
export const CHURN_RISK: Record<HealthBand, { label: string; level: 'high' | 'medium' | 'low' }> = {
  at_risk: { label: 'High churn risk', level: 'high' },
  watch: { label: 'Medium churn risk', level: 'medium' },
  healthy: { label: 'Low churn risk', level: 'low' },
};

export interface RetentionAction {
  key: string;
  title: string;
  why: string;
  dueInDays: number;
}

export interface RetentionPlan {
  actions: RetentionAction[];
  /** Suggested touch cadence for the follow-up schedule. */
  cadence: { everyDays: number; touches: number; label: string };
}

const CADENCE: Record<HealthBand, RetentionPlan['cadence']> = {
  at_risk: { everyDays: 7, touches: 4, label: 'Weekly for the next month' },
  watch: { everyDays: 14, touches: 3, label: 'Every two weeks for six weeks' },
  healthy: { everyDays: 30, touches: 2, label: 'Monthly' },
};

/** Rule-based retention actions: one per kind of risk signal, most urgent first. Suggestions only. */
export function retentionPlan(band: HealthBand, signals: HealthSignal[]): RetentionPlan {
  const has = (k: string) => signals.some((s) => s.key === k);
  const actions: RetentionAction[] = [];
  const esc = signals.filter((s) => s.key.startsWith('escalation_'));
  if (esc.length) {
    const urgent = esc.some((s) => s.key === 'escalation_critical' || s.key === 'escalation_high');
    actions.push({ key: 'escalation', title: 'Agree a fix date for the open escalation and tell the customer', why: `${esc.length} unresolved escalation${esc.length === 1 ? '' : 's'}.`, dueInDays: urgent ? 1 : 3 });
  }
  if (has('renewal_30') || has('renewal_60'))
    actions.push({ key: 'renewal', title: 'Start the renewal and book a renewal call', why: signals.find((s) => s.key.startsWith('renewal_'))!.detail, dueInDays: has('renewal_30') ? 2 : 7 });
  if (has('open_requests')) actions.push({ key: 'requests', title: 'Answer the open portal requests', why: signals.find((s) => s.key === 'open_requests')!.detail, dueInDays: 1 });
  if (has('no_activity') || has('quiet_60') || has('quiet_30'))
    actions.push({ key: 'check_in', title: 'Call your main contact to check in', why: signals.find((s) => ['no_activity', 'quiet_60', 'quiet_30'].includes(s.key))!.detail, dueInDays: has('quiet_30') ? 3 : 1 });
  if (has('declining_engagement')) actions.push({ key: 'review', title: 'Book a check-in meeting to review how they use the product', why: signals.find((s) => s.key === 'declining_engagement')!.detail, dueInDays: 5 });
  if (has('lost_deal')) actions.push({ key: 'loss_review', title: 'Review why the recent deal was lost before the next conversation', why: signals.find((s) => s.key === 'lost_deal')!.detail, dueInDays: 3 });
  if (has('overdue_tasks')) actions.push({ key: 'overdue', title: 'Finish or reschedule the overdue tasks', why: signals.find((s) => s.key === 'overdue_tasks')!.detail, dueInDays: 0 });
  return { actions: actions.sort((a, b) => a.dueInDays - b.dueInDays), cadence: CADENCE[band] };
}

/** The dates of a follow-up schedule, from a start date. */
export function followUpDates(startYmd: string, cadence: { everyDays: number; touches: number }): string[] {
  const base = Date.parse(`${startYmd}T00:00:00Z`);
  return Array.from({ length: cadence.touches }, (_, i) => new Date(base + (i + 1) * cadence.everyDays * 86_400_000).toISOString().slice(0, 10));
}

export const customerFollowUpsSchema = z.object({
  contactId: z.string().uuid().nullable(),
  items: z
    .array(z.object({ title: z.string().trim().min(1).max(200), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().trim().max(2000).nullable().optional() }))
    .min(1)
    .max(12),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
});
export type CustomerFollowUps = z.infer<typeof customerFollowUpsSchema>;

export const CHURN_TREND_DAYS = [30, 90, 180] as const;
export interface ChurnTrends {
  days: { day: string; high: number; medium: number; low: number; averageScore: number | null }[];
  /** Biggest falls in score over the window, worst first. */
  movers: { company: { id: string; name: string }; from: number; to: number; band: HealthBand }[];
}

/** What the Retention Advisor returns. A draft for the account manager; nothing is created from it directly. */
export const retentionBriefSchema = z.object({
  summary: z.string().max(1500),
  talkingPoints: z.array(z.string().max(300)).max(6),
  steps: z.array(z.object({ title: z.string().max(200), dueInDays: z.number().int().min(0).max(90), why: z.string().max(300) })).max(6),
});
export type RetentionBrief = z.infer<typeof retentionBriefSchema>;
