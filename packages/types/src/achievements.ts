import { z } from 'zod';

/*
 * Achievements and celebrations (ADR 0090). SampForce records an achievement once, in the same transaction as the
 * business change that earned it (a company converted into a deal, an RFQ SampBidx confirmed, a lead target reached),
 * and the browser that takes it plays the celebration once. Figures come from the records, never typed in.
 */

/** How big the celebration is. */
export const ACHIEVEMENT_LEVELS = ['ROUTINE', 'DAILY', 'MAJOR', 'EXCEPTIONAL'] as const;
export type AchievementLevel = (typeof ACHIEVEMENT_LEVELS)[number];

/** What a person can switch off, one category at a time. */
export const ACHIEVEMENT_CATEGORIES = ['deals', 'rfqs', 'tasks', 'leads', 'sales', 'consistency', 'recognition'] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  deals: 'Companies converted into deals',
  rfqs: 'RFQs submitted',
  tasks: 'Tasks and follow-ups',
  leads: 'Lead targets',
  sales: 'Sales targets and milestones',
  consistency: 'Consistency',
  recognition: 'Employee of the Month and improvement plans',
};

export const ACHIEVEMENT_KINDS = [
  /** A company was converted into a won deal (the Won action on the company, ADR 0084). */
  'DEAL_CONVERTED',
  /** A lead was converted and a deal was created from it. */
  'PROSPECT_CONVERTED',
  /** SampBidx confirmed it received an RFQ (never on a draft, a failed send or while sending). */
  'RFQ_SUBMITTED',
  /** A high-priority task, a client follow-up or a meeting was completed. */
  'TASK_IMPORTANT',
  /** Every task due today (at least two) is done. */
  'ALL_TASKS_DONE',
  /** 25, 50 or 75 percent of today's lead target. */
  'LEAD_MILESTONE',
  /** A daily, weekly or monthly lead target reached. */
  'LEAD_TARGET',
  /** A monthly or quarterly revenue or won-deals target reached. */
  'SALES_TARGET',
  /** The 1st, 5th, 10th, 25th, 50th, 100th... won deal. */
  'DEALS_WON_MILESTONE',
  /** A won deal at least as big as the person's major-deal amount, or their biggest win yet. */
  'MAJOR_DEAL',
  /** A steady working day: checked in and out, no unplanned interruption, every task due today done. */
  'CONSISTENCY',
  /** Every requirement of a recurring task instance (today's, this week's or this month's) was reached (ADR 0096). */
  'TASK_PLAN_DONE',
  /** Half of everything a recurring task instance asks for is done (ADR 0096). */
  'TASK_PLAN_HALF',
  /** Named Employee of the Month (ADR 0102), for the organisation or the person's team. */
  'EMPLOYEE_OF_THE_MONTH',
  /** Every Employee of the Month condition is met: eligible, not yet selected (ADR 0102). */
  'RECOGNITION_ELIGIBLE',
  /** An improvement plan was confirmed as successfully completed (ADR 0102). */
  'PIP_COMPLETED',
] as const;
export type AchievementKind = (typeof ACHIEVEMENT_KINDS)[number];

export const ACHIEVEMENT_CATEGORY_OF: Record<AchievementKind, AchievementCategory> = {
  DEAL_CONVERTED: 'deals',
  PROSPECT_CONVERTED: 'deals',
  RFQ_SUBMITTED: 'rfqs',
  TASK_IMPORTANT: 'tasks',
  ALL_TASKS_DONE: 'tasks',
  LEAD_MILESTONE: 'leads',
  LEAD_TARGET: 'leads',
  SALES_TARGET: 'sales',
  DEALS_WON_MILESTONE: 'sales',
  MAJOR_DEAL: 'sales',
  CONSISTENCY: 'consistency',
  TASK_PLAN_DONE: 'tasks',
  TASK_PLAN_HALF: 'tasks',
  EMPLOYEE_OF_THE_MONTH: 'recognition',
  RECOGNITION_ELIGIBLE: 'recognition',
  PIP_COMPLETED: 'recognition',
};

