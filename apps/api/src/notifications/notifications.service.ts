import { createManySkipDuplicates } from '@dealflow/database';
import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { notificationCategoryOf, type NotificationRow } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { localizeNotification } from '../common/request-language';
import { personRefs } from '../crm/visibility';

export interface NotificationDraft {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  eventId?: string | null;
  /** The person sending it (ADR 0063): their name and designation show with it. */
  senderId?: string | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | null;
  companyId?: string | null;
  contactId?: string | null;
  actionRequired?: boolean;
}

const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

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
      const senders = await personRefs(tx, auth.tenantId, rows.map((r) => r.senderId));
      const companyIds = [...new Set(rows.map((r) => r.companyId).filter((c): c is string => !!c))];
      const contactIds = [...new Set(rows.map((r) => r.contactId).filter((c): c is string => !!c))];
      const [companies, contacts] = await Promise.all([
        companyIds.length ? tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: companyIds }, deletedAt: null }, select: { id: true, name: true } }) : Promise.resolve([]),
        contactIds.length ? tx.contact.findMany({ where: { tenantId: auth.tenantId, id: { in: contactIds }, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
      ]);
      const companyById = new Map(companies.map((c) => [c.id, c]));
      const contactById = new Map(contacts.map((c) => [c.id, { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') }]));
      return {
        items: rows.map((r) => ({
          id: r.id,
          type: r.type,
          // Stored in English when the event happened; shown in the reader's language (ADR 0052).
          title: localizeNotification(r.title),
          body: r.body === null ? null : localizeNotification(r.body),
          link: r.link,
          sender: r.senderId ? (senders.get(r.senderId) ?? null) : null,
          priority: (r.priority && PRIORITIES.has(r.priority) ? r.priority : 'NORMAL') as NotificationRow['priority'],
          company: r.companyId ? (companyById.get(r.companyId) ?? null) : null,
          contact: r.contactId ? (contactById.get(r.contactId) ?? null) : null,
          actionRequired: r.actionRequired ?? false,
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
    // Workspace notification settings (ADR 0062): an administrator can switch categories off.
    const category = notificationCategoryOf(n.type);
    if (category) {
      const settings = await tx.crmSettings.findUnique({ where: { tenantId }, select: { notifications: true } });
      const disabled = (settings?.notifications as { disabled?: unknown } | null)?.disabled;
      if (Array.isArray(disabled) && disabled.includes(category)) return;
    }
    await createManySkipDuplicates(tx.notification, 'Notification', users.map((userId) => ({
        tenantId,
        userId,
        type: n.type,
        title: n.title.slice(0, 200),
        body: n.body?.slice(0, 1000) ?? null,
        link: n.link ?? null,
        eventId: n.eventId ?? null,
        senderId: n.senderId ?? null,
        priority: n.priority ?? null,
        companyId: n.companyId ?? null,
        contactId: n.contactId ?? null,
        actionRequired: n.actionRequired ?? false,
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
