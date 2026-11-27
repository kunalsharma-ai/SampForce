import { Injectable, Logger } from '@nestjs/common';
import { RFQ_OPEN_STATUSES } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { errorMessage, scan, scanTenants } from '../worker/queue';
import { notificationSettingsOf } from './crm-admin.service';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Overdue alerts are only sent for follow-ups that became overdue recently, so switching this on never floods anyone. */
const OVERDUE_LOOKBACK = 2 * DAY;
const BATCH = 200;
const unset = (field: string) => [{ [field]: null }, { [field]: { isSet: false } }];

/**
 * Follow-up, task and RFQ reminders (ADR 0062; tasks since ADR 0072 M8), driven by Settings → CRM configuration → Notifications: a reminder before a
 * follow-up is due, one alert when it becomes overdue (to the assignee and, if set, their manager), and a reminder
 * before an open RFQ's submission deadline. Each goes out once per due date or deadline: the claim is a conditional
 * update, so several workers never send the same reminder twice.
 */
@Injectable()
export class CrmRemindersService {
  private readonly log = new Logger(CrmRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now = new Date()): Promise<number> {
    return (await this.followUps(now)) + (await this.rfqs(now)) + (await this.dailyDigest(now));
  }

  /** Tenants whose morning summary already went out today (by their date), so the minute sweep skips them. */
  private readonly digested = new Map<string, string>();