/** Percentages of the daily lead target that get a small celebration before the target itself. */
export const LEAD_MILESTONES = [25, 50, 75] as const;
/** Won-deal counts that get a milestone. */
export const DEALS_WON_MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000] as const;

/** A working day is recognised for consistency only between these lengths, so overwork is never rewarded. */
export const CONSISTENCY_MIN_MINUTES = 4 * 60;
export const CONSISTENCY_MAX_MINUTES = 10 * 60;

export type AchievementPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER';

/** Where a target came from: set by a manager or the Super Workspace, the forecast targets, or the person. */
export type AchievementTargetSource = 'ASSIGNED' | 'FORECAST' | 'PERSONAL';

/** The figures an achievement shows. Every field is optional because each kind uses some of them. */
export interface AchievementDetails {
  companyId?: string;
  companyName?: string;
  dealId?: string;
  dealName?: string;
  dealNumber?: string | null;
  amount?: number | null;
  currency?: string | null;
  /** The pipeline stage the deal moved into. */
  stage?: string | null;
  rfqId?: string | null;
  rfqNumber?: string | null;
  rfqTitle?: string;
  /** SampBidx's own reference for what it received. */
  reference?: string | null;
  destination?: 'SampBidx';
  taskId?: string;
  taskTitle?: string;
  priority?: string;
  followUp?: boolean;
  tasksDone?: number;
  /** Every one of them done before its due time. */
  onTime?: boolean;
  period?: AchievementPeriod;
  /** The day, week start, month (YYYY-MM) or quarter (YYYY-Qn) it belongs to. */
  periodLabel?: string;
  percent?: number;
  target?: number;
  actual?: number;
  remaining?: number;
  targetSource?: AchievementTargetSource;
  metric?: 'LEADS' | 'REVENUE' | 'DEALS_WON';
  count?: number;
  previousBest?: number | null;
  workedMinutes?: number;
  breakMinutes?: number;
  breaks?: number;
  /** Recurring tasks (ADR 0096): the cadence of the instance, what it asked and what was done, and the streak. */
  cadence?: 'DAY' | 'WEEK' | 'MONTH';
  items?: { metric: string; amount: number; done: number }[];
  streak?: number;
  /** Employee of the Month and plans (ADR 0102): the month (YYYY-MM), the award's scope, score and the plan. */
  month?: string;
  scope?: 'ORGANISATION' | 'TEAM';
  teamName?: string | null;
  score?: number;
  reward?: string | null;
  planNumber?: string;
  planTitle?: string;
}

export interface AchievementRow {
  id: string;
  kind: AchievementKind;
  category: AchievementCategory;
  level: AchievementLevel;
  details: AchievementDetails;
  link: string | null;
  achievedAt: string;
  /** Whether the person's settings asked for a pop-up when it was earned. */
  celebrate: boolean;
  shownAt: string | null;
}

export interface AchievementPage {
  items: AchievementRow[];
  nextCursor: string | null;
}

export interface LeadProgress {
  period: AchievementPeriod;
  periodLabel: string;
  target: number | null;
  targetSource: AchievementTargetSource | null;
  /** Valid leads (companies) the person added in the period. */
  actual: number;
  percent: number;
  remaining: number;
  /** Added in the period but not counted: no website, email, phone or LinkedIn, or a repeat of a company already in SampForce. */
  notCounted: number;
}

export interface SalesProgress {
  metric: 'REVENUE' | 'DEALS_WON';
  period: AchievementPeriod;
  periodLabel: string;
  target: number;
  targetSource: AchievementTargetSource;
  actual: number;
  percent: number;
  currency: string | null;
}

