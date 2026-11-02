import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { PortalDocumentRow, PortalMessageRow, PortalRequest, PortalRequestRow, PortalSettings, PortalSettingsInput, PortalUserRow } from '@dealflow/types';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { tr } from '../common/request-language';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PortalAuthService } from './portal-auth.service';
import { DocumentLinks } from './portal-documents';
import { addUpdate, checkFile, documentRows, messageRows, requestDetail, requestRef, requestRows } from './portal.service';

const notFound = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });

export interface CompanyPortal {
  enabled: boolean;
  url: string | null;
  users: PortalUserRow[];
  documents: (PortalDocumentRow & { downloadUrl: string })[];
  messages: PortalMessageRow[];
  tasks: { id: string; title: string; dueAt: string | null; done: boolean; deal: string | null; portalVisible: boolean }[];
  requests: PortalRequestRow[];
}

/** The workspace side of the client portal: settings, who has access, and answering customers. */
@Injectable()
export class PortalAdminService {
  private readonly log = new Logger(PortalAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly portalAuth: PortalAuthService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mailer: MailerService,
    private readonly links: DocumentLinks,
  ) {}

  // ─── Settings ───

  settings(auth: AuthContext): Promise<PortalSettings> {
    return this.prisma.run(auth, async (tx) => this.view(tx, auth.tenantId));
  }

