import { z } from 'zod';
import { METRIC_RULE, MONEY_METRICS, TARGET_METRIC_LABEL, TARGET_METRICS, type TargetMetric, type WorkspaceRef } from './workspace-work';
import type { WorkspaceLevel } from './workspaces';

/*
 * Employee of the Month and Performance Improvement Plans (ADR 0102). Both are built from goals: "create 20 qualified
 * companies per working day", "reach 100% task completion", "complete every assigned training module". SampForce
 * counts every goal from the stored records through the same Measures the targets, recurring tasks and rankings use,
 * so nobody types progress in and nothing is decided by AI. People (a manager or the Super Workspace) make the
 * decisions that need judgement: who is named Employee of the Month when the policy says so, and whether a plan was
 * completed, extended or closed as unsuccessful.
 */

// ───────────── Goals (shared) ─────────────

/** Percent measures: the goal's amount is a percentage to reach, not a count. */
export const PERCENT_GOAL_MEASURES = ['TASK_COMPLETION', 'TARGET_ACHIEVEMENT', 'LEARNING_MODULES', 'LEARNING_SCORE'] as const;
export const GOAL_MEASURES = [...TARGET_METRICS, ...PERCENT_GOAL_MEASURES, 'MANUAL'] as const;
export type GoalMeasure = (typeof GOAL_MEASURES)[number];
/** Employee of the Month counts only what SampForce can measure; a manager's own evaluation belongs to a PIP. */
export const RECOGNITION_MEASURES = GOAL_MEASURES.filter((m) => m !== 'MANUAL') as Exclude<GoalMeasure, 'MANUAL'>[];

export const GOAL_MEASURE_LABEL: Record<GoalMeasure, string> = {
  ...TARGET_METRIC_LABEL,
  TASK_COMPLETION: 'Task completion rate',
  TARGET_ACHIEVEMENT: 'Overall target achievement',
  LEARNING_MODULES: 'Training modules completed',
  LEARNING_SCORE: 'Training assessment score',
  MANUAL: 'Manager evaluation',
};

export const GOAL_RULE: Record<GoalMeasure, string> = {
  ...METRIC_RULE,
  TASK_COMPLETION: 'Tasks assigned to the person that fell due in the period and were completed, as a share of all of them (recurring task days included).',
  TARGET_ACHIEVEMENT: 'The average achievement of the targets of the person’s workspace that run in the period, each counted up to 100%.',
  LEARNING_MODULES: 'Training modules assigned to the person in the period that they completed and passed, as a share of all assigned.',
  LEARNING_SCORE: 'The average best assessment score of the training modules the person completed in the period.',
  MANUAL: 'A score from 0 to 100 that the manager records after reviewing the person’s work. The latest evaluation counts.',
};

export type GoalUnit = 'count' | 'money' | 'percent';
export function goalUnit(m: GoalMeasure): GoalUnit {
  if (m === 'MANUAL' || (PERCENT_GOAL_MEASURES as readonly string[]).includes(m)) return 'percent';
  return MONEY_METRICS.has(m as TargetMetric) ? 'money' : 'count';
}

/** A count or money goal is for the whole period or for every working day (Monday to Friday) in it. */
export const GOAL_PER = ['PERIOD', 'DAY'] as const;
export type GoalPer = (typeof GOAL_PER)[number];
export const GOAL_PER_LABEL: Record<GoalPer, string> = { PERIOD: 'In total', DAY: 'Per working day' };

const goalSchema = z
  .object({
    /** Kept when a goal is edited, so its evaluations and history stay with it. */
    id: z.string().max(40).optional(),
    measure: z.enum(GOAL_MEASURES),
    amount: z.number().positive('Enter an amount above 0').max(1e12),
    per: z.enum(GOAL_PER).default('PERIOD'),
    /** The goal's own name ("Qualified companies for the APAC push"); the measure's name when left out. */
    label: z.string().trim().max(120).optional(),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (goalUnit(g.measure) === 'percent') {
      if (g.amount > 100) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A percentage goal is at most 100.' });
      if (g.per === 'DAY') ctx.addIssue({ code: 'custom', path: ['per'], message: 'A percentage goal is for the whole period.' });
    }
  });
