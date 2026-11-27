import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type { WorkspaceLevel } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { branchIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { assertAction, callerOf, may, type Org } from '../workspace-work/hierarchy';

/*
 * Who may do what in Learning & Development (ADR 0097). Everything is decided here, on the server, for every request:
 *
 *  - Everyone whose workspace has the feature takes the modules assigned to them, and the open modules of their part
 *    of the organisation.
 *  - The Super Workspace's administrators and managers (a role that manages members or reports) build modules for the
 *    whole organisation, assign them to anyone, mark answers and see every learning record.
 *  - A Manager Workspace with the Create action builds its own modules (unless the Super Workspace keeps that to
 *    itself), assigns its own and the Super Workspace's published modules to the people in its branch, marks their
 *    answers and sees their records. Nothing outside its branch.
 *  - Executives only ever see their own learning.
 */

export const FEATURE = 'learning' as const;
export type Level = WorkspaceLevel;

export interface Person {
  userId: string;
  name: string;
  email: string;
  nodeId: string | null;
  workspace: string;
  level: Level;
}

export interface LearningCaller {
  auth: AuthContext;
  org: Org;
  me: NodeAccess;
  level: Level;
  /** The caller's workspace id, null for the Super Workspace. */
  nodeId: string | null;
  /** Builds modules (Super administrators and managers, Manager Workspaces allowed to create). */
  author: boolean;
  /** Assigns modules and marks answers for the people below. */
  manager: boolean;
  /** Changes the organisation's learning settings and categories. */
  configure: boolean;
  /** Workspace ids whose people the caller may assign to and see the records of (null = everyone). */
  scope: Set<string | null> | null;
}

const ADMIN_PERMISSIONS = ['members:manage', 'reports:manage', 'tenant:manage'];

export async function learningCaller(tx: TenantTx, auth: AuthContext): Promise<LearningCaller> {
  const org = await resolveOrganisation(tx, auth.tenantId);
  const me = callerOf(auth, org);
  assertAction(me, FEATURE, 'view');
  const level = me.level;
  const nodeId = me === org.root ? null : me.node.id;
  const settings = await tx.learningSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { managersCreate: true } });
  let author = false;
  let manager = false;
  let scope: Set<string | null> | null = new Set([nodeId]);
  if (level === 'SUPER') {
    const admin = auth.permissions.some((p) => ADMIN_PERMISSIONS.includes(p));
    author = admin && may(me, FEATURE, 'create');
    manager = admin && (may(me, FEATURE, 'assign') || author);
    scope = manager ? null : new Set([nodeId]);
  } else if (level === 'MANAGER') {
    manager = may(me, FEATURE, 'assign');
    author = (settings?.managersCreate ?? true) && may(me, FEATURE, 'create');
    const nodes = [...org.byId.values()].filter((a) => !a.node.archivedAt).map((a) => a.node);
    scope = branchIds(nodes, me.node.id) as Set<string | null>;
  }
  const configure = level === 'SUPER' && author && may(me, FEATURE, 'configure');
  return { auth, org, me, level, nodeId, author, manager, configure, scope };
}

export function assertAuthor(c: LearningCaller): void {
  if (!c.author) throw new ForbiddenException({ code: 'LEARNING_AUTHOR_ONLY', message: 'Only the Super Workspace and managers can build learning modules.' });
}

export function assertManager(c: LearningCaller): void {
  if (!c.manager) throw new ForbiddenException({ code: 'LEARNING_MANAGER_ONLY', message: 'Only the Super Workspace and managers can assign modules and see other people’s learning.' });
}

export function assertConfigure(c: LearningCaller): void {
  if (!c.configure) throw new ForbiddenException({ code: 'LEARNING_SUPER_ONLY', message: 'Only the Super Workspace can change the learning settings.' });
}

/** Whether a person (by their workspace) is within what the caller manages. */
export function inScope(c: LearningCaller, nodeId: string | null | undefined): boolean {
  if (c.scope === null) return true;
  return c.scope.has(nodeId ?? null);
}

/** Modules the caller may open as an author or manager: all for the Super Workspace, the manager's own plus the Super Workspace's published ones. */
export function manageableModules(c: LearningCaller): Prisma.LearningModuleWhereInput {
  const base = { tenantId: c.auth.tenantId };
  if (c.level === 'SUPER') return base;
  return { ...base, OR: [{ ownerNodeId: c.nodeId }, { AND: [{ OR: [{ ownerNodeId: null }, { ownerNodeId: { isSet: false } }] }, { status: { in: ['PUBLISHED', 'ARCHIVED'] } }] }] };
}

/** Whether the caller may change a module (not only assign it). */
export function canEdit(c: LearningCaller, m: { ownerNodeId: string | null }): boolean {
  if (!c.author) return false;
  if (c.level === 'SUPER') return true;
  return m.ownerNodeId === c.nodeId;
}

export function assertCanEdit(c: LearningCaller, m: { ownerNodeId: string | null }): void {
  if (!canEdit(c, m)) throw new ForbiddenException({ code: 'LEARNING_EDIT_FORBIDDEN', message: 'Only the workspace that made this module can change it.' });
}

export async function moduleForManager(tx: TenantTx, c: LearningCaller, id: string) {
  const m = await tx.learningModule.findFirst({ where: { AND: [{ id }, manageableModules(c)] } });
  if (!m) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Learning module not found.' });
  return m;
}

/**
 * Whether an open module is offered to a person in `nodeId`: one the Super Workspace made is offered to everyone, one
 * a manager made to that manager's branch.
 */
export function openModuleReaches(org: Org, ownerNodeId: string | null, nodeId: string | null): boolean {
  if (!ownerNodeId) return true;
  const nodes = [...org.byId.values()].map((a) => a.node);
  return branchIds(nodes, ownerNodeId).has(nodeId ?? '');
}

/** Everyone the caller may assign to (and see the learning of), with their workspace. */
export async function peopleInScope(tx: TenantTx, c: LearningCaller): Promise<Person[]> {
  const rows = await tx.membership.findMany({
    where: { tenantId: c.auth.tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { workspaceNodeId: true, user: { select: { id: true, name: true, email: true } } },
    take: 5000,
  });
  const out: Person[] = [];
  for (const r of rows) {
    const nodeId = r.workspaceNodeId ?? null;
    const access = nodeId ? c.org.byId.get(nodeId) : c.org.root;
    if (!access || access.node.archivedAt) continue;
    if (!inScope(c, nodeId)) continue;
    out.push({ userId: r.user.id, name: r.user.name, email: r.user.email, nodeId, workspace: access === c.org.root ? 'Super Workspace' : access.node.name, level: access.level });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Name and workspace of people by id (for rows), whoever they are. */
export async function peopleById(tx: TenantTx, c: LearningCaller, ids: Iterable<string>): Promise<Map<string, Person>> {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return new Map();
  const rows = await tx.membership.findMany({
    where: { tenantId: c.auth.tenantId, userId: { in: list } },
    select: { workspaceNodeId: true, user: { select: { id: true, name: true, email: true } } },
  });
  const out = new Map<string, Person>();
  for (const r of rows) {
    const nodeId = r.workspaceNodeId ?? null;
    const access = nodeId ? c.org.byId.get(nodeId) : c.org.root;
    out.set(r.user.id, { userId: r.user.id, name: r.user.name, email: r.user.email, nodeId, workspace: !access || access === c.org.root ? 'Super Workspace' : access.node.name, level: access?.level ?? 'EXECUTIVE' });
  }
  return out;
}
