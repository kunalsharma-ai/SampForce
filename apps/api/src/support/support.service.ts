import { Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import {
  type OperatorSupportTicketDetail,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_RAISER_STATUSES,
  SUPPORT_TICKET_STATUSES,
  type SupportAttachmentRow,
  type SupportContactMethod,
  type SupportRecordType,
  type SupportTicketContext,
  type OperatorSupportTicketRow,
  type SupportAuthorKind,
  type SupportCounts,
  type SupportTicketDetail,
  type SupportTicketMessageRow,
  type SupportTicketRow,
  type SupportHandlerLevel,
  type SupportPerson,
  type SupportTicketStatus,
  type WorkspaceLevel,
  operatorSupportUpdateSchema,
  supportTicketCreateSchema,
} from '@dealflow/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import type { OperatorContext } from '../operator/operator-auth';
import { branchUserIds, levelOf, workspaceLevelOf } from '../workspaces/access';

type Ticket = Prisma.SupportTicketGetPayload<{ include: { messages: true } }>;
type TicketMessage = Ticket['messages'][number];
type Files = Map<string, SupportAttachmentRow[]>;
type Uploader = { userId: string } | { operatorId: string };

/** What the person who raised a query is told when its status changes. */
const STATUS_TITLE: Record<SupportTicketStatus, (n: number) => string> = {
  SUBMITTED: (n) => `Your query #${n} was opened again`,
  UNDER_REVIEW: (n) => `Your query #${n} is under review`,
  IN_PROGRESS: (n) => `Your query #${n} is in progress`,
  AWAITING_USER: (n) => `Your query #${n} is waiting for your reply`,
  RESOLVED: (n) => `Your query #${n} is resolved`,
  CLOSED: (n) => `Your query #${n} was closed`,
};

/** The fields that change with a status: when it was resolved or closed. */
function statusData(status: SupportTicketStatus, t: { resolvedAt: Date | null; closedAt: Date | null }, now = new Date()) {
  return {
    status,
    closedAt: status === 'CLOSED' ? (t.closedAt ?? now) : null,
    resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? (t.resolvedAt ?? (status === 'RESOLVED' ? now : null)) : null,
  };
}

const badRequest = (path: string, message: string) => new BadRequestException({ code: 'VALIDATION_FAILED', message, details: [{ path, message }] });

/** How SampForce's own team is named to workspaces: one support desk, not individual operators. */
const SUPPORT_NAME = 'SampForce support';

const forbidden = () => new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.' });

/**
 * Help Center support tickets (ADR 0073). People raise a query from Help on the web or in the mobile app. Each
 * organisation numbers its tickets from 1. With the workspace hierarchy (ADR 0071 part 5) a ticket goes to the level
 * above its raiser (an executive's manager, then the Super Workspace, then the SampForce Console); whoever handles it
 * answers it or escalates it one level up. The Console only ever sees tickets that reached it.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Workspace side ───────────────────────────────────────────────────────────────────────────────────────────────

  async create(auth: AuthContext, input: z.output<typeof supportTicketCreateSchema>, meta: RequestMeta): Promise<SupportTicketDetail> {
    const id = await this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `${auth.tenantId}:support_ticket`);
      const last = await tx.supportTicket.aggregate({ where: { tenantId: auth.tenantId }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      const now = new Date();
      const org = await Hierarchy.load(tx, auth.tenantId);
      const route = org.firstHandler(auth.workspaceNodeId);
      const related = input.relatedRecord ? await relatedRecord(tx, auth.tenantId, input.relatedRecord.type, input.relatedRecord.id) : null;
      const context = await captureContext(tx, auth, org);
      const ticket = await tx.supportTicket.create({
        data: {
          tenantId: auth.tenantId,
          number,
          workspaceNodeId: org.isRoot(auth.workspaceNodeId) ? null : (auth.workspaceNodeId ?? null),
          raisedByUserId: auth.userId,
          raisedByMembershipId: auth.membershipId,
          subject: input.subject,
          category: input.category,
          featureKey: input.featureKey ?? null,
          pagePath: input.pagePath ?? null,
          source: (auth.via as string | undefined) === 'mobile' ? 'mobile' : 'web',
          priority: input.priority,
          status: 'SUBMITTED',
          handlerLevel: route.level,
          handlerNodeId: route.nodeId,
          lastMessageAt: now,
          categoryOther: input.category === 'other' ? input.categoryOther || null : null,
          relatedRecordType: related?.type ?? null,
          relatedRecordId: related?.id ?? null,
          relatedRecordLabel: related?.label ?? null,
          contactMethod: input.contactMethod,
          contactPhone: input.contactMethod === 'PHONE' ? (input.contactPhone ?? null) : null,
          appVersion: input.appVersion ?? null,
          context: context as unknown as Prisma.InputJsonValue,
        },
      });
      const first = await tx.supportTicketMessage.create({
        data: { tenantId: auth.tenantId, ticketId: ticket.id, authorKind: 'USER', authorUserId: auth.userId, authorMembershipId: auth.membershipId, body: input.body, createdAt: now },
      });
      await attach(tx, auth.tenantId, ticket.id, first.id, input.attachmentIds, { userId: auth.userId });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'support_ticket.raised',
        entityType: 'support_ticket',
        entityId: ticket.id,
        metadata: { number, category: input.category, priority: input.priority, handlerLevel: route.level },
        meta,
      });
      await this.notifyHandlers(tx, org, ticket, auth.userId, `New query #${number}`);
      return ticket.id;
    });
    return this.get(auth, id);
  }

  /**
   * The caller's tickets; with scope=team also those of their branch (managers) or organisation (Super admins); with
   * scope=handling the tickets their workspace answers.
   */
  list(auth: AuthContext, scope: 'mine' | 'team' | 'handling', status?: SupportTicketStatus): Promise<SupportTicketRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const org = await Hierarchy.load(tx, auth.tenantId);
      let where: Prisma.SupportTicketWhereInput;
      if (scope === 'handling') {
        const handles = org.handles(auth);
        if (!handles) return [];
        where = handles.level === 'SUPER' ? { handlerLevel: 'SUPER' } : { handlerLevel: 'MANAGER', handlerNodeId: handles.nodeId };
      } else {
        const raisers = scope === 'team' ? await this.teamRaisers(tx, auth) : [auth.userId];
        where = raisers ? { raisedByUserId: { in: raisers } } : {};
      }
      const rows = await tx.supportTicket.findMany({
        where: { tenantId: auth.tenantId, ...where, ...(status ? { status } : {}) },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { lastMessageAt: 'desc' },
        take: 200,
      });
      const ctx = await this.rowContext(tx, rows, org);
      return rows.map((r) => toRow(r, ctx, { userId: auth.userId, handling: org.isHandler(auth, r) }));
    });
  }

  async get(auth: AuthContext, id: string): Promise<SupportTicketDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await Hierarchy.load(tx, auth.tenantId);
      const ticket = await this.visibleTicket(tx, auth, org, id);
      const ctx = await this.rowContext(tx, [ticket], org);
      const handling = org.isHandler(auth, ticket);
      const files = await ticketFiles(tx, ticket);
      return {
        ...toRow(ticket, ctx, { userId: auth.userId, handling }),
        messages: ticket.messages.map((m) => toMessage(m, ctx.names, files, { userId: auth.userId })),
        canReply: ticket.raisedByUserId === auth.userId || handling,
      };
    });
  }

  /**
   * The raiser writes again, or the workspace handling it answers. A raiser's message on a ticket that was waiting
   * for them, resolved or closed puts it back under review; a handler's answer makes it wait for the raiser.
   */
  async reply(auth: AuthContext, id: string, input: { body: string; attachmentIds: string[] }, meta: RequestMeta): Promise<SupportTicketDetail> {
    const body = input.body;
    await this.prisma.run(auth, async (tx) => {
      const org = await Hierarchy.load(tx, auth.tenantId);
      const ticket = await this.visibleTicket(tx, auth, org, id);
      const handling = org.isHandler(auth, ticket);
      const raiser = ticket.raisedByUserId === auth.userId;
      if (!raiser && !handling) throw forbidden();
      const now = new Date();
      // The raiser's own workspace answering their ticket (a manager raising and handling none) is still the raiser.
      const answering = handling && !raiser;
      const message = await tx.supportTicketMessage.create({
        data: { tenantId: auth.tenantId, ticketId: id, authorKind: answering ? 'WORKSPACE' : 'USER', authorUserId: auth.userId, authorMembershipId: auth.membershipId, body, createdAt: now },
      });
      await attach(tx, auth.tenantId, id, message.id, input.attachmentIds, { userId: auth.userId });
      const reopen = !answering && (ticket.status === 'AWAITING_USER' || ticket.status === 'RESOLVED' || ticket.status === 'CLOSED');
      const next: SupportTicketStatus = answering ? 'AWAITING_USER' : reopen ? 'UNDER_REVIEW' : ticket.status;
      await tx.supportTicket.update({
        where: { id },
        data: { lastMessageAt: now, ...statusData(next, ticket, now), ...(answering ? { answeredAt: now } : {}) },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: answering ? 'support_ticket.answered' : 'support_ticket.message_added',
        entityType: 'support_ticket',
        entityId: id,
        metadata: { number: ticket.number, ...(next !== ticket.status ? { from: ticket.status, to: next } : {}), ...(answering ? { handlerLevel: ticket.handlerLevel } : {}) },
        meta,
      });
      if (answering)
        await this.notifications.send(tx, auth.tenantId, [ticket.raisedByUserId], {
          type: 'support.reply',
          title: `Your query #${ticket.number} has an answer`,
          body: ticket.subject,
          link: `/app/help/queries?ticket=${id}`,
          priority: ticket.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
          actionRequired: true,
        });
      else await this.notifyHandlers(tx, org, ticket, auth.userId, `New message on query #${ticket.number}`);
    });
    return this.get(auth, id);
  }

  /**
   * The raiser may mark their ticket resolved, close it or open it again; the workspace handling it sets any status
   * and the note. The raiser is told of every change someone else makes.
   */
  async setStatus(auth: AuthContext, id: string, input: { status: SupportTicketStatus; resolutionNote?: string | null }, meta: RequestMeta): Promise<SupportTicketDetail> {
    await this.prisma.run(auth, async (tx) => {
      const org = await Hierarchy.load(tx, auth.tenantId);
      const ticket = await this.visibleTicket(tx, auth, org, id);
      const handling = org.isHandler(auth, ticket);
      const raiser = ticket.raisedByUserId === auth.userId;
      if (!handling && (!raiser || !SUPPORT_RAISER_STATUSES.includes(input.status) || input.resolutionNote !== undefined)) throw forbidden();
      const note = handling && input.resolutionNote !== undefined ? { resolutionNote: input.resolutionNote || null } : {};
      if (ticket.status === input.status && !('resolutionNote' in note)) return;
      await tx.supportTicket.update({ where: { id }, data: { ...statusData(input.status, ticket), ...note } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'support_ticket.status_changed',
        entityType: 'support_ticket',
        entityId: id,
        metadata: { number: ticket.number, from: ticket.status, to: input.status, ...('resolutionNote' in note ? { resolutionNote: true } : {}) },
        meta,
      });
      if (handling && !raiser && input.status !== ticket.status) await notifyRaiser(this.notifications, tx, auth.tenantId, ticket, input.status);
    });
    return this.get(auth, id);
  }

  /**
   * The workspace handling a ticket passes it one level up: a manager to the Super Workspace, the Super Workspace to
   * SampForce support. A note, when given, goes into the conversation for the next handler and the raiser to read.
   */
  async escalate(auth: AuthContext, id: string, note: string | undefined, meta: RequestMeta): Promise<SupportTicketDetail> {
    await this.prisma.run(auth, async (tx) => {
      const org = await Hierarchy.load(tx, auth.tenantId);
      const ticket = await this.visibleTicket(tx, auth, org, id);
      if (!org.isHandler(auth, ticket)) throw forbidden();
      const up: SupportHandlerLevel = ticket.handlerLevel === 'MANAGER' ? 'SUPER' : 'CONSOLE';
      const now = new Date();
      if (note)
        await tx.supportTicketMessage.create({
          data: { tenantId: auth.tenantId, ticketId: id, authorKind: 'WORKSPACE', authorUserId: auth.userId, authorMembershipId: auth.membershipId, body: note, createdAt: now },
        });
      const moved = await tx.supportTicket.update({
        where: { id },
        data: { handlerLevel: up, handlerNodeId: null, escalatedAt: now, ...statusData('SUBMITTED', ticket, now), lastMessageAt: now },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'support_ticket.escalated',
        entityType: 'support_ticket',
        entityId: id,
        metadata: { number: ticket.number, from: ticket.handlerLevel, to: up },
        meta,
      });
      await this.notifyHandlers(tx, org, moved, auth.userId, `Query #${ticket.number} was passed to you`);
    });
    return this.get(auth, id);
  }

  /** Tells the people of the workspace now handling a ticket; the Console sees its own count instead. */
  private async notifyHandlers(tx: TenantTx, org: Hierarchy, ticket: { id: string; number: number; subject: string; priority: string; handlerLevel: SupportHandlerLevel; handlerNodeId: string | null }, except: string, title: string) {
    if (ticket.handlerLevel === 'CONSOLE') return;
    const users = (await org.handlerUserIds(tx, ticket)).filter((u) => u !== except);
    if (!users.length) return;
    await this.notifications.send(tx, org.tenantId, users, {
      type: 'support.handling',
      title,
      body: ticket.subject,
      link: `/app/help/queries?scope=handling&ticket=${ticket.id}`,
      priority: ticket.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
      actionRequired: true,
    });
  }

  /**
   * Whose tickets the caller may read with scope=team: null = everyone in the organisation (a Super Workspace member
   * who manages members), a manager's branch, or only their own.
   */
  private async teamRaisers(tx: TenantTx, auth: AuthContext): Promise<string[] | null> {
    const level = await workspaceLevelOf(tx, auth.tenantId, auth.membershipId);
    if (level === 'SUPER') return auth.permissions.includes('members:manage') ? null : [auth.userId];
    if (level === 'MANAGER' && auth.workspaceNodeId) return [...new Set([auth.userId, ...(await branchUserIds(tx, auth.tenantId, auth.workspaceNodeId))])];
    return [auth.userId];
  }

  private async visibleTicket(tx: TenantTx, auth: AuthContext, org: Hierarchy, id: string): Promise<Ticket> {
    const ticket = await tx.supportTicket.findFirst({ where: { tenantId: auth.tenantId, id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!ticket) throw notFound('Support ticket');
    if (ticket.raisedByUserId === auth.userId || org.isHandler(auth, ticket)) return ticket;
    const raisers = await this.teamRaisers(tx, auth);
    if (raisers && !raisers.includes(ticket.raisedByUserId)) throw notFound('Support ticket');
    return ticket;
  }

  /** Names for rows: raisers and authors, handler workspaces and assigned operators. */
  private async rowContext(tx: TenantTx, rows: Ticket[], org: Hierarchy | null): Promise<RowContext> {
    const [names, operators] = await Promise.all([
      userNames(tx, rows.flatMap((r) => [r.raisedByUserId, ...r.messages.map((m) => m.authorUserId)])),
      operatorNames(tx, rows.map((r) => r.assignedOperatorId)),
    ]);
    return { names, operators, nodeName: (nodeId) => (nodeId ? (org?.nameOf(nodeId) ?? '') : '') };
  }

  // ── Console side ─────────────────────────────────────────────────────────────────────────────────────────────────
  // The Console sees only tickets that reached it: queries a workspace answers inside the organisation stay there.

  operatorList(_op: OperatorContext, q: { status?: SupportTicketStatus; q?: string; tenantId?: string }): Promise<OperatorSupportTicketRow[]> {
    return this.prisma.run({ operatorScan: true }, async (tx) => {
      const number = q.q && /^#?\d+$/.test(q.q) ? Number(q.q.replace('#', '')) : null;
      const rows = await tx.supportTicket.findMany({
        where: {
          handlerLevel: 'CONSOLE',
          ...(q.status ? { status: q.status } : {}),
          ...(q.tenantId ? { tenantId: q.tenantId } : {}),
          ...(q.q ? (number !== null ? { number } : { subject: { contains: q.q, mode: 'insensitive' } }) : {}),
        },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { lastMessageAt: 'desc' },
        take: 300,
      });
      return this.operatorRows(tx, rows);
    });
  }

  async operatorCounts(_op: OperatorContext): Promise<SupportCounts> {
    const groups = await this.prisma.run({ operatorScan: true }, (tx) => tx.supportTicket.groupBy({ by: ['status'], where: { handlerLevel: 'CONSOLE' }, _count: { _all: true } }));
    return Object.fromEntries(SUPPORT_TICKET_STATUSES.map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0])) as SupportCounts;
  }

  async operatorGet(op: OperatorContext, id: string): Promise<OperatorSupportTicketDetail> {
    return this.prisma.run({ operatorScan: true }, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { id, handlerLevel: 'CONSOLE' }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
      if (!ticket) throw notFound('Support ticket');
      const [row] = await this.operatorRows(tx, [ticket]);
      const names = await userNames(tx, ticket.messages.map((m) => m.authorUserId));
      const operators = await operatorNames(tx, ticket.messages.map((m) => m.operatorId));
      const files = await ticketFiles(tx, ticket);
      return { ...row!, messages: ticket.messages.map((m) => toMessage(m, names, files, { operatorId: op.id, operators })) };
    });
  }

  /** An operator answers: the ticket waits for the person who raised it, who is notified. */
  async operatorReply(op: OperatorContext, id: string, input: { body: string; attachmentIds: string[] }, ip: string | null): Promise<OperatorSupportTicketDetail> {
    const body = input.body;
    const tenantId = await this.tenantOf(id);
    await this.prisma.run({ tenantId }, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { tenantId, id, handlerLevel: 'CONSOLE' } });
      if (!ticket) throw notFound('Support ticket');
      const now = new Date();
      const message = await tx.supportTicketMessage.create({ data: { tenantId, ticketId: id, authorKind: 'OPERATOR', operatorId: op.id, body, createdAt: now } });
      await attach(tx, tenantId, id, message.id, input.attachmentIds, { operatorId: op.id });
      // The first operator to answer looks after it unless someone was assigned already.
      await tx.supportTicket.update({ where: { id }, data: { ...statusData('AWAITING_USER', ticket, now), answeredAt: now, lastMessageAt: now, assignedOperatorId: ticket.assignedOperatorId ?? op.id } });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        actorType: 'PLATFORM_ADMIN',
        action: 'support_ticket.answered',
        entityType: 'support_ticket',
        entityId: id,
        metadata: { number: ticket.number, operatorId: op.id, from: ticket.status },
      });
      await this.notifications.send(tx, tenantId, [ticket.raisedByUserId], {
        type: 'support.reply',
        title: `SampForce support replied to query #${ticket.number}`,
        body: ticket.subject,
        link: `/app/help/queries?ticket=${id}`,
        priority: ticket.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
        actionRequired: true,
      });
    });
    await this.prisma.platformAuditLog.create({ data: { operatorId: op.id, action: 'support_ticket.answered', targetTenantId: tenantId, metadata: { ticketId: id }, ip } });
    return this.operatorGet(op, id);
  }

  /** Active operators, who can look after a ticket. */
  representatives(): Promise<SupportPerson[]> {
    return this.prisma.platformOperator.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  /** Status, the representative looking after it, and the resolution note. */
  async operatorUpdate(op: OperatorContext, id: string, input: z.output<typeof operatorSupportUpdateSchema>, ip: string | null): Promise<OperatorSupportTicketDetail> {
    const tenantId = await this.tenantOf(id);
    const changed = await this.prisma.run({ tenantId }, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { tenantId, id, handlerLevel: 'CONSOLE' } });
      if (!ticket) throw notFound('Support ticket');
      if (input.assignedOperatorId) {
        const rep = await tx.platformOperator.findFirst({ where: { id: input.assignedOperatorId, status: 'ACTIVE' }, select: { id: true } });
        if (!rep) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose an active operator.', details: [{ path: 'assignedOperatorId', message: 'Choose an active operator.' }] });
      }
      const data: Prisma.SupportTicketUpdateInput = {};
      if (input.status !== undefined && input.status !== ticket.status) Object.assign(data, statusData(input.status, ticket));
      if (input.assignedOperatorId !== undefined && input.assignedOperatorId !== ticket.assignedOperatorId) data.assignedOperatorId = input.assignedOperatorId;
      if (input.resolutionNote !== undefined && (input.resolutionNote || null) !== ticket.resolutionNote) data.resolutionNote = input.resolutionNote || null;
      if (!Object.keys(data).length) return null;
      await tx.supportTicket.update({ where: { id }, data });
      const base = { tenantId, actorUserId: null, actorType: 'PLATFORM_ADMIN' as const, entityType: 'support_ticket', entityId: id };
      if ('status' in data)
        await this.audit.record(tx, { ...base, action: 'support_ticket.status_changed', metadata: { number: ticket.number, operatorId: op.id, from: ticket.status, to: input.status } });
      if ('assignedOperatorId' in data)
        await this.audit.record(tx, { ...base, action: 'support_ticket.assigned', metadata: { number: ticket.number, operatorId: op.id, from: ticket.assignedOperatorId, to: input.assignedOperatorId } });
      if ('resolutionNote' in data) await this.audit.record(tx, { ...base, action: 'support_ticket.resolution_noted', metadata: { number: ticket.number, operatorId: op.id } });
      if ('status' in data && input.status) await notifyRaiser(this.notifications, tx, tenantId, ticket, input.status);
      return Object.keys(data);
    });
    if (changed) await this.prisma.platformAuditLog.create({ data: { operatorId: op.id, action: 'support_ticket.updated', targetTenantId: tenantId, metadata: { ticketId: id, fields: changed }, ip } });
    return this.operatorGet(op, id);
  }

  // ── Files ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Someone in a workspace uploads a file to send with a new query or a reply. Until it is sent only they can open it. */
  upload(auth: AuthContext, file: { name: string; contentType: string; data: Buffer }): Promise<SupportAttachmentRow> {
    checkFile(file);
    return this.prisma.run(auth, (tx) => storeFile(tx, auth.tenantId, null, file, { userId: auth.userId }));
  }

  async download(auth: AuthContext, fileId: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    return this.prisma.run(auth, async (tx) => {
      const f = await tx.supportTicketAttachment.findFirst({ where: { tenantId: auth.tenantId, id: fileId } });
      if (!f) throw notFound('File');
      if (!f.messageId || !f.ticketId) {
        if (f.uploadedByUserId !== auth.userId) throw notFound('File');
      } else await this.visibleTicket(tx, auth, await Hierarchy.load(tx, auth.tenantId), f.ticketId);
      return { name: f.name, contentType: f.contentType, data: Buffer.from(f.data) };
    });
  }

  async operatorUpload(op: OperatorContext, ticketId: string, file: { name: string; contentType: string; data: Buffer }): Promise<SupportAttachmentRow> {
    checkFile(file);
    const tenantId = await this.tenantOf(ticketId);
    return this.prisma.run({ tenantId }, (tx) => storeFile(tx, tenantId, ticketId, file, { operatorId: op.id }));
  }

  async operatorDownload(op: OperatorContext, ticketId: string, fileId: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    const tenantId = await this.tenantOf(ticketId);
    return this.prisma.run({ tenantId }, async (tx) => {
      const f = await tx.supportTicketAttachment.findFirst({ where: { tenantId, id: fileId, ticketId } });
      if (!f || (!f.messageId && f.uploadedByOperatorId !== op.id)) throw notFound('File');
      return { name: f.name, contentType: f.contentType, data: Buffer.from(f.data) };
    });
  }

  private async tenantOf(id: string): Promise<string> {
    const t = await this.prisma.run({ operatorScan: true }, (tx) => tx.supportTicket.findFirst({ where: { id, handlerLevel: 'CONSOLE' }, select: { tenantId: true } }));
    if (!t) throw notFound('Support ticket');
    return t.tenantId;
  }

  private async operatorRows(tx: TenantTx, rows: Ticket[]): Promise<OperatorSupportTicketRow[]> {
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const nodeIds = [...new Set(rows.map((r) => r.workspaceNodeId).filter((x): x is string => !!x))];
    const [tenants, nodes, ctx] = await Promise.all([
      tenantIds.length ? tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      nodeIds.length ? tx.workspaceNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true, name: true, level: true } }) : Promise.resolve([]),
      this.rowContext(tx, rows, null),
    ]);
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return rows.map((r) => {
      const node = r.workspaceNodeId ? nodeById.get(r.workspaceNodeId) : null;
      return {
        ...toRow(r, ctx, { userId: null, handling: true }),
        tenant: { id: r.tenantId, name: tenantById.get(r.tenantId)?.name ?? '' },
        workspace: node ? { level: node.level, name: node.name } : { level: 'SUPER', name: 'Super Workspace' },
      };
    });
  }
}