  private async view(tx: TenantTx, tenantId: string): Promise<PortalSettings> {
    const s = await tx.portalSettings.findUnique({ where: { tenantId } });
    if (!s) {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
      const slug = t.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).padEnd(3, '0');
      return {
        enabled: false, slug, title: null, welcome: null, showDeals: true, showQuotes: true, showContracts: true, showTasks: true, showDocuments: true,
        allowRequests: true, allowMessages: true, allowUploads: true, allowApprovals: false, url: this.portalAuth.portalUrl(slug), updatedAt: null,
      };
    }
    const { tenantId: _t, updatedById: _u, updatedAt, ...rest } = s;
    return { ...rest, url: this.portalAuth.portalUrl(s.slug), updatedAt: updatedAt.toISOString() };
  }

  saveSettings(auth: AuthContext, input: PortalSettingsInput, meta: RequestMeta): Promise<PortalSettings> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.portalSettings.findUnique({ where: { tenantId: auth.tenantId } });
      const data = { ...input, updatedById: auth.userId, updatedAt: new Date() };
      try {
        await tx.portalSettings.upsert({ where: { tenantId: auth.tenantId }, create: { tenantId: auth.tenantId, ...data }, update: data });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException({ code: 'PORTAL_SLUG_TAKEN', message: 'That portal address is already used. Choose another.', details: [{ path: 'slug', message: 'Already used' }] });
        }
        throw e;
      }
      if (before && before.slug !== input.slug) {
        // Old invitation links name the old address; sessions keep working because they are tied to the workspace.
        this.log.log({ tenantId: auth.tenantId }, 'Portal address changed');
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: before ? 'portal.settings_updated' : 'portal.settings_created', entityType: 'portal_settings', entityId: auth.tenantId,
        metadata: { ...input, welcome: input.welcome ? '(text)' : null, previousSlug: before?.slug ?? null, wasEnabled: before?.enabled ?? false }, meta,
      });
      return this.view(tx, auth.tenantId);
    });
  }

  // ─── Portal users ───

  users(auth: AuthContext, companyId?: string): Promise<PortalUserRow[]> {
    return this.prisma.run(auth, (tx) => userRows(tx, auth.tenantId, companyId));
  }

  invite(auth: AuthContext, input: { companyId: string; contactId?: string; email: string; name: string; role: string }, meta: RequestMeta): Promise<{ user: PortalUserRow; inviteUrl: string; emailed: boolean }> {
    return this.prisma.run(auth, async (tx) => {
      const settings = await tx.portalSettings.findUnique({ where: { tenantId: auth.tenantId } });
      if (!settings) throw new ConflictException({ code: 'PORTAL_NOT_SET_UP', message: 'Set up the client portal in Settings first.' });
      const company = await tx.company.findFirst({ where: { id: input.companyId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true, name: true } });
      if (!company) throw notFound('Company');
      if (input.contactId) {
        const c = await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, deletedAt: null }, select: { companyId: true } });
        if (!c) throw notFound('Contact');
        if (c.companyId !== company.id) throw new BadRequestException({ code: 'CONTACT_NOT_AT_COMPANY', message: 'That contact does not belong to this company.' });
      }
      const existing = await tx.portalUser.findFirst({ where: { tenantId: auth.tenantId, email: input.email } });
      if (existing && (existing.companyId !== company.id || existing.status !== 'invited')) {
        throw new ConflictException({ code: 'PORTAL_USER_EXISTS', message: existing.companyId === company.id ? 'This person already has portal access.' : 'This email already has portal access for another company.', details: [{ path: 'email', message: 'Already has access' }] });
      }
      const u = existing
        ? await tx.portalUser.update({ where: { id: existing.id }, data: { name: input.name, role: input.role, contactId: input.contactId ?? existing.contactId } })
        : await tx.portalUser.create({ data: { tenantId: auth.tenantId, companyId: company.id, contactId: input.contactId ?? null, email: input.email, name: input.name, role: input.role, createdById: auth.userId } });
      const inviteUrl = await this.portalAuth.issueInvite(tx, auth.tenantId, u.id, settings.slug);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'portal.user_invited', entityType: 'portal_user', entityId: u.id, metadata: { email: u.email, companyId: company.id, role: u.role }, meta });
      await addUpdate(tx, auth.tenantId, company.id, 'access', `${u.name} was invited to the portal`, null);
      const emailed = settings.enabled ? await this.sendInvite(tx, auth.tenantId, u.email, u.name, inviteUrl) : false;
      const [row] = await userRows(tx, auth.tenantId, company.id, u.id);
      return { user: row!, inviteUrl, emailed };
    });
  }

  resendInvite(auth: AuthContext, id: string, meta: RequestMeta): Promise<{ inviteUrl: string; emailed: boolean }> {
    return this.prisma.run(auth, async (tx) => {
      const u = await tx.portalUser.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!u) throw notFound('Portal user');
      if (u.status !== 'invited') throw new ConflictException({ code: 'ALREADY_ACTIVE', message: 'This person has already accepted. They can reset their password from the sign-in page.' });
      const settings = await tx.portalSettings.findUniqueOrThrow({ where: { tenantId: auth.tenantId } });
      const inviteUrl = await this.portalAuth.issueInvite(tx, auth.tenantId, u.id, settings.slug);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'portal.invitation_resent', entityType: 'portal_user', entityId: u.id, metadata: { email: u.email }, meta });
      const emailed = settings.enabled ? await this.sendInvite(tx, auth.tenantId, u.email, u.name, inviteUrl) : false;
      return { inviteUrl, emailed };
    });
  }

  private async sendInvite(tx: TenantTx, tenantId: string, to: string, name: string, url: string): Promise<boolean> {
    if (!this.mailer.configured) return false;
    const seller = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } })).name;
    return this.mailer
      // In the language of the person sending it (ADR 0052): the client's own language is not known yet.
      .send({
        to,
        subject: tr('{seller} invited you to their client portal', { seller }),
        text: `${tr('Hello {name},', { name })}\n\n${tr('{seller} has given you access to their client portal, where you can follow your projects, review proposals and send requests.', { seller })}\n\n${tr('Choose a password here (the link works for 7 days):')}\n${url}\n`,
      })
      .then(() => true)
      .catch(() => false);
  }

  updateUser(auth: AuthContext, id: string, input: { role?: string; status?: 'active' | 'disabled' }, meta: RequestMeta): Promise<PortalUserRow> {
    return this.prisma.run(auth, async (tx) => {
      const u = await tx.portalUser.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!u) throw notFound('Portal user');
      if (input.status === 'active' && u.status === 'invited') throw new BadRequestException({ code: 'NOT_ACCEPTED', message: 'This person has not accepted the invitation yet.' });
      const status = input.status === 'active' ? (u.passwordHash ? 'active' : 'invited') : (input.status ?? u.status);
      await tx.portalUser.update({ where: { id }, data: { role: input.role ?? u.role, status } });
      // Switching someone off ends their sessions at once.
      if (status === 'disabled') await tx.portalSession.deleteMany({ where: { tenantId: auth.tenantId, portalUserId: id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: status === 'disabled' && u.status !== 'disabled' ? 'portal.user_disabled' : 'portal.user_updated', entityType: 'portal_user', entityId: id,
        metadata: { email: u.email, role: { from: u.role, to: input.role ?? u.role }, status: { from: u.status, to: status } }, meta,
      });
      const [row] = await userRows(tx, auth.tenantId, undefined, id);
      return row!;
    });
  }

  removeUser(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const u = await tx.portalUser.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!u) throw notFound('Portal user');
      await tx.portalUser.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'portal.user_removed', entityType: 'portal_user', entityId: id, metadata: { email: u.email, companyId: u.companyId }, meta });
    });
  }

  // ─── One company's portal ───

  company(auth: AuthContext, companyId: string): Promise<CompanyPortal> {
    return this.prisma.run(auth, async (tx) => {
      const tenantId = auth.tenantId;
      const company = await tx.company.findFirst({ where: { id: companyId, tenantId, deletedAt: null }, select: { id: true } });
      if (!company) throw notFound('Company');
      const settings = await tx.portalSettings.findUnique({ where: { tenantId } });
      const dealIds = (await tx.opportunity.findMany({ where: { tenantId, companyId, deletedAt: null }, select: { id: true } })).map((d) => d.id);
      const contactIds = (await tx.contact.findMany({ where: { tenantId, companyId, deletedAt: null }, select: { id: true } })).map((c) => c.id);
      const tasks = await tx.task.findMany({
        where: { tenantId, deletedAt: null, status: { not: 'CANCELED' }, OR: [{ opportunityId: { in: dealIds } }, { contactId: { in: contactIds } }] },
        select: { id: true, title: true, dueAt: true, status: true, portalVisible: true, opportunity: { select: { name: true } } },
        orderBy: [{ portalVisible: 'desc' }, { dueAt: 'asc' }],
        take: 100,
      });
      return {
        enabled: settings?.enabled ?? false,
        url: settings ? this.portalAuth.portalUrl(settings.slug) : null,
        users: await userRows(tx, tenantId, companyId),
        documents: (await documentRows(tx, tenantId, companyId)).map((d) => ({ ...d, downloadUrl: this.links.url(tenantId, d.id, companyId) })),
        messages: await messageRows(tx, tenantId, companyId, null),
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt?.toISOString() ?? null, done: t.status === 'DONE', deal: t.opportunity?.name ?? null, portalVisible: t.portalVisible })),
        requests: await requestRows(tx, tenantId, { companyId }),
      };
    });
  }

  sendMessage(auth: AuthContext, companyId: string, body: string): Promise<PortalMessageRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true } });
      if (!company) throw notFound('Company');
      await tx.portalMessage.create({ data: { tenantId: auth.tenantId, companyId, authorUserId: auth.userId, body } });
      await addUpdate(tx, auth.tenantId, companyId, 'message', 'New message from your account team', body.slice(0, 200));
      return messageRows(tx, auth.tenantId, companyId, null);
    });
  }

  setTaskVisibility(auth: AuthContext, taskId: string, visible: boolean, meta: RequestMeta): Promise<{ portalVisible: boolean }> {
    return this.prisma.run(auth, async (tx) => {
      const t = await tx.task.findFirst({ where: { id: taskId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true, title: true, portalVisible: true } });
      if (!t) throw notFound('Task');
      if (t.portalVisible === visible) return { portalVisible: visible };
      await tx.task.update({ where: { id: taskId }, data: { portalVisible: visible } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: visible ? 'portal.task_shared' : 'portal.task_unshared', entityType: 'task', entityId: taskId, metadata: { title: t.title }, meta });
      return { portalVisible: visible };
    });
  }

  // ─── Documents ───

  upload(auth: AuthContext, companyId: string, file: { name: string; contentType: string; data: Buffer }, meta: RequestMeta): Promise<PortalDocumentRow> {
    checkFile(file);
    return this.prisma.run(auth, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true } });
      if (!company) throw notFound('Company');
      const doc = await tx.portalDocument.create({
        data: { tenantId: auth.tenantId, companyId, name: file.name, contentType: file.contentType, sizeBytes: file.data.length, data: new Uint8Array(file.data), sha256: createHash('sha256').update(file.data).digest('hex'), uploadedByUserId: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'portal.document_shared', entityType: 'portal_document', entityId: doc.id, metadata: { companyId, name: file.name, size: file.data.length }, meta });
      await addUpdate(tx, auth.tenantId, companyId, 'document', `New document: ${file.name}`, null);
      return (await documentRows(tx, auth.tenantId, companyId)).find((d) => d.id === doc.id)!;
    });
  }

  removeDocument(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const d = await tx.portalDocument.findFirst({ where: { id, tenantId: auth.tenantId }, select: { id: true, name: true, companyId: true } });
      if (!d) throw notFound('Document');
      await tx.portalDocument.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'portal.document_removed', entityType: 'portal_document', entityId: id, metadata: { companyId: d.companyId, name: d.name }, meta });
    });
  }

  /** Staff download: the member must be able to see the workspace's companies (checked by the route). */
  download(auth: AuthContext, id: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    return this.prisma.run(auth, async (tx) => {
      const d = await tx.portalDocument.findFirst({ where: { id, tenantId: auth.tenantId }, select: { name: true, contentType: true, data: true } });
      if (!d) throw notFound('Document');
      return { name: d.name, contentType: d.contentType, data: Buffer.from(d.data) };
    });
  }

  // ─── Requests inbox ───

  requests(auth: AuthContext, filter: { status?: string; mine?: boolean }): Promise<PortalRequestRow[]> {
    return this.prisma.run(auth, (tx) =>
      requestRows(tx, auth.tenantId, {
        ...(filter.status === 'active' ? { status: ['open', 'in_progress'] } : filter.status ? { status: [filter.status] } : {}),
        ...(filter.mine ? { assignedToId: auth.userId } : {}),
      }),
    );
  }

  request(auth: AuthContext, id: string): Promise<PortalRequest> {
    return this.prisma.run(auth, (tx) => requestDetail(tx, auth.tenantId, id));
  }

  updateRequest(auth: AuthContext, id: string, input: { status?: string; assignedToId?: string | null }, meta: RequestMeta): Promise<PortalRequest> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.portalRequest.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!r) throw notFound('Request');
      if (input.assignedToId) {
        const member = await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: input.assignedToId } });
        if (!member) throw new BadRequestException({ code: 'INVALID_ASSIGNEE', message: 'Assign the request to someone in this workspace.' });
      }
      const status = input.status ?? r.status;
      await tx.portalRequest.update({
        where: { id },
        data: {
          status,
          ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
          resolvedAt: status === 'resolved' || status === 'closed' ? (r.resolvedAt ?? new Date()) : null,
          updatedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'portal.request_updated', entityType: 'portal_request', entityId: id,
        metadata: { status: { from: r.status, to: status }, assignedToId: input.assignedToId === undefined ? undefined : { from: r.assignedToId, to: input.assignedToId } }, meta,
      });
      if (status !== r.status && (status === 'resolved' || status === 'closed')) {
        await addUpdate(tx, auth.tenantId, r.companyId, 'request', `${requestRef(r.number)} marked ${status}`, r.subject);
      }
      if (input.assignedToId && input.assignedToId !== r.assignedToId && input.assignedToId !== auth.userId) {
        await this.notifications.send(tx, auth.tenantId, [input.assignedToId], { type: 'portal.request_assigned', title: `Portal request ${requestRef(r.number)} assigned to you`, body: r.subject, link: `/app/portal/requests?id=${id}` });
      }
      return requestDetail(tx, auth.tenantId, id);
    });
  }

  reply(auth: AuthContext, id: string, body: string): Promise<PortalRequest> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.portalRequest.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!r) throw notFound('Request');
      if (r.status === 'closed') throw new ConflictException({ code: 'REQUEST_CLOSED', message: 'This request is closed. Re-open it to reply.' });
      await tx.portalMessage.create({ data: { tenantId: auth.tenantId, companyId: r.companyId, requestId: id, authorUserId: auth.userId, body } });
      await tx.portalRequest.update({ where: { id }, data: { updatedAt: new Date(), ...(r.status === 'open' ? { status: 'in_progress' } : {}) } });
      await addUpdate(tx, auth.tenantId, r.companyId, 'request', `Reply on ${requestRef(r.number)}`, r.subject);
      const opener = r.portalUserId ? await tx.portalUser.findFirst({ where: { id: r.portalUserId, status: 'active' }, select: { email: true, name: true } }) : null;
      const settings = await tx.portalSettings.findUnique({ where: { tenantId: auth.tenantId } });
      if (opener && settings?.enabled && this.mailer.configured) {
        const seller = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } })).name;
        // Best effort: the reply is saved either way and shows in the portal.
        await this.mailer
          .send({
            to: opener.email,
            subject: tr('{seller} replied to {ref}: {subject}', { seller, ref: requestRef(r.number), subject: r.subject }),
            text: `${tr('Hello {name},', { name: opener.name })}\n\n${tr('There is a new reply to your request. Read it and answer in the portal:')}\n${this.portalAuth.portalUrl(settings.slug)}\n`,
          })
          .catch(() => undefined);
      }
      return requestDetail(tx, auth.tenantId, id);
    });
  }
}

async function userRows(tx: TenantTx, tenantId: string, companyId?: string, id?: string): Promise<PortalUserRow[]> {
  const rows = await tx.portalUser.findMany({
    where: { tenantId, ...(companyId ? { companyId } : {}), ...(id ? { id } : {}) },
    include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
    take: 500,
  });
  return rows.map((u) => ({
    id: u.id,
    company: u.company,
    contact: u.contact ? { id: u.contact.id, name: [u.contact.firstName, u.contact.lastName].filter(Boolean).join(' ') } : null,
    email: u.email,
    name: u.name,
    role: u.role as PortalUserRow['role'],
    status: u.status as PortalUserRow['status'],
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
}
