import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  PORTAL_DOCUMENT_MAX_BYTES,
  PORTAL_DOCUMENT_TYPES,
  type PortalDashboard,
  type PortalDocumentRow,
  type PortalMe,
  type PortalMessageRow,
  type PortalRequest,
  type PortalRequestRow,
  type PublicProposal,
} from '@dealflow/types';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ProposalsService } from '../commercial/proposals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { brandingOf, type PortalContext } from './portal-auth.service';
import { DocumentLinks } from './portal-documents';

type Settings = NonNullable<Awaited<ReturnType<TenantTx['portalSettings']['findUnique']>>>;
const off = (what: string) => new ForbiddenException({ code: 'PORTAL_FEATURE_OFF', message: `${what}: not available in this portal.` });
export const requestRef = (n: number) => `R-${String(n).padStart(4, '0')}`;

/**
 * What a signed-in customer can see and do. Every query is scoped to the workspace (row-level security) and to the
 * customer's own company in the WHERE clause, and every section obeys the portal settings the workspace chose.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly links: DocumentLinks,
  ) {}

  private run<T>(ctx: PortalContext, fn: (tx: TenantTx, settings: Settings) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: ctx.tenantId }, async (tx) => {
      const settings = await tx.portalSettings.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
      return fn(tx, settings);
    });
  }

  me(ctx: PortalContext): Promise<PortalMe> {
    return this.run(ctx, async (tx, s) => {
      const company = await tx.company.findFirstOrThrow({ where: { id: ctx.user.companyId, tenantId: ctx.tenantId }, select: { id: true, name: true, ownerId: true } });
      const manager = company.ownerId ? await tx.user.findFirst({ where: { id: company.ownerId }, select: { name: true, email: true } }) : null;
      const seen = (await tx.portalUser.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { updatesSeenAt: true } })).updatesSeenAt;
      const unread = await tx.portalUpdate.count({ where: { tenantId: ctx.tenantId, companyId: company.id, ...(seen ? { createdAt: { gt: seen } } : {}) } });
      return {
        user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role },
        company: { id: company.id, name: company.name },
        accountManager: manager,
        branding: await brandingOf(tx, ctx.tenantId),
        features: {
          showDeals: s.showDeals, showQuotes: s.showQuotes, showContracts: s.showContracts, showTasks: s.showTasks, showDocuments: s.showDocuments,
          allowRequests: s.allowRequests, allowMessages: s.allowMessages, allowUploads: s.allowUploads, allowApprovals: s.allowApprovals,
        },
        unreadUpdates: unread,
      };
    });
  }

  dashboard(ctx: PortalContext): Promise<PortalDashboard> {
    return this.run(ctx, async (tx, s) => {
      const companyId = ctx.user.companyId;
      const tenantId = ctx.tenantId;
      const deals = s.showDeals || s.showTasks || s.showQuotes
        ? await tx.opportunity.findMany({
            where: { tenantId, companyId, deletedAt: null },
            select: { id: true, name: true, status: true, expectedCloseDate: true, stage: { select: { name: true, position: true } }, pipeline: { select: { stages: { where: { category: 'OPEN' }, select: { id: true } } } } },
            orderBy: { updatedAt: 'desc' },
            take: 50,
          })
        : [];
      const quotes = s.showQuotes
        ? await tx.quote.findMany({
            where: { tenantId, isLatest: true, status: { in: ['SENT', 'ACCEPTED', 'DECLINED'] }, opportunity: { companyId, deletedAt: null } },
            select: { id: true, number: true, version: true, title: true, status: true, total: true, currency: true, validUntil: true, decidedAt: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : [];
      const contracts = s.showContracts
        ? await tx.contract.findMany({ where: { tenantId, companyId, status: { not: 'DRAFT' } }, select: { id: true, name: true, status: true, startDate: true, endDate: true, value: true, currency: true }, orderBy: { startDate: 'desc' }, take: 50 })
        : [];
      const contactIds = (await tx.contact.findMany({ where: { tenantId, companyId, deletedAt: null }, select: { id: true } })).map((c) => c.id);
      const milestones = s.showTasks
        ? await tx.task.findMany({
            where: { tenantId, portalVisible: true, deletedAt: null, OR: [{ opportunityId: { in: deals.map((d) => d.id) } }, { contactId: { in: contactIds } }] },
            select: { id: true, title: true, dueAt: true, status: true, opportunity: { select: { name: true } } },
            orderBy: [{ dueAt: 'asc' }],
            take: 100,
          })
        : [];
      const seen = (await tx.portalUser.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { updatesSeenAt: true } })).updatesSeenAt;
      const updates = await tx.portalUpdate.findMany({ where: { tenantId, companyId }, orderBy: { createdAt: 'desc' }, take: 20 });
      const openRequests = s.allowRequests ? await tx.portalRequest.count({ where: { tenantId, companyId, status: { in: ['open', 'in_progress'] } } }) : 0;
      const today = new Date().toISOString().slice(0, 10);
      return {
        deals: s.showDeals
          ? deals.map((d) => {
              const total = d.pipeline.stages.length || 1;
              const progress = d.status === 'WON' ? 100 : d.status === 'LOST' ? 0 : Math.round((Math.min(d.stage.position, total) / total) * 100);
              return { id: d.id, name: d.name, stage: d.stage.name, status: d.status as 'OPEN' | 'WON' | 'LOST', expectedCloseDate: d.expectedCloseDate?.toISOString().slice(0, 10) ?? null, progress };
            })
          : [],
        proposals: quotes.map((q) => {
          const validUntil = q.validUntil?.toISOString().slice(0, 10) ?? null;
          return {
            id: q.id,
            reference: `Q-${String(q.number).padStart(4, '0')}${q.version > 1 ? ` v${q.version}` : ''}`,
            title: q.title,
            status: q.status,
            total: q.total.toNumber(),
            currency: q.currency,
            validUntil,
            canDecide: s.allowApprovals && ctx.user.role === 'approver' && q.status === 'SENT' && !(validUntil && validUntil < today),
            decidedAt: q.decidedAt?.toISOString() ?? null,
          };
        }),
        contracts: contracts.map((c) => ({ id: c.id, name: c.name, status: c.status, startDate: c.startDate.toISOString().slice(0, 10), endDate: c.endDate?.toISOString().slice(0, 10) ?? null, value: c.value.toNumber(), currency: c.currency })),
        milestones: milestones.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt?.toISOString() ?? null, done: t.status === 'DONE', deal: t.opportunity?.name ?? null })),
        updates: updates.map((u) => ({ id: u.id, kind: u.kind, title: u.title, body: u.body, createdAt: u.createdAt.toISOString(), unread: !seen || u.createdAt > seen })),
        openRequests,
        invoices: 'not_connected',
      };
    });
  }

  async markUpdatesSeen(ctx: PortalContext): Promise<void> {
    await this.prisma.run({ tenantId: ctx.tenantId }, (tx) => tx.portalUser.update({ where: { id: ctx.user.id }, data: { updatesSeenAt: new Date() } }));
  }

  async proposal(ctx: PortalContext, quoteId: string): Promise<PublicProposal> {
    const on = await this.run(ctx, async (_tx, s) => s.showQuotes);
    if (!on) throw off('Proposals');
    const p = await this.proposals.forPortal(ctx.tenantId, quoteId, ctx.user.companyId);
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proposal not found.' });
    return p;
  }

  /** Approve or decline a sent proposal. Only people the workspace made approvers, and only when approvals are on. */
  decide(ctx: PortalContext, quoteId: string, decision: 'accept' | 'decline', note: string | undefined, meta: RequestMeta): Promise<{ status: string }> {
    return this.run(ctx, async (tx, s) => {
      if (!s.allowApprovals) throw off('Approving proposals');
      if (ctx.user.role !== 'approver') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your portal access does not include approving proposals.' });
      const q = await tx.quote.findFirst({
        where: { id: quoteId, tenantId: ctx.tenantId, opportunity: { companyId: ctx.user.companyId, deletedAt: null } },
        select: { id: true, number: true, version: true, status: true, isLatest: true, validUntil: true, createdById: true, opportunity: { select: { id: true, name: true, ownerId: true } } },
      });
      if (!q || !['SENT', 'ACCEPTED', 'DECLINED'].includes(q.status)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proposal not found.' });
      if (!q.isLatest) throw new ConflictException({ code: 'QUOTE_SUPERSEDED', message: 'A newer version of this proposal exists.' });
      if (q.status !== 'SENT') throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'This proposal has already been decided.' });
      if (q.validUntil && q.validUntil.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) {
        throw new ConflictException({ code: 'QUOTE_EXPIRED', message: 'This proposal has expired. Ask your account manager for an updated one.' });
      }
      const status = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';
      const { count } = await tx.quote.updateMany({ where: { id: q.id, status: 'SENT' }, data: { status, decidedAt: new Date(), decidedByPortalUserId: ctx.user.id, decisionNote: note || null } });
      if (!count) throw new ConflictException({ code: 'CONCURRENT_CHANGE', message: 'The proposal changed while you were looking at it. Reload and try again.' });
      const ref = `Q-${String(q.number).padStart(4, '0')}${q.version > 1 ? ` v${q.version}` : ''}`;
      await this.audit.record(tx, {
        tenantId: ctx.tenantId, actorUserId: null, action: decision === 'accept' ? 'portal.proposal_accepted' : 'portal.proposal_declined', entityType: 'quote', entityId: q.id,
        metadata: { reference: ref, portalUserId: ctx.user.id, name: ctx.user.name, email: ctx.user.email, note: note ?? null }, meta,
      });
      await this.notifications.send(tx, ctx.tenantId, [q.createdById, q.opportunity.ownerId], {
        type: decision === 'accept' ? 'quote.accepted_in_portal' : 'quote.declined_in_portal',
        title: `${ctx.user.name} ${decision === 'accept' ? 'approved' : 'declined'} ${ref}`,
        body: `${q.opportunity.name}, in the client portal.${note ? ` Note: ${note.slice(0, 200)}` : ''}`,
        link: `/app/quotes/${q.id}`,
      });
      await addUpdate(tx, ctx.tenantId, ctx.user.companyId, 'proposal', `${ref} ${decision === 'accept' ? 'approved' : 'declined'} by ${ctx.user.name}`, null);
      return { status };
    });
  }

  // ─── Requests and messages ───

  listRequests(ctx: PortalContext): Promise<PortalRequestRow[]> {
    return this.run(ctx, async (tx, s) => {
      if (!s.allowRequests) throw off('Support requests');
      return requestRows(tx, ctx.tenantId, { companyId: ctx.user.companyId });
    });
  }

  getRequest(ctx: PortalContext, id: string): Promise<PortalRequest> {
    return this.run(ctx, async (tx, s) => {
      if (!s.allowRequests) throw off('Support requests');
      return requestDetail(tx, ctx.tenantId, id, ctx.user.companyId);
    });
  }

  createRequest(ctx: PortalContext, input: { subject: string; category: string; body: string }, meta: RequestMeta): Promise<PortalRequest> {
    return this.run(ctx, async (tx, s) => {
      if (!s.allowRequests) throw off('Support requests');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal_request:${ctx.tenantId}`}))`;
      const last = await tx.portalRequest.aggregate({ where: { tenantId: ctx.tenantId }, _max: { number: true } });
      const company = await tx.company.findFirstOrThrow({ where: { id: ctx.user.companyId, tenantId: ctx.tenantId }, select: { name: true, ownerId: true } });
      const r = await tx.portalRequest.create({
        data: { tenantId: ctx.tenantId, companyId: ctx.user.companyId, portalUserId: ctx.user.id, number: (last._max.number ?? 0) + 1, subject: input.subject, category: input.category, assignedToId: company.ownerId },
      });
      await tx.portalMessage.create({ data: { tenantId: ctx.tenantId, companyId: ctx.user.companyId, requestId: r.id, authorPortalUserId: ctx.user.id, body: input.body } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: null, action: 'portal.request_created', entityType: 'portal_request', entityId: r.id, metadata: { portalUserId: ctx.user.id, subject: input.subject }, meta });
      await this.notifications.send(tx, ctx.tenantId, [company.ownerId], { type: 'portal.request', title: `New portal request ${requestRef(r.number)} from ${company.name}`, body: input.subject, link: `/app/portal/requests?id=${r.id}` });
      return requestDetail(tx, ctx.tenantId, r.id, ctx.user.companyId);
    });
  }

  replyToRequest(ctx: PortalContext, id: string, body: string): Promise<PortalRequest> {
    return this.run(ctx, async (tx, s) => {
      if (!s.allowRequests) throw off('Support requests');
      const r = await tx.portalRequest.findFirst({ where: { id, tenantId: ctx.tenantId, companyId: ctx.user.companyId } });
      if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found.' });
      if (r.status === 'closed') throw new ConflictException({ code: 'REQUEST_CLOSED', message: 'This request is closed. Open a new one.' });
      await tx.portalMessage.create({ data: { tenantId: ctx.tenantId, companyId: ctx.user.companyId, requestId: id, authorPortalUserId: ctx.user.id, body } });
      // A customer reply re-opens a resolved request.
      await tx.portalRequest.update({ where: { id }, data: { updatedAt: new Date(), ...(r.status === 'resolved' ? { status: 'open', resolvedAt: null } : {}) } });
      await this.notifications.send(tx, ctx.tenantId, [r.assignedToId], { type: 'portal.request_reply', title: `${ctx.user.name} replied on ${requestRef(r.number)}`, body: body.slice(0, 200), link: `/app/portal/requests?id=${id}` });
      return requestDetail(tx, ctx.tenantId, id, ctx.user.companyId);
    });
  }

  messages(ctx: PortalContext): Promise<PortalMessageRow[]> {
    return this.run(ctx, async (tx, s) => {
      if (!s.allowMessages) throw off('Messages');
      return messageRows(tx, ctx.tenantId, ctx.user.companyId, null);
    });
  }

  sendMessage(ctx: PortalContext, body: string): Promise<PortalMessageRow[]> {
    return this.run(ctx, async (tx, s) => {
      if (!s.allowMessages) throw off('Messages');
      await tx.portalMessage.create({ data: { tenantId: ctx.tenantId, companyId: ctx.user.companyId, authorPortalUserId: ctx.user.id, body } });
      const company = await tx.company.findFirstOrThrow({ where: { id: ctx.user.companyId, tenantId: ctx.tenantId }, select: { name: true, ownerId: true } });
      await this.notifications.send(tx, ctx.tenantId, [company.ownerId], { type: 'portal.message', title: `Message from ${ctx.user.name} (${company.name})`, body: body.slice(0, 200), link: `/app/companies/${ctx.user.companyId}` });
      return messageRows(tx, ctx.tenantId, ctx.user.companyId, null);
    });
  }

  // ─── Documents ───

  documents(ctx: PortalContext): Promise<(PortalDocumentRow & { downloadUrl: string })[]> {
    return this.run(ctx, async (tx, s) => {
      if (!s.showDocuments) throw off('Documents');
      const rows = await documentRows(tx, ctx.tenantId, ctx.user.companyId);
      return rows.map((d) => ({ ...d, downloadUrl: this.links.url(ctx.tenantId, d.id, ctx.user.companyId) }));
    });
  }

  async upload(ctx: PortalContext, file: { name: string; contentType: string; data: Buffer }, meta: RequestMeta): Promise<PortalDocumentRow> {
    checkFile(file);
    return this.run(ctx, async (tx, s) => {
      if (!s.showDocuments || !s.allowUploads) throw off('Uploading documents');
      const doc = await tx.portalDocument.create({
        data: { tenantId: ctx.tenantId, companyId: ctx.user.companyId, name: file.name, contentType: file.contentType, sizeBytes: file.data.length, data: new Uint8Array(file.data), sha256: createHash('sha256').update(file.data).digest('hex'), uploadedByPortalUserId: ctx.user.id },
      });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: null, action: 'portal.document_uploaded', entityType: 'portal_document', entityId: doc.id, metadata: { portalUserId: ctx.user.id, name: file.name, size: file.data.length }, meta });
      const company = await tx.company.findFirstOrThrow({ where: { id: ctx.user.companyId, tenantId: ctx.tenantId }, select: { name: true, ownerId: true } });
      await this.notifications.send(tx, ctx.tenantId, [company.ownerId], { type: 'portal.document', title: `${ctx.user.name} uploaded ${file.name}`, body: `${company.name}, in the client portal.`, link: `/app/companies/${ctx.user.companyId}` });
      return (await documentRows(tx, ctx.tenantId, ctx.user.companyId)).find((d) => d.id === doc.id)!;
    });
  }
}