interface RowContext {
  names: Map<string, string>;
  operators: Map<string, string>;
  nodeName: (nodeId: string | null) => string;
}

/**
 * The organisation's workspaces as ticket routing needs them: where a new ticket goes, who handles one now, and who
 * gets told.
 */
class Hierarchy {
  private constructor(
    readonly tenantId: string,
    private readonly nodes: Map<string, { id: string; level: string; name: string; parentId: string | null; archivedAt: Date | null }>,
    private readonly rootId: string | null,
    private readonly levels: Map<string, WorkspaceLevel>,
  ) {}

  static async load(tx: TenantTx, tenantId: string): Promise<Hierarchy> {
    const nodes = await tx.workspaceNode.findMany({ where: { tenantId }, select: { id: true, level: true, name: true, parentId: true, archivedAt: true } });
    const root = nodes.find((n) => n.level === 'SUPER' && !n.parentId);
    return new Hierarchy(tenantId, new Map(nodes.map((n) => [n.id, n])), root?.id ?? null, new Map(nodes.map((n) => [n.id, levelOf(n.level)])));
  }

  isRoot(nodeId: string | null | undefined): boolean {
    return !nodeId || nodeId === this.rootId || !this.nodes.has(nodeId) || this.levels.get(nodeId) === 'SUPER';
  }