export const ACHIEVEMENT_BADGES = [
  { key: 'first-conversion', kind: 'DEAL_CONVERTED', goal: 1, title: 'First conversion' },
  { key: 'deal-maker', kind: 'DEAL_CONVERTED', goal: 10, title: 'Deal maker' },
  { key: 'rfq-launch', kind: 'RFQ_SUBMITTED', goal: 1, title: 'RFQ launch' },
  { key: 'rfq-pilot', kind: 'RFQ_SUBMITTED', goal: 25, title: 'RFQ pilot' },
  { key: 'quota-reached', kind: 'LEAD_TARGET', goal: 1, title: 'Quota reached' },
  { key: 'quota-regular', kind: 'LEAD_TARGET', goal: 10, title: 'Quota regular' },
  { key: 'clean-sweep', kind: 'ALL_TASKS_DONE', goal: 1, title: 'Clean sweep' },
  { key: 'target-hit', kind: 'SALES_TARGET', goal: 1, title: 'Target hit' },
  { key: 'big-win', kind: 'MAJOR_DEAL', goal: 1, title: 'Big win' },
  { key: 'steady-week', kind: 'CONSISTENCY', goal: 5, title: 'Steady rhythm' },
] as const satisfies readonly { key: string; kind: AchievementKind; goal: number; title: string }[];
export type AchievementBadgeKey = (typeof ACHIEVEMENT_BADGES)[number]['key'];

export interface AchievementBadge {
  key: AchievementBadgeKey;
  kind: AchievementKind;
  goal: number;
  progress: number;
  earnedAt: string | null;
}

export interface AchievementSummary {
  totals: {
    dealsConverted: number;
    rfqsSubmitted: number;
    dailyLeadTargets: number;
    weeklyLeadTargets: number;
    monthlyLeadTargets: number;
    /** Tasks and follow-ups the person completed (counted from the tasks themselves). */
    tasksCompleted: number;
    allTasksDays: number;
    salesTargets: number;
    milestones: number;
  };
  leads: { today: LeadProgress; week: LeadProgress; month: LeadProgress };
  sales: SalesProgress[];
  badges: AchievementBadge[];
  currency: string;
}

export const ACHIEVEMENT_STYLES = ['SUBTLE', 'EXPRESSIVE'] as const;
export type AchievementStyle = (typeof ACHIEVEMENT_STYLES)[number];

export interface AchievementSettingsView {
  enabled: boolean;
  style: AchievementStyle;
  sound: boolean;
  reduceMotion: boolean;
  mutedCategories: AchievementCategory[];
  dailyLeadTarget: number | null;
  weeklyLeadTarget: number | null;
  monthlyLeadTarget: number | null;
  monthlyRevenueTarget: number | null;
  majorDealAmount: number | null;
  currency: string;
  /** Targets a manager or the Super Workspace set for this period, which replace the personal ones while they run. */
  assigned: { dailyLeads: number | null; weeklyLeads: number | null; monthlyLeads: number | null; monthlyRevenue: number | null };
}

const count = z.number().int().min(1).max(100_000).nullable();
const money = z.number().positive().max(1e12).nullable();

export const achievementSettingsSchema = z
  .object({
    enabled: z.boolean(),
    style: z.enum(ACHIEVEMENT_STYLES),
    sound: z.boolean(),
    reduceMotion: z.boolean(),
    mutedCategories: z.array(z.enum(ACHIEVEMENT_CATEGORIES)).max(ACHIEVEMENT_CATEGORIES.length),
    dailyLeadTarget: count,
    weeklyLeadTarget: count,
    monthlyLeadTarget: count,
    monthlyRevenueTarget: money,
    majorDealAmount: money,
  })
  .partial()
  .strict();
export type AchievementSettingsInput = z.infer<typeof achievementSettingsSchema>;

export const achievementListQuerySchema = z.object({
  category: z.enum(ACHIEVEMENT_CATEGORIES).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AchievementListQuery = z.infer<typeof achievementListQuerySchema>;
