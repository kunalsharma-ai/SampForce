import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import {
  TARGET_METRIC_LABEL,
  type TargetCreateInput,
  type TargetDistributeInput,
  targetEnd,
  type TargetMetric,
  type TargetPeriod,
  type TargetRow,
  type TargetsView,
  type TargetUpdateInput,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { Metrics, r2 } from '../command-center/metrics';
import { RevenueRecordsService } from '../crm/revenue-records.service';
import { NotificationsService } from '../notifications/notifications.service';
import { loadRates } from '../revenue/fx';
import { branchUserIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { HierarchyError } from '../workspaces/workspaces.service';
import { assertAction, callerOf, handsDownTo, may, type Org, peopleIn, refOf, visibleNodeIds } from './hierarchy';

type Stored = Prisma.WorkspaceTargetGetPayload<object>;
const FEATURE = 'sales_target_management' as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Target not found.' });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const lastDay = (end: Date) => iso(new Date(end.getTime() - 86_400_000));

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
      const visible = visibleNodeIds(me, org);
      const rows = await tx.workspaceTarget.findMany({ where: { tenantId: auth.tenantId, archivedAt: null, workspaceNodeId: { in: [...visible] } }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'asc' }], take: 500 });
      const ctx = await this.context(tx, auth);
      const assignable = may(me, FEATURE, 'assign') ? [...org.byId.values()].filter((a) => handsDownTo(me, a, org)) : [];
      return {
        targets: await this.rows(tx, auth, org, me, rows, ctx),
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
      const updated = await tx.workspaceTarget.update({ where: { id }, data: { ...(input.amount !== undefined ? { amount: input.amount } : {}), ...(input.note !== undefined ? { note: input.note || null } : {}) } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'target.updated', entityType: 'workspace_target', entityId: id,
        metadata: { amountFrom: row.amount, amountTo: updated.amount, ...(input.note !== undefined ? { note: updated.note } : {}) }, meta,
      });
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
    if (!handsDownTo(me, node, org)) throw new HierarchyError('WORKSPACE_ADMIN_FORBIDDEN', 'Only the workspace above this one can manage it.');
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
    return { orgName: tenant.name, currency: tenant.defaultCurrency, rates: null as Awaited<ReturnType<typeof loadRates>> | null };
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

  private async rows(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, rows: Stored[], ctx: Awaited<ReturnType<TargetsService['context']>>): Promise<TargetRow[]> {
    if (!rows.length) return [];
    if (rows.some((r) => r.metric === 'REVENUE' || r.metric === 'DEALS_WON')) await this.revenue.reconcile(tx, auth.tenantId);
    const setters = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.setById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const setterName = new Map(setters.map((u) => [u.id, u.name]));
    const parts = await tx.workspaceTarget.findMany({ where: { tenantId: auth.tenantId, parentTargetId: { in: rows.map((r) => r.id) }, archivedAt: null }, select: { parentTargetId: true, amount: true } });
    const partsOf = new Map<string, number>();
    for (const p of parts) partsOf.set(p.parentTargetId!, (partsOf.get(p.parentTargetId!) ?? 0) + p.amount);
    const usersOf = new Map<string, string[]>();
    const achieved = new Map<string, number>();
    const canAssign = may(me, FEATURE, 'assign');

    const out: TargetRow[] = [];
    for (const r of rows) {
      const node = org.byId.get(r.workspaceNodeId);
      if (!node) continue;
      if (!usersOf.has(node.node.id)) usersOf.set(node.node.id, await branchUserIds(tx, auth.tenantId, node.node.id));
      const key = `${node.node.id}|${r.metric}|${r.startsAt.getTime()}|${r.endsAt.getTime()}`;
      if (!achieved.has(key)) achieved.set(key, await this.achievement(tx, auth, ctx, usersOf.get(node.node.id)!, r.metric as TargetMetric, r.startsAt, r.endsAt));
      const got = achieved.get(key)!;
      const hasExecutives = [...org.byId.values()].some((a) => a.level === 'EXECUTIVE' && a.node.parentId === node.node.id && !a.node.archivedAt);
      out.push({
        id: r.id,
        metric: r.metric as TargetMetric,
        period: r.period as TargetPeriod,
        startsOn: iso(r.startsAt),
        endsOn: lastDay(r.endsAt),
        amount: r.amount,
        currency: r.metric === 'REVENUE' ? ctx.currency : null,
        note: r.note,
        workspace: refOf(node, org, ctx.orgName),
        setBy: r.setById ? { id: r.setById, name: setterName.get(r.setById) ?? '' } : null,
        source: r.setByLevel === 'SUPER' ? 'SUPER' : 'MANAGER',
        parentTargetId: r.parentTargetId,
        achieved: got,
        percent: r.amount > 0 ? Math.round((got / r.amount) * 1000) / 10 : 0,
        distributed: r2(partsOf.get(r.id) ?? 0),
        editable: canAssign && handsDownTo(me, node, org),
        canDistribute: canAssign && node.level === 'MANAGER' && hasExecutives && (me.level === 'SUPER' || me.node.id === node.node.id),
        createdAt: r.createdAt.toISOString(),
      });
    }
    return out;
  }

  /** What the people counted reached in [start, end): companies they created, calls they logged, deals and revenue credited to them. */
  private async achievement(tx: TenantTx, auth: AuthContext, ctx: Awaited<ReturnType<TargetsService['context']>>, users: string[], metric: TargetMetric, start: Date, end: Date): Promise<number> {
    if (!users.length) return 0;
    if (metric === 'CALLS') {
      return tx.activity.count({
        where: {
          tenantId: auth.tenantId, deletedAt: null, ownerId: { in: users }, occurredAt: { gte: start, lt: end },
          OR: [{ interaction: { in: ['CALL_OUTGOING', 'CALL_INCOMING'] } }, { AND: [{ OR: [{ interaction: null }, { interaction: { isSet: false } }] }, { type: 'CALL' }] }],
        },
      });
    }
    ctx.rates ??= await loadRates(tx, auth.tenantId);
    const now = new Date();
    const m = new Metrics(tx, { tenantId: auth.tenantId, users, start, end, now, todayStart: now, tomorrowStart: now }, ctx.currency, ctx.rates);
    if (metric === 'LEADS') return (await m.leadsGenerated()).length;
    const rev = await m.revenue();
    return metric === 'REVENUE' ? r2(rev.amount) : rev.deals;
  }
}