  levelOf(nodeId: string | null | undefined): WorkspaceLevel {
    return this.isRoot(nodeId) ? 'SUPER' : this.levels.get(nodeId!)!;
  }

  nameOf(nodeId: string): string {
    return this.nodes.get(nodeId)?.name ?? '';
  }

  /** An executive's ticket goes to its manager; a manager's (or an executive's straight under the Super) to the Super Workspace; the Super's to SampForce. */
  firstHandler(nodeId: string | null | undefined): { level: SupportHandlerLevel; nodeId: string | null } {
    const level = this.levelOf(nodeId);
    if (level === 'SUPER') return { level: 'CONSOLE', nodeId: null };
    if (level === 'EXECUTIVE') {
      const parent = this.nodes.get(this.nodes.get(nodeId!)!.parentId ?? '');
      if (parent && !parent.archivedAt && levelOf(parent.level) === 'MANAGER') return { level: 'MANAGER', nodeId: parent.id };
    }
    return { level: 'SUPER', nodeId: null };
  }

  /** What the caller's workspace answers: its own Manager Workspace's tickets, or the Super Workspace's (administrators only). */
  handles(auth: AuthContext): { level: 'MANAGER' | 'SUPER'; nodeId: string | null } | null {
    const level = this.levelOf(auth.workspaceNodeId);
    if (level === 'MANAGER') return { level: 'MANAGER', nodeId: auth.workspaceNodeId! };
    if (level === 'SUPER' && auth.permissions.includes('members:manage')) return { level: 'SUPER', nodeId: null };
    return null;
  }

