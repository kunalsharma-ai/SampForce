import { Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  type OperatorSupportTicketDetail,
  type OperatorSupportTicketRow,
  type SupportAuthorKind,
  type SupportCounts,
  type SupportTicketCreateInput,
  type SupportTicketDetail,
  type SupportTicketMessageRow,
  type SupportTicketRow,
  type SupportTicketStatus,
  supportTicketCreateSchema,
} from '@dealflow/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import type { OperatorContext } from '../operator/operator-auth';
import { branchUserIds, workspaceLevelOf } from '../workspaces/access';

type Ticket = Prisma.SupportTicketGetPayload<{ include: { messages: true } }>;
type TicketMessage = Ticket['messages'][number];

/** How SampForce's own team is named to workspaces: one support desk, not individual operators. */
const SUPPORT_NAME = 'SampForce support';

const forbidden = () => new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' });

/**
 * Help Center support tickets (ADR 0073). People raise a query from Help on the web or in the mobile app; the
 * SampForce Console answers it. Each organisation numbers its tickets from 1. Workspace routing through managers and
 * the Super Workspace (ADR 0071 part 5) adds handlers on top of the `handlerLevel` field; every ticket starts at the
 * Console today.
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
      const ticket = await tx.supportTicket.create({
        data: {
          tenantId: auth.tenantId,
          number,
          workspaceNodeId: auth.workspaceNodeId ?? null,
          raisedByUserId: auth.userId,
          raisedByMembershipId: auth.membershipId,
          subject: input.subject,
          category: input.category,
          featureKey: input.featureKey ?? null,
          pagePath: input.pagePath ?? null,
          source: (auth.via as string | undefined) === 'mobile' ? 'mobile' : 'web',
          priority: input.priority,
          status: 'OPEN',
          handlerLevel: 'CONSOLE',
          handlerNodeId: null,
          lastMessageAt: now,
        },
      });
      await tx.supportTicketMessage.create({
        data: { tenantId: auth.tenantId, ticketId: ticket.id, authorKind: 'USER', authorUserId: auth.userId, authorMembershipId: auth.membershipId, body: input.body, createdAt: now },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'support_ticket.raised',
        entityType: 'support_ticket',
        entityId: ticket.id,
        metadata: { number, category: input.category, priority: input.priority },
        meta,
      });
      return ticket.id;
    });
    return this.get(auth, id);
  }

  /** The caller's tickets, or with scope=team also those of their branch (managers) or organisation (Super admins). */
  list(auth: AuthContext, scope: 'mine' | 'team', status?: SupportTicketStatus): Promise<SupportTicketRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const raisers = scope === 'team' ? await this.teamRaisers(tx, auth) : [auth.userId];
      const rows = await tx.supportTicket.findMany({
        where: { tenantId: auth.tenantId, ...(raisers ? { raisedByUserId: { in: raisers } } : {}), ...(status ? { status } : {}) },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { lastMessageAt: 'desc' },
        take: 200,
      });
      const names = await userNames(tx, rows.map((r) => r.raisedByUserId));
      return rows.map((r) => toRow(r, names, auth.userId));
    });
  }

  async get(auth: AuthContext, id: string): Promise<SupportTicketDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ticket = await this.visibleTicket(tx, auth, id);
      const names = await userNames(tx, [ticket.raisedByUserId, ...ticket.messages.map((m) => m.authorUserId)]);
      return {
        ...toRow(ticket, names, auth.userId),
        messages: ticket.messages.map((m) => toMessage(m, names, { userId: auth.userId })),
        canReply: ticket.raisedByUserId === auth.userId,
      };
    });
  }

  /** The raiser writes again. A closed or answered ticket opens again, so support sees it is waiting. */
  async reply(auth: AuthContext, id: string, body: string, meta: RequestMeta): Promise<SupportTicketDetail> {
    await this.prisma.run(auth, async (tx) => {
      const ticket = await this.visibleTicket(tx, auth, id);
      if (ticket.raisedByUserId !== auth.userId) throw forbidden();
      const now = new Date();
      await tx.supportTicketMessage.create({
        data: { tenantId: auth.tenantId, ticketId: id, authorKind: 'USER', authorUserId: auth.userId, authorMembershipId: auth.membershipId, body, createdAt: now },
      });
      const reopen = ticket.status === 'ANSWERED' || ticket.status === 'CLOSED';
      await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: now, ...(reopen ? { status: 'OPEN', closedAt: null } : {}) } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'support_ticket.message_added',
        entityType: 'support_ticket',
        entityId: id,
        metadata: { number: ticket.number, ...(reopen ? { from: ticket.status, to: 'OPEN' } : {}) },
        meta,
      });
    });
    return this.get(auth, id);
  }

  /** The raiser may close their ticket or open it again; everything else is the support desk's. */
  async setStatus(auth: AuthContext, id: string, status: SupportTicketStatus, meta: RequestMeta): Promise<SupportTicketDetail> {
    await this.prisma.run(auth, async (tx) => {
      const ticket = await this.visibleTicket(tx, auth, id);
      if (ticket.raisedByUserId !== auth.userId || (status !== 'CLOSED' && status !== 'OPEN')) throw forbidden();
      if (ticket.status === status) return;
      await tx.supportTicket.update({ where: { id }, data: { status, closedAt: status === 'CLOSED' ? new Date() : null } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'support_ticket.status_changed',
        entityType: 'support_ticket',
        entityId: id,
        metadata: { number: ticket.number, from: ticket.status, to: status },
        meta,
      });
    });
    return this.get(auth, id);
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

  private async visibleTicket(tx: TenantTx, auth: AuthContext, id: string): Promise<Ticket> {
    const ticket = await tx.supportTicket.findFirst({ where: { tenantId: auth.tenantId, id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!ticket) throw notFound('Support ticket');
    if (ticket.raisedByUserId === auth.userId) return ticket;
    const raisers = await this.teamRaisers(tx, auth);
    if (raisers && !raisers.includes(ticket.raisedByUserId)) throw notFound('Support ticket');
    return ticket;
  }

  // ── Console side ─────────────────────────────────────────────────────────────────────────────────────────────────

  operatorList(_op: OperatorContext, q: { status?: SupportTicketStatus; q?: string; tenantId?: string }): Promise<OperatorSupportTicketRow[]> {
    return this.prisma.run({ operatorScan: true }, async (tx) => {
      const number = q.q && /^#?\d+$/.test(q.q) ? Number(q.q.replace('#', '')) : null;
      const rows = await tx.supportTicket.findMany({
        where: {
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
    const groups = await this.prisma.run({ operatorScan: true }, (tx) => tx.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }));
    const n = (s: SupportTicketStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
    return { open: n('OPEN'), inProgress: n('IN_PROGRESS'), answered: n('ANSWERED'), closed: n('CLOSED') };
  }

  async operatorGet(op: OperatorContext, id: string): Promise<OperatorSupportTicketDetail> {
    return this.prisma.run({ operatorScan: true }, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
      if (!ticket) throw notFound('Support ticket');
      const [row] = await this.operatorRows(tx, [ticket]);
      const names = await userNames(tx, ticket.messages.map((m) => m.authorUserId));
      const operators = await operatorNames(tx, ticket.messages.map((m) => m.operatorId));
      return { ...row!, messages: ticket.messages.map((m) => toMessage(m, names, { operatorId: op.id, operators })) };
    });
  }

  /** An operator answers: the ticket becomes Answered and the person who raised it is notified. */
  async operatorReply(op: OperatorContext, id: string, body: string, ip: string | null): Promise<OperatorSupportTicketDetail> {
    const tenantId = await this.tenantOf(id);
    await this.prisma.run({ tenantId }, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { tenantId, id } });
      if (!ticket) throw notFound('Support ticket');
      const now = new Date();
      await tx.supportTicketMessage.create({ data: { tenantId, ticketId: id, authorKind: 'OPERATOR', operatorId: op.id, body, createdAt: now } });
      await tx.supportTicket.update({ where: { id }, data: { status: 'ANSWERED', answeredAt: now, lastMessageAt: now, closedAt: null } });
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

  async operatorSetStatus(op: OperatorContext, id: string, status: SupportTicketStatus, ip: string | null): Promise<OperatorSupportTicketDetail> {
    const tenantId = await this.tenantOf(id);
    const changed = await this.prisma.run({ tenantId }, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { tenantId, id } });
      if (!ticket) throw notFound('Support ticket');
      if (ticket.status === status) return false;
      await tx.supportTicket.update({ where: { id }, data: { status, closedAt: status === 'CLOSED' ? new Date() : null } });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        actorType: 'PLATFORM_ADMIN',
        action: 'support_ticket.status_changed',
        entityType: 'support_ticket',
        entityId: id,
        metadata: { number: ticket.number, operatorId: op.id, from: ticket.status, to: status },
      });
      if (status === 'CLOSED')
        await this.notifications.send(tx, tenantId, [ticket.raisedByUserId], {
          type: 'support.closed',
          title: `SampForce support closed query #${ticket.number}`,
          body: ticket.subject,
          link: `/app/help/queries?ticket=${id}`,
        });
      return true;
    });
    if (changed) await this.prisma.platformAuditLog.create({ data: { operatorId: op.id, action: 'support_ticket.status_changed', targetTenantId: tenantId, metadata: { ticketId: id, status }, ip } });
    return this.operatorGet(op, id);
  }

  private async tenantOf(id: string): Promise<string> {
    const t = await this.prisma.run({ operatorScan: true }, (tx) => tx.supportTicket.findFirst({ where: { id }, select: { tenantId: true } }));
    if (!t) throw notFound('Support ticket');
    return t.tenantId;
  }

  private async operatorRows(tx: TenantTx, rows: Ticket[]): Promise<OperatorSupportTicketRow[]> {
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const nodeIds = [...new Set(rows.map((r) => r.workspaceNodeId).filter((x): x is string => !!x))];
    const [tenants, nodes, names] = await Promise.all([
      tenantIds.length ? tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      nodeIds.length ? tx.workspaceNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true, name: true, level: true } }) : Promise.resolve([]),
      userNames(tx, rows.map((r) => r.raisedByUserId)),
    ]);
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return rows.map((r) => {
      const node = r.workspaceNodeId ? nodeById.get(r.workspaceNodeId) : null;
      return {
        ...toRow(r, names, null),
        tenant: { id: r.tenantId, name: tenantById.get(r.tenantId)?.name ?? '' },
        workspace: node ? { level: node.level, name: node.name } : { level: 'SUPER', name: 'Super Workspace' },
      };
    });
  }
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

function toRow(t: Ticket, names: Map<string, string>, readerId: string | null): SupportTicketRow {
  const last = t.messages[t.messages.length - 1];
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    featureKey: t.featureKey,
    priority: t.priority,
    status: t.status,
    handlerLevel: t.handlerLevel,
    source: t.source,
    pagePath: t.pagePath,
    raisedBy: { id: t.raisedByUserId, name: names.get(t.raisedByUserId) ?? '' },
    mine: readerId !== null && t.raisedByUserId === readerId,
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
    createdAt: m.createdAt.toISOString(),
  };
}
