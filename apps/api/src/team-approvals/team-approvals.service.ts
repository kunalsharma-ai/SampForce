import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { nextSequenceValue, type Prisma, type TenantTx } from '@dealflow/database';
import {
  type ApprovalAction,
  parseActionGrants,
  withDeleteWhereEdit,
  approvalReference,
  type CreateTeamApprovalInput,
  GUARDED_APPROVAL_CATEGORIES,
  type GuardedApprovalCategory,
  readTeamApprovalSettings,
  recordModelLabel,
  type TeamApprovalCategory,
  type TeamApprovalCounts,
  type TeamApprovalOverview,
  type TeamApprovalQuery,
  type TeamApprovalRow,
  type TeamApprovalSettings,
  teamApprovalSettingsSchema,
  type TeamApprovalStatus,
  type WorkspaceRefLite,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { scan } from '../worker/queue';
import { callerOf, type Org, peopleIn } from '../workspace-work/hierarchy';
import { branchIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { canonical, lookAtRecords, recordOfRoute, sha256 } from './record-of-route';

type Row = Prisma.TeamApprovalGetPayload<object>;

const DAY = 86_400_000;
/** A claim older than this belongs to a request that died half way; the approval can be used again. */
const CLAIM_TIMEOUT_MS = 10 * 60_000;

/** The hash an action's body is tied to: an absent or empty body hashes the same. */
export function bodyHashOf(body: unknown): string {
  const empty = body === undefined || body === null || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body as object).length === 0);
  return sha256(empty ? 'null' : canonical(body));
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Approval request not found.' });

/**
 * Team approvals (ADR 0098). Executives ask; the manager of their workspace (the workspace above) decides, and the
 * Super Workspace can decide anything. A request nobody decided in time moves one level up. Guarded requests carry
 * the exact action; once approved, the requester carries it out themselves, once, before it lapses.
 */
@Injectable()
export class TeamApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- settings and the viewer's position -------------------------------------------------------------------

  async settingsOf(tx: TenantTx, tenantId: string): Promise<TeamApprovalSettings> {
    const row = await tx.teamApprovalSettings.findUnique({ where: { tenantId } });
    return readTeamApprovalSettings(row?.settings);
  }

  /** Whether this caller's action of this category must be approved first (Executive Workspaces only). */
  async requirement(auth: AuthContext, category: GuardedApprovalCategory): Promise<boolean> {
    if (!auth.workspaceNodeId) return false;
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      if (callerOf(auth, org).level !== 'EXECUTIVE') return false;
      const s = await this.settingsOf(tx, auth.tenantId);
      return category === 'delete' ? s.deleteNeedsApproval : s.editNeedsApproval;
    });
  }

  overview(auth: AuthContext): Promise<TeamApprovalOverview> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const settings = await this.settingsOf(tx, auth.tenantId);
      return {
        level: me.level,
        decides: me.level !== 'EXECUTIVE',
        needsApprovalToDelete: me.level === 'EXECUTIVE' && settings.deleteNeedsApproval,
        needsApprovalToEdit: me.level === 'EXECUTIVE' && settings.editNeedsApproval,
        settings,
        canChangeSettings: me.level === 'SUPER',
        counts: await this.countsIn(tx, auth, org, me),
      };
    });
  }

  updateSettings(auth: AuthContext, input: TeamApprovalSettings, meta: RequestMeta): Promise<TeamApprovalSettings> {
    const parsed = teamApprovalSettingsSchema.parse(input);
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      if (callerOf(auth, org).level !== 'SUPER') throw new ForbiddenException({ code: 'SUPER_WORKSPACE_ONLY', message: 'Only the Super Workspace changes approval rules.' });
      const before = await this.settingsOf(tx, auth.tenantId);
      let workspacesChanged = 0;
      if (before.lowerLevelsDelete !== parsed.lowerLevelsDelete) workspacesChanged = await this.setLowerLevelsDelete(tx, auth.tenantId, parsed.lowerLevelsDelete);
      await tx.teamApprovalSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, settings: parsed, updatedById: auth.userId },
        update: { settings: parsed, updatedById: auth.userId },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'approvals.settings_changed', entityType: 'team_approval_settings',
        metadata: { before, after: parsed, workspacesChanged }, meta,
      });
      return parsed;
    });
  }

  /** Grants (or takes away) Delete wherever Manager and Executive Workspaces may edit. */
  private async setLowerLevelsDelete(tx: TenantTx, tenantId: string, on: boolean): Promise<number> {
    const nodes = await tx.workspaceNode.findMany({ where: { tenantId, level: { in: ['MANAGER', 'EXECUTIVE'] } }, select: { id: true, actions: true } });
    let changed = 0;
    for (const n of nodes) {
      const next = withDeleteWhereEdit(parseActionGrants(n.actions), on);
      if (canonical(next) === canonical(parseActionGrants(n.actions))) continue;
      await tx.workspaceNode.update({ where: { id: n.id }, data: { actions: next } });
      changed++;
    }
    return changed;
  }

  private async countsIn(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess): Promise<TeamApprovalCounts> {
    const now = new Date();
    const decideWhere = this.decideWhere(auth, org, me);
    const [toDecide, minePending, mineReady] = await Promise.all([
      decideWhere ? tx.teamApproval.count({ where: { AND: [decideWhere, { status: 'PENDING' }] } }) : Promise.resolve(0),
      tx.teamApproval.count({ where: { tenantId: auth.tenantId, requesterId: auth.userId, status: 'PENDING' } }),
      tx.teamApproval.count({ where: { tenantId: auth.tenantId, requesterId: auth.userId, status: 'APPROVED', method: { not: null }, approvedUntil: { gt: now } } }),
    ]);
    return { toDecide, minePending, mineReady };
  }

  /** Requests the caller decides: the Super Workspace every one, a manager those from its branch; never their own. */
  private decideWhere(auth: AuthContext, org: Org, me: NodeAccess): Prisma.TeamApprovalWhereInput | null {
    if (me.level === 'EXECUTIVE') return null;
    const base: Prisma.TeamApprovalWhereInput = { tenantId: auth.tenantId, requesterId: { not: auth.userId } };
    if (me.level === 'SUPER') return base;
    const branch = [...branchIds([...org.byId.values()].map((a) => a.node), me.node.id)].filter((id) => id !== me.node.id);
    return { ...base, requesterNodeId: { in: branch } };
  }

  private mayDecide(auth: AuthContext, org: Org, me: NodeAccess, row: Row): boolean {
    if (row.requesterId === auth.userId || me.level === 'EXECUTIVE') return false;
    if (me.level === 'SUPER') return true;
    if (!row.requesterNodeId) return false;
    const branch = branchIds([...org.byId.values()].map((a) => a.node), me.node.id);
    return row.requesterNodeId !== me.node.id && branch.has(row.requesterNodeId);
  }

  /** The workspace that decides a request from `node`: the one above it, `levels` further up after escalations. */
  private approverOf(org: Org, node: NodeAccess, levels = 0): NodeAccess {
    let at = node.node.parentId ? (org.byId.get(node.node.parentId) ?? org.root) : org.root;
    for (let i = 0; i < levels && at !== org.root; i++) at = at.node.parentId ? (org.byId.get(at.node.parentId) ?? org.root) : org.root;
    return at;
  }

  // ---- reading ---------------------------------------------------------------------------------------------

  list(auth: AuthContext, q: TeamApprovalQuery): Promise<TeamApprovalRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      let where: Prisma.TeamApprovalWhereInput | null;
      if (q.box === 'mine') where = { tenantId: auth.tenantId, requesterId: auth.userId };
      else if (q.box === 'all') where = me.level === 'SUPER' ? { tenantId: auth.tenantId } : this.decideWhere(auth, org, me);
      else where = this.decideWhere(auth, org, me);
      if (!where) return [];
      const and: Prisma.TeamApprovalWhereInput[] = [where];
      if (q.status === 'OPEN') and.push({ status: { in: ['PENDING', 'APPROVED'] } });
      else if (q.status !== 'ANY') and.push({ status: q.status });
      if (q.category !== 'ANY') and.push({ category: q.category });
      if (q.q) and.push({ OR: [{ recordName: { contains: q.q, mode: 'insensitive' } }, { reason: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }] });
      const rows = await tx.teamApproval.findMany({ where: { AND: and }, orderBy: { createdAt: 'desc' }, take: 300 });
      return this.present(tx, auth, org, me, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<TeamApprovalRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const row = await this.visible(tx, auth, org, me, id);
      return (await this.present(tx, auth, org, me, [row]))[0]!;
    });
  }

  private async visible(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, id: string): Promise<Row> {
    const row = await tx.teamApproval.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!row) throw notFound();
    if (row.requesterId === auth.userId || me.level === 'SUPER' || this.mayDecide(auth, org, me, row)) return row;
    throw notFound();
  }

  private async present(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, rows: Row[]): Promise<TeamApprovalRow[]> {
    if (!rows.length) return [];
    const tenant = await tx.tenant.findFirst({ where: { id: auth.tenantId }, select: { name: true } });
    const ids = [...new Set(rows.flatMap((r) => [r.requesterId, r.decidedById]).filter((v): v is string => !!v))];
    const users = new Map((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u]));
    const managers = new Map<string, { id: string; name: string }[]>();
    const wsRef = (nodeId: string | null): WorkspaceRefLite => {
      const a = nodeId ? (org.byId.get(nodeId) ?? org.root) : org.root;
      return { id: a === org.root ? null : a.node.id, name: a === org.root ? (tenant?.name ?? 'Super Workspace') : a.node.name, level: a.level };
    };
    const now = Date.now();
    const out: TeamApprovalRow[] = [];
    for (const r of rows) {
      const approverKey = r.approverNodeId ?? '';
      if (!managers.has(approverKey)) {
        const a = r.approverNodeId ? (org.byId.get(r.approverNodeId) ?? org.root) : org.root;
        managers.set(approverKey, (await peopleIn(tx, auth.tenantId, a, org)).slice(0, 10));
      }
      const mine = r.requesterId === auth.userId;
      const status = r.status as TeamApprovalStatus;
      const guarded = !!r.method;
      const live = status === 'APPROVED' && guarded && !!r.approvedUntil && r.approvedUntil.getTime() > now;
      let recordChanged = false;
      if (live && mine && r.recordFingerprint && r.path) {
        const rr = recordOfRoute(r.path, r.body);
        if (rr) recordChanged = (await lookAtRecords(tx, auth.tenantId, rr)).fingerprint !== r.recordFingerprint;
      }
      const rr = r.path ? recordOfRoute(r.path, r.body) : null;
      out.push({
        id: r.id,
        reference: approvalReference(r.number),
        category: r.category as TeamApprovalCategory,
        status,
        requester: users.get(r.requesterId) ?? { id: r.requesterId, name: 'Former member' },
        requesterWorkspace: wsRef(r.requesterNodeId),
        approverWorkspace: wsRef(r.approverNodeId),
        assignedManagers: managers.get(approverKey) ?? [],
        escalated: r.escalationLevel > 0,
        recordType: r.recordType,
        recordTypeLabel: rr?.model ? recordModelLabel(rr.model, r.recordCount ?? 1) : null,
        recordName: r.recordName,
        recordId: r.recordId,
        recordCount: r.recordCount,
        scope: rr?.scope ?? null,
        title: r.title,
        reason: r.reason,
        decisionNote: r.decisionNote,
        decidedBy: r.decidedById ? (users.get(r.decidedById) ?? { id: r.decidedById, name: 'Former member' }) : null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        approvedUntil: r.approvedUntil?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        recordChanged,
        action: mine && guarded ? { method: r.method as ApprovalAction['method'], path: r.path!, body: r.body ?? undefined } : null,
        deletedItemsId: r.recycleBatchId,
        canDecide: status === 'PENDING' && this.mayDecide(auth, org, me, r),
        canCancel: mine && (status === 'PENDING' || (status === 'APPROVED' && !r.completedAt)),
        canCarryOut: mine && live && !recordChanged,
      });
    }
    return out;
  }

  // ---- asking, deciding, cancelling --------------------------------------------------------------------------

  create(auth: AuthContext, input: CreateTeamApprovalInput, meta: RequestMeta): Promise<TeamApprovalRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      if (me.level === 'SUPER') throw new ForbiddenException({ code: 'NOBODY_ABOVE', message: 'The Super Workspace has nobody above it to ask. Go ahead directly.' });
      const settings = await this.settingsOf(tx, auth.tenantId);
      const guarded = (GUARDED_APPROVAL_CATEGORIES as readonly string[]).includes(input.category);
      if (guarded) {
        const needed = me.level === 'EXECUTIVE' && (input.category === 'delete' ? settings.deleteNeedsApproval : settings.editNeedsApproval);
        if (!needed) throw new BadRequestException({ code: 'APPROVAL_NOT_NEEDED', message: 'Your workspace can do this without approval.' });
      } else if (!settings.freeFormRequests) {
        throw new ForbiddenException({ code: 'REQUESTS_OFF', message: 'Your organisation has switched requests off.' });
      }

      const action = guarded ? input.action! : null;
      const bodyHash = action ? bodyHashOf(action.body) : null;
      if (action) {
        // The same action asked for again: hand back the open request instead of a second one.
        const same = await tx.teamApproval.findFirst({
          where: { tenantId: auth.tenantId, requesterId: auth.userId, method: action.method, path: action.path, bodyHash, status: { in: ['PENDING', 'APPROVED'] }, completedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (same && (same.status === 'PENDING' || (same.approvedUntil && same.approvedUntil > new Date()))) {
          return (await this.present(tx, auth, org, me, [same]))[0]!;
        }
      }
      const rr = action ? recordOfRoute(action.path, action.body) : null;
      const look = rr ? await lookAtRecords(tx, auth.tenantId, rr) : null;
      if (rr && rr.scope === 'single' && rr.model && look && look.found === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'That record no longer exists.' });
      }
      const approver = this.approverOf(org, me);
      const number = await nextSequenceValue(tx, `team-approval:${auth.tenantId}`);
      const row = await tx.teamApproval.create({
        data: {
          tenantId: auth.tenantId,
          number,
          category: input.category,
          requesterId: auth.userId,
          requesterNodeId: me === org.root ? null : me.node.id,
          approverNodeId: approver === org.root ? null : approver.node.id,
          recordType: rr?.recordType ?? (action ? action.path.split('/')[1] ?? null : null),
          recordName: look?.name ?? null,
          recordId: rr && rr.scope === 'single' ? rr.ids[0]! : null,
          recordCount: rr?.count ?? null,
          recordFingerprint: look?.fingerprint ?? null,
          method: action?.method ?? null,
          path: action?.path ?? null,
          body: action?.body === undefined ? undefined : (action.body as Prisma.InputJsonValue),
          bodyHash,
          title: input.title ?? null,
          reason: input.reason,
          expiresAt: new Date(Date.now() + settings.expireAfterDays * DAY),
        },
      });
      const who = (await tx.user.findFirst({ where: { id: auth.userId }, select: { name: true } }))?.name ?? 'Someone';
      const what = describe(row);
      await this.notifications.send(tx, auth.tenantId, (await peopleIn(tx, auth.tenantId, approver, org)).map((p) => p.id), {
        type: 'approval.requested',
        title: `${who} asks for approval: ${what}`,
        body: row.reason,
        link: `/app/approvals?request=${row.id}`,
        eventId: `team-approval:${row.id}:requested`,
        senderId: auth.userId,
        priority: 'HIGH',
        actionRequired: true,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'approval.requested', entityType: 'team_approval', entityId: row.id,
        metadata: { category: row.category, recordType: row.recordType, recordId: row.recordId, recordCount: row.recordCount, method: row.method, path: row.path }, meta,
      });
      return (await this.present(tx, auth, org, me, [row]))[0]!;
    });
  }

  decide(auth: AuthContext, id: string, decision: 'approve' | 'reject', note: string | undefined, meta: RequestMeta): Promise<TeamApprovalRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const row = await this.visible(tx, auth, org, me, id);
      if (!this.mayDecide(auth, org, me, row)) {
        if (row.requesterId === auth.userId) throw new ForbiddenException({ code: 'NO_SELF_APPROVAL', message: 'You cannot decide your own request.' });
        throw new ForbiddenException({ code: 'NOT_YOUR_DECISION', message: 'This request is decided by another workspace.' });
      }
      const settings = await this.settingsOf(tx, auth.tenantId);
      const now = new Date();
      const approved = decision === 'approve';
      const { count } = await tx.teamApproval.updateMany({
        where: { id, tenantId: auth.tenantId, status: 'PENDING', expiresAt: { gt: now } },
        data: {
          status: approved ? 'APPROVED' : 'REJECTED',
          decidedById: auth.userId,
          decidedAt: now,
          decisionNote: note || null,
          approvedUntil: approved && row.method ? new Date(now.getTime() + settings.approvalValidDays * DAY) : null,
        },
      });
      if (count === 0) throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'This request was already decided, cancelled or has expired.' });
      const updated = await tx.teamApproval.findFirstOrThrow({ where: { id } });
      const what = describe(updated);
      await this.notifications.send(tx, auth.tenantId, [row.requesterId], {
        type: approved ? 'approval.approved' : 'approval.rejected',
        title: approved ? `Approved: ${what}` : `Not approved: ${what}`,
        body: note || (approved && row.method ? 'Open Approvals to carry it out.' : null),
        link: `/app/approvals?request=${row.id}`,
        eventId: `team-approval:${row.id}:${decision}`,
        senderId: auth.userId,
        priority: approved ? 'HIGH' : 'NORMAL',
        actionRequired: approved && !!row.method,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: approved ? 'approval.approved' : 'approval.rejected', entityType: 'team_approval', entityId: id,
        metadata: { category: row.category, requesterId: row.requesterId, recordType: row.recordType, recordId: row.recordId, note: note ?? null }, meta,
      });
      return (await this.present(tx, auth, org, me, [updated]))[0]!;
    });
  }

  cancel(auth: AuthContext, id: string, meta: RequestMeta): Promise<TeamApprovalRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const row = await this.visible(tx, auth, org, me, id);
      if (row.requesterId !== auth.userId) throw new ForbiddenException({ code: 'NOT_YOUR_REQUEST', message: 'Only the person who asked can cancel a request.' });
      const { count } = await tx.teamApproval.updateMany({
        where: { id, status: { in: ['PENDING', 'APPROVED'] }, completedAt: null, claimedAt: null },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (count === 0) throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'This request was already decided, cancelled or has expired.' });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'approval.cancelled', entityType: 'team_approval', entityId: id, metadata: { category: row.category }, meta });
      return (await this.present(tx, auth, org, me, [await tx.teamApproval.findFirstOrThrow({ where: { id } })]))[0]!;
    });
  }

  // ---- the guarded action itself ---------------------------------------------------------------------------

  /** An open request for exactly this action, so the screen can say it is already waiting. */
  async sameOpen(auth: AuthContext, method: string, path: string, body: unknown): Promise<string | null> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.teamApproval.findFirst({
        where: { tenantId: auth.tenantId, requesterId: auth.userId, method, path, bodyHash: bodyHashOf(body), status: 'PENDING' },
        select: { id: true },
      });
      return row?.id ?? null;
    });
  }

  /** What the 403 tells the screen about the record. */
  async describeAction(auth: AuthContext, path: string, body: unknown): Promise<{ recordTypeLabel: string | null; recordName: string | null; recordCount: number | null }> {
    const rr = recordOfRoute(path, body);
    if (!rr) return { recordTypeLabel: null, recordName: null, recordCount: null };
    const look = await this.prisma.run(auth, (tx) => lookAtRecords(tx, auth.tenantId, rr));
    return { recordTypeLabel: rr.recordTypeLabel, recordName: look.name, recordCount: rr.count };
  }

  /**
   * Checks that `id` is an approved request of this caller for exactly this action and that its records are as they
   * were when it was asked for. Throws 403 APPROVAL_NOT_VALID saying why otherwise.
   */
  async assertUsable(auth: AuthContext, id: string, method: string, path: string, body: unknown): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.teamApproval.findFirst({ where: { id, tenantId: auth.tenantId, requesterId: auth.userId } });
      if (!row || !row.method) throw new ForbiddenException({ code: 'APPROVAL_NOT_VALID', message: 'This approval was not found.' });
      if (row.status === 'COMPLETED') throw new ForbiddenException({ code: 'APPROVAL_NOT_VALID', message: 'This approval was already used.' });
      if (row.status !== 'APPROVED') throw new ForbiddenException({ code: 'APPROVAL_NOT_VALID', message: 'This request is not approved.' });
      if (!row.approvedUntil || row.approvedUntil <= new Date()) throw new ForbiddenException({ code: 'APPROVAL_NOT_VALID', message: 'This approval has expired. Ask again.' });
      if (row.method !== method || row.path !== path || row.bodyHash !== bodyHashOf(body)) throw new ForbiddenException({ code: 'APPROVAL_NOT_VALID', message: 'This approval is for a different action.' });
      if (row.recordFingerprint) {
        const rr = recordOfRoute(path, body);
        const now = rr ? (await lookAtRecords(tx, auth.tenantId, rr)).fingerprint : null;
        if (now !== row.recordFingerprint) throw new ForbiddenException({ code: 'APPROVAL_NOT_VALID', message: 'The record changed after it was approved. Ask again so your manager sees it as it is now.' });
      }
    });
  }

  /** Marks the approval as running, so it runs once; false when someone else is already using it. */
  async claim(auth: AuthContext, id: string): Promise<boolean> {
    return this.prisma.run(auth, async (tx) => {
      const stale = new Date(Date.now() - CLAIM_TIMEOUT_MS);
      const { count } = await tx.teamApproval.updateMany({
        where: { id, tenantId: auth.tenantId, requesterId: auth.userId, status: 'APPROVED', OR: [{ claimedAt: null }, { claimedAt: { isSet: false } }, { claimedAt: { lt: stale } }] },
        data: { claimedAt: new Date() },
      });
      return count === 1;
    });
  }

  async release(auth: AuthContext, id: string): Promise<void> {
    await this.prisma.run(auth, (tx) => tx.teamApproval.updateMany({ where: { id, tenantId: auth.tenantId, status: 'APPROVED' }, data: { claimedAt: null } }));
  }

  async complete(auth: AuthContext, id: string, recycleBatchId: string | null, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.teamApproval.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!row) return;
      await tx.teamApproval.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), recycleBatchId } });
      if (row.decidedById) {
        await this.notifications.send(tx, auth.tenantId, [row.decidedById], {
          type: 'approval.completed',
          title: `Done: ${describe(row)}`,
          body: null,
          link: `/app/approvals?request=${row.id}`,
          eventId: `team-approval:${row.id}:completed`,
          senderId: auth.userId,
        });
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'approval.completed', entityType: 'team_approval', entityId: id,
        metadata: { category: row.category, recordType: row.recordType, recordId: row.recordId, recycleBatchId }, meta,
      });
    });
  }

  // ---- the worker: lapse and escalate ------------------------------------------------------------------------

  /** Expires requests nobody decided, lapses unused approvals and moves slow requests one level up. */
  async sweep(): Promise<number> {
    const now = new Date();
    const due = await scan(() =>
      this.prisma.teamApproval.findMany({
        where: { OR: [{ status: 'PENDING' }, { status: 'APPROVED', approvedUntil: { lte: now }, completedAt: null }] },
        select: { id: true, tenantId: true, status: true, expiresAt: true, approvedUntil: true, createdAt: true, escalatedAt: true, escalationLevel: true, approverNodeId: true, requesterId: true, requesterNodeId: true, number: true, category: true, recordName: true, recordType: true, recordCount: true, title: true, claimedAt: true },
        take: 500,
      }),
    );
    let changed = 0;
    const byTenant = new Map<string, typeof due>();
    for (const r of due) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);
    for (const [tenantId, rows] of byTenant) {
      changed += await this.prisma.run({ tenantId }, async (tx) => {
        const settings = await this.settingsOf(tx, tenantId);
        const org = await resolveOrganisation(tx, tenantId);
        let n = 0;
        for (const r of rows) {
          const what = describe(r);
          if (r.status === 'APPROVED' || r.expiresAt <= now) {
            if (r.status === 'APPROVED' && r.claimedAt && r.claimedAt.getTime() > now.getTime() - CLAIM_TIMEOUT_MS) continue;
            const hit = await tx.teamApproval.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'EXPIRED' } });
            if (hit.count) {
              n++;
              await this.notifications.send(tx, tenantId, [r.requesterId], {
                type: 'approval.expired', title: `Expired: ${what}`, body: r.status === 'APPROVED' ? 'The approval was not used in time. Ask again if you still need it.' : 'Nobody decided in time. Ask again if you still need it.',
                link: `/app/approvals?request=${r.id}`, eventId: `team-approval:${r.id}:expired`,
              });
            }
            continue;
          }
          if (!settings.escalateAfterHours || !r.approverNodeId) continue;
          const since = (r.escalatedAt ?? r.createdAt).getTime();
          if (now.getTime() - since < settings.escalateAfterHours * 3_600_000) continue;
          const requester = r.requesterNodeId ? org.byId.get(r.requesterNodeId) : undefined;
          if (!requester) continue;
          const next = this.approverOf(org, requester, r.escalationLevel + 1);
          const nextId = next === org.root ? null : next.node.id;
          if (nextId === r.approverNodeId) continue;
          const hit = await tx.teamApproval.updateMany({ where: { id: r.id, status: 'PENDING', escalationLevel: r.escalationLevel }, data: { approverNodeId: nextId, escalationLevel: r.escalationLevel + 1, escalatedAt: now } });
          if (!hit.count) continue;
          n++;
          await this.notifications.send(tx, tenantId, (await peopleIn(tx, tenantId, next, org)).map((p) => p.id), {
            type: 'approval.escalated', title: `Waiting for a decision: ${what}`, body: `Not decided within ${settings.escalateAfterHours} hours, so it moved to you.`,
            link: `/app/approvals?request=${r.id}`, eventId: `team-approval:${r.id}:escalated:${r.escalationLevel + 1}`, priority: 'HIGH', actionRequired: true,
          });
        }
        return n;
      });
    }
    return changed;
  }
}

/** "Acme Ltd (APR-12)": the record or request in a notification (the words around it are translated when read). */
function describe(r: { number: number; recordName: string | null; recordCount: number | null; title: string | null }): string {
  const ref = approvalReference(r.number);
  const what = r.title ?? r.recordName ?? (r.recordCount && r.recordCount > 1 ? `${r.recordCount} records` : 'a record');
  return `${what} (${ref})`;
}
