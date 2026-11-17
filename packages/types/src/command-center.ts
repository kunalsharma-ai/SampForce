import { z } from 'zod';
import type { CreditRole } from './attribution';
import type { PersonRef } from './crm';
import { LEAD_TRANSFER_REASONS } from './crm';

/*
 * Role-based Command Center (ADR 0063). Each person sees the dashboard of their designation's tier: an Executive
 * dashboard of their own work, a Manager dashboard of the people reporting to them, and a Senior Management dashboard
 * of the organisation. What a dashboard covers never goes beyond the person's record visibility (ADR 0060): a manager
 * whose role only shows their own records sees only their own numbers on the team dashboard.
 */

export const DASHBOARD_TIERS = ['EXECUTIVE', 'MANAGER', 'SENIOR'] as const;
export type DashboardTier = (typeof DASHBOARD_TIERS)[number];

/** The dashboards, as tabs of the Command Center, plus the existing analytics layout. */
export const COMMAND_CENTER_VIEWS = ['executive', 'manager', 'senior', 'analytics'] as const;
export type CommandCenterView = (typeof COMMAND_CENTER_VIEWS)[number];

/**
 * The sections of each tier's dashboard, in their default order. Read by the dashboard policies of Settings → CRM
 * configuration (which sections a tier may see and their default layout); each person can reorder and hide them.
 */
export const TIER_DASHBOARD_WIDGETS = {
  EXECUTIVE: ['exec.kpis', 'exec.work', 'exec.instructions', 'exec.pipeline', 'exec.performance', 'exec.revenue', 'exec.transfers'],
  MANAGER: ['team.kpis', 'team.table', 'team.compare', 'team.pipeline', 'team.monitor', 'team.instructions', 'team.concerns', 'team.revenue'],
  SENIOR: ['org.kpis', 'org.departments', 'org.rankings', 'org.revenue', 'org.insights'],
} as const satisfies Record<DashboardTier, readonly string[]>;
export type TierWidget<T extends DashboardTier = DashboardTier> = (typeof TIER_DASHBOARD_WIDGETS)[T][number];

// ─── Reporting periods ───

export const REPORT_PERIODS = ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'h1', 'h2', 'this_year', 'last_year', 'this_fy', 'last_fy', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const commandCenterQuerySchema = z
  .object({
    period: z.enum(REPORT_PERIODS).default('this_month'),
    from: day.optional(),
    to: day.optional(),
    /** IANA time zone the periods and "today" are worked out in. */
    tz: z.string().max(64).default('UTC'),
    /** The financial year's first month (1-12). */
    fyStart: z.coerce.number().int().min(1).max(12).default(4),
    /** Another person's dashboard, for managers and senior people who can see them. */
    userId: z.string().uuid().optional(),
  })
  .refine((q) => q.period !== 'custom' || (q.from && q.to && q.from <= q.to), { message: 'Choose a start and end date, start first', path: ['from'] });
export type CommandCenterQuery = z.output<typeof commandCenterQuerySchema>;

