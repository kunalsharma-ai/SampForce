import type { Prisma, TenantTx } from '@dealflow/database';
import type { PersonRef, RecordScope } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';

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
  if (scope === 'ALL') return { all: true, userIds: [auth.userId], details, me: auth.userId };
  const team = scope === 'TEAM' ? await reportingTree(tx, auth.tenantId, auth.userId) : [];
  return { all: false, userIds: [auth.userId, ...team], details, me: auth.userId };
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
