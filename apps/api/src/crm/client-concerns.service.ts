import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type { ClientConcernRow, ConcernCategory, MessagePriority, z } from '@dealflow/types';
import type { clientConcernEscalateSchema, clientConcernInputSchema, clientConcernListSchema, clientConcernUpdateSchema } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { reportingManagerOf } from './companies.service';
import { badRef, notFound } from './crm-helpers';
import { managementChain } from './lead-transfers.service';
import { canSeeDetails, companyScope, personRefs, reportingTree, scopeOf, visibility } from './visibility';

type ConcernModel = Prisma.EscalationGetPayload<object>;

const PRIORITY_OF: Record<string, MessagePriority> = { LOW: 'LOW', MEDIUM: 'NORMAL', HIGH: 'HIGH', CRITICAL: 'URGENT' };

/**
 * Client concerns and rejections (ADR 0063, spec section 19): a concern on a company (and optionally one of its
 * employees) with a category, severity, owner, manager and resolution deadline. The manager dashboard lists the
 * unresolved ones; anyone working it can escalate it to the next person up, and resolve it with final remarks.
 * Stored as escalations with a category, so the customer health score counts them too.
 */
@Injectable()
export class ClientConcernsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  raise(auth: AuthContext, input: z.output<typeof clientConcernInputSchema>, meta: RequestMeta): Promise<ClientConcernRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const company = await tx.company.findFirst({ where: { id: input.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) } });
      if (!company) throw notFound('Company');
      if (!canSeeDetails(v, company.ownerId)) throw new BadRequestException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this company.' });
      if (input.contactId && !(await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, companyId: company.id, deletedAt: null }, select: { id: true } }))) throw badRef('contactId');
      for (const [field, id] of [['ownerId', input.ownerId], ['managerId', input.managerId]] as const)
        if (id && !(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: id, status: 'ACTIVE' }, select: { id: true } }))) throw badRef(field);
      const ownerId = input.ownerId ?? company.ownerId ?? auth.userId;
      const managerId = input.managerId ?? (await reportingManagerOf(tx, auth.tenantId, ownerId)) ?? company.managerId ?? null;
      const row = await tx.escalation.create({
        data: {
          tenantId: auth.tenantId, companyId: company.id, contactId: input.contactId ?? null, category: input.category, title: input.title,
          description: input.description ?? null, severity: input.severity, ownerId, managerId, openedById: auth.userId,
          deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'client_concern.raised', entityType: 'company', entityId: company.id, metadata: { concernId: row.id, category: row.category, severity: row.severity }, meta });
      await this.notifications.send(tx, auth.tenantId, [ownerId, managerId].filter((u) => u !== auth.userId), {
        type: 'client_concern.raised',
        title: `Client concern: ${label(company)}`,
        body: row.title,
        link: `/app/companies/${company.id}?concern=${row.id}`,
        senderId: auth.userId,
        priority: PRIORITY_OF[row.severity],
        companyId: company.id,
        contactId: row.contactId,
        actionRequired: true,
      });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  list(auth: AuthContext, q: z.output<typeof clientConcernListSchema>): Promise<ClientConcernRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const base: Prisma.EscalationWhereInput = {
        tenantId: auth.tenantId,
        category: { not: null },
        ...(q.status === 'open' ? { status: 'OPEN' } : q.status === 'resolved' ? { status: 'RESOLVED' } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
      };
      let where: Prisma.EscalationWhereInput;
      if (q.box === 'mine') where = { ...base, OR: [{ ownerId: auth.userId }, { managerId: auth.userId }, { openedById: auth.userId }] };
      else if (q.box === 'escalated') where = { ...base, escalatedToId: auth.userId };
      else {
        const team = await teamOf(tx, auth);
        if (!team) where = base;
        else {
          const companies = (await tx.company.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, ownerId: { in: team } }, select: { id: true } })).map((c) => c.id);
          where = { ...base, OR: [{ ownerId: { in: team } }, { managerId: { in: team } }, ...(companies.length ? [{ companyId: { in: companies } }] : [])] };
        }
      }
      if (q.companyId && q.box !== 'escalated') {
        const v = await visibility(tx, auth);
        if (!(await tx.company.findFirst({ where: { id: q.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true } }))) return [];
        where = { ...base };
      }
      const rows = await tx.escalation.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 200 });
      return this.rows(tx, auth, rows);
    });
  }

  update(auth: AuthContext, id: string, input: z.output<typeof clientConcernUpdateSchema>, meta: RequestMeta): Promise<ClientConcernRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.editable(tx, auth, id);
      for (const [field, uid] of [['ownerId', input.ownerId], ['managerId', input.managerId]] as const)
        if (uid && !(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: uid, status: 'ACTIVE' }, select: { id: true } }))) throw badRef(field);
      if (input.contactId && !(await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, companyId: c.companyId, deletedAt: null }, select: { id: true } }))) throw badRef('contactId');
      const row = await tx.escalation.update({
        where: { id },
        data: {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.severity !== undefined ? { severity: input.severity } : {}),
          ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
          ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
          ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
          ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null } : {}),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'client_concern.updated', entityType: 'company', entityId: c.companyId, metadata: { concernId: id, ...input }, meta });
      if (input.ownerId && input.ownerId !== c.ownerId && input.ownerId !== auth.userId) {
        const company = await tx.company.findFirst({ where: { id: c.companyId, tenantId: auth.tenantId }, select: { name: true, leadNumber: true } });
        await this.notifications.send(tx, auth.tenantId, [input.ownerId], {
          type: 'client_concern.assigned', title: `Client concern: ${label(company ?? { name: '', leadNumber: null })}`, body: row.title,
          link: `/app/companies/${c.companyId}?concern=${id}`, senderId: auth.userId, priority: PRIORITY_OF[row.severity], companyId: c.companyId, contactId: row.contactId, actionRequired: true,
        });
      }
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  /** Sends an open concern up the reporting lines: to the person chosen, else the next person above its manager. */
  escalate(auth: AuthContext, id: string, input: z.output<typeof clientConcernEscalateSchema>, meta: RequestMeta): Promise<ClientConcernRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.editable(tx, auth, id);
      if (c.status === 'RESOLVED') throw new BadRequestException({ code: 'CONCERN_RESOLVED', message: 'This concern is already resolved.' });
      let to = input.toUserId ?? null;
      if (to) {
        if (!(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: to, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('toUserId');
      } else {
        // The concern's manager first, then on up their reporting lines; above the caller when the caller is on them.
        const chain = [c.managerId, ...(await managementChain(tx, auth.tenantId, c.managerId ?? c.ownerId ?? auth.userId))].filter((u): u is string => !!u);
        const mine = chain.indexOf(auth.userId);
        to = (mine >= 0 ? chain.slice(mine + 1) : chain).find((u) => u !== auth.userId && u !== c.escalatedToId && u !== c.ownerId) ?? null;
      }
      if (!to) throw new BadRequestException({ code: 'NO_ONE_ABOVE', message: 'There is no one above in the reporting lines to escalate to. Choose a person.' });
      if (to === auth.userId) throw badRef('toUserId', 'cannot be yourself');
      const row = await tx.escalation.update({ where: { id }, data: { escalatedToId: to, escalatedById: auth.userId, escalatedAt: new Date(), escalationNote: input.note ?? null } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'client_concern.escalated', entityType: 'company', entityId: c.companyId, metadata: { concernId: id, to, note: input.note ?? null }, meta });
      const company = await tx.company.findFirst({ where: { id: c.companyId, tenantId: auth.tenantId }, select: { name: true, leadNumber: true } });
      await this.notifications.send(tx, auth.tenantId, [to], {
        type: 'client_concern.escalated',
        title: `Client concern escalated: ${label(company ?? { name: '', leadNumber: null })}`,
        body: input.note ? `${row.title}: ${input.note}` : row.title,
        link: '/app?view=manager',
        senderId: auth.userId,
        priority: row.severity === 'CRITICAL' ? 'URGENT' : 'HIGH',
        companyId: c.companyId,
        contactId: row.contactId,
        actionRequired: true,
      });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  resolve(auth: AuthContext, id: string, resolution: string, meta: RequestMeta): Promise<ClientConcernRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.editable(tx, auth, id);
      if (c.status === 'RESOLVED') throw new BadRequestException({ code: 'CONCERN_RESOLVED', message: 'This concern is already resolved.' });
      const row = await tx.escalation.update({ where: { id }, data: { status: 'RESOLVED', resolution, resolvedAt: new Date(), resolvedById: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'client_concern.resolved', entityType: 'company', entityId: c.companyId, metadata: { concernId: id }, meta });
      const company = await tx.company.findFirst({ where: { id: c.companyId, tenantId: auth.tenantId }, select: { name: true, leadNumber: true } });
      await this.notifications.send(tx, auth.tenantId, [c.openedById, c.ownerId, c.managerId, c.escalatedToId].filter((u) => u !== auth.userId), {
        type: 'client_concern.resolved',
        title: `Client concern resolved: ${label(company ?? { name: '', leadNumber: null })}`,
        body: resolution,
        link: `/app/companies/${c.companyId}`,
        senderId: auth.userId,
        companyId: c.companyId,
      });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  /** A concern the caller may change: they work it, or the company's owner is in their team (or they see everything). */
  private async editable(tx: TenantTx, auth: AuthContext, id: string): Promise<ConcernModel> {
    const c = await tx.escalation.findFirst({ where: { id, tenantId: auth.tenantId, category: { not: null } } });
    if (!c) throw notFound('Concern');
    const v = await visibility(tx, auth);
    const company = await tx.company.findFirst({ where: { id: c.companyId, tenantId: auth.tenantId, deletedAt: null }, select: { ownerId: true } });
    const involved = [c.ownerId, c.managerId, c.openedById, c.escalatedToId].includes(auth.userId);
    if (!involved) {
      const visible = company && (await tx.company.findFirst({ where: { id: c.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true } }));
      if (!visible) throw notFound('Concern');
      if (!(await canWork(tx, auth, c, company?.ownerId ?? null))) throw new ForbiddenException({ code: 'CONCERN_NOT_YOURS', message: 'Only the people working this concern, or their managers, can change it.' });
    }
    return c;
  }

  async rows(tx: TenantTx, auth: AuthContext, list: ConcernModel[]): Promise<ClientConcernRow[]> {
    if (!list.length) return [];
    const [companies, contacts] = await Promise.all([
      tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: [...new Set(list.map((c) => c.companyId))] } }, select: { id: true, name: true, leadNumber: true, ownerId: true } }),
      tx.contact.findMany({ where: { tenantId: auth.tenantId, id: { in: list.map((c) => c.contactId).filter((c): c is string => !!c) } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const co = new Map(companies.map((c) => [c.id, c]));
    const people = await personRefs(tx, auth.tenantId, list.flatMap((c) => [c.ownerId, c.managerId, c.openedById, c.escalatedToId, c.resolvedById]));
    const ref = (u: string | null | undefined) => (u ? (people.get(u) ?? null) : null);
    const now = Date.now();
    const out: ClientConcernRow[] = [];
    for (const c of list) {
      const company = co.get(c.companyId);
      const contact = c.contactId ? contacts.find((x) => x.id === c.contactId) : undefined;
      const involved = [c.ownerId, c.managerId, c.openedById, c.escalatedToId].includes(auth.userId);
      const edit = involved || (await canWork(tx, auth, c, company?.ownerId ?? null));
      out.push({
        id: c.id,
        company: { id: c.companyId, name: company?.name ?? '', leadNumber: company?.leadNumber ?? null },
        contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') } : null,
        category: (c.category ?? 'GENERAL') as ConcernCategory,
        title: c.title,
        description: c.description,
        severity: c.severity,
        status: c.status,
        owner: ref(c.ownerId),
        manager: ref(c.managerId),
        openedBy: ref(c.openedById),
        deadlineAt: c.deadlineAt?.toISOString() ?? null,
        overdue: c.status === 'OPEN' && !!c.deadlineAt && c.deadlineAt.getTime() < now,
        escalatedTo: ref(c.escalatedToId),
        escalatedAt: c.escalatedAt?.toISOString() ?? null,
        escalationNote: c.escalationNote,
        resolution: c.resolution,
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
        resolvedBy: ref(c.resolvedById),
        createdAt: c.createdAt.toISOString(),
        canEdit: edit && c.status === 'OPEN',
        canEscalate: edit && c.status === 'OPEN',
      });
    }
    return out;
  }
}

/** The caller and everyone reporting to them; null when their role sees every record. */
async function teamOf(tx: TenantTx, auth: AuthContext): Promise<string[] | null> {
  if (scopeOf(auth) === 'ALL') return null;
  return [auth.userId, ...(scopeOf(auth) === 'TEAM' ? await reportingTree(tx, auth.tenantId, auth.userId) : [])];
}

async function canWork(tx: TenantTx, auth: AuthContext, c: ConcernModel, companyOwnerId: string | null): Promise<boolean> {
  if (!auth.permissions.includes('companies:write')) return false;
  if (scopeOf(auth) === 'ALL') return true;
  const below = new Set(await reportingTree(tx, auth.tenantId, auth.userId));
  return [c.ownerId, c.managerId, companyOwnerId].some((u) => !!u && below.has(u));
}

function label(c: { name: string; leadNumber: string | null }): string {
  return c.leadNumber ? `${c.leadNumber} ${c.name}` : c.name;
}
