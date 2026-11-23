import { z } from 'zod';
import { cursorPageQuerySchema } from './pagination';

/*
 * Audit log views (ADR 0071, part 7). Every entry says who did it, what they did, which record it touched and when.
 * The Super Workspace reads its whole organisation; a Manager Workspace reads its own team's entries, and only once
 * the Super Workspace allows it; the Console Admin reads the platform log in the console.
 */

export const AUDIT_CATEGORIES = ['workspaces', 'permissions', 'features', 'subscription', 'limits', 'targets', 'tasks', 'records', 'people', 'support', 'security'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABEL = {
  workspaces: 'Workspaces',
  permissions: 'Permissions',
  features: 'Features',
  subscription: 'Subscription',
  limits: 'Workspace limits',
  targets: 'Sales targets',
  tasks: 'Tasks',
  records: 'CRM records',
  people: 'People',
  support: 'Support queries',
  security: 'Security and passwords',
} as const satisfies Record<AuditCategory, string>;

/**
 * Which actions belong to each category: an exact action, or a prefix ending in a dot or underscore. The first
 * category that matches wins, so the narrower ones come first.
 */
export const AUDIT_CATEGORY_ACTIONS: Record<AuditCategory, readonly string[]> = {
  features: ['workspace.features_changed', 'billing.features_overridden'],
  limits: ['workspace.limits_changed'],
  permissions: ['workspace.permissions_changed', 'role.', 'member.role_changed'],
  workspaces: ['workspace.created', 'workspace.updated', 'workspace.moved', 'workspace.archived', 'workspace.member_assigned'],
  subscription: ['billing.subscription_', 'billing.plan_', 'billing.trial_', 'billing.cancel_', 'billing.grace_', 'billing.period_', 'tenant.suspended', 'tenant.reactivated'],
  targets: ['target.', 'sales_target.'],
  tasks: ['task.'],
  records: ['company.', 'contact.', 'lead.', 'deal.', 'activity.', 'quote.', 'contract.'],
  people: ['member.invited', 'member.joined', 'member.invitation_revoked', 'member.org_changed'],
  support: ['support_ticket.'],
  security: ['security.', 'auth.password_', 'auth.mfa_', 'auth.sessions_'],
};

const isPrefix = (p: string) => p.endsWith('.') || p.endsWith('_');

export function auditCategoryOf(action: string): AuditCategory | null {
  const order: AuditCategory[] = ['features', 'limits', 'permissions', 'workspaces', 'subscription', 'targets', 'tasks', 'records', 'people', 'support', 'security'];
  for (const c of order) if (AUDIT_CATEGORY_ACTIONS[c].some((p) => (isPrefix(p) ? action.startsWith(p) : action === p))) return c;
  return null;
}

/** Splits a category's actions into exact names and prefixes, for building a query. */
export function auditCategoryMatchers(c: AuditCategory): { exact: string[]; prefixes: string[] } {
  const all = AUDIT_CATEGORY_ACTIONS[c];
  return { exact: all.filter((p) => !isPrefix(p)), prefixes: all.filter(isPrefix) };
}

/** Whether an entry records a change that happened or an attempt that was turned down (no permission, wrong password). */
export const AUDIT_OUTCOMES = ['DONE', 'REFUSED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01');

export const auditLogQuerySchema = cursorPageQuerySchema.extend({
  category: z.enum(AUDIT_CATEGORIES).optional(),
  /** Entries by the people of this workspace and those below it. */
  workspaceId: z.string().min(1).optional(),
  actorUserId: z.string().uuid().optional(),
  /** First and last day, inclusive, in UTC. */
  from: day.optional(),
  to: day.optional(),
  /** Only changes that happened (DONE) or only attempts the system turned down (REFUSED). */
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export type AuditScope = 'ORGANISATION' | 'TEAM';

export interface AuditLogRow {
  id: string;
  action: string;
  outcome: AuditOutcome;
  category: AuditCategory | null;
  actorType: string;
  actorName: string | null;
  actor: { id: string; name: string; workspace: { id: string; name: string; level: string } | null } | null;
  entityType: string | null;
  entityId: string | null;
  /** The affected record, named the way people know it (the workspace's, task's or company's name). */
  record: { type: string; id: string | null; label: string | null } | null;
  /** What changed, in short lines, when the entry says. */
  changes: string[];
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogRow[];
  nextCursor: string | null;
  scope: AuditScope;
}

/** What the filters can offer the caller: only workspaces and people inside what they may read. */
export interface AuditLogFilters {
  scope: AuditScope;
  workspaces: { id: string; name: string; level: string }[];
  people: { id: string; name: string }[];
}

export const platformAuditQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  /** Part of the action name, such as "subscription" or "plan.". */
  action: z.string().trim().max(80).optional(),
  /** Entries older than this time, for the next page. */
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type PlatformAuditQuery = z.infer<typeof platformAuditQuerySchema>;
