import { z } from 'zod';
import type { WorkPerson, WorkspaceRef } from './workspace-work';

/*
 * Performance ranking (ADR 0096). Plain arithmetic on stored records, never a model's guess. The Super Workspace picks
 * the measures that count and how much each weighs. Each measure gives a person (or a manager's team) a share between
 * 0 and 1: target achievement and task completion are already percentages; counts and money are compared with the best
 * in the same ranking for the same period. The score is the weighted average of those shares, out of 100.
 */

export const RANKING_METRICS = [
  'TARGET_ACHIEVEMENT',
  'TASK_COMPLETION',
  'QUALIFIED_COMPANIES',
  'EMAILS_SENT',
  'CALLS_CONNECTED',
  'DEALS_CREATED',
  'DEALS_WON',
  'REVENUE',
  'FOLLOW_UPS_DONE',
  'MEETINGS',
  'RFQS',
] as const;
export type RankingMetric = (typeof RANKING_METRICS)[number];
export const RANKING_METRIC_LABEL: Record<RankingMetric, string> = {
  TARGET_ACHIEVEMENT: 'Target achievement',
  TASK_COMPLETION: 'Task completion',
  QUALIFIED_COMPANIES: 'Qualified companies created',
  EMAILS_SENT: 'Emails sent',
  CALLS_CONNECTED: 'Connected calls',
  DEALS_CREATED: 'Deals created',
  DEALS_WON: 'Deals won',
  REVENUE: 'Revenue',
  FOLLOW_UPS_DONE: 'Follow-ups completed',
  MEETINGS: 'Meetings',
  RFQS: 'RFQs received',
};
/** Measures that are percentages already (not compared with the best). */
export const PERCENT_RANKING_METRICS: ReadonlySet<RankingMetric> = new Set(['TARGET_ACHIEVEMENT', 'TASK_COMPLETION']);

/** Out of the box: results weigh more than activity, so nobody climbs on volume alone. */
export const DEFAULT_RANKING_WEIGHTS: Record<RankingMetric, number> = {
  TARGET_ACHIEVEMENT: 30,
  TASK_COMPLETION: 15,
  QUALIFIED_COMPANIES: 10,
  EMAILS_SENT: 5,
  CALLS_CONNECTED: 5,
  DEALS_CREATED: 10,
  DEALS_WON: 10,
  REVENUE: 15,
  FOLLOW_UPS_DONE: 0,
  MEETINGS: 0,
  RFQS: 0,
};

/** Who besides the manager and the assignee hears about recurring tasks: every completion and miss, only misses, or nothing. */
export const SUPER_TASK_NOTICES = ['ALL', 'MISSED_ONLY', 'OFF'] as const;
export type SuperTaskNotices = (typeof SUPER_TASK_NOTICES)[number];
export const SUPER_TASK_NOTICES_LABEL: Record<SuperTaskNotices, string> = {
  ALL: 'Completed and missed tasks',
  MISSED_ONLY: 'Only missed tasks',
  OFF: 'No task notifications',
};

export const performanceSettingsSchema = z
  .object({
    weights: z.record(z.enum(RANKING_METRICS), z.number().int().min(0).max(100)),
    /** Whether an executive sees where they stand among their team (otherwise only their own figures). */
    showTeamPosition: z.boolean(),
    superTaskNotices: z.enum(SUPER_TASK_NOTICES),
  })
  .strict()
  .refine((v) => Object.values(v.weights).some((w) => (w ?? 0) > 0), { message: 'Give at least one measure a weight above 0', path: ['weights'] });
export type PerformanceSettingsInput = z.infer<typeof performanceSettingsSchema>;

export interface PerformanceSettings {
  weights: Record<RankingMetric, number>;
  showTeamPosition: boolean;
  superTaskNotices: SuperTaskNotices;
  updatedAt: string | null;
  updatedBy: WorkPerson | null;
}

export const PERFORMANCE_PERIODS = ['WEEK', 'MONTH', 'QUARTER'] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];
export const PERFORMANCE_PERIOD_LABEL: Record<PerformancePeriod, string> = { WEEK: 'This week', MONTH: 'This month', QUARTER: 'This quarter' };

export const performanceQuerySchema = z
  .object({
    period: z.enum(PERFORMANCE_PERIODS).default('MONTH'),
    /** 0 = the period running now, -1 = the one before, and so on (up to two years back). */
    offset: z.coerce.number().int().min(-24).max(0).default(0),
  })
  .strict();
export type PerformanceQuery = z.input<typeof performanceQuerySchema>;

export interface RankingRow {
  rank: number;
  /** Rank in the previous period of the same length (null when they were not ranked then). */
  previousRank: number | null;
  kind: 'MANAGER' | 'EXECUTIVE';
  /** The person, or for a manager the people of the Manager Workspace. */
  people: WorkPerson[];
  workspace: WorkspaceRef;
  /** People counted: the manager's whole team, or one for an executive. */
  teamSize: number;
  /** Per measure; null when it does not apply (no target or no finished task in the period), so it is left out of the score. */
  values: Partial<Record<RankingMetric, number | null>>;
  /** 0-1 share per measure, as used in the score. */
  shares: Partial<Record<RankingMetric, number | null>>;
  score: number;
  previousScore: number | null;
  /** Whether this row is the caller (or the caller's Manager Workspace). */
  me: boolean;
}

export interface PerformanceView {
  period: { kind: PerformancePeriod; offset: number; startsOn: string; endsOn: string; previousStartsOn: string; previousEndsOn: string };
  /** The measures that count, with their weight (weights above 0 only). */
  method: { metric: RankingMetric; weight: number; relative: boolean }[];
  /** Manager rankings: everyone for the Super Workspace, the caller's own row (and others when allowed) for a manager. */
  managers: RankingRow[];
  /** Executive rankings within what the caller may see. */
  executives: RankingRow[];
  /** What the caller sees: the whole organisation, their team, or themselves. */
  scope: 'ORGANISATION' | 'TEAM' | 'SELF';
  currency: string;
  canConfigure: boolean;
  /** Whether an executive is shown their position (Super setting). */
  showTeamPosition: boolean;
}
