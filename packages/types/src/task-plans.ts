import { z } from 'zod';
import { type TargetMetric } from './workspace-work';
import type { WorkPerson, WorkspaceRef } from './workspace-work';

/*
 * Recurring task plans (ADR 0096). A manager (or the Super Workspace, or anyone for themselves) sets a plan once:
 * "create 20 companies and send 100 emails every working day for a month". SampForce makes the daily, weekly or
 * monthly instances by itself, counts each one from real records, marks it complete the moment the numbers are reached
 * and closes it as partially or not completed when its period ends. Nobody ticks a box: progress is never typed in.
 */

/** Measures a task can ask for. Money measures stay on targets. */
export const TASK_MEASURES = ['QUALIFIED_COMPANIES', 'CONTACTS', 'EMAILS_SENT', 'CALLS', 'CALLS_CONNECTED', 'FOLLOW_UPS_DONE', 'MEETINGS', 'DEALS_CREATED', 'DEALS_WON', 'RFQS'] as const satisfies readonly TargetMetric[];
export type TaskMeasure = (typeof TASK_MEASURES)[number];

/** How often a requirement repeats: every working day, every week (Monday to Sunday) or every calendar month. */
export const TASK_CADENCES = ['DAY', 'WEEK', 'MONTH'] as const;
export type TaskCadence = (typeof TASK_CADENCES)[number];
export const TASK_CADENCE_LABEL: Record<TaskCadence, string> = { DAY: 'Per day', WEEK: 'Per week', MONTH: 'Per month' };

export const TASK_PLAN_DURATIONS = ['ONE_DAY', 'TWO_DAYS', 'ONE_WEEK', 'ONE_MONTH', 'ONE_QUARTER', 'SIX_MONTHS', 'ONE_YEAR', 'CUSTOM'] as const;
export type TaskPlanDuration = (typeof TASK_PLAN_DURATIONS)[number];
export const TASK_PLAN_DURATION_LABEL: Record<TaskPlanDuration, string> = {
  ONE_DAY: '1 day',
  TWO_DAYS: '2 days',
  ONE_WEEK: '1 week',
  ONE_MONTH: '1 month',
  ONE_QUARTER: '1 quarter',
  SIX_MONTHS: '6 months',
  ONE_YEAR: '1 year',
  CUSTOM: 'Custom dates',
};

