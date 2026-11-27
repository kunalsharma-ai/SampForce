import { z } from 'zod';
import type { WorkspaceLevel } from './workspaces';

/*
 * Targets and tasks handed down the workspace hierarchy (ADR 0071, part 4). The Super Workspace sets targets and
 * assigns tasks to Manager and Executive Workspaces; a manager does the same for its own Executive Workspaces when its
 * Super Workspace lets it. Achievement is counted from real records, never typed in.
 */

// ───────────── Targets ─────────────

/**
 * The redesign (R7, ADR 0091) adds emails sent, follow-ups completed, meetings, RFQs and conversions. ADR 0096 adds
 * qualified companies, contacts created, connected calls, deals created, deal value and RFQs converted. LEADS keeps
 * counting every company the person created, as before.
 */
export const TARGET_METRICS = [
  'LEADS',
  'QUALIFIED_COMPANIES',
  'CONTACTS',
  'CALLS',
  'CALLS_CONNECTED',
  'EMAILS_SENT',
  'FOLLOW_UPS_DONE',
  'MEETINGS',
  'DEALS_CREATED',
  'DEAL_VALUE',
  'DEALS_WON',
  'REVENUE',
  'RFQS',
  'RFQS_CONVERTED',
  'CONVERSIONS',
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];
export const TARGET_METRIC_LABEL: Record<TargetMetric, string> = {
  LEADS: 'Leads generated',
  QUALIFIED_COMPANIES: 'Qualified companies created',
  CONTACTS: 'Contacts created',
  CALLS: 'Calls',
  CALLS_CONNECTED: 'Connected calls',
  EMAILS_SENT: 'Emails sent',
  FOLLOW_UPS_DONE: 'Follow-ups completed',
  MEETINGS: 'Meetings',
  DEALS_CREATED: 'Deals created',
  DEAL_VALUE: 'Deal value',
  DEALS_WON: 'Deals won',
  REVENUE: 'Revenue',
  RFQS: 'RFQs received',
  RFQS_CONVERTED: 'RFQs converted',
  CONVERSIONS: 'Conversions',
};
/** Measures counted in money (the organisation's currency); the rest are counts. */
export const MONEY_METRICS: ReadonlySet<TargetMetric> = new Set(['REVENUE', 'DEAL_VALUE']);
/** How each measure is counted, shown next to every target, task and ranking so nobody has to guess. */
export const METRIC_RULE: Record<TargetMetric, string> = {
  LEADS: 'Companies the person created in the period. Deleted companies do not count.',
  QUALIFIED_COMPANIES: 'Companies the person created that have a website, email, phone or LinkedIn and are not a repeat of a company already in SampForce.',
  CONTACTS: 'Contacts the person created that have an email address or a phone number. Deleted contacts do not count.',
  CALLS: 'Calls the person logged, including attempts that did not reach anyone.',
  CALLS_CONNECTED: 'Logged calls where someone answered: connected, asked to call back or not interested.',
  EMAILS_SENT: 'Emails the person sent from SampForce or a connected mailbox, and emails they logged as sent.',
  FOLLOW_UPS_DONE: 'Follow-ups assigned to the person that they marked done.',
  MEETINGS: 'Meetings the person logged.',
  DEALS_CREATED: 'Deals the person owns that were created in the period. Deleted deals do not count.',
  DEAL_VALUE: 'The value of the deals counted in Deals created, in the organisation’s currency.',
  DEALS_WON: 'Deals credited to the person as won in the period.',
  REVENUE: 'Won revenue credited to the person in the period, in the organisation’s currency.',
  RFQS: 'RFQs received in the period on the person’s companies.',
  RFQS_CONVERTED: 'RFQs on the person’s companies that were won in the period.',
  CONVERSIONS: 'Companies of the person that became clients in the period.',
};

