import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import {
  METRIC_RULE,
  MONEY_METRICS,
  TARGET_METRIC_LABEL,
  type TargetCreateInput,
  type TargetDistributeInput,
  targetEnd,
  type TargetMetric,
  type TargetPeriod,
  type TargetRow,
  type TargetsView,
  type TargetTrend,
  type TargetUpdateInput,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { r2 } from '../command-center/metrics';
import { RevenueRecordsService } from '../crm/revenue-records.service';
import { NotificationsService } from '../notifications/notifications.service';
import { branchUserIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { HierarchyError } from '../workspaces/workspaces.service';
import { assertAction, callerOf, handsDownTo, may, type Org, peopleIn, refOf, visibleNodeIds } from './hierarchy';
import { Measures } from './measures';

type Stored = Prisma.WorkspaceTargetGetPayload<object>;
const FEATURE = 'sales_target_management' as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Target not found.' });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;
const lastDay = (end: Date) => iso(new Date(end.getTime() - DAY));
const RECONCILE = new Set(['REVENUE', 'DEALS_WON', 'CONVERSIONS']);

/**
 * Targets the caller may read (ADR 0096): everything for the Super Workspace; for a manager its own team, plus the
 * other Manager Workspaces' own targets when the Super Workspace lets it see other managers; an executive its own.
 */
function readableNodeIds(me: NodeAccess, org: Org): Set<string> {
  const ids = visibleNodeIds(me, org);
  if (me.level === 'MANAGER' && me.node.canViewOtherManagers) for (const a of org.byId.values()) if (a.level === 'MANAGER' && !a.node.archivedAt) ids.add(a.node.id);
  return ids;
}

/** People counted for a workspace's target: its branch, or everyone in the organisation for the organisation's own target. */
async function countedUsers(tx: TenantTx, tenantId: string, org: Org, nodeId: string): Promise<string[]> {
  if (nodeId === org.root.node.id) return (await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true } })).map((m) => m.userId);
  return branchUserIds(tx, tenantId, nodeId);
}

/** The Super Workspace may also set targets for the organisation as a whole (its own root workspace). */
function settable(me: NodeAccess, node: NodeAccess, org: Org): boolean {
  return handsDownTo(me, node, org) || (me.level === 'SUPER' && node === org.root);
}

/**
 * Sales targets down the workspace hierarchy (ADR 0071, part 4). The Super Workspace sets targets for any workspace
 * below it; a manager sets targets for its own Executive Workspaces, and splits a target it received among them, as
 * long as its workspace may assign in Sales target management. Achievement is counted from the records of everyone
 * in the target's workspace and below it, so a lead an executive records moves its own target and its manager's.
 */
