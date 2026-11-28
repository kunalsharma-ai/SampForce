import type { TenantTx } from '@dealflow/database';
import { DEFAULT_RECOGNITION_POLICY, type StaffCard, type RecognitionPolicy, recognitionPolicySchema, type WorkspaceLevel } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { HierarchyError } from '../workspaces/workspaces.service';
import { callerOf, handsDownTo, type Org, refOf } from '../workspace-work/hierarchy';

/*
 * Who is who for Employee of the Month and improvement plans (ADR 0102), and who may act for whom. The rules follow the
 * workspace hierarchy (ADR 0071): the Super Workspace (its administrators) reaches every Manager and Executive
 * Workspace; a manager reaches its own Executive Workspaces, as far as the Super Workspace's policy lets it; an
 * executive reaches only themselves. Every service call checks these rules again; the screens only mirror them.
 */

export interface Person extends StaffCard {
  node: NodeAccess;
}

export interface Directory {
  org: Org;
  orgName: string;
  me: NodeAccess;
  /** The caller administers the Super Workspace (members:manage at the top). */
  isSuper: boolean;
  level: WorkspaceLevel;
  policy: RecognitionPolicy;
  people: Map<string, Person>;
  /** Super Workspace administrators: they hear about plans and awards across the organisation. */
  superAdmins: string[];
  names: Map<string, string>;
  person(userId: string): Person | undefined;
}

export async function loadPolicy(tx: TenantTx, tenantId: string): Promise<RecognitionPolicy> {
  const row = await tx.recognitionPolicy.findUnique({ where: { tenantId } });
  const parsed = recognitionPolicySchema.safeParse({ ...DEFAULT_RECOGNITION_POLICY, ...((row?.policy as object | null) ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_RECOGNITION_POLICY;
}

/** Everyone in the organisation, placed in their workspace, with designation, department and managers. */
export async function loadDirectory(tx: TenantTx, auth: AuthContext): Promise<Directory> {
  const org = await resolveOrganisation(tx, auth.tenantId);
  const me = callerOf(auth, org);
  const [tenant, memberships, policy] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } }),
    tx.membership.findMany({
      where: { tenantId: auth.tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      include: { user: { select: { id: true, name: true } }, role: { select: { permissions: true } } },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    }),
    loadPolicy(tx, auth.tenantId),
  ]);
  const [designations, departments] = await Promise.all([
    tx.designation.findMany({ where: { tenantId: auth.tenantId }, select: { id: true, name: true } }),
    tx.department.findMany({ where: { tenantId: auth.tenantId }, select: { id: true, name: true } }),
  ]);
  const designationName = new Map(designations.map((d) => [d.id, d.name]));
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const names = new Map(memberships.map((m) => [m.user.id, m.user.name]));
  const nodeOf = (id: string | null | undefined): NodeAccess => (id ? (org.byId.get(id) ?? org.root) : org.root);
  const atRoot = (m: (typeof memberships)[number]) => nodeOf(m.workspaceNodeId) === org.root;
  const superAdmins = memberships.filter((m) => atRoot(m) && m.role.permissions.includes('members:manage')).map((m) => m.user.id);
  const membersOf = new Map<string, string[]>();
  for (const m of memberships) {
    const n = nodeOf(m.workspaceNodeId).node.id;
    membersOf.set(n, [...(membersOf.get(n) ?? []), m.user.id]);
  }

  const people = new Map<string, Person>();
  for (const m of memberships) {
    const node = nodeOf(m.workspaceNodeId);
    if (node.node.archivedAt) continue;
    let managers: string[];
    if (m.reportingManagerId && names.has(m.reportingManagerId) && m.reportingManagerId !== m.user.id) managers = [m.reportingManagerId];
    else if (node === org.root) managers = [];
    else {
      const parent = node.node.parentId ? org.byId.get(node.node.parentId) : org.root;
      managers = !parent || parent === org.root ? superAdmins : (membersOf.get(parent.node.id) ?? []);
    }
    const parent = node.node.parentId ? org.byId.get(node.node.parentId) : undefined;
    people.set(m.user.id, {
      id: m.user.id,
      name: m.user.name,
      level: node.level,
      workspace: refOf(node, org, tenant.name),
      designation: (m.designationId && designationName.get(m.designationId)) || node.node.designation || null,
      // The department chosen for the person, else the team they are in (an executive's manager workspace).
      department: (m.departmentId && departmentName.get(m.departmentId)) || node.node.department || (node.level === 'EXECUTIVE' && parent && parent !== org.root ? parent.node.name : null),
      managers: managers.filter((u) => u !== m.user.id).map((u) => ({ id: u, name: names.get(u) ?? '' })),
      employeeCode: m.externalId ?? null,
      node,
    });
  }
  const isSuper = me === org.root && auth.permissions.includes('members:manage');
  return { org, orgName: tenant.name, me, isSuper, level: me.level, policy, people, superAdmins, names, person: (id) => people.get(id) };
}

/** The workspace above handles this person's recognition and plans: the Super Workspace for anyone, a manager for its executives. */
export function reaches(dir: Directory, p: Person, what: 'targets' | 'select' | 'plans' | 'decide'): boolean {
  if (p.node === dir.org.root) return false;
  if (dir.isSuper) return handsDownTo(dir.org.root, p.node, dir.org);
  if (dir.me.level !== 'MANAGER' || !handsDownTo(dir.me, p.node, dir.org)) return false;
  const pol = dir.policy;
  return what === 'targets' ? pol.managersSetTargets : what === 'select' ? pol.managersSelectTeamWinner : what === 'plans' ? pol.managersAssignPlans : pol.managersDecidePlans;
}

/** Whether the caller can see this person's records: themselves, anyone below them, or anyone for the Super Workspace. */
export function sees(dir: Directory, p: Person, callerId: string): boolean {
  if (p.id === callerId) return true;
  if (dir.isSuper) return true;
  if (dir.me.level !== 'MANAGER') return false;
  return handsDownTo(dir.me, p.node, dir.org);
}

export function assertReaches(dir: Directory, p: Person | undefined, what: 'targets' | 'select' | 'plans' | 'decide'): Person {
  if (!p) throw new HierarchyError('PERSON_NOT_IN_REACH', 'You can only do this for people in the workspaces below yours.');
  if (!reaches(dir, p, what)) {
    if (dir.me.level === 'MANAGER' && handsDownTo(dir.me, p.node, dir.org)) throw new HierarchyError('MANAGERS_NOT_ALLOWED', 'The Super Workspace has not allowed managers to do this.');
    throw new HierarchyError('PERSON_NOT_IN_REACH', 'You can only do this for people in the workspaces below yours.');
  }
  return p;
}

/** People the caller may act for, best known first: managers, then executives, by name. */
export function reachable(dir: Directory, what: 'targets' | 'plans'): StaffCard[] {
  return [...dir.people.values()]
    .filter((p) => reaches(dir, p, what))
    .sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'MANAGER' ? -1 : 1))
    .map(card);
}

export function card(p: Person): StaffCard {
  const { node: _node, ...rest } = p;
  return rest;
}

/** Someone who is no longer in the organisation still shows in history. */
export function unknownPerson(id: string, name: string, dir: Directory): StaffCard {
  return { id, name: name || '—', level: 'EXECUTIVE', workspace: refOf(dir.org.root, dir.org, dir.orgName), designation: null, department: null, managers: [], employeeCode: null };
}