export interface PeriodRange {
  period: ReportPeriod;
  /** Inclusive start and exclusive end, as instants. */
  start: string;
  end: string;
  /** Local calendar dates (inclusive), for labels. */
  fromDay: string;
  toDay: string;
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function partsIn(at: Date, tz: string): Ymd & { h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

function offsetAt(at: Date, tz: string): number {
  const p = partsIn(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant local midnight starts on a calendar date in `tz` (month may overflow; Date.UTC normalises it). */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(new Date(guess), tz);
  return new Date(guess - offsetAt(new Date(first), tz));
}

/** Today's calendar date in `tz`. */
export function localToday(now: Date, tz: string): Ymd {
  const p = partsIn(now, tz);
  return { y: p.y, m: p.m, d: p.d };
}

const fmtDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
};

/** Turns a period into instants in the viewer's time zone. Quarters and halves follow the calendar year. */
export function periodRange(period: ReportPeriod, opts: { tz: string; now?: Date; from?: string; to?: string; fyStart?: number }): PeriodRange {
  const tz = safeZone(opts.tz);
  const now = opts.now ?? new Date();
  const { y, m } = localToday(now, tz);
  const q = Math.floor((m - 1) / 3); // 0-3
  const fy = opts.fyStart ?? 4;
  const fyYear = m >= fy ? y : y - 1;
  let a: [number, number, number];
  let b: [number, number, number]; // exclusive end date
  switch (period) {
    case 'this_month':
      a = [y, m, 1]; b = [y, m + 1, 1]; break;
    case 'last_month':
      a = [y, m - 1, 1]; b = [y, m, 1]; break;
    case 'this_quarter':
      a = [y, q * 3 + 1, 1]; b = [y, q * 3 + 4, 1]; break;
    case 'last_quarter':
      a = [y, q * 3 - 2, 1]; b = [y, q * 3 + 1, 1]; break;
    case 'h1':
      a = [y, 1, 1]; b = [y, 7, 1]; break;
    case 'h2':
      a = [y, 7, 1]; b = [y + 1, 1, 1]; break;
    case 'this_year':
      a = [y, 1, 1]; b = [y + 1, 1, 1]; break;
    case 'last_year':
      a = [y - 1, 1, 1]; b = [y, 1, 1]; break;
    case 'this_fy':
      a = [fyYear, fy, 1]; b = [fyYear + 1, fy, 1]; break;
    case 'last_fy':
      a = [fyYear - 1, fy, 1]; b = [fyYear, fy, 1]; break;
    case 'custom': {
      const [fy1, fm1, fd1] = (opts.from ?? fmtDay(y, m, 1)).split('-').map(Number) as [number, number, number];
      const [ty, tm, td] = (opts.to ?? fmtDay(y, m, 28)).split('-').map(Number) as [number, number, number];
      a = [fy1, fm1, fd1]; b = [ty, tm, td + 1]; break;
    }
  }
  const start = zonedMidnight(a[0], a[1], a[2], tz);
  const end = zonedMidnight(b[0], b[1], b[2], tz);
  const last = new Date(Date.UTC(b[0], b[1] - 1, b[2] - 1));
  return { period, start: start.toISOString(), end: end.toISOString(), fromDay: new Date(Date.UTC(a[0], a[1] - 1, a[2])).toISOString().slice(0, 10), toDay: last.toISOString().slice(0, 10) };
}

/** A time zone Intl accepts, else UTC. */
export function safeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** The calendar months (YYYY-MM) a range touches, in the time zone the range was made in. */
export function monthsOf(range: PeriodRange): string[] {
  const out: string[] = [];
  let [y, m] = range.fromDay.split('-').map(Number) as [number, number];
  const [ty, tm] = range.toDay.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * A period's target from the stored sales targets (YYYY-MM, YYYY-Qn or YYYY): each month uses its own target, else a
 * third of its quarter's, else a twelfth of its year's. Null when none of the months has any.
 */
export function targetFor(months: string[], targets: Map<string, number>): number | null {
  let total = 0;
  let any = false;
  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number) as [number, number];
    const month = targets.get(ym);
    const quarter = targets.get(`${y}-Q${Math.floor((m - 1) / 3) + 1}`);
    const year = targets.get(String(y));
    const v = month ?? (quarter !== undefined ? quarter / 3 : year !== undefined ? year / 12 : undefined);
    if (v !== undefined) {
      total += v;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

// ─── The lead funnel ───

/** New Lead → Contacted → Discussion → Interested → RFQ Received → Quotation Submitted → Negotiation → Won / Lost. */
export const FUNNEL_STAGES = ['NEW', 'CONTACTED', 'DISCUSSION', 'INTERESTED', 'RFQ_RECEIVED', 'QUOTATION_SUBMITTED', 'NEGOTIATION', 'WON', 'LOST'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** Where the starter company statuses sit in the funnel; a renamed or new status falls back to its meaning. */
export const STATUS_FUNNEL_BY_NAME: Record<string, FunnelStage> = {
  'New Lead': 'NEW',
  'Discussion Phase': 'DISCUSSION',
  'Revert Soon': 'INTERESTED',
  'Call Scheduled': 'INTERESTED',
  'Meeting Scheduled': 'INTERESTED',
  'RFQ Received': 'RFQ_RECEIVED',
  'RFQ Received – Not Won': 'RFQ_RECEIVED',
  'RFQs Below Target Pricing': 'QUOTATION_SUBMITTED',
  Negotiation: 'NEGOTIATION',
};

export interface FunnelEvidence {
  status: { name: string; meaning: string | null } | null;
  /** Any interaction, logged or synced, with the company or its employees. */
  contacted: boolean;
  rfqStatuses: string[];
  /** Open deals; `negotiating` when one is in a stage whose name says negotiation. */
  openDeals: number;
  negotiating: boolean;
  won: boolean;
}

/**
 * The furthest funnel stage a company has reached, from its records: a win (a won deal or RFQ, or a client status)
 * is Won; a lost-meaning status is Lost; otherwise the furthest of its status and what its RFQs, deals and
 * interactions show.
 */
export function funnelStageOf(e: FunnelEvidence): FunnelStage {
  if (e.won || e.status?.meaning === 'CLIENT') return 'WON';
  if (e.status?.meaning === 'LOST') return 'LOST';
  const rank = (s: FunnelStage) => FUNNEL_STAGES.indexOf(s);
  let best: FunnelStage = 'NEW';
  const lift = (s: FunnelStage) => {
    if (rank(s) > rank(best)) best = s;
  };
  const fromStatus = e.status ? STATUS_FUNNEL_BY_NAME[e.status.name] : undefined;
  if (fromStatus) lift(fromStatus);
  if (e.contacted) lift('CONTACTED');
  if (e.rfqStatuses.length) lift('RFQ_RECEIVED');
  if (e.rfqStatuses.some((s) => s === 'QUOTATION_SUBMITTED' || s === 'LOST')) lift('QUOTATION_SUBMITTED');
  if (e.openDeals > 0) lift('QUOTATION_SUBMITTED');
  if (e.negotiating || e.rfqStatuses.includes('NEGOTIATION')) lift('NEGOTIATION');
  return best;
}

// ─── Drill-down: what a card or stage opens ───

/** Every number on the dashboards that opens a list of the records behind it. */
export const DRILL_METRICS = [
  'leadsGenerated', 'activeCompanies', 'employeesContacted', 'emailsSent', 'responses', 'positiveResponses',
  'followUpsToday', 'followUpsOverdue', 'followUpsPending', 'rfqsReceived', 'rfqsSubmitted', 'rfqsWon', 'rfqsLost',
  'clientsConverted', 'clientsRejected', 'clientConcerns', 'transfersToSenior', 'revenue', 'openOpportunities',
  'existingClients', 'companies', 'outstanding', 'unassignedLeads',
  'stage:NEW', 'stage:CONTACTED', 'stage:DISCUSSION', 'stage:INTERESTED', 'stage:RFQ_RECEIVED', 'stage:QUOTATION_SUBMITTED', 'stage:NEGOTIATION', 'stage:WON', 'stage:LOST',
] as const;
export type DrillMetric = (typeof DRILL_METRICS)[number];

export const drillQuerySchema = z.intersection(
  commandCenterQuerySchema,
  z.object({
    metric: z.enum(DRILL_METRICS),
    /** Whose records: mine (one person, `userId` or the caller), team (the caller's reporting tree) or org. */
    scope: z.enum(['me', 'team', 'org']).default('me'),
    departmentId: z.string().uuid().optional(),
  }),
);
export type DrillQuery = z.output<typeof drillQuerySchema>;

export type DrillKind = 'company' | 'contact' | 'followUp' | 'rfq' | 'revenue' | 'transfer' | 'interaction' | 'email' | 'deal';

export interface DrillRow {
  kind: DrillKind;
  id: string;
  title: string;
  subtitle: string | null;
  /** The record's own page. */
  href: string | null;
  at: string | null;
  person: PersonRef | null;
  status: { name: string; color: string | null } | null;
  amount: number | null;
  currency: string | null;
}

export interface DrillResult {
  metric: DrillMetric;
  rows: DrillRow[];
  /** The number on the card; rows stop at 200. */
  total: number;
}

// ─── Context: who sees which dashboard ───

export interface CommandCenterContext {
  tier: DashboardTier;
  /** Where the tier came from: the person's designation, or their role when they have none. */
  tierSource: 'designation' | 'role';
  designation: string | null;
  department: string | null;
  reportingManager: PersonRef | null;
  /** The dashboards this person can open, best first. */
  views: CommandCenterView[];
  defaultView: CommandCenterView;
  recordScope: 'OWN' | 'TEAM' | 'ALL';
  /** People reporting to them, directly or further down (those their visibility reaches). */
  reports: PersonRef[];
  currency: string;
  canSetTargets: boolean;
}

// ─── Executive dashboard ───

export interface KpiCard {
  key: DrillMetric;
  value: number;
  format: 'number' | 'currency' | 'percent';
}

export interface WorkItem {
  kind: 'task' | 'followUp' | 'rfq' | 'concern' | 'contact' | 'company' | 'transfer';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  at: string | null;
  priority: string | null;
  overdue: boolean;
  from: PersonRef | null;
  /** Team views: who the record is with (assignee or owner), and its company, for the manager's actions. */
  assignee?: PersonRef | null;
  companyId?: string | null;
}

export const WORK_SECTIONS = ['today', 'pending', 'overdue', 'calls', 'meetings', 'awaiting', 'rfqDeadlines', 'concerns', 'fromManager', 'reassigned'] as const;
export type WorkSection = (typeof WORK_SECTIONS)[number];

/** A category a person adds to My Work: open follow-ups of one type and/or priority. */
export const workCategorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    label: z.string().trim().min(1, 'Enter a name').max(60),
    followUpType: z.string().max(20).nullable().default(null),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']).nullable().default(null),
  })
  .strict();
export type WorkCategory = z.infer<typeof workCategorySchema>;

export const commandCenterLayoutSchema = z
  .object({
    sections: z.array(z.object({ id: z.string().max(40), hidden: z.boolean().default(false) }).strict()).max(20),
    workSections: z.array(z.object({ id: z.string().max(40), hidden: z.boolean().default(false) }).strict()).max(40).default([]),
    categories: z.array(workCategorySchema).max(10).default([]),
  })
  .strict();
export type CommandCenterLayout = z.infer<typeof commandCenterLayoutSchema>;

export interface WorkBucket {
  id: string;
  label: string | null;
  items: WorkItem[];
  total: number;
}

export interface FunnelRow {
  stage: FunnelStage;
  companies: number;
  opportunities: number;
  /** Open deals plus open RFQ quotations that have no deal yet, in the workspace currency. */
  potentialValue: number;
  /** Of the companies in the funnel, the share that reached this stage or a later one (Lost counts only itself). */
  conversion: number | null;
  /** People who own companies at this stage (team and organisation funnels). */
  people?: number;
  wonRevenue?: number;
}

export interface RevenueLine {
  recordId: string;
  source: 'DEAL' | 'RFQ';
  company: { id: string; name: string; leadNumber: string | null } | null;
  project: string;
  dealId: string | null;
  rfqId: string | null;
  /** The full won value in its own currency and in the workspace currency (null when no rate is entered). */
  value: number;
  currency: string;
  baseValue: number | null;
  closedAt: string;
  closer: PersonRef | null;
  leadCreator: PersonRef | null;
  manager: PersonRef | null;
  roles: CreditRole[];
  percent: number;
  /** The credited share in the workspace currency. */
  contribution: number | null;
  recognised: number | null;
  collected: number | null;
}

export interface PeriodRevenue {
  period: ReportPeriod;
  /** The person's share of revenue closed in the period, in the workspace currency. */
  amount: number;
  /** The full value of the deals they hold a share of. */
  dealValue: number;
  deals: number;
}

export interface ExecutiveDashboard {
  person: PersonRef & { department: string | null; reportingManager: PersonRef | null; avatarUrl: string | null };
  range: PeriodRange;
  currency: string;
  month: { target: number | null; achieved: number; percent: number | null };
  kpis: KpiCard[];
  work: WorkBucket[];
  funnel: FunnelRow[];
  performance: {
    leads: { month: number; quarter: number; half: number; year: number };
    rfqsReceived: number;
    rfqsSubmitted: number;
    rfqsWon: number;
    revenue: number;
    target: number | null;
    achievement: number | null;
    /** RFQs won ÷ RFQs won or lost in the period. */
    rfqWinRate: number | null;
    /** Companies created in the period that became clients. */
    leadConversion: number | null;
    averageDealValue: number | null;
  };
  revenue: {
    periods: PeriodRevenue[];
    lines: RevenueLine[];
    /** Revenue whose currency has no exchange rate is left out of totals and listed here. */
    unconverted: { currency: string; amount: number }[];
  } | null;
  /** The plan features behind sections that may be switched off. */
  features: { revenueAttribution: boolean; leadTransfers: boolean; instructions: boolean; clientConcerns: boolean };
  layout: CommandCenterLayout | null;
  generatedAt: string;
}

// ─── Lead transfers ───

export const TRANSFER_REASONS = LEAD_TRANSFER_REASONS.filter((r) => r !== 'REASSIGNED') as Exclude<(typeof LEAD_TRANSFER_REASONS)[number], 'REASSIGNED'>[];
export const TRANSFER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REASSIGNED', 'CANCELLED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const leadTransferInputSchema = z
  .object({
    companyId: z.string().uuid(),
    contactId: z.string().uuid().nullable().optional(),
    /** Who should take the lead; empty asks the requester's reporting manager to choose. */
    toUserId: z.string().uuid().nullable().optional(),
    reason: z.enum(TRANSFER_REASONS as [string, ...string[]]),
    opportunityValue: z.coerce.number().min(0).max(1e13).nullable().optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code').nullable().optional(),
    remarks: z.string().trim().max(2000).nullable().optional(),
    /** Company files attached to the request (uploaded to the company first). */
    fileIds: z.array(z.string().uuid()).max(10).default([]),
  })
  .strict();
export type LeadTransferInput = z.input<typeof leadTransferInputSchema>;

export const leadTransferDecisionSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'REASSIGN']),
    /** For REASSIGN, or to approve to someone other than the proposed owner. */
    toUserId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    /** Instructions for the new owner, sent with the notification. */
    instructions: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((d) => d.action !== 'REASSIGN' || !!d.toUserId, { message: 'Choose who takes the lead', path: ['toUserId'] });
export type LeadTransferDecision = z.input<typeof leadTransferDecisionSchema>;

export const leadTransferListSchema = z.object({
  box: z.enum(['mine', 'toDecide', 'all']).default('mine'),
  status: z.enum(TRANSFER_STATUSES).optional(),
  companyId: z.string().uuid().optional(),
});

export interface LeadTransferRow {
  id: string;
  company: { id: string; name: string; leadNumber: string | null };
  contact: { id: string; name: string } | null;
  from: PersonRef | null;
  proposed: PersonRef | null;
  requestedBy: PersonRef | null;
  reason: string;
  opportunityValue: number | null;
  currency: string | null;
  remarks: string | null;
  files: { id: string; name: string }[];
  status: TransferStatus;
  decidedBy: PersonRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  instructions: string | null;
  newOwner: PersonRef | null;
  /** The lead creator, kept whatever happens to ownership. */
  creator: PersonRef | null;
  /** Whether the caller may approve, reject or reassign it. */
  canDecide: boolean;
  createdAt: string;
}

// ─── Revenue records ───

export interface RevenueRecordRow extends RevenueLine {
  credits: { user: PersonRef | null; roles: CreditRole[]; percent: number; amount: number }[];
  manual: boolean;
  paymentStatus: string | null;
}

export const revenueRecordUpdateSchema = z
  .object({
    recognisedAmount: z.coerce.number().min(0).max(1e13).nullable().optional(),
    collectedAmount: z.coerce.number().min(0).max(1e13).nullable().optional(),
    paymentStatus: z.enum(['NOT_DUE', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE']).nullable().optional(),
  })
  .strict();
export type RevenueRecordUpdate = z.infer<typeof revenueRecordUpdateSchema>;

// ─── Manager dashboard (spec section 12) ───

/** The follow-up monitoring sections of the manager dashboard (12.6), in their default order. */
export const MONITOR_SECTIONS = ['teamToday', 'teamOverdue', 'teamMeetings', 'teamAwaiting', 'teamRfqDeadlines', 'teamConcerns', 'unassigned', 'intervention'] as const;
export type MonitorSection = (typeof MONITOR_SECTIONS)[number];

export const PERFORMANCE_STATUSES = ['ACHIEVED', 'ON_TRACK', 'AT_RISK', 'BEHIND', 'NO_TARGET', 'INACTIVE'] as const;
export type PerformanceStatus = (typeof PERFORMANCE_STATUSES)[number];

/**
 * How a person is doing against their target, given how much of the period has gone (0-1): achieved at 100%, on
 * track within 90% of the pace the elapsed time asks for, at risk within 60%, else behind. Without a target, a person
 * with no activity in the period is inactive.
 */
export function performanceStatus(achievement: number | null, elapsed: number, active: boolean): PerformanceStatus {
  if (achievement === null) return active ? 'NO_TARGET' : 'INACTIVE';
  if (achievement >= 100) return 'ACHIEVED';
  const pace = Math.max(0, Math.min(1, elapsed)) * 100;
  if (achievement >= pace * 0.9) return 'ON_TRACK';
  if (achievement >= pace * 0.6) return 'AT_RISK';
  return 'BEHIND';
}

/** Share on the 0-100 scale to one decimal, or null when there is nothing to divide by. */
export function ratio(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 1000) / 10 : null;
}

export interface TeamMemberRow {
  person: PersonRef;
  /** Direct report of the dashboard's manager, or further down the reporting lines. */
  direct: boolean;
  leads: number;
  activeCompanies: number;
  emailsSent: number;
  responses: number;
  positiveResponses: number;
  followUpsPending: number;
  followUpsOverdue: number;
  rfqsReceived: number;
  rfqsSubmitted: number;
  rfqsWon: number;
  rfqsLost: number;
  clientsConverted: number;
  /** Their credited revenue in the period, in the workspace currency. */
  business: number;
  wonDeals: number;
  target: number | null;
  achievement: number | null;
  status: PerformanceStatus;
  /** Responses ÷ emails sent. */
  responseRate: number | null;
  /** RFQs won ÷ RFQs won or lost. */
  rfqConversion: number | null;
  /** Follow-ups due in the period that were completed. */
  followUpCompletion: number | null;
}

export interface PersonRevenueRow {
  person: PersonRef;
  month: number;
  quarter: number;
  year: number;
}

export interface ManagerRevenueRow extends PersonRevenueRow {
  /** People in their part of the team, themselves included. */
  teamSize: number;
}

export interface ManagerDashboard {
  person: PersonRef & { department: string | null; reportingManager: PersonRef | null };
  /** Everyone reporting to the manager, directly or further down. */
  teamSize: number;
  range: PeriodRange;
  currency: string;
  /** This month's team target (the sum of each member's) and the team's revenue, each deal counted once. */
  month: { target: number | null; achieved: number; percent: number | null };
  kpis: KpiCard[];
  team: TeamMemberRow[];
  funnel: FunnelRow[];
  monitor: WorkBucket[];
  revenue: {
    people: PersonRevenueRow[];
    /** Managers within the team, each with the revenue of their own part of it. */
    managers: ManagerRevenueRow[];
    /** The whole team, each deal counted once. */
    team: { month: number; quarter: number; year: number };
    unconverted: { currency: string; amount: number }[];
  } | null;
  features: { revenueAttribution: boolean; leadTransfers: boolean; instructions: boolean; clientConcerns: boolean };
  layout: CommandCenterLayout | null;
  generatedAt: string;
}


// ─── Instructions and remarks (spec 15.2) ───

export const INSTRUCTION_KINDS = ['INSTRUCTION', 'REMARK'] as const;
export const INSTRUCTION_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'DONE', 'CANCELLED'] as const;
export type InstructionStatus = (typeof INSTRUCTION_STATUSES)[number];
export const MESSAGE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type MessagePriority = (typeof MESSAGE_PRIORITIES)[number];

export const instructionInputSchema = z
  .object({
    toUserId: z.string().uuid(),
    kind: z.enum(INSTRUCTION_KINDS).default('INSTRUCTION'),
    message: z.string().trim().min(1, 'Write the instruction').max(2000),
    companyId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    priority: z.enum(MESSAGE_PRIORITIES).default('NORMAL'),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export type InstructionInput = z.input<typeof instructionInputSchema>;

export const instructionProgressSchema = z
  .object({
    action: z.enum(['ACKNOWLEDGE', 'DONE', 'REOPEN']),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type InstructionProgress = z.input<typeof instructionProgressSchema>;

export const instructionListSchema = z.object({
  box: z.enum(['received', 'sent']).default('received'),
  status: z.enum(['open', 'all']).default('open'),
  companyId: z.string().uuid().optional(),
});

export interface InstructionRow {
  id: string;
  kind: (typeof INSTRUCTION_KINDS)[number];
  message: string;
  from: PersonRef | null;
  to: PersonRef | null;
  company: { id: string; name: string; leadNumber: string | null } | null;
  contact: { id: string; name: string } | null;
  priority: MessagePriority;
  dueAt: string | null;
  status: InstructionStatus;
  acknowledgedAt: string | null;
  completedAt: string | null;
  completionNote: string | null;
  createdAt: string;
  /** The caller is the recipient (can acknowledge and complete) or the sender (can withdraw). */
  canProgress: boolean;
  canCancel: boolean;
}

// ─── Client concerns (spec section 19) ───

export const CONCERN_CATEGORIES = ['GENERAL', 'PRICING', 'QUALITY', 'COMMUNICATION', 'DELIVERY', 'PAYMENT', 'SERVICE', 'NOT_INTERESTED', 'REJECTED', 'LOST_OPPORTUNITY'] as const;
export type ConcernCategory = (typeof CONCERN_CATEGORIES)[number];
export const CONCERN_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const clientConcernInputSchema = z
  .object({
    companyId: z.string().uuid(),
    contactId: z.string().uuid().nullable().optional(),
    category: z.enum(CONCERN_CATEGORIES),
    title: z.string().trim().min(1, 'Enter a short title').max(200),
    description: z.string().trim().max(5000).nullable().optional(),
    severity: z.enum(CONCERN_SEVERITIES).default('MEDIUM'),
    ownerId: z.string().uuid().nullable().optional(),
    managerId: z.string().uuid().nullable().optional(),
    deadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export type ClientConcernInput = z.input<typeof clientConcernInputSchema>;

export const clientConcernUpdateSchema = clientConcernInputSchema.omit({ companyId: true }).partial().strict();
export type ClientConcernUpdate = z.input<typeof clientConcernUpdateSchema>;

export const clientConcernEscalateSchema = z
  .object({
    /** Empty sends it to the next person up from the concern's manager. */
    toUserId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export const clientConcernResolveSchema = z.object({ resolution: z.string().trim().min(1, 'Describe how it was resolved').max(5000) }).strict();

export const clientConcernListSchema = z.object({
  /** mine: I own or manage it. team: on my team's companies. escalated: escalated to me. */
  box: z.enum(['mine', 'team', 'escalated']).default('mine'),
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  companyId: z.string().uuid().optional(),
});

export interface ClientConcernRow {
  id: string;
  company: { id: string; name: string; leadNumber: string | null };
  contact: { id: string; name: string } | null;
  category: ConcernCategory;
  title: string;
  description: string | null;
  severity: (typeof CONCERN_SEVERITIES)[number];
  status: 'OPEN' | 'RESOLVED';
  owner: PersonRef | null;
  manager: PersonRef | null;
  openedBy: PersonRef | null;
  deadlineAt: string | null;
  overdue: boolean;
  escalatedTo: PersonRef | null;
  escalatedAt: string | null;
  escalationNote: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: PersonRef | null;
  createdAt: string;
  canEdit: boolean;
  canEscalate: boolean;
}