@Injectable()
export class TargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly revenue: RevenueRecordsService,
  ) {}

  list(auth: AuthContext): Promise<TargetsView> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'view');
      const visible = readableNodeIds(me, org);
      const rows = await tx.workspaceTarget.findMany({ where: { tenantId: auth.tenantId, archivedAt: null, workspaceNodeId: { in: [...visible] } }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'asc' }], take: 500 });
      const ctx = await this.context(tx, auth);
      const assignable = may(me, FEATURE, 'assign') ? [...org.byId.values()].filter((a) => settable(me, a, org)) : [];
      return {
        targets: await this.rows(tx, auth, org, me, rows, ctx),
        scope: me.level === 'SUPER' ? 'ORGANISATION' : me.level === 'MANAGER' ? 'TEAM' : 'SELF',
        myWorkspaceId: me.node.id,
        assignable: assignable.map((a) => ({ ...refOf(a, org, ctx.orgName), parentId: a.node.parentId })),
        currency: ctx.currency,
      };
    });
  }

  create(auth: AuthContext, input: TargetCreateInput, meta: RequestMeta): Promise<TargetRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const node = this.assignableNode(me, org, input.workspaceId);
      const startsAt = new Date(`${input.startsOn}T00:00:00Z`);
      const row = await tx.workspaceTarget.create({
        data: {
          tenantId: auth.tenantId,
          workspaceNodeId: node.node.id,
          metric: input.metric,
          period: input.period,
          startsAt,
          endsAt: targetEnd(input.period, input.startsOn, input.endsOn),
          amount: input.amount,
          note: input.note || null,
          setById: auth.userId,
          setByLevel: me.level === 'SUPER' ? 'SUPER' : 'MANAGER',
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'target.set', entityType: 'workspace_target', entityId: row.id,
        metadata: { workspace: node.node.name, metric: row.metric, period: row.period, amount: row.amount, startsOn: iso(row.startsAt), endsOn: lastDay(row.endsAt) }, meta,
      });
      await this.tell(tx, auth, org, [node], row);
      const ctx = await this.context(tx, auth);
      return (await this.rows(tx, auth, org, me, [row], ctx))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: TargetUpdateInput, meta: RequestMeta): Promise<TargetRow> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `targets:${auth.tenantId}`);
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const row = await this.find(tx, auth, id);
      this.assignableNode(me, org, row.workspaceNodeId);
      if (input.amount !== undefined) {
        const parts = await this.partsTotal(tx, auth.tenantId, row.id);
        if (input.amount < parts) throw new ConflictException({ code: 'TARGET_BELOW_DISTRIBUTED', message: 'The target cannot be lower than the parts already handed down from it.' });
        if (row.parentTargetId) {
          const parent = await this.find(tx, auth, row.parentTargetId);
          const siblings = (await this.partsTotal(tx, auth.tenantId, parent.id)) - row.amount;
          if (siblings + input.amount > parent.amount + 1e-9) throw new ConflictException({ code: 'TARGET_OVER_DISTRIBUTED', message: 'The parts handed down cannot add up to more than the target they come from.' });
        }
      }
      let endsAt: Date | undefined;
      if (input.endsOn !== undefined) {
        if (input.endsOn < iso(row.startsAt)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The period must end on or after its first day.' });
        endsAt = new Date(Date.parse(`${input.endsOn}T00:00:00Z`) + DAY);
        if (endsAt.getTime() - row.startsAt.getTime() > 367 * DAY) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A target can run for at most a year.' });
      }
      const changed = endsAt && endsAt.getTime() !== row.endsAt.getTime();
      const updated = await tx.workspaceTarget.update({
        where: { id },
        data: {
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.note !== undefined ? { note: input.note || null } : {}),
          ...(changed ? { endsAt, period: 'CUSTOM' } : {}),
        },
      });
      // Parts handed down from it follow the new deadline.
      if (changed) await tx.workspaceTarget.updateMany({ where: { tenantId: auth.tenantId, parentTargetId: id, archivedAt: null }, data: { endsAt, period: 'CUSTOM' } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'target.updated', entityType: 'workspace_target', entityId: id,
        metadata: { amountFrom: row.amount, amountTo: updated.amount, ...(input.note !== undefined ? { note: updated.note } : {}), ...(changed ? { endsOnFrom: lastDay(row.endsAt), endsOnTo: lastDay(updated.endsAt) } : {}) }, meta,
      });
      await this.tellChange(tx, auth, org, org.byId.get(row.workspaceNodeId)!, row, updated);
      const ctx = await this.context(tx, auth);
      return (await this.rows(tx, auth, org, me, [updated], ctx))[0]!;
    });
  }

  /** Hands parts of a target down to the Executive Workspaces under its workspace, replacing earlier parts for them. */
  distribute(auth: AuthContext, id: string, input: TargetDistributeInput, meta: RequestMeta): Promise<TargetRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `targets:${auth.tenantId}`);
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const parent = await this.find(tx, auth, id);
      const owner = org.byId.get(parent.workspaceNodeId);
      if (!owner || !visibleNodeIds(me, org).has(owner.node.id)) throw notFound();
      if (owner.level !== 'MANAGER') throw new BadRequestException({ code: 'TARGET_NOT_DISTRIBUTABLE', message: 'Only a Manager Workspace’s target is split among its Executive Workspaces.' });
      assertAction(me, FEATURE, 'assign');
      if (!(me.level === 'SUPER' || me.node.id === owner.node.id)) throw new HierarchyError('WORKSPACE_ADMIN_FORBIDDEN', 'Only the workspace above this one can manage it.');
      for (const p of input.parts) {
        const child = org.byId.get(p.workspaceId);
        if (!child || child.node.archivedAt || child.level !== 'EXECUTIVE' || child.node.parentId !== owner.node.id)
          throw new BadRequestException({ code: 'INVALID_PARENT', message: 'A target is split only among the Executive Workspaces that report to its workspace.' });
      }
      const existing = await tx.workspaceTarget.findMany({ where: { tenantId: auth.tenantId, parentTargetId: parent.id, archivedAt: null } });
      const replaced = new Set(input.parts.map((p) => p.workspaceId));
      const kept = existing.filter((e) => !replaced.has(e.workspaceNodeId)).reduce((a, e) => a + e.amount, 0);
      const total = kept + input.parts.reduce((a, p) => a + p.amount, 0);
      if (total > parent.amount + 1e-9) throw new ConflictException({ code: 'TARGET_OVER_DISTRIBUTED', message: 'The parts handed down cannot add up to more than the target they come from.' });

      const out: Stored[] = [];
      for (const p of input.parts) {
        const prior = existing.find((e) => e.workspaceNodeId === p.workspaceId);
        out.push(
          prior
            ? await tx.workspaceTarget.update({ where: { id: prior.id }, data: { amount: p.amount, setById: auth.userId, setByLevel: me.level === 'SUPER' ? 'SUPER' : 'MANAGER' } })
            : await tx.workspaceTarget.create({
                data: {
                  tenantId: auth.tenantId, workspaceNodeId: p.workspaceId, metric: parent.metric, period: parent.period, startsAt: parent.startsAt, endsAt: parent.endsAt,
                  amount: p.amount, note: parent.note, parentTargetId: parent.id, setById: auth.userId, setByLevel: me.level === 'SUPER' ? 'SUPER' : 'MANAGER',
                },
              }),
        );
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'target.distributed', entityType: 'workspace_target', entityId: parent.id,
        metadata: { workspace: owner.node.name, metric: parent.metric, target: parent.amount, parts: input.parts.map((p) => ({ workspace: org.byId.get(p.workspaceId)!.node.name, amount: p.amount })) }, meta,
      });
      for (const row of out) await this.tell(tx, auth, org, [org.byId.get(row.workspaceNodeId)!], row);
      const ctx = await this.context(tx, auth);
      return this.rows(tx, auth, org, me, out, ctx);
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const row = await this.find(tx, auth, id);
      this.assignableNode(me, org, row.workspaceNodeId);
      const stamp = new Date();
      // Parts handed down from it go with it: they only made sense as shares of this target.
      await tx.workspaceTarget.updateMany({ where: { tenantId: auth.tenantId, OR: [{ id }, { parentTargetId: id }], archivedAt: null }, data: { archivedAt: stamp } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'target.removed', entityType: 'workspace_target', entityId: id, metadata: { metric: row.metric, amount: row.amount }, meta });
    });
  }

  // ───────────── Helpers ─────────────

  private assignableNode(me: NodeAccess, org: Org, nodeId: string): NodeAccess {
    const node = org.byId.get(nodeId);
    if (!node || !visibleNodeIds(me, org).has(nodeId)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
    assertAction(me, FEATURE, 'assign');
    if (!settable(me, node, org)) throw new HierarchyError('WORKSPACE_ADMIN_FORBIDDEN', 'Only the workspace above this one can manage it.');
    return node;
  }

  private async find(tx: TenantTx, auth: AuthContext, id: string): Promise<Stored> {
    const row = await tx.workspaceTarget.findFirst({ where: { id, tenantId: auth.tenantId, archivedAt: null } });
    if (!row) throw notFound();
    return row;
  }

  private async partsTotal(tx: TenantTx, tenantId: string, id: string): Promise<number> {
    const parts = await tx.workspaceTarget.findMany({ where: { tenantId, parentTargetId: id, archivedAt: null }, select: { amount: true } });
    return parts.reduce((a, p) => a + p.amount, 0);
  }

  private async context(tx: TenantTx, auth: AuthContext) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true, defaultCurrency: true } });
    return { orgName: tenant.name, currency: tenant.defaultCurrency, measures: new Measures(tx, auth.tenantId) };
  }

  /** Tells the people of each workspace that it has a new target. */
  private async tell(tx: TenantTx, auth: AuthContext, org: Org, nodes: NodeAccess[], row: Stored): Promise<void> {
    for (const n of nodes) {
      const people = (await peopleIn(tx, auth.tenantId, n, org)).map((p) => p.id).filter((u) => u !== auth.userId);
      await this.notifications.send(tx, auth.tenantId, people, {
        type: 'target.set',
        title: 'You have a new target',
        body: `${TARGET_METRIC_LABEL[row.metric as TargetMetric]}: ${row.amount}, ${iso(row.startsAt)} to ${lastDay(row.endsAt)}.`,
        link: '/app/targets',
        eventId: `target:${row.id}:${row.amount}`,
        senderId: auth.userId,
      });
    }
  }

  /** Tells the people of a workspace that its target changed: a new amount or a new deadline. */
  private async tellChange(tx: TenantTx, auth: AuthContext, org: Org, node: NodeAccess, before: Stored, after: Stored): Promise<void> {
    if (before.amount === after.amount && before.endsAt.getTime() === after.endsAt.getTime()) return;
    const people = (await peopleIn(tx, auth.tenantId, node, org)).map((p) => p.id).filter((u) => u !== auth.userId);
    await this.notifications.send(tx, auth.tenantId, people, {
      type: 'target.updated',
      title: 'Your target changed',
      body: `${TARGET_METRIC_LABEL[after.metric as TargetMetric]}: ${after.amount}, ${iso(after.startsAt)} to ${lastDay(after.endsAt)}.`,
      link: '/app/targets',
      eventId: `target:${after.id}:${after.amount}:${iso(after.endsAt)}`,
      senderId: auth.userId,
    });
  }

  /** Day-by-day progress of one target with the pace line, and how the same measure did in earlier periods. */
  trend(auth: AuthContext, id: string): Promise<TargetTrend> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'view');
      const row = await this.find(tx, auth, id);
      if (!readableNodeIds(me, org).has(row.workspaceNodeId)) throw notFound();
      if (RECONCILE.has(row.metric)) await this.revenue.reconcile(tx, auth.tenantId);
      const users = await countedUsers(tx, auth.tenantId, org, row.workspaceNodeId);
      const m = new Measures(tx, auth.tenantId);
      const metric = row.metric as TargetMetric;
      const days = Math.max(1, Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / DAY));
      const now = Date.now();
      // At most 31 points: one a day for a month, evenly spread over longer periods; none in the future.
      const n = Math.min(days, 31);
      const points: TargetTrend['points'] = [];
      for (let i = 1; i <= n; i++) {
        const d = Math.round((i * days) / n);
        const upTo = new Date(row.startsAt.getTime() + d * DAY);
        if (upTo.getTime() - (days / n) * DAY > now) break;
        const achieved = await m.count(metric, users, row.startsAt, new Date(Math.min(upTo.getTime(), now)));
        points.push({ date: lastDay(upTo), achieved, pace: r2((row.amount * d) / days) });
      }
      const span = row.endsAt.getTime() - row.startsAt.getTime();
      const history: TargetTrend['history'] = [];
      for (let k = 1; k <= 6; k++) {
        const start = new Date(row.startsAt.getTime() - k * span);
        const end = new Date(start.getTime() + span);
        const achieved = await m.count(metric, users, start, end);
        history.push({ startsOn: iso(start), endsOn: lastDay(end), achieved, percent: row.amount > 0 ? Math.round((achieved / row.amount) * 1000) / 10 : 0 });
      }
      return { id: row.id, points, history };
    });
  }

  private async rows(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, rows: Stored[], ctx: Awaited<ReturnType<TargetsService['context']>>): Promise<TargetRow[]> {
    if (!rows.length) return [];
    if (rows.some((r) => RECONCILE.has(r.metric))) await this.revenue.reconcile(tx, auth.tenantId);
    const setters = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.setById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const setterName = new Map(setters.map((u) => [u.id, u.name]));
    const parts = await tx.workspaceTarget.findMany({ where: { tenantId: auth.tenantId, parentTargetId: { in: rows.map((r) => r.id) }, archivedAt: null }, select: { parentTargetId: true, amount: true } });
    const partsOf = new Map<string, number>();
    for (const p of parts) partsOf.set(p.parentTargetId!, (partsOf.get(p.parentTargetId!) ?? 0) + p.amount);
    const usersOf = new Map<string, string[]>();
    const counted = new Map<string, number>();
    const canAssign = may(me, FEATURE, 'assign');
    const now = new Date();
    const count = async (nodeId: string, metric: TargetMetric, start: Date, end: Date) => {
      const key = `${nodeId}|${metric}|${start.getTime()}|${end.getTime()}`;
      if (!counted.has(key)) counted.set(key, await ctx.measures.count(metric, usersOf.get(nodeId)!, start, end));
      return counted.get(key)!;
    };
    const pct = (got: number, amount: number) => (amount > 0 ? Math.round((got / amount) * 1000) / 10 : 0);

    const out: TargetRow[] = [];
    for (const r of rows) {
      const node = org.byId.get(r.workspaceNodeId);
      if (!node) continue;
      if (!usersOf.has(node.node.id)) usersOf.set(node.node.id, await countedUsers(tx, auth.tenantId, org, node.node.id));
      const metric = r.metric as TargetMetric;
      const got = await count(node.node.id, metric, r.startsAt, r.endsAt);
      const span = r.endsAt.getTime() - r.startsAt.getTime();
      const state = now < r.startsAt ? 'UPCOMING' : now >= r.endsAt ? 'ENDED' : 'RUNNING';
      const before = state === 'UPCOMING' ? null : await count(node.node.id, metric, new Date(r.startsAt.getTime() - span), r.startsAt);
      const hasExecutives = [...org.byId.values()].some((a) => a.level === 'EXECUTIVE' && a.node.parentId === node.node.id && !a.node.archivedAt);
      const mine = handsDownTo(me, node, org) || (me.level === 'SUPER' && node === org.root);
      out.push({
        id: r.id,
        metric,
        period: r.period as TargetPeriod,
        startsOn: iso(r.startsAt),
        endsOn: lastDay(r.endsAt),
        amount: r.amount,
        currency: MONEY_METRICS.has(metric) ? ctx.currency : null,
        note: r.note,
        workspace: refOf(node, org, ctx.orgName),
        setBy: r.setById ? { id: r.setById, name: setterName.get(r.setById) ?? '' } : null,
        source: r.setByLevel === 'SUPER' ? 'SUPER' : 'MANAGER',
        parentTargetId: r.parentTargetId,
        achieved: got,
        percent: pct(got, r.amount),
        remaining: r2(Math.max(0, r.amount - got)),
        state,
        daysLeft: state === 'RUNNING' ? Math.max(1, Math.ceil((r.endsAt.getTime() - now.getTime()) / DAY)) : null,
        previous: before === null ? null : { achieved: before, percent: pct(before, r.amount) },
        rule: METRIC_RULE[metric],
        distributed: r2(partsOf.get(r.id) ?? 0),
        editable: canAssign && mine,
        canDistribute: canAssign && node.level === 'MANAGER' && hasExecutives && (me.level === 'SUPER' || me.node.id === node.node.id),
        createdAt: r.createdAt.toISOString(),
      });
    }
    return out;
  }
}