export function checkFile(file: { name: string; contentType: string; data: Buffer }): void {
  if (!file.data.length) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file is empty.' });
  if (file.data.length > PORTAL_DOCUMENT_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 10 MB.' });
  if (!(PORTAL_DOCUMENT_TYPES as readonly string[]).includes(file.contentType)) {
    throw new BadRequestException({ code: 'UNSUPPORTED_FILE', message: 'Upload a PDF, image, text, CSV, Word, Excel or PowerPoint file.' });
  }
  if (!file.name.trim() || file.name.length > 200 || /[\\/]/.test(file.name) || [...file.name].some((ch) => ch.charCodeAt(0) < 32)) throw new BadRequestException({ code: 'INVALID_NAME', message: 'Give the file a simple name.' });
}

export async function addUpdate(tx: TenantTx, tenantId: string, companyId: string, kind: string, title: string, body: string | null): Promise<void> {
  await tx.portalUpdate.create({ data: { tenantId, companyId, kind, title: title.slice(0, 300), body: body?.slice(0, 1000) ?? null } });
}

async function authorNames(tx: TenantTx, portalIds: (string | null)[], userIds: (string | null)[]) {
  const [pu, us] = await Promise.all([
    tx.portalUser.findMany({ where: { id: { in: portalIds.filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
    tx.user.findMany({ where: { id: { in: userIds.filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
  ]);
  return { portal: new Map(pu.map((u) => [u.id, u.name])), team: new Map(us.map((u) => [u.id, u.name])) };
}

export async function messageRows(tx: TenantTx, tenantId: string, companyId: string, requestId: string | null): Promise<PortalMessageRow[]> {
  const rows = await tx.portalMessage.findMany({ where: { tenantId, companyId, requestId }, orderBy: { createdAt: 'asc' }, take: 500 });
  const names = await authorNames(tx, rows.map((m) => m.authorPortalUserId), rows.map((m) => m.authorUserId));
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    side: m.authorUserId ? 'team' : 'customer',
    author: m.authorUserId ? (names.team.get(m.authorUserId) ?? 'Team') : m.authorPortalUserId ? (names.portal.get(m.authorPortalUserId) ?? 'Customer') : 'Former portal user',
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function requestRows(tx: TenantTx, tenantId: string, where: { companyId?: string; status?: string[]; assignedToId?: string }): Promise<PortalRequestRow[]> {
  const rows = await tx.portalRequest.findMany({
    where: { tenantId, ...(where.companyId ? { companyId: where.companyId } : {}), ...(where.status ? { status: { in: where.status } } : {}), ...(where.assignedToId ? { assignedToId: where.assignedToId } : {}) },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  const ids = rows.map((r) => r.id);
  const counts = ids.length ? await tx.portalMessage.groupBy({ by: ['requestId'], where: { tenantId, requestId: { in: ids } }, _count: { _all: true }, _max: { createdAt: true } }) : [];
  const byId = new Map(counts.map((c) => [c.requestId!, c]));
  const names = await authorNames(tx, rows.map((r) => r.portalUserId), rows.map((r) => r.assignedToId));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    reference: requestRef(r.number),
    subject: r.subject,
    category: r.category as PortalRequestRow['category'],
    status: r.status as PortalRequestRow['status'],
    company: r.company,
    openedBy: r.portalUserId ? (names.portal.get(r.portalUserId) ?? null) : null,
    assignedTo: r.assignedToId && names.team.get(r.assignedToId) ? { id: r.assignedToId, name: names.team.get(r.assignedToId)! } : null,
    messageCount: byId.get(r.id)?._count._all ?? 0,
    lastMessageAt: (byId.get(r.id)?._max.createdAt ?? r.updatedAt).toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function requestDetail(tx: TenantTx, tenantId: string, id: string, companyId?: string): Promise<PortalRequest> {
  const r = await tx.portalRequest.findFirst({ where: { id, tenantId, ...(companyId ? { companyId } : {}) }, select: { id: true, companyId: true } });
  if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found.' });
  const [row] = (await requestRows(tx, tenantId, { companyId: r.companyId })).filter((x) => x.id === id);
  return { ...row!, messages: await messageRows(tx, tenantId, r.companyId, id) };
}

export async function documentRows(tx: TenantTx, tenantId: string, companyId: string): Promise<PortalDocumentRow[]> {
  const rows = await tx.portalDocument.findMany({
    where: { tenantId, companyId },
    select: { id: true, name: true, contentType: true, sizeBytes: true, uploadedByUserId: true, uploadedByPortalUserId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const names = await authorNames(tx, rows.map((d) => d.uploadedByPortalUserId), rows.map((d) => d.uploadedByUserId));
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    side: d.uploadedByUserId ? 'team' : 'customer',
    uploadedBy: d.uploadedByUserId ? (names.team.get(d.uploadedByUserId) ?? 'Team') : d.uploadedByPortalUserId ? (names.portal.get(d.uploadedByPortalUserId) ?? 'Customer') : 'Former portal user',
    createdAt: d.createdAt.toISOString(),
  }));
}
