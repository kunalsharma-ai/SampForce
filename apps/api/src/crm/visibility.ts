import type { Prisma, TenantTx } from '@dealflow/database';
import type { PersonRef, RecordScope } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { branchUserIds } from '../workspaces/access';

/**
 * Record visibility (ADR 0060). Each role says which company leads, employees and inbound leads its people see:
 *  - OWN: records they own or created, records they are the assigned manager of, and unassigned records;
 *  - TEAM: the same for themselves and everyone who reports to them, directly or further down;
 *  - ALL: every record of the workspace.
 * And whether they may see the details (emails, phones, links, notes, custom fields) of a visible record that
 * someone else owns. Duplicate checks look across every record but only return names (DuplicateMatch).
 */
export interface Visibility {
  all: boolean;
  /** The caller and, for TEAM, everyone reporting to them. */
  userIds: string[];
  details: boolean;
  me: string;
}

export function scopeOf(auth: AuthContext): RecordScope {
  return (auth.recordScope as RecordScope | undefined) ?? 'ALL';
}

/** Everyone reporting to `userId`, directly or not (cycles are refused when set, and ignored here). */
export async function reportingTree(tx: TenantTx, tenantId: string, userId: string): Promise<string[]> {
  const rows = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true, reportingManagerId: true } });
  const byManager = new Map<string, string[]>();
  for (const r of rows) if (r.reportingManagerId) byManager.set(r.reportingManagerId, [...(byManager.get(r.reportingManagerId) ?? []), r.userId]);
  const seen = new Set<string>([userId]);
  const queue = [userId];
  while (queue.length)
    for (const next of byManager.get(queue.shift()!) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  seen.delete(userId);
  return [...seen];
}

export async function visibility(tx: TenantTx, auth: AuthContext): Promise<Visibility> {
  const scope = scopeOf(auth);
  const details = auth.viewOthersDetails ?? true;
  const branch = await workspaceBranch(tx, auth);
  if (!branch) {
    if (scope === 'ALL') return { all: true, userIds: [auth.userId], details, me: auth.userId };
    const team = scope === 'TEAM' ? await reportingTree(tx, auth.tenantId, auth.userId) : [];
    return { all: false, userIds: [auth.userId, ...team], details, me: auth.userId };
  }
  // In a Manager or Executive Workspace (ADR 0071) the workspace's branch is the team: a manager sees their own
  // workspace and the Executive Workspaces below it, whatever the reporting lines say; OWN still means their own.
  const people = scope === 'OWN' ? [] : branch.filter((id) => id !== auth.userId);
  return { all: false, userIds: [auth.userId, ...people], details, me: auth.userId };
}

/**
 * The people whose records a Manager or Executive Workspace sees (ADR 0071): an Executive Workspace only its own
 * person, a Manager Workspace everyone in it and in the Executive Workspaces below it. Null for the Super Workspace,
 * which the role's scope alone decides.
 */
async function workspaceBranch(tx: TenantTx, auth: AuthContext): Promise<string[] | null> {
  if (!auth.workspaceNodeId) return null;
  const node = await tx.workspaceNode.findFirst({ where: { tenantId: auth.tenantId, id: auth.workspaceNodeId }, select: { level: true, parentId: true, archivedAt: true, accessLevel: true } });
  if (!node || node.archivedAt) return [];
  if (node.level === 'SUPER' && !node.parentId) return null;
  if (node.level === 'EXECUTIVE') return [];
  // A Manager Workspace with the OWN access level (W5) sees only its own people's records, not its executives'.
  if (node.accessLevel === 'OWN') return branchUserIds(tx, auth.tenantId, auth.workspaceNodeId, { below: false });
  return branchUserIds(tx, auth.tenantId, auth.workspaceNodeId);
}

const unset = (field: string) => [{ [field]: null }, { [field]: { isSet: false } }];

export function companyScope(v: Visibility): Prisma.CompanyWhereInput {
  if (v.all) return {};
  return { OR: [{ ownerId: { in: v.userIds } }, { createdById: { in: v.userIds } }, { managerId: { in: v.userIds } }, ...unset('ownerId')] };
}

export function contactScope(v: Visibility): Prisma.ContactWhereInput {
  if (v.all) return {};
  return {
    OR: [
      { ownerId: { in: v.userIds } },
      { createdById: { in: v.userIds } },
      { company: { is: companyScope(v) } },
      { AND: [{ OR: unset('ownerId') }, { OR: unset('companyId') }] },
    ],
  };
}

/**
 * Deals (ADR 0063): those the people in scope own, manage or helped win, and the deals of companies they can see.
 * Unowned deals without a company stay visible to everyone, like unassigned leads.
 */
export function dealScope(v: Visibility): Prisma.OpportunityWhereInput {
  if (v.all) return {};
  return {
    OR: [
      { ownerId: { in: v.userIds } },
      { managerId: { in: v.userIds } },
      { supportingUserIds: { hasSome: v.userIds } },
      { company: { is: companyScope(v) } },
      { AND: [{ OR: unset('ownerId') }, { OR: unset('companyId') }] },
    ],
  };
}

export function leadScope(v: Visibility): Prisma.LeadWhereInput {
  if (v.all) return {};
  return { OR: [{ ownerId: { in: v.userIds } }, ...unset('ownerId')] };
}

/** Whether the caller sees the details of a visible record. Unassigned records and their own always show them. */
export function canSeeDetails(v: Visibility, ownerId: string | null | undefined): boolean {
  return v.details || !ownerId || ownerId === v.me;
}

/** Users with their designation in this workspace. */
export async function personRefs(tx: TenantTx, tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const [users, memberships] = await Promise.all([
    tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    tx.membership.findMany({ where: { tenantId, userId: { in: unique } }, select: { userId: true, designationId: true } }),
  ]);
  const designationIds = [...new Set(memberships.map((m) => m.designationId).filter((d): d is string => !!d))];
  const designations = designationIds.length ? await tx.designation.findMany({ where: { tenantId, id: { in: designationIds } }, select: { id: true, name: true } }) : [];
  const dName = new Map(designations.map((d) => [d.id, d.name]));
  const byUser = new Map(memberships.map((m) => [m.userId, m.designationId ? (dName.get(m.designationId) ?? null) : null]));
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name, designation: byUser.get(u.id) ?? null }]));
}