export type GoalInput = z.input<typeof goalSchema>;

/** One goal and where it stands, counted from the records. */
export interface GoalProgress {
  id: string;
  measure: GoalMeasure;
  label: string;
  /** How it is counted, in plain words. */
  rule: string;
  unit: GoalUnit;
  per: GoalPer;
  /** The amount as set: per working day for a daily goal. */
  amount: number;
  /** What the whole period asks for (amount × working days for a daily goal). */
  required: number;
  /** Counted so far (a percentage for percent goals); null when it cannot be measured yet. */
  done: number | null;
  remaining: number;
  /** done ÷ required × 100, one decimal; can pass 100. */
  percent: number;
  met: boolean;
  /** False when the measure cannot be counted in this organisation (training not set up) or awaits an evaluation. */
  measurable: boolean;
  /** Manager evaluations, newest first (MANUAL goals). */
  evaluations: GoalEvaluation[];
}

export interface GoalEvaluation {
  id: string;
  score: number;
  comments: string;
  evaluator: { id: string; name: string };
  at: string;
}

/** A person a goal is for, with what the dashboards show about them. */
export interface StaffCard {
  id: string;
  name: string;
  level: WorkspaceLevel;
  workspace: WorkspaceRef;
  designation: string | null;
  department: string | null;
  /** The people the person reports to: the reporting manager, or the people of the workspace above. */
  managers: { id: string; name: string }[];
  employeeCode: string | null;
}

// ───────────── Employee of the Month ─────────────

export const RECOGNITION_SELECTION = ['AUTOMATIC', 'MANUAL'] as const;
export type RecognitionSelection = (typeof RECOGNITION_SELECTION)[number];
export const RECOGNITION_SELECTION_LABEL: Record<RecognitionSelection, string> = {
  AUTOMATIC: 'Automatic: the eligible person with the best ranking',
  MANUAL: 'Chosen by a manager or the Super Workspace from the eligible people',
};

/** What the ranking compares, in the order the Super Workspace puts them. */
export const RANKING_CRITERIA = ['ACHIEVEMENT', 'SCORE', 'REVENUE', 'DEALS_WON', 'TASK_COMPLETION', 'LEARNING_SCORE'] as const;
export type RankingCriterion = (typeof RANKING_CRITERIA)[number];
export const RANKING_CRITERION_LABEL: Record<RankingCriterion, string> = {
  ACHIEVEMENT: 'Highest overall target achievement',
  SCORE: 'Highest performance score',
  REVENUE: 'Highest revenue won',
  DEALS_WON: 'Most deals won',
  TASK_COMPLETION: 'Highest task completion rate',
  LEARNING_SCORE: 'Highest training assessment score',
};
export const DEFAULT_RANKING: RankingCriterion[] = ['ACHIEVEMENT', 'REVENUE', 'TASK_COMPLETION', 'SCORE'];

/** When everything compared is equal. Never random. */
export const TIE_BREAKS = ['DECIDE', 'EARLIEST_ELIGIBLE'] as const;
export type TieBreak = (typeof TIE_BREAKS)[number];
export const TIE_BREAK_LABEL: Record<TieBreak, string> = {
  DECIDE: 'A manager or the Super Workspace decides',
  EARLIEST_ELIGIBLE: 'The person who became eligible first',
};

/** How eligibility is judged. */
export const ELIGIBILITY_RULES = ['EVERY_GOAL', 'OVERALL'] as const;
export type EligibilityRule = (typeof ELIGIBILITY_RULES)[number];
export const ELIGIBILITY_RULE_LABEL: Record<EligibilityRule, string> = {
  EVERY_GOAL: 'Every goal reaches the minimum achievement',
  OVERALL: 'The overall achievement reaches the minimum',
};