  /**
   * The morning summary (redesign R3, ADR 0083): from 8:00 in the workspace's time zone, everyone with follow-ups due
   * today or overdue gets one notification saying how many. Once a day per person and workspace (the event id carries the workspace and the date: one person can be in several
   * workspaces, and notification event ids are unique per person across all of them).
   */
  async dailyDigest(now = new Date()): Promise<number> {
    const candidates = await scanTenants(this.prisma.task, { status: 'OPEN', deletedAt: null, followUpType: { not: null }, assigneeId: { not: null }, dueAt: { not: null, lte: new Date(now.getTime() + DAY) } });
    if (!candidates.length) return 0;
    // Cheap filters first, in bulk, so a sweep never opens a transaction per organisation for nothing: those where it
    // is not yet 8:00, and those already summarised today (stored, so every worker and restart knows).
    const [zones, settings] = (await Promise.all([
      scan(() => this.prisma.tenant.findMany({ where: { id: { in: candidates } }, select: { id: true, defaultTimezone: true } })),
      scan(() => this.prisma.crmSettings.findMany({ where: { tenantId: { in: candidates } }, select: { tenantId: true, digestDate: true } })),
    ])) as [Array<{ id: string; defaultTimezone: string | null }>, Array<{ tenantId: string; digestDate: string | null }>];
    const last = new Map(settings.map((s) => [s.tenantId, s.digestDate]));
    const due = zones
      .filter((z) => {
        const { date, hour } = localDay(now, z.defaultTimezone ?? 'UTC');
        return hour >= 8 && this.digested.get(z.id) !== date && last.get(z.id) !== date;
      })
      .map((z) => z.id);
    let sent = 0;
    for (const tenantId of due) {
      try {
        sent += await this.prisma.run({ tenantId }, async (tx) => {
          const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { defaultTimezone: true } });
          const { date, hour, endOfDay } = localDay(now, tenant?.defaultTimezone ?? 'UTC');
          if (hour < 8 || this.digested.get(tenantId) === date) return 0;
          const tasks = await tx.task.findMany({
            where: { tenantId, status: 'OPEN', deletedAt: null, followUpType: { not: null }, assigneeId: { not: null }, dueAt: { not: null, lte: endOfDay } },
            select: { assigneeId: true, dueAt: true },
          });
          const per = new Map<string, { today: number; overdue: number }>();
          for (const t of tasks) {
            const p = per.get(t.assigneeId!) ?? { today: 0, overdue: 0 };
            if (t.dueAt! < now) p.overdue++;
            else p.today++;
            per.set(t.assigneeId!, p);
          }
          let n = 0;
          for (const [userId, c] of per) {
            await this.notifications.send(tx, tenantId, [userId], {
              type: 'followup.daily', title: `Follow-ups for today: ${c.today} due, ${c.overdue} overdue`, body: null, link: c.overdue ? '/app/follow-ups?bucket=overdue' : '/app/follow-ups?bucket=today', eventId: `digest:${tenantId}:${userId}:${date}`,
            });
            n++;
          }
          this.digested.set(tenantId, date);
          await tx.crmSettings.upsert({ where: { tenantId }, create: { tenantId, digestDate: date }, update: { digestDate: date } });
          return n;
        });
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId }, 'daily follow-up summary failed');
      }
    }
    return sent;
  }

  private async followUps(now: Date): Promise<number> {
    const candidates = await scan(() =>
      this.prisma.task.findMany({
        where: {
          status: 'OPEN',
          deletedAt: null,
          // Follow-ups, and tasks with a due date (ADR 0072, M8: they reach phones as "due soon" and "overdue").
          dueAt: { not: null, lte: new Date(now.getTime() + 7 * DAY) },
          OR: [...unset('reminderSentAt'), { dueAt: { lt: now }, OR: unset('overdueNotifiedAt') }],
        },
        select: { id: true, tenantId: true },
        orderBy: { dueAt: 'asc' },
        take: BATCH,
      }),
    );
    let sent = 0;
    for (const tenantId of new Set(candidates.map((c) => c.tenantId))) {
      try {
        sent += await this.prisma.run({ tenantId }, async (tx) => {
          const { reminders } = await notificationSettingsOf(tx, tenantId);
          const tasks = await tx.task.findMany({ where: { tenantId, id: { in: candidates.filter((c) => c.tenantId === tenantId).map((c) => c.id) } } });
          let n = 0;
          for (const t of tasks) {
            const due = t.dueAt!;
            if (due < now && !t.overdueNotifiedAt) {
              // Claim first; the pre-due reminder is closed too, since it is no longer useful.
              const { count } = await tx.task.updateMany({ where: { id: t.id, OR: unset('overdueNotifiedAt') }, data: { overdueNotifiedAt: now, reminderSentAt: t.reminderSentAt ?? now } });
              if (count && reminders.followUpOverdue && now.getTime() - due.getTime() <= OVERDUE_LOOKBACK) {
                const to = [t.assigneeId, reminders.overdueNotifiesManager ? t.managerId : null];
                if (t.followUpType) await this.notifications.send(tx, tenantId, to, { type: 'followup.overdue', title: `Follow-up overdue: ${t.title}`, body: null, link: '/app/follow-ups?bucket=overdue', eventId: `overdue:${t.id}:${due.getTime()}` });
                else await this.notifications.send(tx, tenantId, to, { type: 'task.overdue', title: `Task overdue: ${t.title}`, body: null, link: `/app/tasks?task=${t.id}`, eventId: `overdue:${t.id}:${due.getTime()}` });
                n++;
              }
            } else if (due >= now && !t.reminderSentAt && reminders.followUpBeforeMinutes !== null && due.getTime() - now.getTime() <= reminders.followUpBeforeMinutes * MINUTE) {
              const { count } = await tx.task.updateMany({ where: { id: t.id, OR: unset('reminderSentAt') }, data: { reminderSentAt: now } });
              if (count) {
                if (t.followUpType) await this.notifications.send(tx, tenantId, [t.assigneeId], { type: 'followup.reminder', title: `Follow-up due soon: ${t.title}`, body: null, link: '/app/follow-ups?bucket=today', eventId: `due:${t.id}:${due.getTime()}` });
                else await this.notifications.send(tx, tenantId, [t.assigneeId], { type: 'task.due_soon', title: `Task due soon: ${t.title}`, body: null, link: `/app/tasks?task=${t.id}`, eventId: `due:${t.id}:${due.getTime()}` });
                n++;
              }
            } else if (due >= now && !t.reminderSentAt && reminders.followUpBeforeMinutes === null) {
              // Reminders are off: close it so the sweep does not look at it again.
              await tx.task.updateMany({ where: { id: t.id, OR: unset('reminderSentAt') }, data: { reminderSentAt: now } });
            }
          }
          return n;
        });
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId }, 'follow-up reminders failed');
      }
    }
    return sent;
  }

  private async rfqs(now: Date): Promise<number> {
    const candidates = await scan(() =>
      this.prisma.rfq.findMany({
        where: { deletedAt: null, status: { in: [...RFQ_OPEN_STATUSES] }, deadlineAt: { gt: now, lte: new Date(now.getTime() + 60 * DAY) } },
        select: { id: true, tenantId: true, deadlineAt: true, deadlineReminderFor: true },
        orderBy: { deadlineAt: 'asc' },
        take: 2000,
      }),
    );
    const due = candidates.filter((c) => c.deadlineReminderFor?.getTime() !== c.deadlineAt!.getTime());
    let sent = 0;
    for (const tenantId of new Set(due.map((c) => c.tenantId))) {
      try {
        sent += await this.prisma.run({ tenantId }, async (tx) => {
          const { reminders } = await notificationSettingsOf(tx, tenantId);
          if (reminders.rfqDeadlineDays === null) return 0;
          let n = 0;
          for (const c of due.filter((x) => x.tenantId === tenantId)) {
            const deadline = c.deadlineAt!;
            const days = Math.ceil((deadline.getTime() - now.getTime()) / DAY);
            if (days > reminders.rfqDeadlineDays) continue;
            const { count } = await tx.rfq.updateMany({
              where: { id: c.id, deadlineAt: deadline, ...(c.deadlineReminderFor ? { deadlineReminderFor: c.deadlineReminderFor } : { OR: unset('deadlineReminderFor') }) },
              data: { deadlineReminderFor: deadline },
            });
            if (!count) continue;
            const r = await tx.rfq.findUniqueOrThrow({ where: { id: c.id }, select: { number: true, projectName: true, ownerId: true, managerId: true } });
            const rfq = `${r.number} ${r.projectName}`;
            await this.notifications.send(tx, tenantId, [r.ownerId], {
              type: 'rfq.deadline',
              title: days <= 1 ? `RFQ deadline tomorrow: ${rfq}` : `RFQ deadline in ${days} days: ${rfq}`,
              body: null,
              link: `/app/rfqs?open=${c.id}`,
              eventId: `rfq-deadline:${c.id}:${deadline.getTime()}`,
            });
            n++;
          }
          return n;
        });
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId }, 'RFQ deadline reminders failed');
      }
    }
    return sent;
  }
}

/** The date (YYYY-MM-DD) and hour in a time zone, and the end of that day as an instant. */
export function localDay(now: Date, timeZone: string): { date: string; hour: number; endOfDay: Date } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    return localDay(now, 'UTC');
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const date = `${String(get('year')).padStart(4, '0')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`;
  const hour = get('hour');
  const elapsed = ((hour * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return { date, hour, endOfDay: new Date(now.getTime() - elapsed + DAY - 1) };
}
