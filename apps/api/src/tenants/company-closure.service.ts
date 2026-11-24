import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import { COMPANY_REOPEN_DAYS, type CloseCompanyInput, type CompanyClosed, type CompanyCloseImpact, type WorkspaceLevel } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { inLanguage, requestLanguage, tr } from '../common/request-language';
import { MailerService } from '../mail/mailer.service';
import { nameKeyOf } from '../workspaces/access';

const DAY = 86_400_000;
const NOT_DELETED = { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] };
const FORBIDDEN = { code: 'COMPANY_CLOSE_FORBIDDEN', message: 'Only an owner in the Super Workspace can close the company.' };

/** Collections holding a workspace's documents, and the stored name of their workspace field (from the Prisma schema). */
const TENANT_COLLECTIONS = Prisma.dmmf.datamodel.models
  .map((m) => ({ collection: m.dbName ?? m.name, field: m.fields.find((f) => f.name === 'tenantId') }))
  .filter((m): m is { collection: string; field: Prisma.DMMF.Field } => !!m.field)
  .map((m) => ({ collection: m.collection, field: m.field.dbName ?? m.field.name }));

/**
 * Closing the company (workspace redesign W7). An owner in the Super Workspace closes it after seeing every workspace
 * and the data it holds, typing the company name, entering the password and confirming a second time. Sign-in stops
 * for everyone at once (the tenant is PENDING_DELETION, which every access check refuses). The Console can reopen it
 * for 30 days; after that the worker erases its data.
 */
@Injectable()
export class CompanyClosureService {
  private readonly logger = new Logger(CompanyClosureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
  ) {}