export const RECOGNITION_STATUSES = ['ACTIVE', 'ELIGIBLE', 'AWARDED', 'NOT_SELECTED', 'CLOSED', 'CANCELLED'] as const;
export type RecognitionStatus = (typeof RECOGNITION_STATUSES)[number];
export const RECOGNITION_STATUS_LABEL: Record<RecognitionStatus, string> = {
  ACTIVE: 'In progress',
  ELIGIBLE: 'Eligible',
  AWARDED: 'Employee of the Month',
  NOT_SELECTED: 'Eligible, not selected',
  CLOSED: 'Month ended',
  CANCELLED: 'Cancelled',
};

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-12');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01');

export const recognitionTargetCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    month,
    userId: z.string().min(1).max(64),
    goals: z.array(goalSchema).min(1, 'Add at least one goal').max(10),
    eligibility: z.enum(ELIGIBILITY_RULES).default('EVERY_GOAL'),
    /** Each goal (or the overall achievement) must reach this percentage. */
    minAchievementPercent: z.number().min(1).max(100).default(100),
    /** The performance score (0 to 100) the person must keep; null = no minimum. */
    minScore: z.number().min(0).max(100).nullable().default(null),
    conditions: z.string().trim().max(1000).optional(),
    description: z.string().trim().max(1000).optional(),
    reward: z.string().trim().max(200).optional(),
    /** Within the month; the whole month when left out. */
    startsOn: day.optional(),
    endsOn: day.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.goals.some((g) => g.measure === 'MANUAL')) ctx.addIssue({ code: 'custom', path: ['goals'], message: 'Employee of the Month goals are counted from records; manager evaluations belong to improvement plans.' });
    for (const [k, d] of [['startsOn', v.startsOn], ['endsOn', v.endsOn]] as const) {
      if (d && d.slice(0, 7) !== v.month) ctx.addIssue({ code: 'custom', path: [k], message: 'The dates must be inside the recognition month.' });
    }
    if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The end date cannot be before the start date.' });
  });
export type RecognitionTargetCreateInput = z.input<typeof recognitionTargetCreateSchema>;

export const recognitionTargetUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120).optional(),
    goals: z.array(goalSchema).min(1, 'Add at least one goal').max(10).optional(),
    eligibility: z.enum(ELIGIBILITY_RULES).optional(),
    minAchievementPercent: z.number().min(1).max(100).optional(),
    minScore: z.number().min(0).max(100).nullable().optional(),
    conditions: z.string().trim().max(1000).optional(),
    description: z.string().trim().max(1000).optional(),
    reward: z.string().trim().max(200).optional(),
    endsOn: day.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.goals?.some((g) => g.measure === 'MANUAL')) ctx.addIssue({ code: 'custom', path: ['goals'], message: 'Employee of the Month goals are counted from records; manager evaluations belong to improvement plans.' });
  });
export type RecognitionTargetUpdateInput = z.input<typeof recognitionTargetUpdateSchema>;

export const recognitionAwardSchema = z.object({ month, userId: z.string().min(1).max(64), note: z.string().trim().max(500).optional() }).strict();
export type RecognitionAwardInput = z.input<typeof recognitionAwardSchema>;
export const recognitionSelectSchema = z.object({ month }).strict();
export const recognitionRevokeSchema = z.object({ reason: z.string().trim().min(1, 'Say why').max(500) }).strict();

export const recognitionPolicySchema = z
  .object({
    selection: z.enum(RECOGNITION_SELECTION),
    ranking: z.array(z.enum(RANKING_CRITERIA)).min(1).max(RANKING_CRITERIA.length),
    tieBreak: z.enum(TIE_BREAKS),
    /** Managers may set Employee of the Month targets for their executives. */
    managersSetTargets: z.boolean(),
    /** Managers may name their own team's Employee of the Month. */
    managersSelectTeamWinner: z.boolean(),
    /** Managers may give their executives improvement plans. */
    managersAssignPlans: z.boolean(),
    /** Managers may decide their executives' plans (complete, extend, unsuccessful, cancel). */
    managersDecidePlans: z.boolean(),
    /** Days before a review date that the reviewer and the person are reminded. */
    reviewReminderDays: z.number().int().min(0).max(14),
    /** The Super Workspace hears about every plan's progress and reviews, not only its own. */
    superFollowsAllPlans: z.boolean(),
  })
  .strict()
  .refine((v) => new Set(v.ranking).size === v.ranking.length, { path: ['ranking'], message: 'Each ranking criterion can be used once.' });
