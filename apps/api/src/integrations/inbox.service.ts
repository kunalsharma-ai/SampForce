import { Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type {
  InboxCategory,
  InboxMessage,
  InboxNote,
  InboxQuery,
  InboxStatus,
  InboxThread,
  InboxThreadRow,
  InboxUpdate,
  SyncLogRow,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, notFound, ownerRefs } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { toEmailRow } from './communication.service';

const threadInclude = {
  connection: { select: { id: true, accountEmail: true, provider: true, userId: true, status: true } },
  deal: { select: { id: true, name: true } },
  messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { fromAddress: true, snippet: true } },
  _count: { select: { notes: true } },
} satisfies Prisma.EmailThreadInclude;
type ThreadWith = Prisma.EmailThreadGetPayload<{ include: typeof threadInclude }>;

/**
 * Enhancement feature 8: the inbox. Conversations are built by a database trigger as messages are stored, so
 * every path (sync, one-off send, sequence) lands in one place. This service lists, filters, assigns,
 * categorises and links them, and keeps internal notes. Nothing here sends email; replies use the normal send path.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, q: InboxQuery): Promise<{ items: InboxThreadRow[]; nextCursor: string | null }> {
    return this.prisma.run(auth, async (tx) => {
      const and: Prisma.EmailThreadWhereInput[] = [{ tenantId: auth.tenantId }];
      if (q.status === 'ACTIVE') and.push({ status: { not: 'CLOSED' } });
      else if (q.status) and.push({ status: q.status });
      if (q.category) and.push({ category: q.category });
      if (q.assigned === 'me') and.push({ assignedToId: auth.userId });
      else if (q.assigned === 'unassigned') and.push({ assignedToId: null });
      else if (q.assigned) and.push({ assignedToId: q.assigned });
      if (q.mine === 'true') and.push({ connection: { userId: auth.userId } });
      if (q.linked === 'deal') and.push({ dealId: { not: null } });
      if (q.linked === 'none') and.push({ dealId: null, contactId: null, leadId: null });
      if (q.dealId) and.push({ dealId: q.dealId });
      if (q.contactId) and.push({ contactId: q.contactId });
      if (q.leadId) and.push({ leadId: q.leadId });
      if (q.q) {
        const term = q.q;
        and.push({
          OR: [
            { subject: { contains: term, mode: 'insensitive' } },
            {
              messages: {
                some: {
                  OR: [
                    { fromAddress: { contains: term, mode: 'insensitive' } },
                    { toAddresses: { has: term.toLowerCase() } },
                    { snippet: { contains: term, mode: 'insensitive' } },
                    { bodyText: { contains: term, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        });
      }
      const cursor = parseCursor(q.cursor);
      if (cursor) and.push({ OR: [{ lastMessageAt: { lt: cursor.at } }, { lastMessageAt: cursor.at, id: { lt: cursor.id } }] });
      const rows = await tx.emailThread.findMany({ where: { AND: and }, include: threadInclude, orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
      const page = rows.slice(0, q.limit);
      const items = await this.toRows(tx, page);
      const last = page.at(-1);
      return { items, nextCursor: rows.length > q.limit && last ? `${last.lastMessageAt.toISOString()}_${last.id}` : null };
    });
  }

  get(auth: AuthContext, id: string): Promise<InboxThread> {
    return this.prisma.run(auth, async (tx) => {
      const t = await tx.emailThread.findFirst({ where: { id, tenantId: auth.tenantId }, include: threadInclude });
      if (!t) throw notFound('Conversation');
      const [[row], messages, notes] = await Promise.all([
        this.toRows(tx, [t]),
        tx.emailMessage.findMany({ where: { conversationId: id, tenantId: auth.tenantId }, include: { connection: { select: { provider: true } } }, orderBy: { sentAt: 'asc' }, take: 200 }),
        tx.emailThreadNote.findMany({ where: { threadId: id, tenantId: auth.tenantId }, orderBy: { createdAt: 'asc' }, take: 200 }),
      ]);
      const tracked = await tx.sequenceMessage.findMany({
        where: { tenantId: auth.tenantId, emailMessageId: { in: messages.map((m) => m.id) } },
        select: { emailMessageId: true, openedAt: true, openCount: true, clickedAt: true, clickCount: true, bouncedAt: true, repliedAt: true },
      });
      const byEmail = new Map(tracked.map((s) => [s.emailMessageId, s]));
      const authors = await ownerRefs(tx, notes.map((n) => n.authorId));
      const iso = (d: Date | null) => d?.toISOString() ?? null;
      return {
        ...row!,
        messages: messages.map((m): InboxMessage => {
          const s = byEmail.get(m.id);
          return {
            ...toEmailRow(m),
            cc: m.ccAddresses,
            bodyText: m.bodyText,
            tracking: s ? { openedAt: iso(s.openedAt), openCount: s.openCount, clickedAt: iso(s.clickedAt), clickCount: s.clickCount, bouncedAt: iso(s.bouncedAt), repliedAt: iso(s.repliedAt) } : null,
          };
        }),
        notes: notes.map((n): InboxNote => ({ id: n.id, body: n.body, author: n.authorId ? (authors.get(n.authorId) ?? null) : null, createdAt: n.createdAt.toISOString() })),
        canReplyInThread: t.connection.userId === auth.userId && t.connection.status === 'CONNECTED',
      };
    });
  }

  async update(auth: AuthContext, id: string, input: InboxUpdate, meta: RequestMeta): Promise<InboxThread> {
    await this.prisma.run(auth, async (tx) => {
      const t = await tx.emailThread.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!t) throw notFound('Conversation');
      await assertRefs(tx, auth.tenantId, { ownerId: input.assignedToId, opportunityId: input.dealId, contactId: input.contactId, leadId: input.leadId });
      const data: Prisma.EmailThreadUncheckedUpdateInput = {};
      const changes: Record<string, unknown> = {};
      for (const key of ['status', 'category', 'assignedToId', 'dealId', 'contactId', 'leadId'] as const) {
        if (input[key] !== undefined && input[key] !== t[key]) {
          (data as Record<string, unknown>)[key] = input[key];
          changes[key] = input[key];
        }
      }
      if (Object.keys(changes).length === 0) return;
      await tx.emailThread.update({ where: { id }, data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'inbox.updated', entityType: 'email_thread', entityId: id, metadata: changes, meta });
      if (input.assignedToId && input.assignedToId !== t.assignedToId && input.assignedToId !== auth.userId) {
        await this.notifications.send(tx, auth.tenantId, [input.assignedToId], {
          type: 'inbox.assigned',
          title: 'A conversation was assigned to you',
          body: t.subject.slice(0, 200),
          link: `/app/communication?conversation=${id}`,
        });
      }
    });
    return this.get(auth, id);
  }

  async addNote(auth: AuthContext, id: string, body: string, meta: RequestMeta): Promise<InboxNote> {
    return this.prisma.run(auth, async (tx) => {
      const t = await tx.emailThread.findFirst({ where: { id, tenantId: auth.tenantId }, include: { connection: { select: { userId: true } } } });
      if (!t) throw notFound('Conversation');
      const note = await tx.emailThreadNote.create({ data: { tenantId: auth.tenantId, threadId: id, authorId: auth.userId, body } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'inbox.note_added', entityType: 'email_thread', entityId: id, metadata: {}, meta });
      // The assignee and the mailbox owner hear about notes they did not write.
      const notify = [...new Set([t.assignedToId, t.connection.userId].filter((u): u is string => !!u && u !== auth.userId))];
      if (notify.length) {
        const author = (await ownerRefs(tx, [auth.userId])).get(auth.userId);
        await this.notifications.send(tx, auth.tenantId, notify, {
          type: 'inbox.note',
          title: `${author?.name ?? 'A teammate'} added a note`,
          body: `${t.subject.slice(0, 120)}: ${body.slice(0, 160)}`,
          link: `/app/communication?conversation=${id}`,
        });
      }
      const authors = await ownerRefs(tx, [auth.userId]);
      return { id: note.id, body: note.body, author: authors.get(auth.userId) ?? null, createdAt: note.createdAt.toISOString() };
    });
  }

  /** Mailbox sync history: your own mailboxes, or every mailbox for someone with integrations:manage. */
  syncLogs(auth: AuthContext): Promise<SyncLogRow[]> {
    const all = auth.permissions.includes('integrations:manage');
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.integrationSyncLog.findMany({
        where: { tenantId: auth.tenantId, ...(all ? {} : { connection: { userId: auth.userId } }) },
        include: { connection: { select: { id: true, accountEmail: true, provider: true } } },
        orderBy: { startedAt: 'desc' },
        take: 50,
      });
      return rows.map((r) => ({
        id: r.id,
        mailbox: r.connection,
        trigger: r.trigger as SyncLogRow['trigger'],
        ok: r.ok,
        emails: r.emails,
        meetings: r.meetings,
        error: r.error,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt.toISOString(),
      }));
    });
  }

  private async toRows(tx: TenantTx, rows: ThreadWith[]): Promise<InboxThreadRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [contacts, leads, users, intents] = await Promise.all([
      tx.contact.findMany({
        where: { id: { in: rows.map((r) => r.contactId).filter((v): v is string => !!v) } },
        select: { id: true, firstName: true, lastName: true, companyId: true, company: { select: { name: true } } },
      }),
      tx.lead.findMany({ where: { id: { in: rows.map((r) => r.leadId).filter((v): v is string => !!v) } }, select: { id: true, fullName: true } }),
      ownerRefs(tx, rows.map((r) => r.assignedToId)),
      tx.emailMessage.findMany({
        where: { conversationId: { in: ids }, direction: 'INBOUND', aiIntent: { not: null } },
        orderBy: { sentAt: 'desc' },
        distinct: ['conversationId'],
        select: { conversationId: true, aiIntent: true },
      }),
    ]);
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const intentBy = new Map(intents.map((i) => [i.conversationId, i.aiIntent]));
    return rows.map((r) => {
      const c = r.contactId ? contactById.get(r.contactId) : undefined;
      const l = r.leadId ? leadById.get(r.leadId) : undefined;
      const latest = r.messages[0];
      return {
        id: r.id,
        subject: r.subject,
        status: r.status as InboxStatus,
        category: r.category as InboxCategory | null,
        mailbox: { id: r.connection.id, accountEmail: r.connection.accountEmail, provider: r.connection.provider, ownerId: r.connection.userId },
        assignedTo: r.assignedToId ? (users.get(r.assignedToId) ?? null) : null,
        contact: c ? { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), companyId: c.companyId, companyName: c.company?.name ?? null } : null,
        lead: l ? { id: l.id, name: l.fullName } : null,
        deal: r.deal,
        messageCount: r.messageCount,
        lastMessageAt: r.lastMessageAt.toISOString(),
        lastDirection: r.lastDirection as 'INBOUND' | 'OUTBOUND',
        preview: latest ? { from: latest.fromAddress, snippet: latest.snippet } : null,
        aiIntent: intentBy.get(r.id) ?? null,
        noteCount: r._count.notes,
      };
    });
  }
}

function parseCursor(c: string | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  const i = c.lastIndexOf('_');
  const at = new Date(c.slice(0, i));
  const id = c.slice(i + 1);
  if (i < 0 || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}