  isHandler(auth: AuthContext, t: { handlerLevel: SupportHandlerLevel; handlerNodeId: string | null }): boolean {
    const h = this.handles(auth);
    if (!h || t.handlerLevel === 'CONSOLE') return false;
    return h.level === t.handlerLevel && (h.level === 'SUPER' || h.nodeId === t.handlerNodeId);
  }

  async handlerUserIds(tx: TenantTx, t: { handlerLevel: SupportHandlerLevel; handlerNodeId: string | null }): Promise<string[]> {
    if (t.handlerLevel === 'MANAGER' && t.handlerNodeId) {
      const rows = await tx.membership.findMany({ where: { tenantId: this.tenantId, status: 'ACTIVE', workspaceNodeId: t.handlerNodeId }, select: { userId: true } });
      return rows.map((r) => r.userId);
    }
    if (t.handlerLevel !== 'SUPER') return [];
    const roles = await tx.role.findMany({ where: { tenantId: this.tenantId, permissions: { has: 'members:manage' } }, select: { id: true } });
    if (!roles.length) return [];
    const rows = await tx.membership.findMany({ where: { tenantId: this.tenantId, status: 'ACTIVE', roleId: { in: roles.map((r) => r.id) } }, select: { userId: true, workspaceNodeId: true } });
    return rows.filter((r) => this.isRoot(r.workspaceNodeId)).map((r) => r.userId);
  }
}