export type RecognitionPolicy = z.infer<typeof recognitionPolicySchema>;
export const DEFAULT_RECOGNITION_POLICY: RecognitionPolicy = {
  selection: 'MANUAL',
  ranking: DEFAULT_RANKING,
  tieBreak: 'DECIDE',
  managersSetTargets: true,
  managersSelectTeamWinner: true,
  managersAssignPlans: true,
  managersDecidePlans: true,
  reviewReminderDays: 1,
  superFollowsAllPlans: true,
};

/** The performance score, out of 100, and what it is made of. */
export interface PerformanceScore {
  score: number;
  /** Each part counts the same; parts without data are left out (and say so). */
  parts: { key: 'GOALS' | 'TARGETS' | 'TASKS'; label: string; value: number | null }[];
}

export interface RecognitionTargetRow {
  id: string;
  name: string;
  month: string;
  startsOn: string;
  endsOn: string;
  person: StaffCard;
  goals: GoalProgress[];
  eligibility: EligibilityRule;
  minAchievementPercent: number;
  minScore: number | null;
  conditions: string | null;
  description: string | null;
  reward: string | null;
  /** Average of the goals' percentages (uncapped, one decimal). */
  achievementPercent: number;
  performance: PerformanceScore;
  eligible: boolean;
  eligibleAt: string | null;
  status: RecognitionStatus;
  setBy: { id: string; name: string } | null;
  setByLevel: 'SUPER' | 'MANAGER';
  editable: boolean;
  revisions: { at: string; by: string; changes: string[] }[];
  createdAt: string;
}

export interface RecognitionAwardRow {
  id: string;
  month: string;
  scope: 'ORGANISATION' | 'TEAM';
  /** The team's workspace for a team award. */
  team: WorkspaceRef | null;
  person: StaffCard;
  method: RecognitionSelection;
  achievementPercent: number;
  score: number;
  goals: { label: string; required: number; done: number | null; unit: GoalUnit }[];
  criteria: string;
  reward: string | null;
  note: string | null;
  selectedBy: { id: string; name: string } | null;
  awardedAt: string;
  revoked: { at: string; by: string; reason: string } | null;
  canRevoke: boolean;
}

/** One person in the month's ranking, best first. */
export interface RecognitionCandidate {
  rank: number;
  target: RecognitionTargetRow;
  values: Partial<Record<RankingCriterion, number | null>>;
  /** True when every compared value equals the next person's. */
  tiedWithNext: boolean;
}

export interface RecognitionScopeView {
  scope: 'ORGANISATION' | 'TEAM';
  team: WorkspaceRef | null;
  award: RecognitionAwardRow | null;
  candidates: RecognitionCandidate[];
  /** Whether the caller may name the winner here, and why not. */
  canSelect: boolean;
  /** "Tie: decide between Priya Sharma and Arjun Mehta" and other notes for the decider. */
  notice: string | null;
}

/** The management page: the month's targets, the ranking and the winners in the caller's reach. */
export interface RecognitionView {
  month: string;
  currentMonth: string;
  level: WorkspaceLevel;
  policy: RecognitionPolicy;
  canSetTargets: boolean;
  canEditPolicy: boolean;
  /** People the caller may set targets for (and give plans to). */
  people: StaffCard[];
  targets: RecognitionTargetRow[];
  scopes: RecognitionScopeView[];
  /** Earlier winners in reach, newest first. */
  history: RecognitionAwardRow[];
  currency: string;
}

/** The dashboard card: always there, with the month's winner(s) in reach and the person's own progress. */
export interface RecognitionCard {
  month: string;
  /** "December 2026" is written by the browser from `month`. */
  target: RecognitionTargetRow | null;
  /** Winners the person can see for the month: their organisation's and their team's. */
  winners: RecognitionAwardRow[];
  /** The person's own award this month, when they won. */
  mine: RecognitionAwardRow | null;
  /** The person's earlier awards. */
  history: RecognitionAwardRow[];
  currency: string;
}

