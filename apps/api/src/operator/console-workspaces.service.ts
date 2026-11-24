import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { transactionLock, type TenantTx } from '@dealflow/database';
import {
  actionAllowed,
  type ConsoleWorkspaceBlacklistInput,
  type ConsoleWorkspaceDeleteInput,
  type ConsoleWorkspaceDetail,
  type ConsoleWorkspaceEditInput,
  type ConsoleWorkspaceHistoryEntry,
  type ConsoleWorkspaceList,
  type ConsoleWorkspaceQuery,
  type ConsoleDirectoryWorkspace,
  type ConsoleWorkspaceStatus,
  CONSOLE_WORKSPACE_STATUSES,
  type WorkspaceLevel,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import { CompanyClosureService } from '../tenants/company-closure.service';
import { blacklistedNow, levelOf, nameKeyOf, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { assertNotBlocked, blacklistEnd, UNBLOCKED, WorkspacesService } from '../workspaces/workspaces.service';
import { ConsoleService } from './console.service';
import type { OperatorContext } from './operator-auth';
import { OperatorSecurityService } from './operator-security.service';
import { writePlatformAudit } from './platform-audit';

const PAGE_SIZE = 50;
const NOT_FOUND = { code: 'NOT_FOUND', message: 'That workspace does not exist.' };
const ROOT_PREFIX = 'root:';
const LEVEL_ORDER: Record<WorkspaceLevel, number> = { SUPER: 0, MANAGER: 1, EXECUTIVE: 2 };

type Tenant = { id: string; name: string; status: string; closedAt: Date | null; eraseAfter: Date | null; closeReason: string | null; createdAt: Date };
type Node = {
  id: string; tenantId: string; level: string; name: string; designation: string; parentId: string | null; description: string | null; department: string | null;
  deactivatedAt: Date | null; deactivationReason: string | null; blacklistedUntil: Date | null; blacklistReason: string | null; lockedByConsole: string | null;
  archivedAt: Date | null; canCreateExecutives: boolean; createdAt: Date;
};
type Member = { tenantId: string; workspaceNodeId: string | null; userId: string; createdAt: Date; role: { key: string } };

/** Everything the directory is built from, read once across every client (a system read: the Console sees them all). */
interface Snapshot {
  tenants: Map<string, Tenant>;
  nodes: Node[];
  roots: Map<string, Node>;
  members: Member[];
  invites: { tenantId: string; workspaceNodeId: string | null; email: string }[];
  users: Map<string, { name: string; email: string }>;
}

/**
 * Console Workspace Management (workspace management, sections 18-22). Every client's Super, Manager and Executive
 * Workspaces, their status, and the Console's direct actions on them. A Super Workspace is its client: suspending
 * it suspends the client, a temporary blacklist blocks everyone in it until the chosen day, and deleting it closes
 * the company (restorable for 30 days, then erased). Manager and Executive Workspaces are suspended, blacklisted,
 * deleted (records go to the workspace above) and restored directly. Every block and delete asks for the operator's
 * password, and every action is written to the client's audit log and the platform audit log.
 */
@Injectable()
export class ConsoleWorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workspaces: WorkspacesService,
    private readonly clients: ConsoleService,
    private readonly closures: CompanyClosureService,
    private readonly security: OperatorSecurityService,
  ) {}

  // ───────────── Reading ─────────────

  async list(query: ConsoleWorkspaceQuery): Promise<ConsoleWorkspaceList> {
    const snap = await this.snapshot(query.tenantId);
    let rows = this.rowsOf(snap);
    const q = query.q?.toLowerCase();
    if (query.level) rows = rows.filter((r) => r.level === query.level);
    if (q) rows = rows.filter((r) => [r.name, r.client, r.owner?.name, r.owner?.email, r.invited].some((v) => v?.toLowerCase().includes(q)));
    const counts = Object.fromEntries(CONSOLE_WORKSPACE_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<ConsoleWorkspaceStatus, number>;
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    rows.sort((a, b) => a.client.localeCompare(b.client) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.name.localeCompare(b.name));
    const page = rows.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE);
    await this.addPermissions(page);
    return { rows: page, total: rows.length, page: query.page, pageSize: PAGE_SIZE, counts };
  }

  async detail(id: string): Promise<ConsoleWorkspaceDetail> {
    const tenantId = await this.tenantOf(id);
    const snap = await this.snapshot(tenantId);
    const rows = this.rowsOf(snap);
    // A `root:` id names the Super Workspace even after an action stored it under an id of its own.
    const row = rows.find((r) => r.id === id) ?? (id.startsWith(ROOT_PREFIX) ? rows.find((r) => r.level === 'SUPER' && r.tenantId === tenantId) : undefined);
    if (!row) throw new NotFoundException(NOT_FOUND);
    await this.addPermissions([row]);
    const node = row.level === 'SUPER' ? snap.roots.get(tenantId) : snap.nodes.find((n) => n.id === row.id);
    const people = this.membersOf(snap, row).map((m) => ({ ...(snap.users.get(m.userId) ?? { name: 'Unknown', email: '' }), role: m.role.key }));
    const childIds = row.level === 'SUPER' ? null : row.id;
    const children = rows.filter((r) => r.tenantId === tenantId && r.level !== 'SUPER' && (childIds ? r.parent?.id === childIds : r.parent?.level === 'SUPER')).map((r) => ({ id: r.id, name: r.name, level: r.level, status: r.status }));
    const features = await this.prisma.run({ tenantId }, async (tx) => {
      const org = await resolveOrganisation(tx, tenantId);
      return (row.level === 'SUPER' ? org.root : org.byId.get(row.id))?.features ?? [];
    });
    return { ...row, description: node?.description ?? null, department: node?.department ?? null, people, children, features, history: await this.history(tenantId, row) };
  }

  // ───────────── Actions ─────────────

  /** Changes a Manager or Executive Workspace's name, designation or description (a Super Workspace's name is its client's). */
  async edit(op: OperatorContext, id: string, input: ConsoleWorkspaceEditInput, ip: string | null): Promise<ConsoleWorkspaceDetail> {
    const tenantId = await this.tenantOf(id);
    const changes: string[] = [];
    await this.prisma.run({ tenantId }, async (tx) => {
      await transactionLock(tx, `workspaces:${tenantId}`);
      const { node, super: isSuper } = await this.target(tx, tenantId, id);
      const data: { name?: string; nameKey?: string; designation?: string; description?: string | null } = {};
      if (input.name !== undefined && input.name !== node.name) {
        if (isSuper) throw new BadRequestException({ code: 'SUPER_NAME_IS_CLIENT', message: 'A Super Workspace is named after its client. Rename the client on its profile.' });
        if (await tx.workspaceNode.count({ where: { tenantId, nameKey: nameKeyOf(input.name), archivedAt: null, id: { not: node.id } } })) {
          throw new ConflictException({ code: 'WORKSPACE_NAME_TAKEN', message: 'This client already has a workspace with that name.' });
        }
        changes.push(`Name: ${node.name} → ${input.name}`);
        Object.assign(data, { name: input.name, nameKey: nameKeyOf(input.name) });
      }
      if (input.designation !== undefined && input.designation !== node.designation) {
        changes.push(`Designation: ${node.designation} → ${input.designation}`);
        data.designation = input.designation;
      }
      if (input.description !== undefined && (input.description || null) !== (node.description ?? null)) {
        changes.push('Description changed');
        data.description = input.description || null;
      }
      if (!changes.length) return;
      await tx.workspaceNode.update({ where: { id: node.id }, data });
      await this.clientAudit(tx, op, tenantId, 'workspace.updated', node, { reason: input.reason, changes });
    });
    if (changes.length) await this.log(op, 'workspace.updated', tenantId, id, { reason: input.reason, changes }, ip);
    return this.detail(id);
  }

  /** Suspends a workspace until the Console reactivates it. A Super Workspace suspends its whole client. */
  async suspend(op: OperatorContext, id: string, reason: string, password: string, ip: string | null): Promise<ConsoleWorkspaceDetail> {
    await this.security.confirmPassword(op.id, password);
    const tenantId = await this.tenantOf(id);
    if (id.startsWith(ROOT_PREFIX) || (await this.isRoot(tenantId, id))) {
      assertClientStatus(op);
      await this.clients.setState(op, tenantId, 'SUSPENDED', reason, ip);
      return this.detail(id);
    }
    await this.prisma.run({ tenantId }, async (tx) => {
      const { node } = await this.target(tx, tenantId, id);
      if (node.archivedAt) throw deleted();
      assertNotBlocked(node);
      await tx.workspaceNode.update({ where: { id }, data: { deactivatedAt: new Date(), deactivatedById: `operator:${op.id}`, deactivationReason: reason, lockedByConsole: `operator:${op.email}` } });
      await this.clientAudit(tx, op, tenantId, 'workspace.deactivated', node, { reason });
    });
    await this.log(op, 'workspace.suspended', tenantId, id, { reason }, ip);
    return this.detail(id);
  }

  /** Blocks a workspace until a chosen day; it lifts by itself then. On a Super Workspace it blocks everyone in the client. */
  async blacklist(op: OperatorContext, id: string, input: ConsoleWorkspaceBlacklistInput, ip: string | null): Promise<ConsoleWorkspaceDetail> {
    await this.security.confirmPassword(op.id, input.password);
    const tenantId = await this.tenantOf(id);
    const until = blacklistEnd(input.until);
    let nodeId = id;
    await this.prisma.run({ tenantId }, async (tx) => {
      await transactionLock(tx, `workspaces:${tenantId}`);
      const t = await this.tenant(tx, tenantId);
      if (t.status !== 'ACTIVE') throw new ConflictException({ code: 'CLIENT_NOT_ACTIVE', message: 'This client is suspended or closing. Reactivate it before blacklisting one of its workspaces.' });
      const { node } = await this.target(tx, tenantId, id, { createRoot: true });
      nodeId = node.id;
      if (node.archivedAt) throw deleted();
      assertNotBlocked(node);
      await tx.workspaceNode.update({ where: { id: node.id }, data: { blacklistedUntil: until, blacklistedById: `operator:${op.id}`, blacklistReason: input.reason, lockedByConsole: `operator:${op.email}` } });
      await this.clientAudit(tx, op, tenantId, 'workspace.blacklisted', node, { reason: input.reason, until: until.toISOString() });
    });
    await this.log(op, 'workspace.blacklisted', tenantId, nodeId, { reason: input.reason, until: until.toISOString() }, ip);
    return this.detail(id);
  }

  /** Lifts a suspension or a blacklist, whoever set it. A suspended Super Workspace reactivates its client. */
  async reactivate(op: OperatorContext, id: string, reason: string, ip: string | null): Promise<ConsoleWorkspaceDetail> {
    const tenantId = await this.tenantOf(id);
    const isRoot = id.startsWith(ROOT_PREFIX) || (await this.isRoot(tenantId, id));
    let lifted = false;
    await this.prisma.run({ tenantId }, async (tx) => {
      const found = await this.target(tx, tenantId, id).catch(() => null);
      const node = found?.node;
      if (node && !node.archivedAt && (node.deactivatedAt || blacklistedNow(node))) {
        await tx.workspaceNode.update({ where: { id: node.id }, data: UNBLOCKED });
        await this.clientAudit(tx, op, tenantId, 'workspace.reactivated', node, { reason, was: node.deactivatedAt ? 'deactivated' : 'blacklisted' });
        lifted = true;
      }
    });
    if (lifted) await this.log(op, 'workspace.reactivated', tenantId, id, { reason }, ip);
    if (isRoot) {
      const t = await this.prisma.run({ tenantId }, (tx) => this.tenant(tx, tenantId));
      if (t.status === 'SUSPENDED') {
        assertClientStatus(op);
        await this.clients.setState(op, tenantId, 'ACTIVE', reason, ip);
        lifted = true;
      }
    }
    if (!lifted) throw new ConflictException({ code: 'WORKSPACE_NOT_DEACTIVATED', message: 'This workspace is not suspended or blacklisted.' });
    return this.detail(id);
  }

  /**
   * Deletes a workspace. A Manager or Executive Workspace is removed the way its client would remove it, without
   * asking for a receiver: its records and open tasks go to the nearest live workspace above that has someone in it,
   * its Executive Workspaces move up with their people, and its own people lose access. A Super Workspace closes its
   * company: everyone is signed out, and it can be restored for 30 days before its data is erased.
   */
  async delete(op: OperatorContext, id: string, input: ConsoleWorkspaceDeleteInput, ip: string | null): Promise<ConsoleWorkspaceDetail | { closed: true; eraseAfter: string }> {
    await this.security.confirmPassword(op.id, input.password);
    const tenantId = await this.tenantOf(id);
    if (id.startsWith(ROOT_PREFIX) || (await this.isRoot(tenantId, id))) {
      assertClientStatus(op);
      const t = await this.prisma.run({ tenantId }, (tx) => this.tenant(tx, tenantId));
      if (nameKeyOf(input.confirmName) !== nameKeyOf(t.name)) throw mismatch();
      const closed = await this.closures.closeByConsole(op, tenantId, input.reason, ip);
      return { closed: true, eraseAfter: closed.eraseAfter };
    }
    let result: { handoverTo: string | null; recordsMoved: number; workspacesMoved: number; peopleRemoved: number } | null = null;
    await this.prisma.run({ tenantId }, async (tx) => {
      await transactionLock(tx, `workspaces:${tenantId}`);
      const org = await resolveOrganisation(tx, tenantId);
      const target = org.byId.get(id);
      if (!target || target === org.root) throw new NotFoundException(NOT_FOUND);
      if (target.node.archivedAt) throw deleted();
      if (nameKeyOf(input.confirmName) !== nameKeyOf(target.node.name)) throw mismatch();
      const impact = await this.workspaces.impactOf(tx, tenantId, org, target, null, null);
      // The nearest live workspace above that someone can receive records in; the Super Workspace in the end.
      let handover: NodeAccess = org.root;
      let receiver: { id: string; name: string } | null = null;
      for (let a = target.node.parentId ? org.byId.get(target.node.parentId) : org.root; a; a = a === org.root ? undefined : a.node.parentId ? org.byId.get(a.node.parentId) : org.root) {
        if (a.node.archivedAt || a.node.deactivatedAt || blacklistedNow(a.node)) continue;
        const r = await this.workspaces.receiverOf(tx, tenantId, org, a, null, null);
        if (r) {
          handover = a;
          receiver = r;
          break;
        }
      }
      // Nobody anywhere above (a client whose administrator has not joined): the records stay with their owners.
      const done = await this.workspaces.removeNode(tx, tenantId, org, target, impact, handover, receiver);
      result = done;
      await this.clientAudit(tx, op, tenantId, 'workspace.deleted', target.node, {
        reason: input.reason, handoverToId: handover.virtual ? null : handover.node.id, receiverId: receiver?.id ?? null, records: impact.records,
        workspacesMoved: impact.workspacesBelow.map((w) => w.name), peopleRemoved: impact.people.map((p) => p.email),
      });
    });
    await this.log(op, 'workspace.deleted', tenantId, id, { reason: input.reason, ...result! }, ip);
    return this.detail(id);
  }

  /**
   * Restores a deleted workspace: a Manager or Executive Workspace comes back active with the people the delete took
   * out (the records already handed over stay where they went); a Super Workspace reopens its company within its 30 days.
   */
  async restore(op: OperatorContext, id: string, reason: string, ip: string | null): Promise<ConsoleWorkspaceDetail> {
    const tenantId = await this.tenantOf(id);
    if (id.startsWith(ROOT_PREFIX) || (await this.isRoot(tenantId, id))) {
      assertClientStatus(op);
      await this.closures.reopen(op, tenantId, reason, ip);
      return this.detail(id);
    }
    let restored = 0;
    await this.prisma.run({ tenantId }, async (tx) => {
      await transactionLock(tx, `workspaces:${tenantId}`);
      const t = await this.tenant(tx, tenantId);
      if (t.status === 'PENDING_DELETION') throw new ConflictException({ code: 'CLIENT_CLOSING', message: 'This client is closing. Restore its Super Workspace first.' });
      const node = await tx.workspaceNode.findFirst({ where: { tenantId, id } });
      if (!node) throw new NotFoundException(NOT_FOUND);
      if (!node.archivedAt) throw new ConflictException({ code: 'WORKSPACE_NOT_DELETED', message: 'This workspace is not deleted.' });
      const key = nameKeyOf(node.name);
      if (await tx.workspaceNode.count({ where: { tenantId, nameKey: key, archivedAt: null } })) {
        throw new ConflictException({ code: 'WORKSPACE_NAME_TAKEN', message: `This client now has another workspace called ${node.name}. Rename that one first.` });
      }
      const level = levelOf(node.level) as Exclude<WorkspaceLevel, 'SUPER'>;
      const usage = await this.workspaces.usage(tx, tenantId);
      const u = level === 'MANAGER' ? usage.managers : usage.executives;
      if (u.max !== null && u.used >= u.max) {
        throw new ConflictException({
          code: 'PLAN_LIMIT',
          message: level === 'MANAGER' ? `This client already has all ${u.max} of its Manager Workspaces. Raise the limit first.` : `This client already has all ${u.max} of its Executive Workspaces. Raise the limit first.`,
        });
      }
      // Its parent may be gone too: then it comes back under the Super Workspace.
      const parent = node.parentId ? await tx.workspaceNode.findFirst({ where: { tenantId, id: node.parentId, archivedAt: null } }) : null;
      const parentId = parent ? parent.id : (await this.workspaces.ensureRootIn(tx, tenantId)).id;
      await tx.workspaceNode.update({ where: { id }, data: { archivedAt: null, nameKey: key, parentId, removedMemberIds: [], ...UNBLOCKED } });
      if (node.removedMemberIds.length) {
        const r = await tx.membership.updateMany({ where: { tenantId, workspaceNodeId: id, status: 'SUSPENDED', userId: { in: node.removedMemberIds } }, data: { status: 'ACTIVE' } });
        restored = r.count;
      }
      await this.clientAudit(tx, op, tenantId, 'workspace.restored', node, { reason, peopleRestored: restored });
    });
    await this.log(op, 'workspace.restored', tenantId, id, { reason, peopleRestored: restored }, ip);
    return this.detail(id);
  }

  // ───────────── Building rows ─────────────

  private async snapshot(tenantId?: string): Promise<Snapshot> {
    return this.prisma.run({ system: true }, async (tx) => {
      const where = tenantId ? { tenantId } : {};
      const now = new Date();
      const [tenants, nodes, members, invites] = await Promise.all([
        tx.tenant.findMany({ where: { deletedAt: null, ...(tenantId ? { id: tenantId } : {}) }, select: { id: true, name: true, status: true, closedAt: true, eraseAfter: true, closeReason: true, createdAt: true } }),
        tx.workspaceNode.findMany({ where }),
        tx.membership.findMany({ where: { ...where, status: 'ACTIVE' }, select: { tenantId: true, workspaceNodeId: true, userId: true, createdAt: true, role: { select: { key: true } } }, orderBy: { createdAt: 'asc' } }),
        tx.invitation.findMany({ where: { ...where, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, select: { tenantId: true, workspaceNodeId: true, email: true }, orderBy: { createdAt: 'asc' } }),
      ]);
      const ids = [...new Set(members.map((m) => m.userId))];
      const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
      const live = new Set(tenants.map((t) => t.id));
      const kept = (nodes as unknown as Node[]).filter((n) => live.has(n.tenantId));
      const roots = new Map(kept.filter((n) => n.level === 'SUPER' && !n.parentId).map((n) => [n.tenantId, n]));
      return {
        tenants: new Map(tenants.map((t) => [t.id, t])),
        nodes: kept,
        roots,
        members: (members as Member[]).filter((m) => live.has(m.tenantId)),
        invites: invites.filter((i) => live.has(i.tenantId)),
        users: new Map(users.map((u) => [u.id, { name: u.name, email: u.email }])),
      };
    });
  }

  private membersOf(snap: Snapshot, row: { tenantId: string; id: string; level: WorkspaceLevel }): Member[] {
    const root = snap.roots.get(row.tenantId);
    return snap.members.filter((m) => m.tenantId === row.tenantId && (row.level === 'SUPER' ? !m.workspaceNodeId || m.workspaceNodeId === root?.id : m.workspaceNodeId === row.id));
  }

  private rowsOf(snap: Snapshot): ConsoleDirectoryWorkspace[] {
    const out: ConsoleDirectoryWorkspace[] = [];
    const now = new Date();
    const byId = new Map(snap.nodes.map((n) => [n.id, n]));
    for (const t of snap.tenants.values()) {
      const root = snap.roots.get(t.id);
      const superRow = {
        id: root?.id ?? `${ROOT_PREFIX}${t.id}`,
        tenantId: t.id,
        level: 'SUPER' as const,
      };
      const members = this.membersOf(snap, superRow);
      const invited = snap.invites.find((i) => i.tenantId === t.id && !i.workspaceNodeId)?.email ?? null;
      const owner = members.find((m) => m.role.key === 'owner') ?? members[0];
      let status: ConsoleWorkspaceStatus = 'ACTIVE';
      let statusReason: string | null = null;
      let statusUntil: string | null = null;
      let locked = false;
      if (t.status === 'PENDING_DELETION') [status, statusReason, statusUntil, locked] = ['DELETED', t.closeReason, t.eraseAfter?.toISOString() ?? null, true];
      else if (t.status !== 'ACTIVE') [status, locked] = ['SUSPENDED', true];
      else if (root && blacklistedNow(root, now)) [status, statusReason, statusUntil, locked] = ['BLACKLISTED', root.blacklistReason, root.blacklistedUntil!.toISOString(), true];
      else if (!members.length) status = 'PENDING';
      out.push({
        ...superRow,
        client: t.name,
        name: t.name,
        designation: root?.designation ?? 'Client Administrator',
        owner: owner ? (snap.users.get(owner.userId) ?? null) : null,
        invited: members.length ? null : invited,
        status,
        statusReason,
        statusUntil,
        lockedByConsole: locked,
        restorable: status === 'DELETED' && !!t.eraseAfter && t.eraseAfter > now,
        createdAt: (root?.createdAt ?? t.createdAt).toISOString(),
        users: members.length,
        parent: null,
        permissions: { features: 0, deleteAllowed: false, createsExecutives: root?.canCreateExecutives ?? true },
      });
    }
    for (const n of snap.nodes) {
      if (n.level === 'SUPER' && !n.parentId) continue;
      const t = snap.tenants.get(n.tenantId)!;
      const level = levelOf(n.level);
      const members = this.membersOf(snap, { tenantId: n.tenantId, id: n.id, level });
      const parentNode = n.parentId ? byId.get(n.parentId) : undefined;
      const parentIsRoot = !parentNode || (parentNode.level === 'SUPER' && !parentNode.parentId);
      let status: ConsoleWorkspaceStatus = 'ACTIVE';
      let statusReason: string | null = null;
      let statusUntil: string | null = null;
      if (n.archivedAt) status = 'DELETED';
      else if (n.deactivatedAt) [status, statusReason] = ['SUSPENDED', n.deactivationReason];
      else if (blacklistedNow(n, now)) [status, statusReason, statusUntil] = ['BLACKLISTED', n.blacklistReason, n.blacklistedUntil!.toISOString()];
      else if (!members.length) status = 'PENDING';
      out.push({
        id: n.id,
        tenantId: n.tenantId,
        client: t.name,
        level,
        name: n.name,
        designation: n.designation,
        owner: members[0] ? (snap.users.get(members[0].userId) ?? null) : null,
        invited: members.length ? null : (snap.invites.find((i) => i.workspaceNodeId === n.id)?.email ?? null),
        status,
        statusReason,
        statusUntil,
        lockedByConsole: !!n.lockedByConsole && (status === 'SUSPENDED' || status === 'BLACKLISTED'),
        restorable: status === 'DELETED' && t.status !== 'PENDING_DELETION',
        createdAt: n.createdAt.toISOString(),
        users: members.length,
        parent: parentIsRoot ? { id: snap.roots.get(n.tenantId)?.id ?? `${ROOT_PREFIX}${n.tenantId}`, name: t.name, level: 'SUPER' } : { id: parentNode!.id, name: parentNode!.name, level: levelOf(parentNode!.level) },
        permissions: { features: 0, deleteAllowed: false, createsExecutives: n.canCreateExecutives },
      });
    }
    return out;
  }

  /** What each workspace may use and do now, for the rows of one page (one access computation per client). */
  private async addPermissions(rows: ConsoleDirectoryWorkspace[]): Promise<void> {
    for (const tenantId of new Set(rows.map((r) => r.tenantId))) {
      const org = await this.prisma.run({ tenantId }, (tx) => resolveOrganisation(tx, tenantId));
      for (const r of rows.filter((x) => x.tenantId === tenantId)) {
        const a = r.level === 'SUPER' ? org.root : org.byId.get(r.id);
        if (!a || r.status === 'DELETED') continue;
        r.permissions.features = a.features.length;
        r.permissions.deleteAllowed = actionAllowed(a.actions, 'workspace_management', 'delete') || Object.values(a.actions).some((list) => list?.includes('delete'));
      }
    }
  }

  private async history(tenantId: string, row: ConsoleDirectoryWorkspace): Promise<ConsoleWorkspaceHistoryEntry[]> {
    return this.prisma.run({ tenantId }, async (tx) => {
      const entries = await tx.auditLog.findMany({
        where: { tenantId, ...(row.level === 'SUPER' ? { entityType: 'tenant', entityId: tenantId } : { entityType: 'workspace', entityId: row.id }) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const userIds = [...new Set(entries.map((e) => e.actorUserId).filter((x): x is string => !!x))];
      const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      return entries.map((e) => {
        const m = (e.metadata ?? {}) as Record<string, unknown>;
        const actor = e.actorType === 'PLATFORM_ADMIN' ? `${typeof m.operatorName === 'string' ? m.operatorName : typeof m.operator === 'string' ? m.operator : 'Console'} (SampForce)` : e.actorUserId ? (names.get(e.actorUserId) ?? 'Someone') : 'SampForce';
        const detail = [typeof m.reason === 'string' ? m.reason : null, typeof m.until === 'string' ? `until ${m.until.slice(0, 10)}` : null, Array.isArray(m.changes) ? m.changes.join('; ') : null].filter(Boolean).join(' · ');
        return { at: e.createdAt.toISOString(), action: e.action, actor, outcome: e.outcome === 'REFUSED' ? 'REFUSED' : e.outcome === 'FAILED' ? 'FAILED' : 'SUCCEEDED', detail: detail || null };
      });
    });
  }

  // ───────────── Helpers ─────────────

  /** The client a workspace id belongs to. */
  private async tenantOf(id: string): Promise<string> {
    if (id.startsWith(ROOT_PREFIX)) {
      const tenantId = id.slice(ROOT_PREFIX.length);
      const t = await this.prisma.run({ system: true }, (tx) => tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } }));
      if (!t) throw new NotFoundException(NOT_FOUND);
      return t.id;
    }
    const n = await this.prisma.run({ system: true }, (tx) => tx.workspaceNode.findFirst({ where: { id }, select: { tenantId: true } }));
    if (!n) throw new NotFoundException(NOT_FOUND);
    const t = await this.prisma.run({ system: true }, (tx) => tx.tenant.findFirst({ where: { id: n.tenantId, deletedAt: null }, select: { id: true } }));
    if (!t) throw new NotFoundException(NOT_FOUND);
    return t.id;
  }

  private async isRoot(tenantId: string, id: string): Promise<boolean> {
    return !!(await this.prisma.run({ tenantId }, (tx) => tx.workspaceNode.findFirst({ where: { tenantId, id, level: 'SUPER', parentId: null }, select: { id: true } })));
  }

  private async tenant(tx: TenantTx, tenantId: string): Promise<Tenant> {
    const t = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true, name: true, status: true, closedAt: true, eraseAfter: true, closeReason: true, createdAt: true } });
    if (!t) throw new NotFoundException(NOT_FOUND);
    return t;
  }

  /** The stored node behind an id; a Super Workspace that was never stored is created when an action needs it. */
  private async target(tx: TenantTx, tenantId: string, id: string, { createRoot = false } = {}) {
    if (id.startsWith(ROOT_PREFIX)) {
      const root = createRoot ? await this.workspaces.ensureRootIn(tx, tenantId) : await tx.workspaceNode.findFirst({ where: { tenantId, level: 'SUPER', parentId: null } });
      if (!root) throw new NotFoundException(NOT_FOUND);
      return { node: root, super: true };
    }
    const node = await tx.workspaceNode.findFirst({ where: { tenantId, id } });
    if (!node) throw new NotFoundException(NOT_FOUND);
    return { node, super: node.level === 'SUPER' && !node.parentId };
  }

  /** The client's own audit log: its administrators see what SampForce did to their workspaces. */
  private clientAudit(tx: TenantTx, op: OperatorContext, tenantId: string, action: string, node: { id: string; name: string; level: string }, metadata: Record<string, unknown>) {
    return this.audit.record(tx, {
      tenantId, actorUserId: null, actorType: 'PLATFORM_ADMIN', action, entityType: node.level === 'SUPER' && action !== 'workspace.updated' ? 'tenant' : 'workspace', entityId: node.level === 'SUPER' ? tenantId : node.id,
      metadata: { workspace: node.name, level: node.level, operator: op.email, operatorName: op.name, ...metadata },
    });
  }

  private log(op: OperatorContext, action: string, tenantId: string, id: string, metadata: Record<string, unknown>, ip: string | null) {
    return writePlatformAudit(this.prisma, { operatorId: op.id, action, tenantId, target: { type: 'workspace', id, label: null }, metadata, ip });
  }
}

/** A Super Workspace's suspension, closing and reopening act on its client, so they need the client permission too. */
function assertClientStatus(op: OperatorContext): void {
  if (!op.permissions.includes('clients.status')) throw new ForbiddenException({ code: 'FORBIDDEN_FOR_ROLE', message: 'Suspending or closing a client needs the “Suspend and reactivate” permission.' });
}

const deleted = () => new ConflictException({ code: 'WORKSPACE_DELETED', message: 'This workspace is deleted. Restore it first.' });
const mismatch = () => new BadRequestException({ code: 'CONFIRM_NAME_MISMATCH', message: 'Type the workspace name exactly to delete it.', details: [{ path: 'confirmName', message: 'Type the workspace name exactly to delete it.' }] });
