import { z } from 'zod';

/*
 * Team approvals and deleted items (ADR 0098). An Executive Workspace asks its manager before it deletes anything;
 * Super and Manager Workspaces delete directly. The Super Workspace can also require approval for edits to
 * companies, contacts and deals, and people can ask for other things (a task or target change) through the same
 * inbox. Every delete, by anyone, lands in Deleted items first and can be restored until it is purged.
 */

/** 403 code: this action needs a manager's approval first. */
export const APPROVAL_REQUIRED = 'APPROVAL_REQUIRED';
/** 403 code: the approval sent with the request cannot be used (wrong action, changed record, expired, used). */
export const APPROVAL_NOT_VALID = 'APPROVAL_NOT_VALID';
/** Header naming the approved request an action carries out. */
export const APPROVAL_HEADER = 'x-approval-id';

export const TEAM_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED'] as const;
export type TeamApprovalStatus = (typeof TEAM_APPROVAL_STATUSES)[number];

/** Categories the server enforces on routes (guarded) and those that are requests in words only. */
export const GUARDED_APPROVAL_CATEGORIES = ['delete', 'record_edit'] as const;
export const FREE_APPROVAL_CATEGORIES = ['task_change', 'target_change', 'data_change', 'other'] as const;
export const TEAM_APPROVAL_CATEGORIES = [...GUARDED_APPROVAL_CATEGORIES, ...FREE_APPROVAL_CATEGORIES] as const;
export type TeamApprovalCategory = (typeof TEAM_APPROVAL_CATEGORIES)[number];
export type GuardedApprovalCategory = (typeof GUARDED_APPROVAL_CATEGORIES)[number];

export const TEAM_APPROVAL_CATEGORY_LABEL: Record<TeamApprovalCategory, string> = {
  delete: 'Delete',
  record_edit: 'Edit a record',
  task_change: 'Task change',
  target_change: 'Target change',
  data_change: 'Data change',
  other: 'Other request',
};

export const TEAM_APPROVAL_STATUS_LABEL: Record<TeamApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
};

export const teamApprovalSettingsSchema = z.object({
  /**
   * Manager and Executive Workspaces may delete (managers directly, executives with approval). Turning it on grants
   * Delete wherever a workspace may edit, for every existing and new workspace; turning it off takes Delete away
   * again. Off by default, so organisations keep Delete as the per-workspace permission it was (W2).
   */
  lowerLevelsDelete: z.boolean(),
  /** Executives need approval to delete (on by default). */
  deleteNeedsApproval: z.boolean(),
  /** Executives need approval to edit companies, contacts and deals (off by default). */
  editNeedsApproval: z.boolean(),
  /** Free-form requests (task, target, data change, other) are offered. */
  freeFormRequests: z.boolean(),
  /** A request nobody decided moves up one level after this many hours (0 = never). */
  escalateAfterHours: z.number().int().min(0).max(24 * 30),
  /** A pending request expires after this many days. */
  expireAfterDays: z.number().int().min(1).max(90),
  /** After approval, the requester has this many days to carry the action out. */
  approvalValidDays: z.number().int().min(1).max(30),
  /** Deleted items can be restored for this many days, then they are removed for good. */
  keepDeletedDays: z.number().int().min(1).max(365),
});
export type TeamApprovalSettings = z.infer<typeof teamApprovalSettingsSchema>;

export const DEFAULT_TEAM_APPROVAL_SETTINGS: TeamApprovalSettings = {
  lowerLevelsDelete: false,
  deleteNeedsApproval: true,
  editNeedsApproval: false,
  freeFormRequests: true,
  escalateAfterHours: 24,
  expireAfterDays: 7,
  approvalValidDays: 3,
  keepDeletedDays: 30,
};

