import type { Prisma, TenantTx } from '@dealflow/database';
import { createManySkipDuplicates } from '@dealflow/database';
import {
  overallPercent,
  type SuperTaskNotices,
  type TaskCadence,
  type TaskMeasure,
  type TaskRequirement,
  TASK_CADENCES,
} from '@dealflow/types';
import type { Candidate } from '../achievements/detector';
import { NotificationsService } from '../notifications/notifications.service';
import { Measures } from '../workspace-work/measures';
import { resolveOrganisation } from '../workspaces/access';
import { peopleIn } from '../workspace-work/hierarchy';
import { addDays, dayStart, localDay, localHour, periodOf } from './calendar';

export type PlanRow = Prisma.TaskPlanGetPayload<object>;
export type InstanceRow = Prisma.TaskPlanInstanceGetPayload<object>;
export interface Item {
  metric: TaskMeasure;
  amount: number;
  done: number;
}

export const itemsOf = (i: { requirements: Prisma.JsonValue }): Item[] => (Array.isArray(i.requirements) ? (i.requirements as unknown as Item[]) : []);
export const requirementsOf = (p: { requirements: Prisma.JsonValue }): TaskRequirement[] => (Array.isArray(p.requirements) ? (p.requirements as unknown as TaskRequirement[]) : []);

/** Local hours when a running daily task reminds its person: the morning list, then two nudges while unfinished. */
const REMINDERS: { key: string; hour: number }[] = [
  { key: 'today', hour: 8 },
  { key: 'r12', hour: 12 },
  { key: 'r16', hour: 16 },
];

/** The achievement pop-up for an instance (ADR 0090 celebrations, shown once in one tab). */
export type Award = (tx: TenantTx, tenantId: string, found: Candidate[]) => Promise<void>;

/**
 * The recurring task engine (ADR 0096). It makes the instances that should exist now, counts them from the records,
 * marks them complete as soon as every number is reached and closes them when their period ends. Each notification
 * is noted on the instance, so a retry, a second worker or a refresh never sends it twice.
 */
export class TaskPlanEngine {
  private tz: string | null = null;
  private superNotices: SuperTaskNotices | null = null;
  private org: Awaited<ReturnType<typeof resolveOrganisation>> | null = null;
  private readonly measures: Measures;
  readonly now: Date;

  constructor(
    private readonly tx: TenantTx,
    private readonly tenantId: string,
    private readonly notifications: NotificationsService,
    private readonly award: Award,
    now = new Date(),
  ) {
    this.measures = new Measures(tx, tenantId);
    this.now = now;
  }

  async timeZone(): Promise<string> {
    this.tz ??= (await this.tx.tenant.findUniqueOrThrow({ where: { id: this.tenantId }, select: { defaultTimezone: true } })).defaultTimezone || 'UTC';
    return this.tz;
  }

  async today(): Promise<string> {
    return localDay(this.now, await this.timeZone());
  }

  // ─── Making instances ───

  /** Creates the instances that should be running now for the plans' people (no-op when they exist). */
  async ensure(plans: PlanRow[], onlyUser?: string): Promise<void> {
    const tz = await this.timeZone();
    const today = await this.today();
    const active = await this.activeMembers(plans.flatMap((p) => p.assigneeIds));
    const rows: Prisma.TaskPlanInstanceCreateManyInput[] = [];
    for (const p of plans) {
      if (p.status !== 'ACTIVE') continue;
      const reqs = requirementsOf(p);
      for (const cadence of TASK_CADENCES) {
        const asked = reqs.filter((r) => r.per === cadence);
        if (!asked.length) continue;
        const period = periodOf(cadence, today, p);
        if (!period) continue;
        for (const userId of p.assigneeIds) {
          if (onlyUser && userId !== onlyUser) continue;
          if (!active.has(userId)) continue;
          rows.push({
            tenantId: this.tenantId, planId: p.id, userId, cadence, periodKey: period.first,
            startsAt: dayStart(period.first, tz), endsAt: dayStart(addDays(period.last, 1), tz),
            requirements: asked.map((r) => ({ metric: r.metric, amount: r.amount, done: 0 })) as unknown as Prisma.InputJsonValue,
            percent: 0, status: 'OPEN', notified: [],
          });
        }
      }
    }
    if (rows.length) await createManySkipDuplicates(this.tx.taskPlanInstance, 'TaskPlanInstance', rows);
  }

