import { createManySkipDuplicates, type Notification, type Prisma } from '@dealflow/database';
import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  type CenterNotification,
  DEFAULT_NOTIFICATION_PREFERENCES,
  MOBILE_PUSH_TYPE_OF,
  mobileRouteFor,
  notificationCategoryOf,
  type NotificationPage,
  type NotificationPageQuery,
  type NotificationPreferences,
  type NotificationPreferencesInput,
  type NotificationReadInput,
  type NotificationRow,
  notificationSection,
  type NotificationSectionKey,
  notificationSectionOf,
  type NotificationSummary,
  SOUND_CATEGORY_KEYS,
} from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { localizeNotification } from '../common/request-language';
import { personRefs } from '../crm/visibility';
import { watchersOf } from './watchers';
import { queueMobilePush } from '../mobile/push/push-queue';

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
/** Unread rows read for the summary; past this the total is counted and the per-section counts cover the newest. */
const SUMMARY_CAP = 1000;
/** How often a waiting live request looks for something new. */
const WAIT_POLL_MS = Number(process.env.NOTIFICATIONS_WAIT_POLL_MS ?? 1500);

/** A section's notifications: those stored with it, and older rows (no section stored) whose link opens it. */
function sectionWhere(section: NotificationSectionKey): Prisma.NotificationWhereInput {
  const href = notificationSection(section)!.href;
  return { OR: [{ section }, { OR: [{ section: null }, { section: { isSet: false } }], AND: { OR: [{ link: href }, { link: { startsWith: `${href}/` } }, { link: { startsWith: `${href}?` } }] } }] };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of the person's notifications, newest first, filtered by unread, action required, section or page. */
  page(auth: AuthContext, q: NotificationPageQuery): Promise<NotificationPage> {
    return this.prisma.run(auth, async (tx) => {
      const mine = { tenantId: auth.tenantId, userId: auth.userId };
      const filter = q.unread === 'true' ? 'unread' : q.filter;
      const and: Prisma.NotificationWhereInput[] = [mine];
      if (filter === 'unread') and.push({ readAt: null });
      if (filter === 'action') and.push({ readAt: null, actionRequired: true });
      if (q.section) and.push(sectionWhere(q.section));
      if (q.link) and.push({ link: q.link });
      if (q.before) and.push({ createdAt: { lt: new Date(q.before) } });
      const [rows, unread] = await Promise.all([
        tx.notification.findMany({ where: { AND: and }, orderBy: { createdAt: 'desc' }, take: q.limit + 1 }),
        tx.notification.count({ where: { ...mine, readAt: null } }),
      ]);
      const more = rows.length > q.limit;
      const shown = rows.slice(0, q.limit);
      return { items: await this.present(tx, auth.tenantId, shown), unread, next: more ? shown[shown.length - 1]!.createdAt.toISOString() : null };
    });
  }

  /** Unread counts for the bell, the home dashboard and each section's badge. */
  summary(auth: AuthContext): Promise<NotificationSummary> {
    return this.prisma.run(auth, async (tx) => {
      const mine = { tenantId: auth.tenantId, userId: auth.userId };
      const [unreadRows, latest] = await Promise.all([
        tx.notification.findMany({
          where: { ...mine, readAt: null },
          select: { type: true, link: true, section: true, priority: true, actionRequired: true },
          orderBy: { createdAt: 'desc' },
          take: SUMMARY_CAP,
        }),
        tx.notification.findFirst({ where: mine, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);
      const unread = unreadRows.length < SUMMARY_CAP ? unreadRows.length : await tx.notification.count({ where: { ...mine, readAt: null } });
      const bySection: NotificationSummary['bySection'] = {};
      let actionRequired = 0;
      let important = 0;
      for (const r of unreadRows) {
        const section = (r.section as NotificationSectionKey | null) ?? notificationSectionOf(r.type, r.link);
        if (section) bySection[section] = (bySection[section] ?? 0) + 1;
        if (r.actionRequired) actionRequired += 1;
        if (r.priority === 'HIGH' || r.priority === 'URGENT') important += 1;
      }
      return { unread, actionRequired, important, bySection, latestAt: latest?.createdAt.toISOString() ?? null };
    });
  }

  /**
   * Live delivery without a socket: answers with the summary as soon as a notification newer than `after` exists,
   * or after `wait` seconds, or when the browser gives up. An ordinary request, so it passes any proxy.
   */
  async wait(auth: AuthContext, after: string | undefined, waitSeconds: number, closed: Promise<void>): Promise<NotificationSummary> {
    const since = after ? new Date(after) : null;
    const deadline = Date.now() + waitSeconds * 1000;
    let gone = false;
    void closed.then(() => (gone = true));
    while (since && !gone && Date.now() < deadline) {
      const newer = await this.prisma.run(auth, (tx) =>
        tx.notification.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, createdAt: { gt: since } }, select: { id: true } }),
      );
      if (newer) break;
      await Promise.race([new Promise((r) => setTimeout(r, WAIT_POLL_MS)), closed]);
    }
    return this.summary(auth);
  }

  /** Marks notifications read: chosen ones, all of them, or every one of a section. */
  async markRead(auth: AuthContext, input: NotificationReadInput): Promise<{ updated: number }> {
    const which: Prisma.NotificationWhereInput = 'section' in input ? sectionWhere(input.section) : input.ids === 'all' ? {} : { id: { in: input.ids } };
    const { count } = await this.prisma.run(auth, (tx) =>
      tx.notification.updateMany({ where: { AND: [{ tenantId: auth.tenantId, userId: auth.userId, readAt: null }, which] }, data: { readAt: new Date() } }),
    );
    return { updated: count };
  }

  /** Puts one notification back to unread, to come back to it later. */
  async markUnread(auth: AuthContext, id: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.run(auth, (tx) =>
      tx.notification.updateMany({ where: { id, tenantId: auth.tenantId, userId: auth.userId, readAt: { not: null } }, data: { readAt: null } }),
    );
    return { updated: count };
  }

  async preferences(auth: AuthContext): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId: auth.userId } });
    if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    const known = new Set<string>(SOUND_CATEGORY_KEYS);
    const d = DEFAULT_NOTIFICATION_PREFERENCES;
    return {
      sound: row.sound,
      volume: row.volume,
      mutedSound: row.mutedSound.filter((k) => known.has(k)) as NotificationPreferences['mutedSound'],
      desktop: row.desktop,
      // Rows saved before on-screen pop-ups existed have none of these fields.
      popups: row.popups ?? d.popups,
      popupSeconds: row.popupSeconds ?? d.popupSeconds,
      mutedPopups: (row.mutedPopups ?? []).filter((k) => known.has(k)) as NotificationPreferences['mutedPopups'],
    };
  }

  /** Saves the person's choices. Fields left out (an older app that does not know pop-ups) keep what is stored. */
  async savePreferences(auth: AuthContext, prefs: NotificationPreferencesInput): Promise<NotificationPreferences> {
    const data = {
      sound: prefs.sound,
      volume: prefs.volume,
      mutedSound: [...new Set(prefs.mutedSound)],
      desktop: prefs.desktop,
      ...(prefs.popups === undefined ? {} : { popups: prefs.popups }),
      ...(prefs.popupSeconds === undefined ? {} : { popupSeconds: prefs.popupSeconds }),
      ...(prefs.mutedPopups === undefined ? {} : { mutedPopups: [...new Set(prefs.mutedPopups)] }),
    };
    await this.prisma.notificationPreference.upsert({ where: { userId: auth.userId }, create: { userId: auth.userId, ...data }, update: data });
    return this.preferences(auth);
  }

  /** Rows as the reader sees them: in their language, with the sender, company, contact and section. */
  private async present(tx: TenantTx, tenantId: string, rows: Notification[]): Promise<CenterNotification[]> {
    const senders = await personRefs(tx, tenantId, rows.map((r) => r.senderId));
    const companyIds = [...new Set(rows.map((r) => r.companyId).filter((c): c is string => !!c))];
    const contactIds = [...new Set(rows.map((r) => r.contactId).filter((c): c is string => !!c))];
    const [companies, contacts] = await Promise.all([
      companyIds.length ? tx.company.findMany({ where: { tenantId, id: { in: companyIds }, deletedAt: null }, select: { id: true, name: true } }) : Promise.resolve([]),
      contactIds.length ? tx.contact.findMany({ where: { tenantId, id: { in: contactIds }, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
    ]);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const contactById = new Map(contacts.map((c) => [c.id, { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') }]));
    return rows.map((r) => ({
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
      section: (r.section as NotificationSectionKey | null) ?? notificationSectionOf(r.type, r.link),
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
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
        section: notificationSectionOf(n.type, n.link),
      })));
    // The same notification on the person's phones, when it is one the phone app has (ADR 0072, M8).
    const push = MOBILE_PUSH_TYPE_OF[n.type];
    if (push) await queueMobilePush(tx, tenantId, users, { type: push, title: n.title, body: n.body ?? null, route: mobileRouteFor(n.link) });
  }

  /** The managers and Super Workspace people who are told about this person's work (see watchers.ts). */
  watchersOf(tx: TenantTx, tenantId: string, userId: string | null | undefined): Promise<string[]> {
    return watchersOf(tx, tenantId, userId, () => this.usersWithPermission(tx, tenantId, 'members:manage'));
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