/** Stored settings merged over the defaults; anything unreadable falls back to its default. */
export function readTeamApprovalSettings(raw: unknown): TeamApprovalSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const merged = { ...DEFAULT_TEAM_APPROVAL_SETTINGS };
  for (const key of Object.keys(DEFAULT_TEAM_APPROVAL_SETTINGS) as (keyof TeamApprovalSettings)[]) {
    const one = teamApprovalSettingsSchema.shape[key].safeParse(src[key]);
    if (one.success) (merged as Record<string, unknown>)[key] = one.data;
  }
  return merged;
}

/** The action an approval request is tied to: exactly the request the person tried to send. */
export const approvalActionSchema = z.object({
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  /** The API path after /api/v1, with its query string. */
  path: z.string().min(2).max(2000).startsWith('/'),
  body: z.unknown().optional(),
});
export type ApprovalAction = z.infer<typeof approvalActionSchema>;

export const createTeamApprovalSchema = z
  .object({
    category: z.enum(TEAM_APPROVAL_CATEGORIES),
    reason: z.string().trim().min(3, 'Say why, in a few words').max(1000),
    /** Guarded categories: the action to carry out once approved. */
    action: approvalActionSchema.optional(),
    /** Free-form categories: what is asked for, in a line. */
    title: z.string().trim().min(3).max(200).optional(),
  })
  .refine((v) => (GUARDED_APPROVAL_CATEGORIES as readonly string[]).includes(v.category) ? !!v.action : !!v.title, {
    message: 'Describe what you are asking for',
    path: ['title'],
  });
export type CreateTeamApprovalInput = z.infer<typeof createTeamApprovalSchema>;

export const decideTeamApprovalSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional(),
});

export const teamApprovalQuerySchema = z.object({
  box: z.enum(['decide', 'mine', 'all']).default('decide'),
  status: z.enum([...TEAM_APPROVAL_STATUSES, 'OPEN', 'ANY']).default('ANY'),
  category: z.enum([...TEAM_APPROVAL_CATEGORIES, 'ANY']).default('ANY'),
  q: z.string().trim().max(100).optional(),
});
export type TeamApprovalQuery = z.infer<typeof teamApprovalQuerySchema>;

export interface ApprovalPerson {
  id: string;
  name: string;
}

export interface WorkspaceRefLite {
  id: string | null;
  name: string;
  level: 'SUPER' | 'MANAGER' | 'EXECUTIVE';
}

export interface TeamApprovalRow {
  id: string;
  /** APR-12 */
  reference: string;
  category: TeamApprovalCategory;
  status: TeamApprovalStatus;
  requester: ApprovalPerson;
  requesterWorkspace: WorkspaceRefLite;
  /** The workspace that decides, and the people in it. */
  approverWorkspace: WorkspaceRefLite;
  assignedManagers: ApprovalPerson[];
  escalated: boolean;
  recordType: string | null;
  recordTypeLabel: string | null;
  recordName: string | null;
  recordId: string | null;
  recordCount: number | null;
  /** single = one record, bulk = chosen records, all = every record a list matches. */
  scope: 'single' | 'bulk' | 'all' | null;
  title: string | null;
  reason: string;
  decisionNote: string | null;
  decidedBy: ApprovalPerson | null;
  decidedAt: string | null;
  createdAt: string;
  expiresAt: string;
  approvedUntil: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** For an approved request: the record changed since it was asked for, so it must be asked for again. */
  recordChanged: boolean;
  /** The action to send again once approved (only to the requester). */
  action: ApprovalAction | null;
  deletedItemsId: string | null;
  canDecide: boolean;
  canCancel: boolean;
  canCarryOut: boolean;
}

export interface TeamApprovalCounts {
  /** Waiting for the viewer's decision. */
  toDecide: number;
  /** The viewer's own requests still pending. */
  minePending: number;
  /** The viewer's approved requests not carried out yet. */
  mineReady: number;
}