  private async activeMembers(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.tx.membership.findMany({ where: { tenantId: this.tenantId, status: 'ACTIVE', userId: { in: [...new Set(ids)] } }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  // ─── Counting ───

  /** Counts a running instance again, completes it when everything is reached, and sends what is due. */
  async refresh(instance: InstanceRow, plan: PlanRow): Promise<InstanceRow> {
    if (instance.status !== 'OPEN') return instance;
    if (this.now >= instance.endsAt) return this.finalize(instance, plan);
    const items = await this.count(instance);
    const percent = overallPercent(items);
    const notified = new Set(instance.notified);
    const done = items.every((r) => r.done >= r.amount);
    const data: Prisma.TaskPlanInstanceUpdateInput = { requirements: items as unknown as Prisma.InputJsonValue, percent };
    if (done) {
      data.status = 'COMPLETED';
      data.completedAt = this.now;
    }
    const sends: (() => Promise<void>)[] = [];
    if (done && !notified.has('done')) {
      notified.add('done');
      sends.push(() => this.completed(instance, plan, items));
    } else if (!done && percent >= 50 && !notified.has('half')) {
      notified.add('half');
      sends.push(() => this.halfway(instance, plan, items, percent));
    }
    if (!done && plan.status === 'ACTIVE') {
      const tz = await this.timeZone();
      const hour = localHour(this.now, tz);
      if (instance.cadence === 'DAY') {
        // Only the latest reminder that is due: someone signing in at 17:00 gets one, not three.
        const due = [...REMINDERS].reverse().find((r) => hour >= r.hour);
        if (due && !notified.has(due.key) && !(due.key !== 'today' && percent >= 100)) {
          for (const r of REMINDERS) if (r.hour <= due.hour) notified.add(r.key);
          sends.push(() => this.remind(instance, plan, due.key, percent));
        }
      } else if (localDay(new Date(instance.endsAt.getTime() - 1), tz) === localDay(this.now, tz) && hour >= 9 && !notified.has('last-day')) {
        notified.add('last-day');
        sends.push(() => this.remind(instance, plan, 'last-day', percent));
      }
    }
    data.notified = [...notified];
    // Claim the change only if nobody else changed the instance meanwhile, so two workers never both notify.
    const claimed = await this.tx.taskPlanInstance.updateMany({ where: { id: instance.id, status: 'OPEN', updatedAt: instance.updatedAt }, data: data as Prisma.TaskPlanInstanceUpdateManyMutationInput });
    if (claimed.count === 1) for (const s of sends) await s();
    return (await this.tx.taskPlanInstance.findUnique({ where: { id: instance.id } })) ?? instance;
  }

  /** Closes an instance whose period has ended: completed, partially completed or not completed. */
  async finalize(instance: InstanceRow, plan: PlanRow | null): Promise<InstanceRow> {
    if (instance.status !== 'OPEN') return instance;
    const items = await this.count(instance);
    const percent = overallPercent(items);
    const done = items.every((r) => r.done >= r.amount);
    const status = done ? 'COMPLETED' : items.some((r) => r.done > 0) ? 'PARTIALLY_COMPLETED' : 'NOT_COMPLETED';
    const notified = new Set(instance.notified);
    const tell = !notified.has(done ? 'done' : 'missed');
    notified.add(done ? 'done' : 'missed');
    const claimed = await this.tx.taskPlanInstance.updateMany({
      where: { id: instance.id, status: 'OPEN', updatedAt: instance.updatedAt },
      data: { requirements: items as unknown as Prisma.InputJsonValue, percent, status, finalizedAt: this.now, ...(done ? { completedAt: instance.endsAt } : {}), notified: [...notified] },
    });
    if (claimed.count === 1 && tell && plan && plan.status !== 'CANCELLED') {
      if (done) await this.completed(instance, plan, items);
      else await this.missed(instance, plan, percent);
    }
    return (await this.tx.taskPlanInstance.findUnique({ where: { id: instance.id } })) ?? instance;
  }

  private async count(instance: InstanceRow): Promise<Item[]> {
    const end = new Date(Math.min(instance.endsAt.getTime(), this.now.getTime() + 1));
    const out: Item[] = [];
    for (const r of itemsOf(instance)) out.push({ metric: r.metric, amount: r.amount, done: await this.measures.count(r.metric, [instance.userId], instance.startsAt, end) });
    return out;
  }

  /** Consecutive completed instances of the plan for the person, ending with this one (or the one before, if it runs). */
  async streak(planId: string, userId: string, cadence: string): Promise<number> {
    const recent = await this.tx.taskPlanInstance.findMany({ where: { tenantId: this.tenantId, planId, userId, cadence }, orderBy: { periodKey: 'desc' }, take: 400, select: { status: true } });
    let n = 0;
    for (const [i, r] of recent.entries()) {
      if (r.status === 'COMPLETED') n++;
      else if (i === 0 && r.status === 'OPEN') continue;
      else break;
    }
    return n;
  }

  // ─── Who hears about it ───

  private async orgOf() {
    this.org ??= await resolveOrganisation(this.tx, this.tenantId);
    return this.org;
  }

  private async superSetting(): Promise<SuperTaskNotices> {
    this.superNotices ??= ((await this.tx.performanceSettings.findUnique({ where: { tenantId: this.tenantId }, select: { superTaskNotices: true } }))?.superTaskNotices as SuperTaskNotices | undefined) ?? 'ALL';
    return this.superNotices;
  }

  /** The person's reporting manager(s) and whoever set the task; the Super Workspace too, if its setting asks for this. */
  private async watchers(plan: PlanRow, userId: string, kind: 'done' | 'missed' | 'half'): Promise<string[]> {
    const org = await this.orgOf();
    const out = new Set<string>([plan.createdById]);
    const member = await this.tx.membership.findFirst({ where: { tenantId: this.tenantId, userId, status: 'ACTIVE' }, select: { workspaceNodeId: true } });
    const node = member?.workspaceNodeId ? org.byId.get(member.workspaceNodeId) : null;
    const parent = node?.node.parentId ? org.byId.get(node.node.parentId) : null;
    if (parent && parent.level === 'MANAGER') for (const p of await peopleIn(this.tx, this.tenantId, parent, org)) out.add(p.id);
    const notices = await this.superSetting();
    if (kind !== 'half' && (notices === 'ALL' || (notices === 'MISSED_ONLY' && kind === 'missed'))) for (const p of await peopleIn(this.tx, this.tenantId, org.root, org)) out.add(p.id);
    out.delete(userId);
    return [...out];
  }

  private async nameOf(userId: string): Promise<string> {
    return (await this.tx.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '';
  }

  private link(instance: InstanceRow): string {
    return `/app/tasks?plan=${instance.planId}`;
  }

  private async completed(instance: InstanceRow, plan: PlanRow, items: Item[]): Promise<void> {
    const streak = await this.streak(plan.id, instance.userId, instance.cadence);
    await this.award(this.tx, this.tenantId, [
      {
        userId: instance.userId, kind: 'TASK_PLAN_DONE', level: instance.cadence === 'DAY' ? 'DAILY' : 'MAJOR', dedupeKey: `task-plan:${instance.id}:done`,
        details: { taskTitle: plan.title, cadence: instance.cadence as TaskCadence, periodLabel: instance.periodKey, items: items.map((i) => ({ metric: i.metric, amount: i.amount, done: i.done })), streak, percent: 100 },
        entityType: 'task_plan', entityId: plan.id, link: this.link(instance),
      },
    ]);
    await this.notifications.send(this.tx, this.tenantId, [instance.userId], {
      type: 'daily_task.completed', title: `Completed: ${plan.title}`, body: 'Great work! Everything this task asked for is done.', link: this.link(instance), eventId: `task-plan:${instance.id}:done`,
    });
    const name = await this.nameOf(instance.userId);
    await this.notifications.send(this.tx, this.tenantId, await this.watchers(plan, instance.userId, 'done'), {
      type: 'daily_task.team_completed', title: `${name} completed ${plan.title}`, body: null, link: this.link(instance), eventId: `task-plan:${instance.id}:done:team`, senderId: instance.userId,
    });
  }

  private async halfway(instance: InstanceRow, plan: PlanRow, items: Item[], percent: number): Promise<void> {
    await this.award(this.tx, this.tenantId, [
      {
        userId: instance.userId, kind: 'TASK_PLAN_HALF', level: 'ROUTINE', dedupeKey: `task-plan:${instance.id}:half`,
        details: { taskTitle: plan.title, cadence: instance.cadence as TaskCadence, periodLabel: instance.periodKey, items: items.map((i) => ({ metric: i.metric, amount: i.amount, done: i.done })), percent: Math.floor(percent) },
        entityType: 'task_plan', entityId: plan.id, link: this.link(instance),
      },
    ]);
    await this.notifications.send(this.tx, this.tenantId, [instance.userId], {
      type: 'daily_task.half', title: `Halfway there: ${plan.title}`, body: 'Keep going. Every record you add counts by itself.', link: this.link(instance), eventId: `task-plan:${instance.id}:half`,
    });
    const name = await this.nameOf(instance.userId);
    await this.notifications.send(this.tx, this.tenantId, await this.watchers(plan, instance.userId, 'half'), {
      type: 'daily_task.team_half', title: `${name} is halfway through ${plan.title}`, body: null, link: this.link(instance), eventId: `task-plan:${instance.id}:half:team`, senderId: instance.userId,
    });
  }

  private async missed(instance: InstanceRow, plan: PlanRow, percent: number): Promise<void> {
    const p = String(Math.floor(percent));
    await this.notifications.send(this.tx, this.tenantId, [instance.userId], {
      type: 'daily_task.missed', title: `Not completed: ${plan.title} (${p}%)`, body: null, link: this.link(instance), eventId: `task-plan:${instance.id}:missed`,
    });
    const name = await this.nameOf(instance.userId);
    await this.notifications.send(this.tx, this.tenantId, await this.watchers(plan, instance.userId, 'missed'), {
      type: 'daily_task.team_missed', title: `${name} did not complete ${plan.title} (${p}%)`, body: null, link: this.link(instance), eventId: `task-plan:${instance.id}:missed:team`, senderId: instance.userId,
    });
  }

  private async remind(instance: InstanceRow, plan: PlanRow, key: string, percent: number): Promise<void> {
    const p = String(Math.floor(percent));
    const title =
      key === 'today' ? `Today’s task: ${plan.title}`
      : key === 'r12' ? `Keep going: ${plan.title} is ${p}% done`
      : key === 'r16' ? `The day ends soon: ${plan.title} is ${p}% done`
      : `Last day for ${plan.title}: ${p}% done`;
    await this.notifications.send(this.tx, this.tenantId, [instance.userId], {
      type: key === 'today' ? 'daily_task.today' : 'daily_task.reminder', title, body: 'Progress counts by itself from the records you add.', link: this.link(instance), eventId: `task-plan:${instance.id}:${key}`, actionRequired: key === 'today',
    });
  }
}
