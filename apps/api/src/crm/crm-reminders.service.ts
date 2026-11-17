import { Injectable, Logger } from '@nestjs/common';
import { RFQ_OPEN_STATUSES } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { errorMessage, scan } from '../worker/queue';
import { notificationSettingsOf } from './crm-admin.service';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Overdue alerts are only sent for follow-ups that became overdue recently, so switching this on never floods anyone. */
const OVERDUE_LOOKBACK = 2 * DAY;
const BATCH = 200;
const unset = (field: string) => [{ [field]: null }, { [field]: { isSet: false } }];

/**
 * Follow-up and RFQ reminders (ADR 0062), driven by Settings → CRM configuration → Notifications: a reminder before a
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
    return (await this.followUps(now)) + (await this.rfqs(now));
  }

  private async followUps(now: Date): Promise<number> {
    const candidates = await scan(() =>
      this.prisma.task.findMany({
        where: {
          status: 'OPEN',
          deletedAt: null,
          followUpType: { not: null },
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
                await this.notifications.send(tx, tenantId, to, { type: 'followup.overdue', title: `Follow-up overdue: ${t.title}`, body: null, link: '/app/follow-ups?bucket=overdue', eventId: `overdue:${t.id}:${due.getTime()}` });
                n++;
              }
            } else if (due >= now && !t.reminderSentAt && reminders.followUpBeforeMinutes !== null && due.getTime() - now.getTime() <= reminders.followUpBeforeMinutes * MINUTE) {
              const { count } = await tx.task.updateMany({ where: { id: t.id, OR: unset('reminderSentAt') }, data: { reminderSentAt: now } });
              if (count) {
                await this.notifications.send(tx, tenantId, [t.assigneeId], { type: 'followup.reminder', title: `Follow-up due soon: ${t.title}`, body: null, link: '/app/follow-ups?bucket=today', eventId: `due:${t.id}:${due.getTime()}` });
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