function checkFile(file: { name: string; data: Buffer }) {
  if (file.data.length === 0) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file is empty.' });
  if (file.data.length > SUPPORT_ATTACHMENT_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 10 MB.' });
  if (!file.name || file.name.length > 200) throw new BadRequestException({ code: 'INVALID_NAME', message: 'Give the file a name.' });
}

async function storeFile(tx: TenantTx, tenantId: string, ticketId: string | null, file: { name: string; contentType: string; data: Buffer }, by: Uploader): Promise<SupportAttachmentRow> {
  const row = await tx.supportTicketAttachment.create({
    data: {
      tenantId,
      ticketId,
      name: file.name,
      contentType: file.contentType || 'application/octet-stream',
      sizeBytes: file.data.length,
      data: new Uint8Array(file.data),
      sha256: createHash('sha256').update(file.data).digest('hex'),
      ...('userId' in by ? { uploadedByUserId: by.userId } : { uploadedByOperatorId: by.operatorId }),
    },
  });
  return { id: row.id, name: row.name, contentType: row.contentType, sizeBytes: row.sizeBytes };
}

/** Links files the author uploaded (and has not sent yet) to their message. */
async function attach(tx: TenantTx, tenantId: string, ticketId: string, messageId: string, ids: string[], by: Uploader) {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const found = await tx.supportTicketAttachment.findMany({
    where: { tenantId, id: { in: unique }, messageId: null, ...('userId' in by ? { uploadedByUserId: by.userId } : { uploadedByOperatorId: by.operatorId, ticketId }) },
    select: { id: true },
  });
  if (found.length !== unique.length) throw badRequest('attachmentIds', 'refers to a record that does not exist');
  await tx.supportTicketAttachment.updateMany({ where: { tenantId, id: { in: unique } }, data: { ticketId, messageId } });
}

async function ticketFiles(tx: TenantTx, ticket: { id: string; tenantId: string }): Promise<Files> {
  const rows = await tx.supportTicketAttachment.findMany({
    where: { tenantId: ticket.tenantId, ticketId: ticket.id, messageId: { not: null } },
    select: { id: true, name: true, contentType: true, sizeBytes: true, messageId: true },
    orderBy: { createdAt: 'asc' },
  });
  const byMessage: Files = new Map();
  for (const r of rows) byMessage.set(r.messageId!, [...(byMessage.get(r.messageId!) ?? []), { id: r.id, name: r.name, contentType: r.contentType, sizeBytes: r.sizeBytes }]);
  return byMessage;
}

/** The record a query is about must exist in the workspace; its name is kept so support reads it at a glance. */
async function relatedRecord(tx: TenantTx, tenantId: string, type: SupportRecordType, id: string): Promise<{ type: SupportRecordType; id: string; label: string }> {
  const where = { tenantId, id };
  let label: string | null | undefined;
  if (type === 'lead') label = (await tx.lead.findFirst({ where, select: { fullName: true } }))?.fullName;
  else if (type === 'company') label = (await tx.company.findFirst({ where, select: { name: true } }))?.name;
  else if (type === 'deal') label = (await tx.opportunity.findFirst({ where, select: { name: true } }))?.name;
  else {
    const c = await tx.contact.findFirst({ where, select: { firstName: true, lastName: true } });
    label = c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : null;
  }
  if (label == null) throw badRequest('relatedRecord', 'refers to a record that does not exist');
  return { type, id, label };
}

/** What the app already knows about the person raising a query, so they never type it. */
async function captureContext(tx: TenantTx, auth: AuthContext, org: Hierarchy): Promise<SupportTicketContext> {
  const [membership, user] = await Promise.all([
    tx.membership.findFirst({ where: { tenantId: auth.tenantId, id: auth.membershipId }, select: { roleId: true } }),
    tx.user.findFirst({ where: { id: auth.userId }, select: { email: true } }),
  ]);
  const role = membership ? await tx.role.findFirst({ where: { tenantId: auth.tenantId, id: membership.roleId }, select: { name: true } }) : null;
  const level = org.levelOf(auth.workspaceNodeId);
  return {
    workspaceName: org.isRoot(auth.workspaceNodeId) ? 'Super Workspace' : org.nameOf(auth.workspaceNodeId!),
    workspaceLevel: level,
    roleName: role?.name ?? auth.roleKey,
    email: user?.email ?? '',
  };
}

async function notifyRaiser(notifications: NotificationsService, tx: TenantTx, tenantId: string, ticket: { id: string; number: number; subject: string; raisedByUserId: string; priority: string }, status: SupportTicketStatus) {
  await notifications.send(tx, tenantId, [ticket.raisedByUserId], {
    type: 'support.status',
    title: STATUS_TITLE[status](ticket.number),
    body: ticket.subject,
    link: `/app/help/queries?ticket=${ticket.id}`,
    ...(status === 'AWAITING_USER' ? { actionRequired: true, priority: ticket.priority === 'HIGH' ? 'HIGH' : 'NORMAL' } : {}),
  });
}

async function userNames(tx: TenantTx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function operatorNames(tx: TenantTx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const ops = await tx.platformOperator.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(ops.map((o) => [o.id, o.name]));
}

function toRow(t: Ticket, ctx: RowContext, reader: { userId: string | null; handling: boolean }): SupportTicketRow {
  const last = t.messages[t.messages.length - 1];
  const handlerName = t.handlerLevel === 'CONSOLE' ? SUPPORT_NAME : t.handlerLevel === 'SUPER' ? 'Super Workspace' : ctx.nodeName(t.handlerNodeId);
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    featureKey: t.featureKey,
    priority: t.priority,
    status: t.status,
    handlerLevel: t.handlerLevel,
    handler: { level: t.handlerLevel, name: handlerName },
    assignedTo: t.assignedOperatorId ? { id: t.assignedOperatorId, name: ctx.operators.get(t.assignedOperatorId) ?? SUPPORT_NAME } : null,
    resolutionNote: t.resolutionNote,
    handling: reader.handling,
    canEscalate: reader.handling && t.handlerLevel !== 'CONSOLE',
    escalatedAt: t.escalatedAt?.toISOString() ?? null,
    source: t.source,
    pagePath: t.pagePath,
    categoryOther: t.categoryOther,
    relatedRecord: t.relatedRecordType && t.relatedRecordId ? { type: t.relatedRecordType as SupportRecordType, id: t.relatedRecordId, label: t.relatedRecordLabel ?? '' } : null,
    contactMethod: t.contactMethod as SupportContactMethod,
    contactPhone: t.contactPhone,
    appVersion: t.appVersion,
    context: (t.context as SupportTicketContext | null) ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    raisedBy: { id: t.raisedByUserId, name: ctx.names.get(t.raisedByUserId) ?? '' },
    mine: reader.userId !== null && t.raisedByUserId === reader.userId,
    messageCount: t.messages.length,
    lastMessageAt: t.lastMessageAt.toISOString(),
    lastAuthorKind: (last?.authorKind as SupportAuthorKind | undefined) ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Workspaces see operators as one support desk; the Console sees which operator wrote. */
function toMessage(
  m: TicketMessage,
  names: Map<string, string>,
  files: Files,
  reader: { userId?: string; operatorId?: string; operators?: Map<string, string> },
): SupportTicketMessageRow {
  const author =
    m.authorKind === 'OPERATOR'
      ? { id: reader.operators ? (m.operatorId ?? 'support') : 'support', name: reader.operators?.get(m.operatorId ?? '') ?? SUPPORT_NAME }
      : m.authorUserId
        ? { id: m.authorUserId, name: names.get(m.authorUserId) ?? '' }
        : null;
  return {
    id: m.id,
    authorKind: m.authorKind,
    author,
    mine: m.authorKind === 'OPERATOR' ? !!reader.operatorId && m.operatorId === reader.operatorId : !!reader.userId && m.authorUserId === reader.userId,
    body: m.body,
    attachments: files.get(m.id) ?? [],
    createdAt: m.createdAt.toISOString(),
  };
}
