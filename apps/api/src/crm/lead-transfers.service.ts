import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type { LeadTransferRow, TransferStatus, z } from '@dealflow/types';
import type { leadTransferDecisionSchema, leadTransferInputSchema, leadTransferListSchema, leadTransferUpdateSchema } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertAssignable, CompaniesService, reportingManagerOf } from './companies.service';
import { badRef, notFound } from './crm-helpers';
import { canSeeDetails, companyScope, personRefs, reportingTree, scopeOf, visibility } from './visibility';

type TransferModel = Prisma.LeadTransferGetPayload<object>;

/** Everyone above a person in the reporting lines, nearest first (loops are refused when set, and stopped here). */
export async function managementChain(tx: TenantTx, tenantId: string, userId: string): Promise<string[]> {
  const rows = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true, reportingManagerId: true } });
  const up = new Map(rows.map((r) => [r.userId, r.reportingManagerId]));
  const chain: string[] = [];
  let cur = up.get(userId) ?? null;
  while (cur && !chain.includes(cur) && cur !== userId) {
    chain.push(cur);
    cur = up.get(cur) ?? null;
  }
  return chain;
}

/**
 * Lead transfer requests (ADR 0063, section 16 of the specification). The person working a lead asks for it to go to
 * their manager or a senior person; someone above them in the reporting lines (or anyone whose role sees every
 * record) approves it, rejects it, or gives it to someone else. Approving moves the lead through the normal owner
 * change, so the ownership history and notifications are the same, and the lead creator never changes.
 */
