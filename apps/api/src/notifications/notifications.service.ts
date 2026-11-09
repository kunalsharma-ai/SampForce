import { createManySkipDuplicates } from '@dealflow/database';
import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { NotificationRow } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { localizeNotification } from '../common/request-language';

export interface NotificationDraft {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  eventId?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: AuthContext, unreadOnly: boolean): Promise<{ items: NotificationRow[]; unread: number }> {
    return this.prisma.run(auth, async (tx) => {
      const where = { tenantId: auth.tenantId, userId: auth.userId };
      const [rows, unread] = await Promise.all([
        tx.notification.findMany({ where: { ...where, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.notification.count({ where: { ...where, readAt: null } }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          type: r.type,
          // Stored in English when the event happened; shown in the reader's language (ADR 0052).
          title: localizeNotification(r.title),
          body: r.body === null ? null : localizeNotification(r.body),
          link: r.link,
          readAt: r.readAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        unread,
      };
    });
  }

  async markRead(auth: AuthContext, ids: string[] | 'all'): Promise<{ updated: number }> {
    const { count } = await this.prisma.run(auth, (tx) =>
      tx.notification.updateMany({
        where: { tenantId: auth.tenantId, userId: auth.userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
        data: { readAt: new Date() },
      }),
    );
    return { updated: count };
  }

  /**
   * Inserts notifications for other users. Uses createMany (no RETURNING) because a user can only
   * read their own notifications, and skips duplicates so a retried event never notifies twice.
   */
  async send(tx: TenantTx, tenantId: string, userIds: (string | null | undefined)[], n: NotificationDraft): Promise<void> {
    const users = [...new Set(userIds.filter((u): u is string => !!u))];
    if (users.length === 0) return;
    await createManySkipDuplicates(tx.notification, 'Notification', users.map((userId) => ({
        tenantId,
        userId,
        type: n.type,
        title: n.title.slice(0, 200),
        body: n.body?.slice(0, 1000) ?? null,
        link: n.link ?? null,
        eventId: n.eventId ?? null,
      })));
  }

  /** Active members of the tenant whose role grants `permission`. */
  async usersWithPermission(tx: TenantTx, tenantId: string, permission: string): Promise<string[]> {
    const rows = await tx.membership.findMany({
      where: { tenantId, status: 'ACTIVE', role: { permissions: { has: permission } }, user: { status: 'ACTIVE' } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