// ───────────── Performance Improvement Plans ─────────────

export const PIP_STATUSES = ['DRAFT', 'ACTIVE', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'EXTENDED', 'COMPLETED', 'UNSUCCESSFUL', 'CANCELLED'] as const;
export type PipStatus = (typeof PIP_STATUSES)[number];
export const PIP_STATUS_LABEL: Record<PipStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  IN_PROGRESS: 'In progress',
  READY_FOR_REVIEW: 'Ready for review',
  UNDER_REVIEW: 'Under review',
  EXTENDED: 'Extended',
  COMPLETED: 'Successfully completed',
  UNSUCCESSFUL: 'Unsuccessful',
  CANCELLED: 'Cancelled',
};
/** Plans the person is working on: shown on their dashboard until someone with the right decides them. */
export const OPEN_PIP_STATUSES: readonly PipStatus[] = ['ACTIVE', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'EXTENDED'];
export const CLOSED_PIP_STATUSES: readonly PipStatus[] = ['COMPLETED', 'UNSUCCESSFUL', 'CANCELLED'];

export const PIP_REVIEW_FREQUENCIES = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM'] as const;
export type PipReviewFrequency = (typeof PIP_REVIEW_FREQUENCIES)[number];
export const PIP_REVIEW_FREQUENCY_LABEL: Record<PipReviewFrequency, string> = { WEEKLY: 'Every week', FORTNIGHTLY: 'Every two weeks', MONTHLY: 'Every month', CUSTOM: 'On chosen dates' };

const doc = z.object({ name: z.string().trim().min(1, 'Enter a name').max(120), url: z.string().trim().url('Enter a full web address').max(1000) }).strict();

export const pipCreateSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title').max(160),
    userId: z.string().min(1).max(64),
    employeeCode: z.string().trim().max(40).optional(),
    reason: z.string().trim().min(1, 'Say why the plan is needed').max(2000),
    areas: z.array(z.string().trim().min(1).max(120)).min(1, 'Name at least one area to improve').max(10),
    currentLevel: z.string().trim().max(500).optional(),
    requiredLevel: z.string().trim().max(500).optional(),
    goals: z.array(goalSchema).min(1, 'Add at least one goal').max(12),
    startsOn: day,
    endsOn: day,
    reviewFrequency: z.enum(PIP_REVIEW_FREQUENCIES).default('WEEKLY'),
    reviewDates: z.array(day).max(26).optional(),
    /** The share of the goals (their average) the plan needs; 100 = every goal in full. */
    requiredPercent: z.number().min(1).max(100).default(100),
    managerComments: z.string().trim().max(2000).optional(),
    documents: z.array(doc).max(10).optional(),
    /** False keeps it as a draft that only managers see. */
    activate: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.endsOn < v.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The end date cannot be before the start date.' });
    if (v.reviewFrequency === 'CUSTOM' && !v.reviewDates?.length) ctx.addIssue({ code: 'custom', path: ['reviewDates'], message: 'Choose at least one review date.' });
    for (const d of v.reviewDates ?? []) if (d < v.startsOn || d > v.endsOn) ctx.addIssue({ code: 'custom', path: ['reviewDates'], message: 'Review dates must be inside the plan.' });
  });
export type PipCreateInput = z.input<typeof pipCreateSchema>;

export const pipUpdateSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title').max(160).optional(),
    employeeCode: z.string().trim().max(40).optional(),
    reason: z.string().trim().min(1, 'Say why the plan is needed').max(2000).optional(),
    areas: z.array(z.string().trim().min(1).max(120)).min(1, 'Name at least one area to improve').max(10).optional(),
    currentLevel: z.string().trim().max(500).optional(),
    requiredLevel: z.string().trim().max(500).optional(),
    goals: z.array(goalSchema).min(1, 'Add at least one goal').max(12).optional(),
    reviewFrequency: z.enum(PIP_REVIEW_FREQUENCIES).optional(),
    reviewDates: z.array(day).max(26).optional(),
    requiredPercent: z.number().min(1).max(100).optional(),
    documents: z.array(doc).max(10).optional(),
    /** Why the plan changed: shown to the person with the change. */
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();
export type PipUpdateInput = z.input<typeof pipUpdateSchema>;