export interface TeamApprovalOverview {
  level: 'SUPER' | 'MANAGER' | 'EXECUTIVE';
  /** Whether the viewer decides requests (Super and Manager Workspaces). */
  decides: boolean;
  /** Whether the viewer's own deletes need approval. */
  needsApprovalToDelete: boolean;
  needsApprovalToEdit: boolean;
  settings: TeamApprovalSettings;
  canChangeSettings: boolean;
  counts: TeamApprovalCounts;
}

/** Details of the 403 APPROVAL_REQUIRED answer, so the screen can offer to ask. */
export interface ApprovalRequiredDetails {
  category: GuardedApprovalCategory;
  recordTypeLabel: string | null;
  recordName: string | null;
  recordCount: number | null;
  /** An identical request already waiting. */
  pendingId: string | null;
}

export interface RecycleBatchRow {
  id: string;
  recordType: string;
  recordTypeLabel: string;
  label: string;
  count: number;
  /** Everything removed, follow-on records included: [{ label, count }]. */
  parts: { label: string; count: number }[];
  partial: boolean;
  deletedBy: ApprovalPerson;
  deletedAt: string;
  approvalReference: string | null;
  restoredAt: string | null;
  restoredBy: ApprovalPerson | null;
  restoreFailed: number;
  purgeAfter: string;
  canRestore: boolean;
  canPurge: boolean;
}

export interface RestoreResult {
  restored: number;
  failed: number;
}

/** Friendly names for the records the bin keeps (model name -> label). */
export const RECORD_MODEL_LABEL: Record<string, [singular: string, plural: string]> = {
  Company: ['Company', 'Companies'],
  Contact: ['Contact', 'Contacts'],
  Lead: ['Company record', 'Company records'],
  Opportunity: ['Deal', 'Deals'],
  Pipeline: ['Pipeline', 'Pipelines'],
  PipelineStage: ['Pipeline stage', 'Pipeline stages'],
  Task: ['Task', 'Tasks'],
  TaskComment: ['Task comment', 'Task comments'],
  TaskEvent: ['Task update', 'Task updates'],
  WorkspaceTarget: ['Target', 'Targets'],
  SalesTarget: ['Sales target', 'Sales targets'],
  Activity: ['Activity', 'Activities'],
  Rfq: ['RFQ', 'RFQs'],
  Quote: ['Quote', 'Quotes'],
  QuoteLine: ['Quote line', 'Quote lines'],
  MeetingRecord: ['Meeting note', 'Meeting notes'],
  VoiceNote: ['Voice note', 'Voice notes'],
  PhoneCall: ['Call', 'Calls'],
  CompanyBranch: ['Branch', 'Branches'],
  CompanyFile: ['Company file', 'Company files'],
  Prospect: ['Prospect', 'Prospects'],
  ProspectList: ['Prospect list', 'Prospect lists'],
  Workflow: ['Workflow', 'Workflows'],
  CustomField: ['Custom field', 'Custom fields'],
  Territory: ['Territory', 'Territories'],
  Dialer: ['Dialer', 'Dialers'],
  EmailTemplate: ['Email template', 'Email templates'],
  Report: ['Report', 'Reports'],
  Dashboard: ['Dashboard', 'Dashboards'],
  Segment: ['Segment', 'Segments'],
  Announcement: ['Announcement', 'Announcements'],
};

export function recordModelLabel(model: string, count = 1): string {
  const pair = RECORD_MODEL_LABEL[model];
  if (pair) return count === 1 ? pair[0] : pair[1];
  const words = model.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return count === 1 ? name : `${name} records`;
}

/** APR-12 */
export const approvalReference = (n: number) => `APR-${n}`;

/** A workspace's stored action grants with Delete added wherever it may edit (or taken away everywhere). */
export function withDeleteWhereEdit<T extends Record<string, readonly string[] | undefined>>(actions: T, on: boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(actions)) {
    const l = [...(list ?? [])].filter((a) => a !== 'delete');
    if (on && l.includes('edit')) l.push('delete');
    out[key] = l;
  }
  return out;
}
