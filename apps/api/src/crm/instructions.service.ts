import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type { InstructionRow, InstructionStatus, MessagePriority, z } from '@dealflow/types';
import type { instructionInputSchema, instructionListSchema, instructionProgressSchema } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRef, notFound } from './crm-helpers';
import { companyScope, personRefs, reportingTree, scopeOf, visibility } from './visibility';

type InstructionModel = Prisma.InstructionGetPayload<object>;

/**
 * Instructions and remarks from a manager or senior person to someone below them in the reporting lines (ADR 0063,
 * spec 15.2). The recipient is notified, acknowledges the instruction and marks it done; the sender sees its
 * progress on the manager dashboard and can withdraw it while it is open.
 */
@Injectable()
export class InstructionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  send(auth: AuthContext, input: z.output<typeof instructionInputSchema>, meta: RequestMeta): Promise<InstructionRow> {
    return this.prisma.run(auth, async (tx) => {
      if (input.toUserId === auth.userId) throw badRef('toUserId', 'cannot be yourself');
      if (!(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: input.toUserId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('toUserId');
      if (!(await canInstruct(tx, auth, input.toUserId))) throw new ForbiddenException({ code: 'NOT_YOUR_REPORT', message: 'You can send instructions to people who report to you only.' });
      let company: { id: string; name: string; leadNumber: string | null } | null = null;
      if (input.companyId) {
        const v = await visibility(tx, auth);
        company = await tx.company.findFirst({ where: { id: input.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, name: true, leadNumber: true } });
        if (!company) throw badRef('companyId');
      }
      if (input.contactId && !(await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, deletedAt: null, ...(input.companyId ? { companyId: input.companyId } : {}) }, select: { id: true } }))) throw badRef('contactId');
      const row = await tx.instruction.create({
        data: {
          tenantId: auth.tenantId, fromId: auth.userId, toId: input.toUserId, kind: input.kind, message: input.message,
          companyId: input.companyId ?? null, contactId: input.contactId ?? null, priority: input.priority, dueAt: input.dueAt ? new Date(input.dueAt) : null,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `instruction.sent`, entityType: 'instruction', entityId: row.id, metadata: { to: row.toId, kind: row.kind, companyId: row.companyId }, meta });
      const by = await nameOf(tx, auth.userId);
      await this.notifications.send(tx, auth.tenantId, [row.toId], {
        type: row.kind === 'REMARK' ? 'manager.remark' : 'manager.instruction',
        title: row.kind === 'REMARK' ? `Remark from ${by}` : `Instruction from ${by}`,
        body: row.message,
        link: `/app?view=executive&instruction=${row.id}`,
        senderId: auth.userId,
        priority: row.priority as MessagePriority,
        companyId: row.companyId,
        contactId: row.contactId,
        actionRequired: row.kind === 'INSTRUCTION',
      });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  list(auth: AuthContext, q: z.output<typeof instructionListSchema>): Promise<InstructionRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const where: Prisma.InstructionWhereInput = {
        tenantId: auth.tenantId,
        ...(q.box === 'received' ? { toId: auth.userId } : { fromId: auth.userId }),
        ...(q.status === 'open' ? { status: { in: ['OPEN', 'ACKNOWLEDGED'] } } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
      };
      const rows = await tx.instruction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
      return this.rows(tx, auth, rows);
    });
  }

