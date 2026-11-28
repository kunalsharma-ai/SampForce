import { Injectable, Logger } from '@nestjs/common';
import { transactionLock, type TenantTx } from '@dealflow/database';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { errorMessage, scanTenants } from '../worker/queue';
import { dayIn } from './learner.service';

const DAY = 86_400_000;
/** Assignments looked at per workspace per sweep. */
const BATCH = 500;
/** Overdue reminders stop this long after the deadline, so an old assignment never nags forever. */
const OVERDUE_FOR = 60 * DAY;

export interface ReminderPlan {
  key: string;
  kind: 'before' | 'due' | 'overdue';
  days?: number;
}

/**
 * The reminder an assignment is owed now, if any (ADR 0097). Before the deadline: the nearest of the module's "days
 * before" marks that has been reached (3 days, then 1 day). On the day itself: once. After it: once when it becomes
 * overdue, then every few days. Each has a key stored on the assignment, so it goes out once.
 */
export function reminderFor(
  m: { reminderDaysBefore: number[]; remindOnDueDay: boolean; overdueEveryDays: number | null },
  a: { dueAt: Date; remindersSent: string[] },
  now: Date,
  timeZone: string,
): ReminderPlan | null {
  const sent = new Set(a.remindersSent);
  const dueDay = dayIn(timeZone, a.dueAt);
  const today = dayIn(timeZone, now);
  const left = a.dueAt.getTime() - now.getTime();
  if (left > 0) {
    if (today === dueDay && m.remindOnDueDay) {
      const key = `due:${dueDay}`;
      return sent.has(key) ? null : { key, kind: 'due' };
    }
    const reached = [...m.reminderDaysBefore].sort((x, y) => x - y).find((d) => left <= d * DAY);
    if (reached === undefined) return null;
    const key = `before:${reached}:${dueDay}`;
    return sent.has(key) ? null : { key, kind: 'before', days: reached };
  }
  const late = now.getTime() - a.dueAt.getTime();
  if (late > OVERDUE_FOR) return null;
  const first = `overdue:${dueDay}:0`;
  if (!sent.has(first)) return { key: first, kind: 'overdue' };
  if (!m.overdueEveryDays) return null;
  const n = Math.floor(late / (m.overdueEveryDays * DAY));
  if (n < 1) return null;
  const key = `overdue:${dueDay}:${n}`;
  return sent.has(key) ? null : { key, kind: 'overdue' };
}

/** Deadline reminders for learning assignments, run by the worker every minute. */
@Injectable()
export class LearningRemindersService {
  private readonly log = new Logger(LearningRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now = new Date()): Promise<number> {
    const where = { removedAt: null, status: { not: 'COMPLETED' }, dueAt: { not: null, gte: new Date(now.getTime() - OVERDUE_FOR), lte: new Date(now.getTime() + 61 * DAY) } };
    const tenants = await scanTenants(this.prisma.learningAssignment, where);
    let sent = 0;
    for (const tenantId of tenants) {
      try {
        sent += await this.prisma.run({ tenantId }, (tx) => this.forTenant(tx, tenantId, now));
      } catch (err) {
        this.log.warn({ tenantId, err: errorMessage(err) }, 'learning reminders failed for a workspace');
      }
    }
    return sent;
  }

  private async forTenant(tx: TenantTx, tenantId: string, now: Date): Promise<number> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { defaultTimezone: true } });
    const tz = tenant?.defaultTimezone ?? 'UTC';
    const rows = await tx.learningAssignment.findMany({
      where: { tenantId, removedAt: null, status: { not: 'COMPLETED' }, dueAt: { not: null, gte: new Date(now.getTime() - OVERDUE_FOR), lte: new Date(now.getTime() + 61 * DAY) } },
      orderBy: { dueAt: 'asc' },
      take: BATCH,
    });
    if (!rows.length) return 0;
    const modules = await tx.learningModule.findMany({ where: { tenantId, id: { in: [...new Set(rows.map((a) => a.moduleId))] }, status: 'PUBLISHED' } });
    const byId = new Map(modules.map((m) => [m.id, m]));
    let n = 0;
    for (const a of rows) {
      const m = byId.get(a.moduleId);
      if (!m || !a.dueAt) continue;
      const plan = reminderFor(m, { dueAt: a.dueAt, remindersSent: a.remindersSent ?? [] }, now, tz);
      if (!plan) continue;
      // Claim it first, one worker at a time per assignment: only the one that finds the key unsent sends it.
      await transactionLock(tx, `learning-reminder:${a.id}`);
      const fresh = await tx.learningAssignment.findUnique({ where: { id: a.id }, select: { remindersSent: true } });
      if (!fresh || (fresh.remindersSent ?? []).includes(plan.key)) continue;
      await tx.learningAssignment.update({ where: { id: a.id }, data: { remindersSent: [...(fresh.remindersSent ?? []), plan.key] } });
      const due = dayIn(tz, a.dueAt);
      const link = `/app/learning/${m.id}`;
      if (plan.kind === 'before') {
        await this.notifications.send(tx, tenantId, [a.userId], { type: 'learning.deadline_approaching', title: 'Learning deadline approaching', body: `${m.title} · due ${due}`, link, eventId: `learning.reminder:${a.id}:${plan.key}`, priority: plan.days === 1 ? 'HIGH' : 'NORMAL' });
      } else if (plan.kind === 'due') {
        await this.notifications.send(tx, tenantId, [a.userId], { type: 'learning.due_today', title: 'Learning module due today', body: m.title, link, eventId: `learning.reminder:${a.id}:${plan.key}`, priority: 'HIGH', actionRequired: a.mandatory });
      } else {
        await this.notifications.send(tx, tenantId, [a.userId], { type: 'learning.overdue', title: 'Learning module overdue', body: `${m.title} · was due ${due}`, link, eventId: `learning.reminder:${a.id}:${plan.key}`, priority: 'URGENT', actionRequired: a.mandatory });
        if (plan.key.endsWith(':0')) {
          const learner = await tx.user.findUnique({ where: { id: a.userId }, select: { name: true } });
          const managers = [...new Set([m.responsibleUserId, a.assignedById].filter((x): x is string => !!x && x !== a.userId))];
          await this.notifications.send(tx, tenantId, managers, { type: 'learning.overdue_team', title: 'Learning overdue in your team', body: `${learner?.name ?? 'Someone'} · ${m.title} · was due ${due}`, link: `/app/learning/manage/${m.id}?tab=people`, eventId: `learning.overdue_team:${a.id}:${due}` });
        }
      }
      n++;
    }
    return n;
  }
}

