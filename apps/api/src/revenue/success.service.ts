import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  type ChurnTrends,
  customerHealth,
  type CustomerFollowUps,
  type CustomerRow,
  engagementTrend,
  type HealthBand,
  retentionPlan,
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
import { TasksService } from '../crm/tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';
import { SlicedSweep } from '../worker/sliced-sweep';

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
  private readonly sweeper = new SlicedSweep(HOUR);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
  ) {}

  /** Customers, worst health first, optionally narrowed by churn risk band and owner. */
  async customers(auth: AuthContext, filter: { band?: HealthBand; ownerId?: string } = {}): Promise<CustomerRow[]> {
    const rows = await this.prisma.run(auth, (tx) => this.refresh(tx, auth.tenantId));
    return rows.filter((r) => (!filter.band || r.health.band === filter.band) && (!filter.ownerId || r.owner?.id === filter.ownerId));
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
      const d30 = new Date(now.getTime() - 30 * DAY);
      const d60 = new Date(now.getTime() - 60 * DAY);
      const d90 = new Date(now.getTime() - 90 * DAY);
      const contactIds = (await tx.contact.findMany({ where: { tenantId, companyId, deletedAt: null }, select: { id: true } })).map((c) => c.id);
      const mail = contactIds.length ? { contactId: { in: contactIds } } : null;
      const [last, escalations, overdue, previous, a30, a60, e30, e60, inbound, dealGroups, requests] = await Promise.all([
        tx.activity.findFirst({ where: { tenantId, deletedAt: null, ...related }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
        tx.escalation.findMany({ where: { tenantId, companyId, status: 'OPEN' }, select: { severity: true } }),
        tx.task.count({ where: { tenantId, deletedAt: null, status: 'OPEN', dueAt: { lt: now }, OR: [{ contact: { companyId } }, { opportunity: { companyId } }] } }),
        tx.companyHealth.findUnique({ where: { companyId } }),
        tx.activity.count({ where: { tenantId, deletedAt: null, occurredAt: { gte: d30, lte: now }, ...related } }),
        tx.activity.count({ where: { tenantId, deletedAt: null, occurredAt: { gte: d60, lt: d30 }, ...related } }),
        mail ? tx.emailMessage.count({ where: { tenantId, sentAt: { gte: d30, lte: now }, ...mail } }) : 0,
        mail ? tx.emailMessage.count({ where: { tenantId, sentAt: { gte: d60, lt: d30 }, ...mail } }) : 0,
        mail ? tx.emailMessage.findFirst({ where: { tenantId, direction: 'INBOUND', ...mail }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }) : null,
        tx.opportunity.findMany({ where: { tenantId, companyId, deletedAt: null }, select: { status: true, closedAt: true } }),
        tx.portalRequest.findMany({ where: { tenantId, companyId, status: { notIn: ['resolved', 'closed'] } }, select: { createdAt: true } }),
      ]);
      const engagement = { last30: a30 + e30, previous30: a60 + e60 };
      const deals = {
        won: dealGroups.filter((d) => d.status === 'WON').length,
        open: dealGroups.filter((d) => d.status === 'OPEN').length,
        lost90: dealGroups.filter((d) => d.status === 'LOST' && d.closedAt && d.closedAt >= d90).length,
      };
      const oldest = requests.reduce<Date | null>((m, r) => (!m || r.createdAt < m ? r.createdAt : m), null);
      const ending = cs.filter((c) => c.endDate).sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime())[0];
      const daysToRenewal = ending ? daysBetween(ymd(now), ymd(ending.endDate!)) : null;
      const h = customerHealth({
        lastActivityDays: last ? Math.floor((now.getTime() - last.occurredAt.getTime()) / DAY) : null,
        openEscalations: escalations.map((e) => e.severity as Severity),
        daysToRenewal,
        renewalInProgress: !!ending?.renewal,
        overdueTasks: overdue,
        engagement,
        openRequests: { count: requests.length, oldestDays: oldest ? Math.floor((now.getTime() - oldest.getTime()) / DAY) : 0 },
        lostDeals90: deals.lost90,
      });
      const ownerId = company.ownerId ?? cs[0]!.ownerId;
      const alert = h.band === 'at_risk' && previous?.band !== 'at_risk';
      await tx.companyHealth.upsert({
        where: { companyId },
        create: { companyId, tenantId, score: h.score, band: h.band, signals: h.signals as unknown as Prisma.InputJsonValue, computedAt: now, alertedAt: alert ? now : null },
        update: { score: h.score, band: h.band, signals: h.signals as unknown as Prisma.InputJsonValue, computedAt: now, ...(alert ? { alertedAt: now } : h.band !== 'at_risk' ? { alertedAt: null } : {}) },
      });
      const today = new Date(`${ymd(now)}T00:00:00Z`);
      await tx.companyHealthDaily.upsert({
        where: { companyId_day: { companyId, day: today } },
        create: { companyId, day: today, tenantId, score: h.score, band: h.band },
        update: { score: h.score, band: h.band },
      });
      const history = await tx.companyHealthDaily.findMany({ where: { tenantId, companyId, day: { gte: new Date(today.getTime() - 89 * DAY) } }, orderBy: { day: 'asc' }, select: { day: true, score: true } });
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
        engagement: { ...engagement, trend: engagementTrend(engagement), lastInboundAt: inbound?.sentAt.toISOString() ?? null },
        deals,
        openRequests: requests.length,
        history: history.map((d) => ({ day: ymd(d.day), score: d.score })),
        plan: retentionPlan(h.band, h.signals),
      });
    }
    return out.sort((a, b) => a.health.score - b.health.score);
  }

  /** Daily churn-risk counts across all customers, and the biggest falls in the window. */
  trends(auth: AuthContext, days: number): Promise<ChurnTrends> {
    return this.prisma.run(auth, async (tx) => {
      await this.refresh(tx, auth.tenantId);
      const from = new Date(`${ymd(new Date(Date.now() - (days - 1) * DAY))}T00:00:00Z`);
      const rows = await tx.companyHealthDaily.findMany({
        where: { tenantId: auth.tenantId, day: { gte: from }, company: { deletedAt: null } },
        orderBy: { day: 'asc' },
        select: { companyId: true, day: true, score: true, band: true, company: { select: { name: true } } },
      });
      const byDay = new Map<string, { high: number; medium: number; low: number; total: number; n: number }>();
      for (const r of rows) {
        const k = ymd(r.day);
        const d = byDay.get(k) ?? { high: 0, medium: 0, low: 0, total: 0, n: 0 };
        if (r.band === 'at_risk') d.high++;
        else if (r.band === 'watch') d.medium++;
        else d.low++;
        d.total += r.score;
        d.n++;
        byDay.set(k, d);
      }
      const first = new Map<string, (typeof rows)[number]>();
      const lastBy = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (!first.has(r.companyId)) first.set(r.companyId, r);
        lastBy.set(r.companyId, r);
      }
      const movers = [...lastBy.values()]
        .map((l) => ({ l, f: first.get(l.companyId)! }))
        .filter(({ l, f }) => l.score < f.score)
        .sort((a, b) => a.l.score - a.f.score - (b.l.score - b.f.score))
        .slice(0, 10)
        .map(({ l, f }) => ({ company: { id: l.companyId, name: l.company.name }, from: f.score, to: l.score, band: l.band as HealthBand }));
      return {
        days: [...byDay.entries()].map(([day, d]) => ({ day, high: d.high, medium: d.medium, low: d.low, averageScore: d.n ? Math.round(d.total / d.n) : null })),
        movers,
      };
    });
  }

  /** Facts for the Retention Advisor: the stored signals plus recent subjects. Customer-written text is marked untrusted by the caller. */
  async briefFacts(auth: AuthContext, companyId: string) {
    const row = await this.customer(auth, companyId);
    return this.prisma.run(auth, async (tx) => {
      const related = { OR: [{ companyId }, { contact: { companyId } }, { opportunity: { companyId } }] };
      const [activities, escalations, requests] = await Promise.all([
        tx.activity.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, ...related }, orderBy: { occurredAt: 'desc' }, take: 8, select: { type: true, subject: true, occurredAt: true } }),
        tx.escalation.findMany({ where: { tenantId: auth.tenantId, companyId, status: 'OPEN' }, select: { title: true, severity: true, createdAt: true } }),
        tx.portalRequest.findMany({ where: { tenantId: auth.tenantId, companyId, status: { notIn: ['resolved', 'closed'] } }, orderBy: { createdAt: 'asc' }, take: 8, select: { subject: true, category: true, createdAt: true } }),
      ]);
      return {
        row,
        activities: activities.map((a) => ({ type: a.type, subject: a.subject, on: ymd(a.occurredAt) })),
        escalations: escalations.map((e) => ({ title: e.title, severity: e.severity, opened: ymd(e.createdAt) })),
        requests: requests.map((r) => ({ subject: r.subject, category: r.category, opened: ymd(r.createdAt) })),
      };
    });
  }

  /** Creates the follow-up tasks the manager confirmed, on a contact at the customer when chosen. */
  async createFollowUps(auth: AuthContext, companyId: string, input: CustomerFollowUps, meta: RequestMeta): Promise<{ created: { id: string; title: string; dueAt: string }[] }> {
    const row = await this.customer(auth, companyId);
    if (input.contactId) {
      const ok = await this.prisma.run(auth, (tx) => tx.contact.findFirst({ where: { id: input.contactId!, tenantId: auth.tenantId, companyId, deletedAt: null }, select: { id: true } }));
      if (!ok) throw badRef('contactId');
    }
    const created: { id: string; title: string; dueAt: string }[] = [];
    for (const item of input.items) {
      // 09:00 on the chosen day in the manager's own time zone.
      const dueAt = new Date(Date.parse(`${item.dueDate}T09:00:00Z`) + input.timezoneOffsetMinutes * 60_000).toISOString();
      const title = input.contactId ? item.title : `${item.title} (${row.company.name})`;
      const t = await this.tasks.create(auth, { title, dueAt, contactId: input.contactId ?? undefined, description: item.description ?? `Retention follow-up for ${row.company.name} (${row.health.score}/100).`, priority: row.health.band === 'at_risk' ? 'HIGH' : 'NORMAL' }, meta);
      created.push({ id: t.id, title, dueAt });
    }
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'customer.follow_ups_created', entityType: 'company', entityId: companyId, metadata: { count: created.length, band: row.health.band, score: row.health.score }, meta }),
    );
    return { created };
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
        await this.notifications.send(tx, auth.tenantId, [ownerId], { type: 'escalation.opened', title: { LOW: `low escalation: ${row.company.name}`, MEDIUM: `medium escalation: ${row.company.name}`, HIGH: `high escalation: ${row.company.name}`, CRITICAL: `critical escalation: ${row.company.name}` }[input.severity], body: input.title, link: `/app/customer-success?company=${input.companyId}` });
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
    return this.sweeper.run(
      force,
      async () => (await claim<{ tenant_id: string }>(this.prisma, Prisma.sql`SELECT DISTINCT tenant_id FROM contracts WHERE status = 'ACTIVE' AND company_id IS NOT NULL LIMIT 1000`)).map((t) => t.tenant_id),
      async (tenantId) => {
        try {
          await this.prisma.run({ tenantId }, (tx) => this.refresh(tx, tenantId));
        } catch (err) {
          this.log.error({ err: errorMessage(err), tenantId }, 'health sweep failed');
        }
      },
    );
  }
}

function toEscalationRow(r: Prisma.EscalationGetPayload<{ include: { company: { select: { id: true; name: true } } } }>, names: Map<string, { id: string; name: string }>): EscalationRow {
  return {
    id: r.id, company: r.company, contractId: r.contractId, title: r.title, description: r.description, severity: r.severity, status: r.status,
    owner: r.ownerId ? (names.get(r.ownerId) ?? null) : null, resolution: r.resolution, resolvedAt: r.resolvedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}