  /** The recipient acknowledges it, marks it done (with a note) or reopens it. */
  progress(auth: AuthContext, id: string, input: z.output<typeof instructionProgressSchema>, meta: RequestMeta): Promise<InstructionRow> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.instruction.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!r || (r.toId !== auth.userId && r.fromId !== auth.userId)) throw notFound('Instruction');
      if (r.toId !== auth.userId) throw new ForbiddenException({ code: 'NOT_YOUR_INSTRUCTION', message: 'Only the person it was sent to can update an instruction.' });
      if (r.status === 'CANCELLED') throw new BadRequestException({ code: 'INSTRUCTION_CANCELLED', message: 'This instruction was withdrawn.' });
      const now = new Date();
      const data: Prisma.InstructionUpdateInput =
        input.action === 'ACKNOWLEDGE'
          ? { status: r.status === 'DONE' ? 'DONE' : 'ACKNOWLEDGED', acknowledgedAt: r.acknowledgedAt ?? now }
          : input.action === 'DONE'
            ? { status: 'DONE', acknowledgedAt: r.acknowledgedAt ?? now, completedAt: now, completionNote: input.note ?? null }
            : { status: r.acknowledgedAt ? 'ACKNOWLEDGED' : 'OPEN', completedAt: null };
      const row = await tx.instruction.update({ where: { id }, data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `instruction.${input.action.toLowerCase()}`, entityType: 'instruction', entityId: id, metadata: { note: input.note ?? null }, meta });
      if (input.action !== 'REOPEN' && r.status !== row.status) {
        const by = await nameOf(tx, auth.userId);
        await this.notifications.send(tx, auth.tenantId, [r.fromId], {
          type: input.action === 'DONE' ? 'manager.instruction_done' : 'manager.instruction_acknowledged',
          title: input.action === 'DONE' ? `Instruction done: ${by}` : `Instruction acknowledged: ${by}`,
          body: input.note ? `${by}: ${input.note}` : r.message,
          link: '/app?view=manager',
          senderId: auth.userId,
          companyId: r.companyId,
          contactId: r.contactId,
        });
      }
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  /** The sender withdraws an instruction that is not done yet. */
  cancel(auth: AuthContext, id: string, meta: RequestMeta): Promise<InstructionRow> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.instruction.findFirst({ where: { id, tenantId: auth.tenantId, fromId: auth.userId } });
      if (!r) throw notFound('Instruction');
      if (r.status === 'DONE' || r.status === 'CANCELLED') throw new BadRequestException({ code: 'INSTRUCTION_CLOSED', message: 'This instruction is already done or withdrawn.' });
      const row = await tx.instruction.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'instruction.cancelled', entityType: 'instruction', entityId: id, meta });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  async rows(tx: TenantTx, auth: AuthContext, list: InstructionModel[]): Promise<InstructionRow[]> {
    if (!list.length) return [];
    const companyIds = [...new Set(list.map((r) => r.companyId).filter((c): c is string => !!c))];
    const contactIds = [...new Set(list.map((r) => r.contactId).filter((c): c is string => !!c))];
    const [people, companies, contacts] = await Promise.all([
      personRefs(tx, auth.tenantId, list.flatMap((r) => [r.fromId, r.toId])),
      companyIds.length ? tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: companyIds } }, select: { id: true, name: true, leadNumber: true } }) : Promise.resolve([]),
      contactIds.length ? tx.contact.findMany({ where: { tenantId: auth.tenantId, id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
    ]);
    const co = new Map(companies.map((c) => [c.id, c]));
    const ct = new Map(contacts.map((c) => [c.id, { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') }]));
    return list.map((r) => {
      const status = r.status as InstructionStatus;
      const open = status === 'OPEN' || status === 'ACKNOWLEDGED';
      return {
        id: r.id,
        kind: r.kind as InstructionRow['kind'],
        message: r.message,
        from: people.get(r.fromId) ?? null,
        to: people.get(r.toId) ?? null,
        company: r.companyId ? (co.get(r.companyId) ?? null) : null,
        contact: r.contactId ? (ct.get(r.contactId) ?? null) : null,
        priority: r.priority as MessagePriority,
        dueAt: r.dueAt?.toISOString() ?? null,
        status,
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        completionNote: r.completionNote,
        createdAt: r.createdAt.toISOString(),
        canProgress: r.toId === auth.userId && status !== 'CANCELLED',
        canCancel: r.fromId === auth.userId && open,
      };
    });
  }
}

/**
 * Someone below the caller in the reporting lines, or anyone when the caller manages members and sees every record
 * (owners and admins). Seeing every record alone is not enough: older workspaces give it to every role.
 */
export async function canInstruct(tx: TenantTx, auth: AuthContext, userId: string): Promise<boolean> {
  if (scopeOf(auth) === 'ALL' && auth.permissions.includes('members:manage')) return true;
  return (await reportingTree(tx, auth.tenantId, auth.userId)).includes(userId);
}

async function nameOf(tx: TenantTx, userId: string): Promise<string> {
  return (await tx.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '';
}