/** The redesign (R7) adds half-yearly and yearly targets. */
export const TARGET_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];
export const TARGET_PERIOD_LABEL: Record<TargetPeriod, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-yearly',
  YEARLY: 'Yearly',
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
  .object({
    amount: amount.optional(),
    note: z.string().trim().max(500).nullable().optional(),
    /** A new last day (ADR 0096): the deadline moves, the period becomes custom. */
    endsOn: day.optional(),
  })
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
    case 'HALF_YEARLY':
      return new Date(Date.UTC(y, m + 5, d));
    case 'YEARLY':
      return new Date(Date.UTC(y + 1, m - 1, d));
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
  /** Can pass 100 when the target is exceeded. */
  percent: number;
  /** What is still missing (0 once reached). */
  remaining: number;
  /** UPCOMING (not started), RUNNING or ENDED. */
  state: 'UPCOMING' | 'RUNNING' | 'ENDED';
  /** Whole days left including today, while running. */
  daysLeft: number | null;
  /** The same measure over the period of the same length just before (ADR 0096), for comparison. */
  previous: { achieved: number; percent: number } | null;
  /** How each measure is counted. */
  rule: string;
  /** Total of the parts already handed down from this target. */
  distributed: number;
  editable: boolean;
  /** Whether the caller may split it among the workspaces below its workspace. */
  canDistribute: boolean;
  createdAt: string;
}

/** Cumulative progress of a target, day by day, with the straight line that would reach it on time (ADR 0096). */
export interface TargetTrend {
  id: string;
  points: { date: string; achieved: number; pace: number }[];
  /** Earlier periods of the same length, newest first (up to six). */
  history: { startsOn: string; endsOn: string; achieved: number; percent: number }[];
}

export interface TargetsView {
  targets: TargetRow[];
  /** What the caller sees: everything (Super), its team and maybe other managers (Manager), or itself (Executive). */
  scope: 'ORGANISATION' | 'TEAM' | 'SELF';
  /** The caller's own workspace, to pick out "your targets". */
  myWorkspaceId: string;
  /** Workspaces the caller may set targets for, with the workspace each reports to. */
  assignable: (WorkspaceRef & { parentId: string | null })[];
  currency: string;
}

// ───────────── Tasks ─────────────

export const ASSIGNED_TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type AssignedTaskPriority = (typeof ASSIGNED_TASK_PRIORITIES)[number];
export const ASSIGNED_TASK_STATUSES = ['OPEN', 'DONE', 'CANCELED'] as const;
export type AssignedTaskStatus = (typeof ASSIGNED_TASK_STATUSES)[number];

/**
 * Where an open task stands (redesign R7, ADR 0091): the assignee acknowledges it, starts it or marks it blocked (with
 * the reason), then completes it; the assigner hears about each step. A finished task keeps its last step.
 */
export const TASK_PROGRESS = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'BLOCKED'] as const;
export type TaskProgress = (typeof TASK_PROGRESS)[number];
export const TASK_PROGRESS_LABEL: Record<TaskProgress, string> = { NEW: 'Not acknowledged', ACKNOWLEDGED: 'Acknowledged', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked' };
export const taskProgressSchema = z
  .object({ progress: z.enum(['ACKNOWLEDGED', 'IN_PROGRESS', 'BLOCKED']), reason: z.string().trim().max(500).optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (v.progress === 'BLOCKED' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Say what is blocking it' });
  });
export type TaskProgressInput = z.infer<typeof taskProgressSchema>;

/** Quick reactions on task comments. */
export const TASK_REACTIONS = ['👍', '✅', '👀', '🎉', '❤️', '🙏'] as const;
export type TaskReaction = (typeof TASK_REACTIONS)[number];
export const taskReactionSchema = z.object({ emoji: z.enum(TASK_REACTIONS) }).strict();
export type TaskReactionInput = z.infer<typeof taskReactionSchema>;

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
  progress: TaskProgress;
  acknowledgedAt: string | null;
  /** Why it is blocked, while it is. */
  blockedReason: string | null;
  workspace: WorkspaceRef;
  assignee: WorkPerson | null;
  createdBy: WorkPerson | null;
  comments: number;
  /** The creator and the levels above may change everything; the assignee may change the status. */
  canEdit: boolean;
  canChangeStatus: boolean;
  /** Whether the caller is the one doing it, so may acknowledge, start or block it. */
  canProgress: boolean;
}

export interface TaskHistoryRow {
  id: string;
  actor: WorkPerson | null;
  kind: 'created' | 'updated' | 'commented' | 'progress';
  changes: { field: string; from: string | null; to: string | null }[];
  createdAt: string;
}

export interface AssignedTaskDetail extends AssignedTaskRow {
  commentList: { id: string; author: WorkPerson | null; body: string; createdAt: string; reactions: { emoji: TaskReaction; count: number; mine: boolean; names: string[] }[] }[];
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