/** ISO weekdays: 1 = Monday ... 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_SHORT: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

/** The plan's last day (included). */
export function planLastDay(duration: TaskPlanDuration, startsOn: string, endsOn?: string): string {
  if (duration === 'CUSTOM') return endsOn ?? startsOn;
  const [y, m, d] = startsOn.split('-').map(Number) as [number, number, number];
  const at = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  switch (duration) {
    case 'ONE_DAY':
      return startsOn;
    case 'TWO_DAYS':
      return at(y, m - 1, d + 1);
    case 'ONE_WEEK':
      return at(y, m - 1, d + 6);
    case 'ONE_MONTH':
      return at(y, m, d - 1);
    case 'ONE_QUARTER':
      return at(y, m + 2, d - 1);
    case 'SIX_MONTHS':
      return at(y, m + 5, d - 1);
    case 'ONE_YEAR':
      return at(y + 1, m - 1, d - 1);
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01');
const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export const taskRequirementSchema = z
  .object({
    metric: z.enum(TASK_MEASURES),
    amount: z.number().int('Use a whole number').min(1, 'Ask for at least 1').max(100_000),
    per: z.enum(TASK_CADENCES),
  })
  .strict();
export type TaskRequirement = z.infer<typeof taskRequirementSchema>;

const requirements = z
  .array(taskRequirementSchema)
  .min(1, 'Add at least one thing to do')
  .max(8, 'At most 8 things in one task')
  .refine((rs) => new Set(rs.map((r) => `${r.metric}:${r.per}`)).size === rs.length, 'Each measure can appear once per cadence');
const workingDays = z
  .array(z.number().int().min(1).max(7))
  .min(1, 'Pick at least one working day')
  .max(7)
  .transform((d) => [...new Set(d)].sort());
const skipDates = z.array(day).max(60).transform((d) => [...new Set(d)].sort());

export const taskPlanCreateSchema = z
  .object({
    title: z.string().trim().min(2, 'Enter a title').max(120),
    note: z.string().trim().max(1000).optional(),
    requirements,
    duration: z.enum(TASK_PLAN_DURATIONS),
    startsOn: day,
    /** The last day of a custom range (included). */
    endsOn: day.optional(),
    workingDays: workingDays.default(DEFAULT_WORKING_DAYS),
    /** Holidays and other days off: no daily instance on them. */
    skipDates: skipDates.default([]),
    /** The people doing it. The caller's own id assigns it to themselves. */
    assigneeIds: z.array(z.string().uuid()).min(1, 'Choose who does it').max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.duration !== 'CUSTOM') return;
    if (!v.endsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Choose the last day' });
    else if (v.endsOn < v.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The last day must be on or after the first day' });
    else if (daysBetween(v.startsOn, v.endsOn) > 366) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'A task can run for at most a year' });
  });
export type TaskPlanCreateInput = z.input<typeof taskPlanCreateSchema>;

/**
 * Changes apply from now on: the instance running now and the ones still to come take the new numbers, while
 * finished instances keep what they were measured against.
 */
export const taskPlanUpdateSchema = z
  .object({
    title: z.string().trim().min(2, 'Enter a title').max(120).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    requirements: requirements.optional(),
    /** A new last day: later extends the task, earlier ends it sooner (never before today). */
    endsOn: day.optional(),
    workingDays: workingDays.optional(),
    skipDates: skipDates.optional(),
    addAssigneeIds: z.array(z.string().uuid()).max(200).optional(),
    removeAssigneeIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Change at least one thing');
export type TaskPlanUpdateInput = z.infer<typeof taskPlanUpdateSchema>;

export const taskPlanCancelSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export type TaskPlanCancelInput = z.infer<typeof taskPlanCancelSchema>;

export const TASK_PLAN_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED', 'ENDED'] as const;
export type TaskPlanStatus = (typeof TASK_PLAN_STATUSES)[number];
export const TASK_PLAN_STATUS_LABEL: Record<TaskPlanStatus, string> = { ACTIVE: 'Active', PAUSED: 'Paused', CANCELLED: 'Cancelled', ENDED: 'Ended' };

/**
 * Where one instance stands. While its period runs: not started (nothing counted), in progress, half completed (50%
 * or more of everything asked) or completed. When the period ends unfinished: partially completed (something counted)
 * or not completed. Overdue is a one-off task past its due time; cancelled instances belong to a cancelled task.
 */
export const TASK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'HALF_COMPLETED', 'COMPLETED', 'OVERDUE', 'PARTIALLY_COMPLETED', 'NOT_COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  HALF_COMPLETED: 'Half completed',
  COMPLETED: 'Completed',
  OVERDUE: 'Overdue',
  PARTIALLY_COMPLETED: 'Partially completed',
  NOT_COMPLETED: 'Not completed',
  CANCELLED: 'Cancelled',
};

/** Progress of an instance that is still running, from the share of everything asked that is done. */
export function runningStatus(percent: number): TaskStatus {
  if (percent >= 100) return 'COMPLETED';
  if (percent >= 50) return 'HALF_COMPLETED';
  if (percent > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/** Overall progress: each requirement counts equally and stops at 100%, so overdoing one never hides another. */
export function overallPercent(items: { amount: number; done: number }[]): number {
  if (!items.length) return 0;
  const share = items.reduce((a, r) => a + Math.min(1, r.done / r.amount), 0) / items.length;
  return Math.floor(share * 1000) / 10;
}

export interface TaskRequirementProgress {
  metric: TaskMeasure;
  per: TaskCadence;
  amount: number;
  done: number;
  remaining: number;
  /** May pass 100. */
  percent: number;
}

export interface TaskInstanceRow {
  id: string;
  planId: string;
  title: string;
  cadence: TaskCadence;
  /** First and last day of the instance's period, both included. */
  startsOn: string;
  endsOn: string;
  /** When the period ends (exclusive), for the countdown. */
  endsAt: string;
  status: TaskStatus;
  percent: number;
  requirements: TaskRequirementProgress[];
  completedAt: string | null;
  person: WorkPerson;
  /** Consecutive completed instances of this task, up to this one. */
  streak: number;
}

export interface TaskPlanRow {
  id: string;
  title: string;
  note: string | null;
  requirements: TaskRequirement[];
  duration: TaskPlanDuration;
  startsOn: string;
  endsOn: string;
  workingDays: number[];
  skipDates: string[];
  status: TaskPlanStatus;
  cancelReason: string | null;
  assignees: (WorkPerson & { workspace: WorkspaceRef | null })[];
  createdBy: WorkPerson | null;
  createdAt: string;
  /** Instances finished so far: completed, partially completed and not completed. */
  totals: { completed: number; partial: number; missed: number; running: number };
  canManage: boolean;
}

export interface TaskPlanRevision {
  at: string;
  by: WorkPerson | null;
  /** created, updated, paused, resumed, cancelled. */
  kind: string;
  changes: { field: string; from: string | null; to: string | null }[];
}

export interface TaskPlanDetail extends TaskPlanRow {
  revisions: TaskPlanRevision[];
  /** Every instance so far, newest first (at most 400). */
  instances: TaskInstanceRow[];
}

export interface TaskPlansView {
  /** The caller's instances running now, unfinished ones first. */
  today: TaskInstanceRow[];
  /** The caller's longest running daily streak across their tasks. */
  bestStreak: number;
  /** Tasks the caller does, and tasks the caller set or may see for their team. */
  mine: TaskPlanRow[];
  team: TaskPlanRow[];
  /** Instances running now for the people the caller manages. */
  teamToday: TaskInstanceRow[];
  /** People the caller may give a task to (themselves first), by workspace. */
  assignable: (WorkPerson & { workspace: WorkspaceRef | null; self: boolean })[];
  timeZone: string;
}
