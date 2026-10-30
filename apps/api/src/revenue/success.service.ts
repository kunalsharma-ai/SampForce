import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  customerHealth,
  type CustomerRow,
  daysBetween,
  type EscalationRow,
  type escalationInputSchema,
  formatReference,
  type HealthSignal,
  type Severity,
  type z,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, notFound, ownerRefs } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const HOUR = 3_600_000;

/**
 * Customer success: customers are companies with an active contract. Health is rule-based
 * (`customerHealth` in @dealflow/types) and stored, so a drop into "at risk" raises one churn alert.
 */
@Injectable()
export class SuccessService {
  private readonly log = new Logger(SuccessService.name);
  private lastSweep = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  customers(auth: AuthContext): Promise<CustomerRow[]> {
    return this.prisma.run(auth, (tx) => this.refresh(tx, auth.tenantId));
  }

  /** One customer; 404 when the company has no active contract (it is not a customer yet). */
  async customer(auth: AuthContext, companyId: string): Promise<CustomerRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = (await this.refresh(tx, auth.tenantId, companyId))[0];
      if (!row) throw notFound('Customer');
      return row;
    });
  }

  /** Recomputes health for every customer (or one), raising churn alerts on a drop into "at risk". */
  private async refresh(tx: TenantTx, tenantId: string, onlyCompanyId?: string): Promise<CustomerRow[]> {
    const contracts = await tx.contract.findMany({
      where: { tenantId, status: 'ACTIVE', companyId: onlyCompanyId ? onlyCompanyId : { not: null } },
      include: { company: { select: { id: true, name: true, ownerId: true, deletedAt: true } }, renewal: { select: { id: true } } },
    });
    const byCompany = new Map<string, typeof contracts>();
    for (const c of contracts) {
      if (!c.company || c.company.deletedAt) continue;
      byCompany.set(c.company.id, [...(byCompany.get(c.company.id) ?? []), c]);
    }
    const base = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
    const owners = await ownerRefs(tx, [...byCompany.values()].map((cs) => cs[0]!.company!.ownerId ?? cs[0]!.ownerId));
    const now = new Date();
    const out: CustomerRow[] = [];
    for (const [companyId, cs] of byCompany) {
      const company = cs[0]!.company!;
      const related = { OR: [{ companyId }, { contact: { companyId } }, { opportunity: { companyId } }] };
      const [last, escalations, overdue, previous] = await Promise.all([
        tx.activity.findFirst({ where: { tenantId, deletedAt: null, ...related }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
        tx.escalation.findMany({ where: { tenantId, companyId, status: 'OPEN' }, select: { severity: true } }),
        tx.task.count({ where: { tenantId, deletedAt: null, status: 'OPEN', dueAt: { lt: now }, OR: [{ contact: { companyId } }, { opportunity: { companyId } }] } }),
        tx.companyHealth.findUnique({ where: { companyId } }),
      ]);
      const ending = cs.filter((c) => c.endDate).sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime())[0];
      const daysToRenewal = ending ? daysBetween(ymd(now), ymd(ending.endDate!)) : null;
      const h = customerHealth({
        lastActivityDays: last ? Math.floor((now.getTime() - last.occurredAt.getTime()) / DAY) : null,
        openEscalations: escalations.map((e) => e.severity as Severity),
        daysToRenewal,
        renewalInProgress: !!ending?.renewal,
        overdueTasks: overdue,
      });
      const ownerId = company.ownerId ?? cs[0]!.ownerId;
      const alert = h.band === 'at_risk' && previous?.band !== 'at_risk';
      await tx.companyHealth.upsert({
        where: { companyId },
        create: { companyId, tenantId, score: h.score, band: h.band, signals: h.signals as unknown as Prisma.InputJsonValue, computedAt: now, alertedAt: alert ? now : null },
        update: { score: h.score, band: h.band, signals: h.signals as unknown as Prisma.InputJsonValue, computedAt: now, ...(alert ? { alertedAt: now } : h.band !== 'at_risk' ? { alertedAt: null } : {}) },
      });
      if (alert) {
        await this.notifications.send(tx, tenantId, [ownerId], {
          type: 'customer.churn_risk', title: `${company.name} is at risk`, body: `Health ${h.score}/100: ${h.signals.map((s) => s.label).join(', ')}.`, link: `/app/customer-success?company=${companyId}`,
        });
        await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'customer.churn_alert', entityType: 'company', entityId: companyId, metadata: { score: h.score, signals: h.signals.map((s) => s.key) } });
      }
      const sameCurrency = cs.filter((c) => c.currency === base);
      out.push({
        company: { id: company.id, name: company.name },
        owner: ownerId ? (owners.get(ownerId) ?? null) : null,
        activeContracts: cs.length,
        contractValue: Math.round(sameCurrency.reduce((a, c) => a + c.value.toNumber(), 0) * 100) / 100,
        currency: base,
        nextRenewal: ending ? { contractId: ending.id, reference: formatReference('C', ending.number), endDate: ymd(ending.endDate!), daysToEnd: daysToRenewal! } : null,
        openEscalations: escalations.length,
        health: { score: h.score, band: h.band, signals: h.signals as HealthSignal[], computedAt: now.toISOString() },
      });
    }
    return out.sort((a, b) => a.health.score - b.health.score);
  }

  escalations(auth: AuthContext, q: { status?: 'OPEN' | 'RESOLVED'; companyId?: string }): Promise<EscalationRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.escalation.findMany({
        where: { tenantId: auth.tenantId, ...(q.status ? { status: q.status } : {}), ...(q.companyId ? { companyId: q.companyId } : {}) },
        include: { company: { select: { id: true, name: true } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      });
      const names = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return rows.map((r) => toEscalationRow(r, names));
    });
  }

  openEscalation(auth: AuthContext, input: z.infer<typeof escalationInputSchema>, meta: RequestMeta): Promise<EscalationRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { companyId: input.companyId, ownerId });
      if (input.contractId && !(await tx.contract.findFirst({ where: { id: input.contractId, tenantId: auth.tenantId, companyId: input.companyId } }))) throw badRef('contractId');
      const row = await tx.escalation.create({
        data: { tenantId: auth.tenantId, companyId: input.companyId, contractId: input.contractId ?? null, title: input.title, description: input.description ?? null, severity: input.severity, ownerId, openedById: auth.userId },
        include: { company: { select: { id: true, name: true } } },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'escalation.opened', entityType: 'escalation', entityId: row.id, metadata: { companyId: input.companyId, severity: input.severity }, meta });
      if (ownerId !== auth.userId || input.severity === 'HIGH' || input.severity === 'CRITICAL') {
        await this.notifications.send(tx, auth.tenantId, [ownerId], { type: 'escalation.opened', title: `${input.severity.toLowerCase()} escalation: ${row.company.name}`, body: input.title, link: `/app/customer-success?company=${input.companyId}` });
      }
      return toEscalationRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  resolveEscalation(auth: AuthContext, id: string, resolution: string, meta: RequestMeta): Promise<EscalationRow> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.escalation.updateMany({ where: { id, tenantId: auth.tenantId, status: 'OPEN' }, data: { status: 'RESOLVED', resolution, resolvedAt: new Date() } });
      if (!count) {
        if (await tx.escalation.findFirst({ where: { id, tenantId: auth.tenantId } })) throw new ConflictException({ code: 'ALREADY_RESOLVED', message: 'This escalation is already resolved.' });
        throw notFound('Escalation');
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'escalation.resolved', entityType: 'escalation', entityId: id, meta });
      const row = await tx.escalation.findFirstOrThrow({ where: { id }, include: { company: { select: { id: true, name: true } } } });
      return toEscalationRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  /** Worker job, at most hourly: recompute health in every workspace with active contracts. */
  async sweep(force = false): Promise<number> {
    if (!force && Date.now() - this.lastSweep < HOUR) return 0;
    this.lastSweep = Date.now();
    const tenants = await claim<{ tenant_id: string }>(this.prisma, Prisma.sql`SELECT DISTINCT tenant_id FROM contracts WHERE status = 'ACTIVE' AND company_id IS NOT NULL LIMIT 1000`);
    let n = 0;
    for (const t of tenants) {
      try {
        await this.prisma.run({ tenantId: t.tenant_id }, (tx) => this.refresh(tx, t.tenant_id));
        n++;
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId: t.tenant_id }, 'health sweep failed');
      }
    }
    return n;
  }
}

function toEscalationRow(r: Prisma.EscalationGetPayload<{ include: { company: { select: { id: true; name: true } } } }>, names: Map<string, { id: string; name: string }>): EscalationRow {
  return {
    id: r.id, company: r.company, contractId: r.contractId, title: r.title, description: r.description, severity: r.severity, status: r.status,
    owner: r.ownerId ? (names.get(r.ownerId) ?? null) : null, resolution: r.resolution, resolvedAt: r.resolvedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}
