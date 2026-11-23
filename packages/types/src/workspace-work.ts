import { z } from 'zod';
import type { WorkspaceLevel } from './workspaces';

/*
 * Targets and tasks handed down the workspace hierarchy (ADR 0071, part 4). The Super Workspace sets targets and
 * assigns tasks to Manager and Executive Workspaces; a manager does the same for its own Executive Workspaces when its
 * Super Workspace lets it. Achievement is counted from real records, never typed in.
 */

// ───────────── Targets ─────────────

export const TARGET_METRICS = ['LEADS', 'CALLS', 'DEALS_WON', 'REVENUE'] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];
export const TARGET_METRIC_LABEL: Record<TargetMetric, string> = {
  LEADS: 'Leads generated',
  CALLS: 'Calls',
  DEALS_WON: 'Deals won',
  REVENUE: 'Revenue',
};

export const TARGET_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM'] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];
export const TARGET_PERIOD_LABEL: Record<TargetPeriod, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  CUSTOM: 'Custom period',
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01');
const amount = z.number().positive('Enter an amount above 0').max(1e12);

export const targetCreateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    metric: z.enum(TARGET_METRICS),
    period: z.enum(TARGET_PERIODS),
    startsOn: day,
    /** The last day of a custom period (included). Other periods end by themselves. */
    endsOn: day.optional(),
    amount,
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.period !== 'CUSTOM') return;
    if (!v.endsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Choose when the period ends' });
    else if (v.endsOn < v.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The period must end on or after its first day' });
    else if (targetEnd('CUSTOM', v.startsOn, v.endsOn).getTime() - new Date(`${v.startsOn}T00:00:00Z`).getTime() > 366 * 86_400_000)
      ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'A custom period can be at most a year' });
  });
export type TargetCreateInput = z.infer<typeof targetCreateSchema>;

export const targetUpdateSchema = z
  .object({ amount: amount.optional(), note: z.string().trim().max(500).nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type TargetUpdateInput = z.infer<typeof targetUpdateSchema>;

/** Splits one target among workspaces below the one it was set for; each part becomes a target of its own. */
export const targetDistributeSchema = z
  .object({ parts: z.array(z.object({ workspaceId: z.string().uuid(), amount }).strict()).min(1).max(100) })
  .strict()
  .refine((v) => new Set(v.parts.map((p) => p.workspaceId)).size === v.parts.length, 'Each workspace can get one part');
export type TargetDistributeInput = z.infer<typeof targetDistributeSchema>;

/** The day after a period's last day, at midnight UTC: periods are [start, end). */
export function targetEnd(period: TargetPeriod, startsOn: string, endsOn?: string): Date {
  const [y, m, d] = startsOn.split('-').map(Number) as [number, number, number];
  switch (period) {
    case 'DAILY':
      return new Date(Date.UTC(y, m - 1, d + 1));
    case 'WEEKLY':
      return new Date(Date.UTC(y, m - 1, d + 7));
    case 'MONTHLY':
      return new Date(Date.UTC(y, m, d));
    case 'QUARTERLY':
      return new Date(Date.UTC(y, m + 2, d));
    case 'CUSTOM': {
      const [ey, em, ed] = (endsOn ?? startsOn).split('-').map(Number) as [number, number, number];
      return new Date(Date.UTC(ey, em - 1, ed + 1));
    }
  }
}

export interface WorkspaceRef {
  id: string;
  name: string;
  level: WorkspaceLevel;
}

export interface WorkPerson {
  id: string;
  name: string;
}

export interface TargetRow {
  id: string;
  metric: TargetMetric;
  period: TargetPeriod;
  /** First and last day of the period, both included. */
  startsOn: string;
  endsOn: string;
  amount: number;
  /** Revenue targets are in the organisation's currency; the others are counts. */
  currency: string | null;
  note: string | null;
  workspace: WorkspaceRef;
  /** Who set it, and from which level: the Super Workspace directly, or a manager handing down its own target. */
  setBy: WorkPerson | null;
  source: 'SUPER' | 'MANAGER';
  parentTargetId: string | null;
  /** Counted from records owned by the people of the workspace and every workspace below it. */
  achieved: number;
  percent: number;
  /** Total of the parts already handed down from this target. */
  distributed: number;
  editable: boolean;
  /** Whether the caller may split it among the workspaces below its workspace. */
  canDistribute: boolean;
  createdAt: string;
}

export interface TargetsView {
  targets: TargetRow[];
  /** Workspaces the caller may set targets for, with the workspace each reports to. */
  assignable: (WorkspaceRef & { parentId: string | null })[];
  currency: string;
}

// ───────────── Tasks ─────────────

export const ASSIGNED_TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type AssignedTaskPriority = (typeof ASSIGNED_TASK_PRIORITIES)[number];
export const ASSIGNED_TASK_STATUSES = ['OPEN', 'DONE', 'CANCELED'] as const;
export type AssignedTaskStatus = (typeof ASSIGNED_TASK_STATUSES)[number];

const title = z.string().trim().min(2, 'Enter a title').max(200);
const description = z.string().trim().max(4000);
const due = z.string().datetime({ offset: true });

export const assignedTaskCreateSchema = z
  .object({
    title,
    description: description.optional(),
    priority: z.enum(ASSIGNED_TASK_PRIORITIES).default('NORMAL'),
    dueAt: due.optional(),
    workspaceId: z.string().uuid(),
    /** One person of that workspace; omitted = everyone in it (an Executive Workspace holds one person). */
    assigneeUserId: z.string().uuid().optional(),
  })
  .strict();
export type AssignedTaskCreateInput = z.input<typeof assignedTaskCreateSchema>;

export const assignedTaskUpdateSchema = z
  .object({
    title: title.optional(),
    description: description.nullable().optional(),
    priority: z.enum(ASSIGNED_TASK_PRIORITIES).optional(),
    dueAt: due.nullable().optional(),
    status: z.enum(ASSIGNED_TASK_STATUSES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type AssignedTaskUpdateInput = z.infer<typeof assignedTaskUpdateSchema>;

export const taskCommentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(2000) }).strict();
export type TaskCommentInput = z.infer<typeof taskCommentSchema>;

export interface AssignedTaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: AssignedTaskPriority;
  status: AssignedTaskStatus;
  dueAt: string | null;
  overdue: boolean;
  completedAt: string | null;
  createdAt: string;
  workspace: WorkspaceRef;
  assignee: WorkPerson | null;
  createdBy: WorkPerson | null;
  comments: number;
  /** The creator and the levels above may change everything; the assignee may change the status. */
  canEdit: boolean;
  canChangeStatus: boolean;
}

export interface TaskHistoryRow {
  id: string;
  actor: WorkPerson | null;
  kind: 'created' | 'updated' | 'commented';
  changes: { field: string; from: string | null; to: string | null }[];
  createdAt: string;
}

export interface AssignedTaskDetail extends AssignedTaskRow {
  commentList: { id: string; author: WorkPerson | null; body: string; createdAt: string }[];
  history: TaskHistoryRow[];
}

export interface AssignedTasksView {
  /** Tasks for the caller: assigned to them, or to their workspace without a person. */
  forMe: AssignedTaskRow[];
  /** Tasks the caller handed down. */
  byMe: AssignedTaskRow[];
  /** Workspaces the caller may assign tasks to, with their people. */
  assignable: (WorkspaceRef & { people: WorkPerson[] })[];
}
