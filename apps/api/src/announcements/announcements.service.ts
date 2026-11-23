import { Injectable, NotFoundException } from '@nestjs/common';
import type { AnnouncementInput, AnnouncementRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Announcements (ADR 0072, M8): a notice from the organisation's administrators to everyone in it. It shows on the
 * web and the phone's home screen, and goes out as a notification (and a phone notification where allowed).
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(auth: AuthContext, take = 20): Promise<AnnouncementRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.announcement.findMany({ where: { tenantId: auth.tenantId }, orderBy: { createdAt: 'desc' }, take });
      const authors = new Map(
        (await tx.membership.findMany({ where: { tenantId: auth.tenantId, userId: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { user: { select: { id: true, name: true } } } })).map((m) => [m.user.id, m.user]),
      );
      return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, author: authors.get(r.createdById) ?? null, createdAt: r.createdAt.toISOString() }));
    });
  }

  async post(auth: AuthContext, input: AnnouncementInput, meta: RequestMeta): Promise<AnnouncementRow> {
    const id = await this.prisma.run(auth, async (tx) => {
      const row = await tx.announcement.create({ data: { tenantId: auth.tenantId, title: input.title, body: input.body, createdById: auth.userId } });
      const people = await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' }, userId: { not: auth.userId } }, select: { userId: true } });
      await this.notifications.send(tx, auth.tenantId, people.map((p) => p.userId), {
        type: 'announcement.posted',
        title: input.title,
        body: input.body.length > 300 ? `${input.body.slice(0, 297)}…` : input.body,
        link: '/app/announcements',
        eventId: `announcement:${row.id}`,
        senderId: auth.userId,
        priority: 'HIGH',
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'announcement.posted', entityType: 'announcement', entityId: row.id, metadata: { title: input.title, recipients: people.length }, meta });
      return row.id;
    });
    return (await this.list(auth, 50)).find((r) => r.id === id)!;
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.announcement.findFirst({ where: { tenantId: auth.tenantId, id } });
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Announcement not found.' });
      await tx.announcement.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'announcement.removed', entityType: 'announcement', entityId: id, metadata: { title: row.title }, meta });
    });
  }
}
