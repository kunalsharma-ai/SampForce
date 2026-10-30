import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { OperatorPlanInput, OperatorTenantDetail, OperatorTenantRow, PlatformAuditRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { toInvoiceRow } from '../billing/billing.service';
import { PrismaService } from '../common/prisma.service';
import type { OperatorContext } from './operator-auth';

type ScanTx = Prisma.TransactionClient;

/**
 * Platform operations. Listing reads only tenants, subscriptions, membership counts, support grants and
 * invoices across workspaces (the `operator_scan` policies). Member lists and the workspace audit log
 * are shown only while that workspace has granted support access. Operators never read CRM records.
 */
@Injectable()
export class OperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip: string | null): Promise<OperatorContext> {
    const op = await this.prisma.platformOperator.findUnique({ where: { email } });
    const ok = await this.passwords.verify(op?.passwordHash ?? null, password);
    if (!op || !ok || op.status !== 'ACTIVE') {
      await this.log(null, 'operator.login_failed', null, { email }, ip);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    await this.prisma.platformOperator.update({ where: { id: op.id }, data: { lastLoginAt: new Date() } });
    await this.log(op.id, 'operator.login', null, {}, ip);
    return { id: op.id, email: op.email, name: op.name, role: op.role };
  }

  private scan<T>(fn: (tx: ScanTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.operator_scan', 'on', true)`;
      return fn(tx);
    });
  }

  async tenants(op: OperatorContext, q: { search?: string }, ip: string | null): Promise<OperatorTenantRow[]> {
    const rows = await this.scan((tx) => this.tenantRows(tx, q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { slug: { contains: q.search, mode: 'insensitive' } }] } : {}));
    await this.log(op.id, 'tenants.listed', null, { search: q.search ?? null, results: rows.length }, ip);
    return rows;
  }

  private async tenantRows(tx: ScanTx, where: Prisma.TenantWhereInput): Promise<OperatorTenantRow[]> {
    const now = new Date();
    const tenants = await tx.tenant.findMany({
      where: { deletedAt: null, ...where },
      include: {
        subscription: true,
        _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
        supportGrants: { where: { revokedAt: null, expiresAt: { gt: now } }, orderBy: { expiresAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return tenants.map((t) => ({
      id: t.id, name: t.name, slug: t.slug, status: t.status, isDemo: t.isDemo, createdAt: t.createdAt.toISOString(), members: t._count.memberships,
      subscription: t.subscription
        ? { planCode: t.subscription.planCode, status: t.subscription.status, seats: t.subscription.seats, provider: t.subscription.provider, currentPeriodEnd: t.subscription.currentPeriodEnd?.toISOString() ?? null, trialEndsAt: t.subscription.trialEndsAt?.toISOString() ?? null }
        : null,
      supportAccessUntil: t.supportGrants[0]?.expiresAt.toISOString() ?? null,
    }));
  }

  async tenant(op: OperatorContext, id: string, ip: string | null): Promise<OperatorTenantDetail> {
    const { row, invoices } = await this.scan(async (tx) => ({
      row: (await this.tenantRows(tx, { id }))[0],
      invoices: await tx.invoice.findMany({ where: { tenantId: id }, orderBy: { issuedAt: 'desc' }, take: 24 }),
    }));
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
    let support: OperatorTenantDetail['support'] = null;
    if (row.supportAccessUntil) {
      support = await this.prisma.run({ tenantId: id }, async (tx) => {
        const [members, audit] = await Promise.all([
          tx.membership.findMany({ where: { tenantId: id, status: 'ACTIVE' }, include: { user: { select: { name: true, email: true } }, role: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take: 200 }),
          tx.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { action: true, actorType: true, createdAt: true, entityType: true } }),
        ]);
        return {
          members: members.map((m) => ({ name: m.user.name, email: m.user.email, role: m.role.name, joinedAt: m.createdAt.toISOString() })),
          audit: audit.map((a) => ({ action: a.action, actorType: a.actorType, createdAt: a.createdAt.toISOString(), entityType: a.entityType })),
        };
      });
    }
    await this.log(op.id, support ? 'tenant.viewed_with_support_access' : 'tenant.viewed', id, {}, ip);
    return { ...row, invoices: invoices.map(toInvoiceRow), support };
  }

  /** Manual plan changes for sales-led deals, credits and corrections. Recorded in both audit logs. */
  async setPlan(op: OperatorContext, id: string, input: OperatorPlanInput, ip: string | null) {
    await this.prisma.run({ tenantId: id }, async (tx) => {
      const before = await tx.subscription.findUnique({ where: { tenantId: id } });
      if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      const now = new Date();
      await tx.subscription.update({
        where: { tenantId: id },
        data: {
          planCode: input.planCode, seats: input.seats, status: input.status,
          trialEndsAt: input.status === 'TRIALING' ? (input.trialEndsAt ? new Date(input.trialEndsAt) : before.trialEndsAt) : null,
          ...(input.status === 'TRIALING' ? { trialUsedAt: before.trialUsedAt ?? now } : {}),
          pastDueSince: input.status === 'PAST_DUE' || input.status === 'UNPAID' ? (before.pastDueSince ?? now) : null,
        },
      });
      await this.audit.record(tx, {
        tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'billing.plan_overridden', entityType: 'subscription', entityId: before.id,
        metadata: { operator: op.email, reason: input.reason, from: { planCode: before.planCode, seats: before.seats, status: before.status }, to: { planCode: input.planCode, seats: input.seats, status: input.status } },
      });
    });
    await this.log(op.id, 'tenant.plan_overridden', id, { ...input }, ip);
    return this.tenant(op, id, ip);
  }

  async setSuspended(op: OperatorContext, id: string, suspended: boolean, reason: string, ip: string | null) {
    await this.prisma.run({ tenantId: id }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id } });
      if (!t || t.deletedAt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      if (t.status === 'PENDING_DELETION') throw new ForbiddenException({ code: 'PENDING_DELETION', message: 'This workspace is scheduled for deletion.' });
      await tx.tenant.update({ where: { id }, data: { status: suspended ? 'SUSPENDED' : 'ACTIVE' } });
      await this.audit.record(tx, { tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: suspended ? 'tenant.suspended' : 'tenant.reactivated', entityType: 'tenant', entityId: id, metadata: { operator: op.email, reason } });
    });
    await this.log(op.id, suspended ? 'tenant.suspended' : 'tenant.reactivated', id, { reason }, ip);
    return this.tenant(op, id, ip);
  }

  async auditLog(q: { tenantId?: string }): Promise<PlatformAuditRow[]> {
    const rows = await this.prisma.platformAuditLog.findMany({
      where: q.tenantId ? { targetTenantId: q.tenantId } : {},
      include: { operator: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ id: r.id, operator: r.operator, action: r.action, targetTenantId: r.targetTenantId, metadata: r.metadata as Record<string, unknown>, createdAt: r.createdAt.toISOString() }));
  }

  async log(operatorId: string | null, action: string, targetTenantId: string | null, metadata: Record<string, unknown>, ip: string | null): Promise<void> {
    await this.prisma.platformAuditLog.create({ data: { operatorId, action, targetTenantId, metadata: metadata as Prisma.InputJsonValue, ip } });
  }
}
