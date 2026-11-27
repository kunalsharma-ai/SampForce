import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { beforeCommit, type Prisma, type TenantTx } from '@dealflow/database';
import {
  planLastDay,
  runningStatus,
  TASK_CADENCE_LABEL,
  TARGET_METRIC_LABEL,
  type TaskCadence,
  type TaskInstanceRow,
  type TaskPlanCancelInput,
  type TaskPlanCreateInput,
  taskPlanCreateSchema,
  type TaskPlanDetail,
  type TaskPlanRevision,
  type TaskPlanRow,
  type TaskPlansView,
  type TaskPlanStatus,
  type TaskPlanUpdateInput,
  type TaskRequirement,
  type TaskStatus,
  type WorkPerson,
  type WorkspaceRef,
} from '@dealflow/types';
import { AchievementsService } from '../achievements/achievements.service';
import { AuditService } from '../audit/audit.service';
import { currentAutomationScope } from '../automation/automation-context';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { errorMessage, scanTenants } from '../worker/queue';
import { SlicedSweep } from '../worker/sliced-sweep';
import { branchUserIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { assertAction, callerOf, handsDownTo, may, type Org, refOf } from '../workspace-work/hierarchy';
import { addDays, dayStart, localDay } from './calendar';
import { TaskPlanEngine, itemsOf, requirementsOf, type InstanceRow, type PlanRow } from './engine';

const FEATURE = 'task_management' as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found.' });
/** Business actions that can move a running task: the person's own instances are counted again before the change commits. */
const WATCHED = new Set(['company.created', 'contact.created', 'deal.created', 'deal.stage_changed', 'company.won', 'activity.logged', 'email.sent', 'call.logged', 'task.completed', 'rfq.created']);
const describe = (rs: TaskRequirement[]) => rs.map((r) => `${r.amount} ${TARGET_METRIC_LABEL[r.metric].toLowerCase()} ${TASK_CADENCE_LABEL[r.per].toLowerCase()}`).join(', ');

/**
 * Recurring task plans (ADR 0096). Anyone may give themselves a task; a manager gives tasks to its Executive
 * Workspaces and the Super Workspace to anyone below it, as long as their workspace may assign in Task management.
 * The plan's creator, and the Super Workspace, may change, pause, cancel or delete it.
 */
@Injectable()
export class TaskPlansService implements OnModuleInit {
  private readonly log = new Logger(TaskPlansService.name);
  private readonly sweeper = new SlicedSweep(60_000, 3_000);
  private readonly pending = new WeakMap<TenantTx, { tenantId: string; users: Set<string> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly achievements: AchievementsService,
  ) {}

  private engine(tx: TenantTx, tenantId: string): TaskPlanEngine {
    return new TaskPlanEngine(tx, tenantId, this.notifications, (t, id, found) => this.achievements.award(t, id, found));
  }

  // ─── Counting as people work ───

  onModuleInit(): void {
    this.audit.observe((tx, entry) => {
      if (!WATCHED.has(entry.action) || !entry.actorUserId) return;
      if (currentAutomationScope() || (entry.actorType && entry.actorType !== 'USER')) return;
      const batch = this.pending.get(tx);
      if (batch) {
        batch.users.add(entry.actorUserId);
        return;
      }
      const fresh = { tenantId: entry.tenantId, users: new Set([entry.actorUserId]) };
      this.pending.set(tx, fresh);
      const run = async (t: TenantTx) => {
        this.pending.delete(tx);
        try {
          await this.refreshPeople(t, fresh.tenantId, [...fresh.users]);
        } catch (err) {
          this.log.warn({ err: errorMessage(err), tenantId: fresh.tenantId }, 'task progress check failed');
        }
      };
      if (!beforeCommit(run)) void run(tx);
    });
  }

  /** Counts the running instances of these people again (completes them the moment the numbers are reached). */
  private async refreshPeople(tx: TenantTx, tenantId: string, users: string[]): Promise<void> {
    const engine = this.engine(tx, tenantId);
    const open = await tx.taskPlanInstance.findMany({ where: { tenantId, userId: { in: users }, status: 'OPEN', startsAt: { lte: engine.now } }, take: 100 });
    if (!open.length) return;
    const plans = await this.plansById(tx, tenantId, open.map((i) => i.planId));
    for (const i of open) {
      const plan = plans.get(i.planId);
      if (plan) await engine.refresh(i, plan);
    }
  }

  private async plansById(tx: TenantTx, tenantId: string, ids: string[]): Promise<Map<string, PlanRow>> {
    const rows = await tx.taskPlan.findMany({ where: { tenantId, id: { in: [...new Set(ids)] } } });
    return new Map(rows.map((p) => [p.id, p]));
  }

  // ─── The worker ───

  /** Makes today's instances, counts the running ones, closes the ended ones and sends reminders, in every organisation. */
  sweep(force = false): Promise<number> {
    return this.sweeper.run(
      force,
      async () => [...new Set([...(await scanTenants(this.prisma.taskPlan, { status: { in: ['ACTIVE', 'PAUSED'] } })), ...(await scanTenants(this.prisma.taskPlanInstance, { status: 'OPEN' }))])],
      async (tenantId) => {
        try {
          await this.prisma.run({ tenantId }, (tx) => this.runTenant(tx, tenantId));
        } catch (err) {
          this.log.error({ err: errorMessage(err), tenantId }, 'recurring task sweep failed');
        }
      },
    );
  }

  /** One organisation's pass. Exposed for tests (with a chosen time) and the sweep. */
  async runTenant(tx: TenantTx, tenantId: string, now?: Date): Promise<void> {
    const engine = new TaskPlanEngine(tx, tenantId, this.notifications, (t, id, found) => this.achievements.award(t, id, found), now);
    const plans = await tx.taskPlan.findMany({ where: { tenantId, status: 'ACTIVE' }, take: 2000 });
    await engine.ensure(plans);
    const open = await tx.taskPlanInstance.findMany({ where: { tenantId, status: 'OPEN', startsAt: { lte: engine.now } }, take: 5000 });
    const byId = await this.plansById(tx, tenantId, open.map((i) => i.planId));
    for (const i of open) await engine.refresh(i, byId.get(i.planId) ?? (null as unknown as PlanRow));
  }

  // ─── Reading ───

  view(auth: AuthContext): Promise<TaskPlansView> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'view');
      const engine = this.engine(tx, auth.tenantId);
      const team = await this.teamUsers(tx, auth, org, me);
      const plans = await tx.taskPlan.findMany({
        where: { tenantId: auth.tenantId, OR: [{ assigneeIds: { has: auth.userId } }, { createdById: auth.userId }, ...(team.length ? [{ assigneeIds: { hasSome: team } }] : [])] },
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
      const byId = new Map(plans.map((p) => [p.id, p]));
      // Make sure what should be running exists, and count it, before showing it.
      await engine.ensure(plans);
      const running = await tx.taskPlanInstance.findMany({
        where: { tenantId: auth.tenantId, planId: { in: plans.map((p) => p.id) }, startsAt: { lte: engine.now }, endsAt: { gt: engine.now }, status: { not: 'CANCELLED' } },
        take: 1000,
      });
      const mineNow: InstanceRow[] = [];
      const teamNow: InstanceRow[] = [];
      let refreshedTeam = 0;
      for (const i of running) {
        const plan = byId.get(i.planId)!;
        if (i.userId === auth.userId) mineNow.push(await engine.refresh(i, plan));
        else if (team.includes(i.userId)) teamNow.push(refreshedTeam++ < 60 ? await engine.refresh(i, plan) : i);
      }
      // Anything of mine whose period ended without being closed yet is closed now.
      const ended = await tx.taskPlanInstance.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId, status: 'OPEN', endsAt: { lte: engine.now } }, take: 50 });
      for (const i of ended) await engine.finalize(i, byId.get(i.planId) ?? null);

      const names = await this.names(tx, [...new Set([...plans.flatMap((p) => [...p.assigneeIds, p.createdById]), ...running.map((r) => r.userId)])]);
      const today = await this.instanceRows(tx, auth.tenantId, engine, mineNow, byId, names);
      const order = (r: TaskInstanceRow) => (r.status === 'COMPLETED' ? 1 : 0);
      const ctx = await this.ctx(tx, auth, org);
      const planRows = await this.planRows(tx, auth, org, me, plans, names, ctx);
      return {
        today: today.sort((a, b) => order(a) - order(b) || a.endsAt.localeCompare(b.endsAt)),
        bestStreak: Math.max(0, ...today.filter((r) => r.cadence === 'DAY').map((r) => r.streak)),
        mine: planRows.filter((p) => p.assignees.some((a) => a.id === auth.userId)),
        team: planRows.filter((p) => !p.assignees.some((a) => a.id === auth.userId) || p.assignees.length > 1),
        teamToday: (await this.instanceRows(tx, auth.tenantId, engine, teamNow, byId, names)).sort((a, b) => a.person.name.localeCompare(b.person.name) || a.title.localeCompare(b.title)),
        assignable: await this.assignable(tx, auth, org, me, ctx.orgName),
        timeZone: await engine.timeZone(),
      };
    });
  }

  detail(auth: AuthContext, id: string): Promise<TaskPlanDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'view');
      const plan = await this.visiblePlan(tx, auth, org, me, id);
      return this.detailOf(tx, auth, org, me, plan);
    });
  }

  // ─── Changing ───

  create(auth: AuthContext, input: TaskPlanCreateInput, meta: RequestMeta): Promise<TaskPlanDetail> {
    const v = taskPlanCreateSchema.parse(input);
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'view');
      const engine = this.engine(tx, auth.tenantId);
      const today = await engine.today();
      if (v.startsOn < today) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A task starts today or later.' });
      const assignees = [...new Set(v.assigneeIds)];
      await this.assertAssignable(tx, auth, org, me, assignees);
      const endsOn = planLastDay(v.duration, v.startsOn, v.endsOn);
      const plan = await tx.taskPlan.create({
        data: {
          tenantId: auth.tenantId, title: v.title, note: v.note || null, requirements: v.requirements as unknown as Prisma.InputJsonValue, duration: v.duration,
          startsOn: v.startsOn, endsOn, workingDays: v.workingDays, skipDates: v.skipDates, assigneeIds: assignees, status: 'ACTIVE',
          createdById: auth.userId, createdByNodeId: me.virtual ? null : me.node.id,
          revisions: [{ at: new Date().toISOString(), byId: auth.userId, kind: 'created', changes: [] }] as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task_plan.created', entityType: 'task_plan', entityId: plan.id,
        metadata: { title: plan.title, requirements: describe(v.requirements), startsOn: plan.startsOn, endsOn: plan.endsOn, assignees: assignees.length }, meta,
      });
      await this.notifications.send(tx, auth.tenantId, assignees.filter((u) => u !== auth.userId), {
        type: 'daily_task.assigned', title: `New recurring task: ${plan.title}`, body: `From ${plan.startsOn} to ${plan.endsOn}.`, link: `/app/tasks?plan=${plan.id}`,
        eventId: `task-plan:${plan.id}:assigned`, senderId: auth.userId, actionRequired: true,
      });
      await engine.ensure([plan]);
      return this.detailOf(tx, auth, org, me, plan);
    });
  }

  update(auth: AuthContext, id: string, input: TaskPlanUpdateInput, meta: RequestMeta): Promise<TaskPlanDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const plan = await this.managedPlan(tx, auth, org, me, id);
      if (plan.status === 'CANCELLED') throw new ConflictException({ code: 'TASK_PLAN_CANCELLED', message: 'A cancelled task cannot be changed.' });
      const engine = this.engine(tx, auth.tenantId);
      const today = await engine.today();
      const changes: TaskPlanRevision['changes'] = [];
      const data: Prisma.TaskPlanUpdateInput = {};
      const note = (field: string, from: unknown, to: unknown) => changes.push({ field, from: from == null ? null : String(from), to: to == null ? null : String(to) });

      if (input.title !== undefined && input.title !== plan.title) {
        note('title', plan.title, input.title);
        data.title = input.title;
      }
      if (input.note !== undefined && (input.note || null) !== plan.note) {
        note('note', plan.note, input.note || null);
        data.note = input.note || null;
      }
      const before = requirementsOf(plan);
      const after = input.requirements ?? before;
      if (input.requirements && describe(before) !== describe(after)) {
        note('requirements', describe(before), describe(after));
        data.requirements = after as unknown as Prisma.InputJsonValue;
      }
      let endsOn = plan.endsOn;
      if (input.endsOn !== undefined && input.endsOn !== plan.endsOn) {
        if (input.endsOn < today || input.endsOn < plan.startsOn) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The last day cannot be before today or before the first day.' });
        if (Date.parse(input.endsOn) - Date.parse(plan.startsOn) > 366 * 86_400_000) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A task can run for at most a year.' });
        note('endsOn', plan.endsOn, input.endsOn);
        data.endsOn = endsOn = input.endsOn;
        data.duration = 'CUSTOM';
      }
      if (input.workingDays && input.workingDays.join() !== plan.workingDays.join()) {
        note('workingDays', plan.workingDays.join(','), input.workingDays.join(','));
        data.workingDays = input.workingDays;
      }
      if (input.skipDates && input.skipDates.join() !== plan.skipDates.join()) {
        note('skipDates', plan.skipDates.join(', ') || null, input.skipDates.join(', ') || null);
        data.skipDates = input.skipDates;
      }
      const removed = (input.removeAssigneeIds ?? []).filter((u) => plan.assigneeIds.includes(u));
      const added = [...new Set((input.addAssigneeIds ?? []).filter((u) => !plan.assigneeIds.includes(u)))];
      if (added.length) await this.assertAssignable(tx, auth, org, me, added);
      const assignees = [...plan.assigneeIds.filter((u) => !removed.includes(u)), ...added];
      if (added.length || removed.length) {
        if (!assignees.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A task needs at least one person. Cancel it instead.' });
        const names = await this.names(tx, [...added, ...removed]);
        note('assignees', removed.map((u) => names.get(u)?.name ?? u).join(', ') || null, added.map((u) => names.get(u)?.name ?? u).join(', ') || null);
        data.assigneeIds = assignees;
      }
      if (!changes.length) return this.detailOf(tx, auth, org, me, plan);

      const revisions = this.revisionsOf(plan);
      revisions.push({ at: new Date().toISOString(), byId: auth.userId, kind: 'updated', changes });
      data.revisions = revisions.slice(-200) as unknown as Prisma.InputJsonValue;
      const updated = await tx.taskPlan.update({ where: { id }, data });

      // From now on: the running instances take the new numbers; finished ones keep theirs.
      const open = await tx.taskPlanInstance.findMany({ where: { tenantId: auth.tenantId, planId: id, status: 'OPEN' } });
      const endOfPlan = dayStart(addDays(endsOn, 1), await engine.timeZone());
      for (const i of open) {
        const asked = after.filter((r) => r.per === i.cadence);
        if (removed.includes(i.userId) || !asked.length || i.startsAt >= endOfPlan) {
          await tx.taskPlanInstance.update({ where: { id: i.id }, data: { status: 'CANCELLED', finalizedAt: new Date() } });
          continue;
        }
        if (data.requirements) {
          const done = new Map(itemsOf(i).map((x) => [x.metric, x.done]));
          await tx.taskPlanInstance.update({ where: { id: i.id }, data: { requirements: asked.map((r) => ({ metric: r.metric, amount: r.amount, done: done.get(r.metric) ?? 0 })) as unknown as Prisma.InputJsonValue } });
        }
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task_plan.updated', entityType: 'task_plan', entityId: id, metadata: { title: updated.title, changes }, meta });
      const stay = assignees.filter((u) => !added.includes(u) && u !== auth.userId);
      await this.notifications.send(tx, auth.tenantId, stay, {
        type: 'daily_task.updated', title: `Recurring task changed: ${updated.title}`, body: 'The change applies from now on. Finished days keep their numbers.', link: `/app/tasks?plan=${id}`,
        eventId: `task-plan:${id}:updated:${revisions.length}`, senderId: auth.userId,
      });
      await this.notifications.send(tx, auth.tenantId, added.filter((u) => u !== auth.userId), {
        type: 'daily_task.assigned', title: `New recurring task: ${updated.title}`, body: `From ${updated.startsOn} to ${updated.endsOn}.`, link: `/app/tasks?plan=${id}`,
        eventId: `task-plan:${id}:assigned:${revisions.length}`, senderId: auth.userId, actionRequired: true,
      });
      await this.notifications.send(tx, auth.tenantId, removed.filter((u) => u !== auth.userId), {
        type: 'daily_task.updated', title: `Recurring task changed: ${updated.title}`, body: 'You are no longer on this task.', link: '/app/tasks', eventId: `task-plan:${id}:removed:${revisions.length}`, senderId: auth.userId,
      });
      if (updated.status === 'ACTIVE') await engine.ensure([updated]);
      return this.detailOf(tx, auth, org, me, updated);
    });
  }

  setStatus(auth: AuthContext, id: string, to: 'PAUSED' | 'ACTIVE' | 'CANCELLED', input: TaskPlanCancelInput, meta: RequestMeta): Promise<TaskPlanDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const plan = await this.managedPlan(tx, auth, org, me, id);
      if (plan.status === 'CANCELLED') throw new ConflictException({ code: 'TASK_PLAN_CANCELLED', message: 'This task was cancelled.' });
      if (plan.status === to) return this.detailOf(tx, auth, org, me, plan);
      if (to === 'PAUSED' && plan.status !== 'ACTIVE') throw new ConflictException({ code: 'TASK_PLAN_NOT_ACTIVE', message: 'Only an active task can be paused.' });
      const kind = to === 'PAUSED' ? 'paused' : to === 'ACTIVE' ? 'resumed' : 'cancelled';
      const revisions = this.revisionsOf(plan);
      revisions.push({ at: new Date().toISOString(), byId: auth.userId, kind, changes: to === 'CANCELLED' && input.reason ? [{ field: 'reason', from: null, to: input.reason }] : [] });
      const updated = await tx.taskPlan.update({
        where: { id },
        data: {
          status: to,
          revisions: revisions.slice(-200) as unknown as Prisma.InputJsonValue,
          ...(to === 'PAUSED' ? { pausedAt: new Date() } : to === 'ACTIVE' ? { pausedAt: null } : { cancelledAt: new Date(), cancelReason: input.reason || null }),
        },
      });
      // Pausing or cancelling stops what is running now; finished instances stay in the history.
      if (to !== 'ACTIVE') await tx.taskPlanInstance.updateMany({ where: { tenantId: auth.tenantId, planId: id, status: 'OPEN' }, data: { status: 'CANCELLED', finalizedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `task_plan.${kind}`, entityType: 'task_plan', entityId: id, metadata: { title: plan.title, ...(input.reason ? { reason: input.reason } : {}) }, meta });
      const title = to === 'PAUSED' ? `Recurring task paused: ${plan.title}` : to === 'ACTIVE' ? `Recurring task resumed: ${plan.title}` : `Recurring task cancelled: ${plan.title}`;
      await this.notifications.send(tx, auth.tenantId, plan.assigneeIds.filter((u) => u !== auth.userId), {
        type: 'daily_task.updated', title, body: to === 'CANCELLED' ? input.reason || null : null, link: `/app/tasks?plan=${id}`, eventId: `task-plan:${id}:${kind}:${revisions.length}`, senderId: auth.userId,
      });
      if (to === 'ACTIVE') {
        // A paused day was cancelled; resuming the same day brings it back.
        const engine = this.engine(tx, auth.tenantId);
        await tx.taskPlanInstance.updateMany({ where: { tenantId: auth.tenantId, planId: id, status: 'CANCELLED', endsAt: { gt: engine.now }, startsAt: { lte: engine.now }, completedAt: null }, data: { status: 'OPEN', finalizedAt: null } });
        await engine.ensure([updated]);
      }
      return this.detailOf(tx, auth, org, me, updated);
    });
  }

  /** Deletes a task set up by mistake. Once any instance has finished, it can only be cancelled, so history stays. */
  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const plan = await this.managedPlan(tx, auth, org, me, id);
      const finished = await tx.taskPlanInstance.count({ where: { tenantId: auth.tenantId, planId: id, status: { in: ['COMPLETED', 'PARTIALLY_COMPLETED', 'NOT_COMPLETED'] } } });
      if (finished > 0) throw new ConflictException({ code: 'TASK_PLAN_HAS_HISTORY', message: 'This task already has finished days. Cancel it instead, so its history stays.' });
      await tx.taskPlanInstance.deleteMany({ where: { tenantId: auth.tenantId, planId: id } });
      await tx.taskPlan.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task_plan.deleted', entityType: 'task_plan', entityId: id, metadata: { title: plan.title }, meta });
    });
  }

  // ─── Rules ───

  /** People in the workspaces the caller looks after: its whole branch for a manager, everyone for the Super Workspace. */
  private async teamUsers(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess): Promise<string[]> {
    if (me.level === 'EXECUTIVE') return [];
    const users = me.level === 'SUPER' ? (await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, select: { userId: true } })).map((m) => m.userId) : await branchUserIds(tx, auth.tenantId, me.node.id);
    return users.filter((u) => u !== auth.userId);
  }

  private async assertAssignable(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, users: string[]): Promise<void> {
    const others = users.filter((u) => u !== auth.userId);
    if (!others.length) return;
    assertAction(me, FEATURE, 'assign');
    const members = await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', userId: { in: others } }, select: { userId: true, workspaceNodeId: true } });
    for (const u of others) {
      const m = members.find((x) => x.userId === u);
      const node = m?.workspaceNodeId ? org.byId.get(m.workspaceNodeId) : org.root;
      if (!m || !node || !handsDownTo(me, node, org)) throw new BadRequestException({ code: 'INVALID_ASSIGNEE', message: 'You can give tasks only to yourself and the people in the workspaces below yours.' });
    }
  }

  private canManage(auth: AuthContext, me: NodeAccess, plan: PlanRow): boolean {
    return plan.createdById === auth.userId || (me.level === 'SUPER' && may(me, FEATURE, 'assign'));
  }

  private async visiblePlan(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, id: string): Promise<PlanRow> {
    const plan = await tx.taskPlan.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!plan) throw notFound();
    if (plan.createdById === auth.userId || plan.assigneeIds.includes(auth.userId) || me.level === 'SUPER') return plan;
    const team = await this.teamUsers(tx, auth, org, me);
    if (plan.assigneeIds.some((u) => team.includes(u))) return plan;
    throw notFound();
  }

  private async managedPlan(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, id: string): Promise<PlanRow> {
    const plan = await this.visiblePlan(tx, auth, org, me, id);
    if (!this.canManage(auth, me, plan)) throw new ConflictException({ code: 'TASK_PLAN_FORBIDDEN', message: 'Only whoever set this task, or the Super Workspace, can change it.' });
    return plan;
  }

  private revisionsOf(plan: PlanRow): { at: string; byId: string | null; kind: string; changes: TaskPlanRevision['changes'] }[] {
    return Array.isArray(plan.revisions) ? (plan.revisions as unknown as { at: string; byId: string | null; kind: string; changes: TaskPlanRevision['changes'] }[]) : [];
  }

  // ─── Shaping ───

  private async ctx(tx: TenantTx, auth: AuthContext, org: Org) {
    const orgName = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } })).name;
    const members = await tx.membership.findMany({ where: { tenantId: auth.tenantId }, select: { userId: true, workspaceNodeId: true } });
    const nodeOf = new Map(members.map((m) => [m.userId, m.workspaceNodeId ?? null]));
    const workspaceOf = (userId: string): WorkspaceRef | null => {
      const id = nodeOf.get(userId);
      const node = id ? org.byId.get(id) : org.root;
      return node ? refOf(node, org, orgName) : null;
    };
    return { orgName, workspaceOf };
  }

  private async names(tx: TenantTx, ids: string[]): Promise<Map<string, WorkPerson>> {
    const rows = ids.length ? await tx.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } }) : [];
    return new Map(rows.map((u) => [u.id, { id: u.id, name: u.name }]));
  }

  private async assignable(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, orgName: string): Promise<TaskPlansView['assignable']> {
    const self = (await this.names(tx, [auth.userId])).get(auth.userId) ?? { id: auth.userId, name: '' };
    const out: TaskPlansView['assignable'] = [{ ...self, workspace: refOf(me, org, orgName), self: true }];
    if (!may(me, FEATURE, 'assign')) return out;
    const members = await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', userId: { not: auth.userId } }, include: { user: { select: { id: true, name: true } } }, take: 500 });
    for (const m of members) {
      const node = m.workspaceNodeId ? org.byId.get(m.workspaceNodeId) : org.root;
      if (node && handsDownTo(me, node, org)) out.push({ id: m.user.id, name: m.user.name, workspace: refOf(node, org, orgName), self: false });
    }
    return out.sort((a, b) => Number(b.self) - Number(a.self) || (a.workspace?.name ?? '').localeCompare(b.workspace?.name ?? '') || a.name.localeCompare(b.name));
  }

  private status(plan: PlanRow, today: string): TaskPlanStatus {
    if (plan.status === 'CANCELLED' || plan.status === 'PAUSED') return plan.status;
    return today > plan.endsOn ? 'ENDED' : 'ACTIVE';
  }

  private async planRows(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, plans: PlanRow[], names: Map<string, WorkPerson>, ctx: Awaited<ReturnType<TaskPlansService['ctx']>>): Promise<TaskPlanRow[]> {
    if (!plans.length) return [];
    const today = await this.engine(tx, auth.tenantId).today();
    const counts = await tx.taskPlanInstance.groupBy({ by: ['planId', 'status'], where: { tenantId: auth.tenantId, planId: { in: plans.map((p) => p.id) } }, _count: { _all: true } });
    const total = (planId: string, status: string) => counts.find((c) => c.planId === planId && c.status === status)?._count._all ?? 0;
    return plans.map((p) => ({
      id: p.id,
      title: p.title,
      note: p.note,
      requirements: requirementsOf(p),
      duration: p.duration as TaskPlanRow['duration'],
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      workingDays: p.workingDays,
      skipDates: p.skipDates,
      status: this.status(p, today),
      cancelReason: p.cancelReason,
      assignees: p.assigneeIds.map((u) => ({ ...(names.get(u) ?? { id: u, name: '' }), workspace: ctx.workspaceOf(u) })),
      createdBy: names.get(p.createdById) ?? null,
      createdAt: p.createdAt.toISOString(),
      totals: { completed: total(p.id, 'COMPLETED'), partial: total(p.id, 'PARTIALLY_COMPLETED'), missed: total(p.id, 'NOT_COMPLETED'), running: total(p.id, 'OPEN') },
      canManage: this.canManage(auth, me, p),
    }));
  }

  private async instanceRows(tx: TenantTx, tenantId: string, engine: TaskPlanEngine, rows: InstanceRow[], plans: Map<string, PlanRow>, names: Map<string, WorkPerson>): Promise<TaskInstanceRow[]> {
    const tz = await engine.timeZone();
    const out: TaskInstanceRow[] = [];
    for (const i of rows) {
      const plan = plans.get(i.planId);
      if (!plan) continue;
      out.push(this.instanceRow(i, plan, names, tz, i.cadence === 'DAY' || i.status === 'COMPLETED' ? await engine.streak(i.planId, i.userId, i.cadence) : 0, engine.now));
    }
    return out;
  }

  private instanceRow(i: InstanceRow, plan: PlanRow, names: Map<string, WorkPerson>, tz: string, streak: number, now: Date): TaskInstanceRow {
    const items = itemsOf(i);
    const status: TaskStatus = i.status === 'OPEN' ? (now >= i.endsAt ? (items.some((x) => x.done > 0) ? 'PARTIALLY_COMPLETED' : 'NOT_COMPLETED') : runningStatus(i.percent)) : (i.status as TaskStatus);
    return {
      id: i.id,
      planId: i.planId,
      title: plan.title,
      cadence: i.cadence as TaskCadence,
      startsOn: localDay(i.startsAt, tz),
      endsOn: localDay(new Date(i.endsAt.getTime() - 1), tz),
      endsAt: i.endsAt.toISOString(),
      status,
      percent: i.percent,
      requirements: items.map((x) => ({ metric: x.metric, per: i.cadence as TaskCadence, amount: x.amount, done: x.done, remaining: Math.max(0, x.amount - x.done), percent: Math.floor((x.done / x.amount) * 1000) / 10 })),
      completedAt: i.completedAt?.toISOString() ?? null,
      person: names.get(i.userId) ?? { id: i.userId, name: '' },
      streak,
    };
  }

  private async detailOf(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, plan: PlanRow): Promise<TaskPlanDetail> {
    const engine = this.engine(tx, auth.tenantId);
    const tz = await engine.timeZone();
    const instances = await tx.taskPlanInstance.findMany({ where: { tenantId: auth.tenantId, planId: plan.id }, orderBy: [{ periodKey: 'desc' }, { cadence: 'asc' }], take: 400 });
    const revisions = this.revisionsOf(plan);
    const names = await this.names(tx, [...plan.assigneeIds, plan.createdById, ...instances.map((i) => i.userId), ...revisions.map((r) => r.byId).filter((x): x is string => !!x)]);
    const ctx = await this.ctx(tx, auth, org);
    const [row] = await this.planRows(tx, auth, org, me, [plan], names, ctx);
    // Streaks from the oldest instance up, per person and cadence.
    const run = new Map<string, number>();
    const streakOf = new Map<string, number>();
    for (const i of [...instances].reverse()) {
      const k = `${i.userId}|${i.cadence}`;
      const n = i.status === 'COMPLETED' ? (run.get(k) ?? 0) + 1 : i.status === 'OPEN' ? (run.get(k) ?? 0) : 0;
      run.set(k, n);
      streakOf.set(i.id, n);
    }
    return {
      ...row!,
      revisions: [...revisions].reverse().map((r) => ({ at: r.at, by: r.byId ? (names.get(r.byId) ?? null) : null, kind: r.kind, changes: r.changes })),
      instances: instances.map((i) => this.instanceRow(i, plan, names, tz, streakOf.get(i.id) ?? 0, engine.now)),
    };
  }
}