@Injectable()
export class LeadTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly companies: CompaniesService,
  ) {}

  request(auth: AuthContext, input: z.output<typeof leadTransferInputSchema>, meta: RequestMeta): Promise<LeadTransferRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const company = await tx.company.findFirst({ where: { id: input.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) } });
      if (!company) throw notFound('Company');
      if (!canSeeDetails(v, company.ownerId)) throw new BadRequestException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this company.' });
      if (await tx.leadTransfer.findFirst({ where: { tenantId: auth.tenantId, companyId: company.id, status: 'PENDING' }, select: { id: true } })) {
        throw new BadRequestException({ code: 'TRANSFER_PENDING', message: 'This company already has a transfer request waiting for a decision.' });
      }
      if (input.toUserId) {
        if (!(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: input.toUserId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('toUserId');
        if (input.toUserId === company.ownerId) throw badRef('toUserId', 'already owns this company');
      }
      if (input.contactId && !(await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, companyId: company.id, deletedAt: null }, select: { id: true } }))) throw badRef('contactId');
      const fileIds = [...new Set(input.fileIds)];
      if (fileIds.length && (await tx.companyFile.count({ where: { tenantId: auth.tenantId, companyId: company.id, id: { in: fileIds } } })) !== fileIds.length) throw badRef('fileIds');
      const row = await tx.leadTransfer.create({
        data: {
          tenantId: auth.tenantId, companyId: company.id, contactId: input.contactId ?? null, fromUserId: company.ownerId, toUserId: input.toUserId ?? null,
          requestedById: auth.userId, reason: input.reason, opportunityValue: input.opportunityValue ?? null, currency: input.currency ?? null,
          remarks: input.remarks ?? null, fileIds,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead_transfer.requested', entityType: 'company', entityId: company.id, metadata: { transferId: row.id, to: row.toUserId, reason: row.reason }, meta });
      const deciders = [...new Set([(await reportingManagerOf(tx, auth.tenantId, auth.userId)) ?? null, row.toUserId].filter((u): u is string => !!u && u !== auth.userId))];
      const by = await this.nameOf(tx, auth.userId);
      await this.notifications.send(tx, auth.tenantId, deciders, {
        type: 'lead_transfer.requested',
        title: `Company transfer request: ${label(company)}`,
        body: row.remarks ? `${by}: ${row.remarks}` : `Requested by ${by}.`,
        link: `/app?view=executive&transfer=${row.id}`,
      });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  list(auth: AuthContext, q: z.output<typeof leadTransferListSchema>): Promise<LeadTransferRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const base: Prisma.LeadTransferWhereInput = { tenantId: auth.tenantId, ...(q.status ? { status: q.status } : {}), ...(q.companyId ? { companyId: q.companyId } : {}) };
      let where: Prisma.LeadTransferWhereInput;
      if (q.box === 'mine') where = { ...base, OR: [{ requestedById: auth.userId }, { fromUserId: auth.userId }] };
      else if (q.box === 'toDecide') {
        const scope = scopeOf(auth);
        if (scope === 'ALL') where = { ...base, status: 'PENDING', requestedById: { not: auth.userId } };
        else {
          const reports = await this.reportsOf(tx, auth);
          where = { ...base, status: 'PENDING', requestedById: { in: reports } };
        }
      } else {
        const v = await visibility(tx, auth);
        const visible = v.all ? null : (await tx.company.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true } })).map((c) => c.id);
        where = { ...base, ...(visible ? { companyId: { in: visible } } : {}) };
      }
      const rows = await tx.leadTransfer.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
      return this.rows(tx, auth, rows);
    });
  }

  decide(auth: AuthContext, id: string, input: z.output<typeof leadTransferDecisionSchema>, meta: RequestMeta): Promise<LeadTransferRow> {
    return this.prisma.run(auth, async (tx) => {
      const t = await tx.leadTransfer.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!t) throw notFound('Transfer request');
      if (t.status !== 'PENDING') throw new BadRequestException({ code: 'TRANSFER_DECIDED', message: 'This transfer request has already been decided.' });
      if (!(await this.canDecide(tx, auth, t))) throw new ForbiddenException({ code: 'TRANSFER_NOT_YOURS', message: 'Only someone above the requester in the reporting lines can decide this request.' });
      const company = await tx.company.findFirst({ where: { id: t.companyId, tenantId: auth.tenantId, deletedAt: null } });
      if (!company) throw notFound('Company');
      let status: TransferStatus = 'REJECTED';
      let newOwnerId: string | null = null;
      if (input.action !== 'REJECT') {
        newOwnerId = input.toUserId ?? t.toUserId ?? auth.userId;
        if (!(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: newOwnerId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('toUserId');
        await assertAssignable(tx, auth, newOwnerId);
        status = input.action === 'REASSIGN' || (input.toUserId && t.toUserId && input.toUserId !== t.toUserId) ? 'REASSIGNED' : 'APPROVED';
        if (newOwnerId !== company.ownerId) {
          // The lead creator stays; the assigned manager follows the new owner, as with any owner change.
          const managerId = await reportingManagerOf(tx, auth.tenantId, newOwnerId);
          const updated = await tx.company.update({ where: { id: company.id }, data: { ownerId: newOwnerId, managerId, updatedById: auth.userId } });
          await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.owner_changed', entityType: 'company', entityId: company.id, metadata: { from: company.ownerId, to: newOwnerId, reason: t.reason, transferId: t.id }, meta });
          await this.companies.recordOwnerChange(tx, auth, updated, company.ownerId, newOwnerId, t.reason, input.instructions ?? t.remarks ?? null);
        }
      }
      const row = await tx.leadTransfer.update({
        where: { id },
        data: { status, decidedById: auth.userId, decidedAt: new Date(), decisionNote: input.note ?? null, instructions: input.instructions ?? null, newOwnerId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `lead_transfer.${status.toLowerCase()}`, entityType: 'company', entityId: company.id, metadata: { transferId: id, newOwnerId, note: input.note ?? null }, meta });
      const people = [t.requestedById, t.fromUserId].filter((u): u is string => !!u && u !== auth.userId);
      const by = await this.nameOf(tx, auth.userId);
      await this.notifications.send(tx, auth.tenantId, people, {
        type: status === 'REJECTED' ? 'lead_transfer.rejected' : 'lead_transfer.approved',
        title: status === 'REJECTED' ? `Company transfer rejected: ${label(company)}` : `Company transfer approved: ${label(company)}`,
        body: input.note ? `${by}: ${input.note}` : `Decided by ${by}.`,
        link: `/app/companies/${company.id}`,
      });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  /** The requester changes a request that is still pending; whoever decides it is told it changed. */
  update(auth: AuthContext, id: string, input: z.output<typeof leadTransferUpdateSchema>, meta: RequestMeta): Promise<LeadTransferRow> {
    return this.prisma.run(auth, async (tx) => {
      const t = await tx.leadTransfer.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!t || t.requestedById !== auth.userId) throw notFound('Transfer request');
      if (t.status !== 'PENDING') throw new BadRequestException({ code: 'TRANSFER_DECIDED', message: 'This transfer request has already been decided.' });
      const company = await tx.company.findFirst({ where: { id: t.companyId, tenantId: auth.tenantId, deletedAt: null } });
      if (!company) throw notFound('Company');
      if (input.toUserId) {
        if (!(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: input.toUserId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('toUserId');
        if (input.toUserId === company.ownerId) throw badRef('toUserId', 'already owns this company');
      }
      if (input.contactId && !(await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, companyId: company.id, deletedAt: null }, select: { id: true } }))) throw badRef('contactId');
      const fileIds = input.fileIds ? [...new Set(input.fileIds)] : undefined;
      if (fileIds?.length && (await tx.companyFile.count({ where: { tenantId: auth.tenantId, companyId: company.id, id: { in: fileIds } } })) !== fileIds.length) throw badRef('fileIds');
      const fields = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
      if (!fields.length) return (await this.rows(tx, auth, [t]))[0]!;
      const row = await tx.leadTransfer.update({
        where: { id },
        data: {
          ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
          ...(input.toUserId !== undefined ? { toUserId: input.toUserId } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.opportunityValue !== undefined ? { opportunityValue: input.opportunityValue } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
          ...(fileIds ? { fileIds } : {}),
          editedAt: new Date(),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead_transfer.updated', entityType: 'company', entityId: company.id, metadata: { transferId: id, fields }, meta });
      const deciders = [...new Set([(await reportingManagerOf(tx, auth.tenantId, auth.userId)) ?? null, row.toUserId].filter((u): u is string => !!u && u !== auth.userId))];
      const by = await this.nameOf(tx, auth.userId);
      await this.notifications.send(tx, auth.tenantId, deciders, {
        type: 'lead_transfer.requested',
        title: `Company transfer request updated: ${label(company)}`,
        body: row.remarks ? `${by}: ${row.remarks}` : `Updated by ${by}.`,
        link: `/app?view=executive&transfer=${row.id}`,
      });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  cancel(auth: AuthContext, id: string, meta: RequestMeta): Promise<LeadTransferRow> {
    return this.prisma.run(auth, async (tx) => {
      const t = await tx.leadTransfer.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!t || t.requestedById !== auth.userId) throw notFound('Transfer request');
      if (t.status !== 'PENDING') throw new BadRequestException({ code: 'TRANSFER_DECIDED', message: 'This transfer request has already been decided.' });
      const row = await tx.leadTransfer.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date(), decidedById: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead_transfer.cancelled', entityType: 'company', entityId: t.companyId, metadata: { transferId: id }, meta });
      return (await this.rows(tx, auth, [row]))[0]!;
    });
  }

  /** Someone above the requester, or anyone whose role sees every record; never the requester. */
  private async canDecide(tx: TenantTx, auth: AuthContext, t: TransferModel, reports?: Set<string>): Promise<boolean> {
    if (t.requestedById === auth.userId || t.status !== 'PENDING') return false;
    if (!auth.permissions.includes('companies:write')) return false;
    if (scopeOf(auth) === 'ALL') return true;
    return (reports ?? new Set(await this.reportsOf(tx, auth))).has(t.requestedById);
  }

  /** Everyone below the caller in the reporting lines. */
  private reportsOf(tx: TenantTx, auth: AuthContext): Promise<string[]> {
    return reportingTree(tx, auth.tenantId, auth.userId);
  }

  private async nameOf(tx: TenantTx, userId: string): Promise<string> {
    return (await tx.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '';
  }

  private async rows(tx: TenantTx, auth: AuthContext, list: TransferModel[]): Promise<LeadTransferRow[]> {
    if (!list.length) return [];
    const [companies, contacts, files] = await Promise.all([
      tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: list.map((t) => t.companyId) } }, select: { id: true, name: true, leadNumber: true, createdById: true } }),
      tx.contact.findMany({ where: { tenantId: auth.tenantId, id: { in: list.map((t) => t.contactId).filter((c): c is string => !!c) } }, select: { id: true, firstName: true, lastName: true } }),
      tx.companyFile.findMany({ where: { tenantId: auth.tenantId, id: { in: list.flatMap((t) => t.fileIds) } }, select: { id: true, name: true } }),
    ]);
    const byCompany = new Map(companies.map((c) => [c.id, c]));
    const people = await personRefs(tx, auth.tenantId, [...list.flatMap((t) => [t.fromUserId, t.toUserId, t.requestedById, t.decidedById, t.newOwnerId]), ...companies.map((c) => c.createdById)]);
    const ref = (u: string | null | undefined) => (u ? (people.get(u) ?? null) : null);
    const reports = new Set(scopeOf(auth) === 'ALL' ? [] : await this.reportsOf(tx, auth));
    const out: LeadTransferRow[] = [];
    for (const t of list) {
      const c = byCompany.get(t.companyId);
      const contact = t.contactId ? contacts.find((x) => x.id === t.contactId) : undefined;
      out.push({
        id: t.id,
        company: { id: t.companyId, name: c?.name ?? '', leadNumber: c?.leadNumber ?? null },
        contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') } : null,
        from: ref(t.fromUserId),
        proposed: ref(t.toUserId),
        requestedBy: ref(t.requestedById),
        reason: t.reason,
        opportunityValue: t.opportunityValue,
        currency: t.currency,
        remarks: t.remarks,
        files: files.filter((f) => t.fileIds.includes(f.id)),
        status: t.status as TransferStatus,
        decidedBy: ref(t.decidedById),
        decidedAt: t.decidedAt?.toISOString() ?? null,
        decisionNote: t.decisionNote,
        instructions: t.instructions,
        newOwner: ref(t.newOwnerId),
        creator: ref(c?.createdById),
        canDecide: await this.canDecide(tx, auth, t, reports),
        canEdit: t.requestedById === auth.userId && t.status === 'PENDING',
        editedAt: t.editedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      });
    }
    return out;
  }
}

function label(c: { name: string; leadNumber: string | null }): string {
  return c.leadNumber ? `${c.leadNumber} ${c.name}` : c.name;
}