  async impact(auth: AuthContext): Promise<CompanyCloseImpact> {
    this.assertOwner(auth);
    return this.prisma.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      const t = auth.tenantId;
      const [nodes, members, companies, contacts, leads, deals, openTasks] = await Promise.all([
        tx.workspaceNode.findMany({ where: { tenantId: t, archivedAt: null }, select: { id: true, name: true, level: true }, orderBy: [{ level: 'asc' }, { name: 'asc' }] }),
        tx.membership.findMany({ where: { tenantId: t, status: 'ACTIVE' }, select: { workspaceNodeId: true } }),
        tx.company.count({ where: { tenantId: t, ...NOT_DELETED } }),
        tx.contact.count({ where: { tenantId: t, ...NOT_DELETED } }),
        tx.lead.count({ where: { tenantId: t, ...NOT_DELETED } }),
        tx.opportunity.count({ where: { tenantId: t, ...NOT_DELETED } }),
        tx.task.count({ where: { tenantId: t, status: 'OPEN', ...NOT_DELETED } }),
      ]);
      const superId = nodes.find((n) => n.level === 'SUPER')?.id;
      const order: Record<string, number> = { SUPER: 0, MANAGER: 1, EXECUTIVE: 2 };
      const workspaces = nodes
        .map((n) => ({
          id: n.id,
          name: n.level === 'SUPER' ? tenant.name : n.name,
          level: n.level as WorkspaceLevel,
          people: members.filter((m) => (m.workspaceNodeId ?? superId) === n.id).length,
        }))
        .sort((a, b) => order[a.level]! - order[b.level]! || a.name.localeCompare(b.name));
      return { name: tenant.name, workspaces, people: members.length, records: { companies, contacts, leads, deals, openTasks }, eraseAfter: new Date(Date.now() + COMPANY_REOPEN_DAYS * DAY).toISOString() };
    });
  }

  async close(auth: AuthContext, input: CloseCompanyInput, meta: RequestMeta): Promise<CompanyClosed> {
    this.assertOwner(auth);
    const now = new Date();
    const eraseAfter = new Date(now.getTime() + COMPANY_REOPEN_DAYS * DAY);
    const tenant = await this.prisma.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      if (nameKeyOf(input.confirmName) !== nameKeyOf(t.name)) {
        throw new BadRequestException({ code: 'CONFIRM_NAME_MISMATCH', message: 'Type the company name exactly as it is shown.', details: [{ path: 'confirmName', message: 'Type the company name exactly as it is shown.' }] });
      }
      if (t.status !== 'ACTIVE') throw new ConflictException({ code: 'COMPANY_NOT_ACTIVE', message: 'This company is not active, so it cannot be closed.' });
      await tx.tenant.update({ where: { id: t.id }, data: { status: 'PENDING_DELETION', closedAt: now, closedById: auth.userId, closeReason: input.reason || null, eraseAfter } });
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: auth.userId,
        action: 'tenant.closed',
        entityType: 'tenant',
        entityId: t.id,
        metadata: { reason: input.reason || null, eraseAfter: eraseAfter.toISOString() },
        meta,
      });
      return t;
    });
    // Everyone signed in to this company is signed out now; the access checks refuse it from here on anyway.
    await this.prisma.session.updateMany({ where: { activeTenantId: tenant.id, revokedAt: null }, data: { revokedAt: now } });
    await this.prisma.platformAuditLog.create({ data: { operatorId: null, action: 'client.closed_by_owner', targetTenantId: tenant.id, metadata: { reason: input.reason || null, eraseAfter: eraseAfter.toISOString() } } });
    this.logger.log({ tenantId: tenant.id, requestId: meta.requestId }, 'Company closed by its owner');

    const owner = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true, name: true } });
    if (owner) {
      await inLanguage(requestLanguage(), () =>
        this.mailer.send({
          to: owner.email,
          subject: tr('{company} was closed on SampForce', { company: tenant.name }),
          text: [
            tr('Hi {name},', { name: owner.name }),
            '',
            tr('{company} was closed and nobody can sign in to it any more. Its data will be erased on {date}.', { company: tenant.name, date: eraseAfter.toISOString().slice(0, 10) }),
            '',
            tr('If this was a mistake, contact SampForce support before then and the company can be reopened with everything in it.'),
            '',
            'SampForce',
          ].join('\n'),
        }),
      ).catch(() => undefined);
    }
    return { name: tenant.name, eraseAfter: eraseAfter.toISOString() };
  }

  /** The Console reopens a closed company within its 30 days: sign-in works again and nothing was lost. */
  async reopen(operator: { id: string; email: string }, tenantId: string, reason: string, ip: string | null): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const t = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
      if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That client does not exist.' });
      if (t.status !== 'PENDING_DELETION' || !t.closedAt) throw new ConflictException({ code: 'COMPANY_NOT_CLOSED', message: 'This client has not closed its company.' });
      if (t.eraseAfter && t.eraseAfter <= new Date()) throw new ConflictException({ code: 'REOPEN_TOO_LATE', message: 'The 30 days to reopen this company have passed.' });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE', closedAt: null, closedById: null, closeReason: null, eraseAfter: null } });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'tenant.reopened', entityType: 'tenant', entityId: tenantId, metadata: { operator: operator.email, reason, closedAt: t.closedAt.toISOString() } });
    });
    await this.prisma.platformAuditLog.create({ data: { operatorId: operator.id, action: 'client.reopened', targetTenantId: tenantId, metadata: { reason }, ip } });
  }

  /**
   * The worker's sweep: companies closed more than 30 days ago lose their data. Every collection with a workspace
   * field is emptied of the company's documents (the audit log too), people who belong to no other organisation are
   * anonymised and signed out, and the tenant row stays, marked erased, as the record that the client existed. The
   * platform audit log keeps what was erased and when.
   */
  async eraseDue(now = new Date()): Promise<number> {
    const due = await this.prisma.run({ system: true }, (tx) => tx.tenant.findMany({ where: { status: 'PENDING_DELETION', erasedAt: null, eraseAfter: { lte: now } }, select: { id: true, name: true }, take: 5 }));
    for (const t of due) await this.erase(t.id, t.name);
    return due.length;
  }

  private async erase(tenantId: string, name: string): Promise<void> {
    const people = await this.prisma.run({ system: true }, (tx) => tx.membership.findMany({ where: { tenantId }, select: { userId: true } }));
    let documents = 0;
    for (const { collection, field } of TENANT_COLLECTIONS) {
      const r = (await this.prisma.$runCommandRaw({ delete: collection, deletes: [{ q: { [field]: tenantId }, limit: 0 }] })) as { n?: number };
      documents += r.n ?? 0;
    }
    // People who belonged only to this company: their account is anonymised (other records may still point at it).
    let anonymised = 0;
    await this.prisma.run({ system: true }, async (tx) => {
      for (const userId of new Set(people.map((p) => p.userId))) {
        if (await tx.membership.count({ where: { userId } })) continue;
        await tx.session.deleteMany({ where: { userId } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
        await tx.userPhoto.deleteMany({ where: { userId } });
        await tx.userPreference.deleteMany({ where: { userId } });
        await tx.userRegionalSetting.deleteMany({ where: { userId } });
        await tx.userSavedTheme.deleteMany({ where: { userId } });
        await tx.user.update({
          where: { id: userId },
          data: { email: `erased-${userId}@erased.invalid`, name: 'Erased user', phone: null, passwordHash: '!erased', status: 'DISABLED', mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null },
        });
        anonymised++;
      }
      await tx.tenant.update({ where: { id: tenantId }, data: { erasedAt: new Date(), deletedAt: new Date(), closeReason: null } });
    });
    await this.prisma.platformAuditLog.create({ data: { operatorId: null, action: 'client.erased', targetTenantId: tenantId, metadata: { name, documents, anonymised } } });
    this.logger.log({ tenantId, documents, anonymised }, 'Closed company erased');
  }

  private assertOwner(auth: AuthContext): void {
    if (auth.via === 'api_key' || auth.via === 'extension' || auth.roleKey !== 'owner') throw new ForbiddenException(FORBIDDEN);
  }
}