export const pipCommentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(2000), documents: z.array(doc).max(5).optional() }).strict();
export const pipEvaluationSchema = z.object({ goalId: z.string().min(1).max(40), score: z.number().min(0).max(100), comments: z.string().trim().min(1, 'Add your comments').max(2000) }).strict();
export const pipReviewSchema = z.object({ notes: z.string().trim().min(1, 'Add your review notes').max(2000), nextReviewOn: day.optional() }).strict();

export const PIP_DECISIONS = ['COMPLETE', 'EXTEND', 'UNSUCCESSFUL', 'CANCEL'] as const;
export type PipDecision = (typeof PIP_DECISIONS)[number];
export const pipDecisionSchema = z
  .object({
    decision: z.enum(PIP_DECISIONS),
    comment: z.string().trim().min(1, 'Add a comment for the record').max(2000),
    /** EXTEND: the new last day. */
    endsOn: day.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'EXTEND' && !v.endsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Choose the new end date.' });
  });
export type PipDecisionInput = z.input<typeof pipDecisionSchema>;

export const PIP_EVENT_KINDS = ['CREATED', 'ACTIVATED', 'ACKNOWLEDGED', 'UPDATED', 'COMMENT', 'EVALUATION', 'REVIEW', 'GOAL_MET', 'READY_FOR_REVIEW', 'EXTENDED', 'COMPLETED', 'UNSUCCESSFUL', 'CANCELLED'] as const;
export type PipEventKind = (typeof PIP_EVENT_KINDS)[number];

export interface PipEvent {
  id: string;
  kind: PipEventKind;
  by: { id: string; name: string; role: 'EMPLOYEE' | 'MANAGER' | 'SYSTEM' } | null;
  body: string | null;
  /** What changed, in plain words ("End date: 2026-12-31 → 2027-01-15"). */
  changes: string[];
  documents: { name: string; url: string }[];
  at: string;
}

export interface PipRow {
  id: string;
  number: string;
  title: string;
  person: StaffCard;
  assignedBy: { id: string; name: string; level: 'SUPER' | 'MANAGER' };
  reason: string;
  areas: string[];
  currentLevel: string | null;
  requiredLevel: string | null;
  goals: GoalProgress[];
  requiredPercent: number;
  /** Average of the goals' percentages, each up to 100. */
  percent: number;
  goalsMet: number;
  startsOn: string;
  endsOn: string;
  originalEndsOn: string;
  /** Days left including today; 0 on the last day's end, negative once passed. */
  daysRemaining: number;
  reviewFrequency: PipReviewFrequency;
  reviewDates: string[];
  nextReviewOn: string | null;
  status: PipStatus;
  acknowledgedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  closingComment: string | null;
  managerFeedback: string | null;
  employeeComment: string | null;
  documents: { name: string; url: string }[];
  /** What the caller may do. */
  can: { edit: boolean; decide: boolean; evaluate: boolean; review: boolean; acknowledge: boolean; comment: boolean; activate: boolean };
  createdAt: string;
}

export interface PipDetail extends PipRow {
  events: PipEvent[];
}

export interface PipsView {
  level: WorkspaceLevel;
  canAssign: boolean;
  people: StaffCard[];
  open: PipRow[];
  drafts: PipRow[];
  closed: PipRow[];
  /** The caller's own plans (a manager can have one from the Super Workspace). */
  mine: PipRow[];
}

/** The dashboard: the open plan, or a one-time note that a plan was just completed. Null shows nothing. */
export interface PipCard {
  plan: PipRow | null;
  /** A plan completed recently whose success message the person has not closed yet. */
  completed: PipRow | null;
}
