import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { DealHealthDetail, DealHealthQuery, DealHealthRow, DealHealthSummary, DealRisk, Signal } from '@dealflow/types';
import { dealHealth, type DealFacts } from '../ai/scoring';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { scanTenants, errorMessage } from '../worker/queue';
import { SlicedSweep } from '../worker/sliced-sweep';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

interface FactRow {
  id: string;
  name: string;
  amount: Prisma.Decimal;
  currency: string;
  status: string;
  expected_close_date: Date | null;
  created_at: Date;
  contact_id: string | null;
  owner_id: string | null;
  stage_name: string;
  stage_entered_at: Date | null;
  last_activity_at: Date | null;
  open_tasks: number;
  overdue_tasks: number;
  touches14: number;
  touches_prev14: number;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  people30: number;
  people_prev30: number;
}

/** Facts for the open deals of one workspace (or one deal), in a single query. */
export async function loadDealFacts(tx: TenantTx, tenantId: string, dealId?: string): Promise<FactRow[]> {
  return tx.$queryRaw<FactRow[]>`
    SELECT o.id, o.name, o.amount, o.currency, o.status::text AS status, o.expected_close_date, o.created_at, o.contact_id, o.owner_id,
           s.name AS stage_name,
           (SELECT max(e.occurred_at) FROM deal_stage_events e WHERE e.opportunity_id = o.id AND e.to_stage_id = o.stage_id) AS stage_entered_at,
           (SELECT max(a.occurred_at) FROM activities a WHERE a.opportunity_id = o.id AND a.deleted_at IS NULL) AS last_activity_at,
           (SELECT count(*)::int FROM tasks t WHERE t.opportunity_id = o.id AND t.deleted_at IS NULL AND t.status = 'OPEN') AS open_tasks,
           (SELECT count(*)::int FROM tasks t WHERE t.opportunity_id = o.id AND t.deleted_at IS NULL AND t.status = 'OPEN' AND t.due_at < now()) AS overdue_tasks
      FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id
      CROSS JOIN LATERAL (
        -- The deal's people: its main contact plus the contacts at its company.
        SELECT coalesce(array_agg(c.id), '{}') AS ids FROM contacts c
         WHERE c.deleted_at IS NULL AND (c.id = o.contact_id OR (o.company_id IS NOT NULL AND c.company_id = o.company_id))
      ) p
      CROSS JOIN LATERAL (
        SELECT
          (SELECT count(*)::int FROM activities a WHERE a.deleted_at IS NULL AND (a.opportunity_id = o.id OR a.contact_id = ANY(p.ids)) AND a.occurred_at >= now() - interval '14 days')
            + (SELECT count(*)::int FROM email_messages m WHERE m.contact_id = ANY(p.ids) AND m.sent_at >= now() - interval '14 days') AS touches14,
          (SELECT count(*)::int FROM activities a WHERE a.deleted_at IS NULL AND (a.opportunity_id = o.id OR a.contact_id = ANY(p.ids)) AND a.occurred_at >= now() - interval '28 days' AND a.occurred_at < now() - interval '14 days')
            + (SELECT count(*)::int FROM email_messages m WHERE m.contact_id = ANY(p.ids) AND m.sent_at >= now() - interval '28 days' AND m.sent_at < now() - interval '14 days') AS touches_prev14,
          (SELECT max(m.sent_at) FROM email_messages m WHERE m.contact_id = ANY(p.ids) AND m.direction = 'INBOUND') AS last_inbound_at,
          (SELECT max(m.sent_at) FROM email_messages m WHERE m.contact_id = ANY(p.ids) AND m.direction = 'OUTBOUND') AS last_outbound_at,
          (SELECT count(DISTINCT x.cid)::int FROM (
             SELECT a.contact_id AS cid FROM activities a WHERE a.deleted_at IS NULL AND a.contact_id = ANY(p.ids) AND a.occurred_at >= now() - interval '30 days'
             UNION SELECT m.contact_id FROM email_messages m WHERE m.contact_id = ANY(p.ids) AND m.direction = 'INBOUND' AND m.sent_at >= now() - interval '30 days') x) AS people30,
          (SELECT count(DISTINCT x.cid)::int FROM (
             SELECT a.contact_id AS cid FROM activities a WHERE a.deleted_at IS NULL AND a.contact_id = ANY(p.ids) AND a.occurred_at >= now() - interval '60 days' AND a.occurred_at < now() - interval '30 days'
             UNION SELECT m.contact_id FROM email_messages m WHERE m.contact_id = ANY(p.ids) AND m.direction = 'INBOUND' AND m.sent_at >= now() - interval '60 days' AND m.sent_at < now() - interval '30 days') x) AS people_prev30
      ) e
     WHERE o.tenant_id = ${tenantId}::uuid AND o.deleted_at IS NULL
       AND ${dealId ? Prisma.sql`o.id = ${dealId}::uuid` : Prisma.sql`o.status = 'OPEN'`}`;
}

export function toDealFacts(r: FactRow): DealFacts {
  return {
    status: r.status,
    amount: Number(r.amount),
    expectedCloseDate: r.expected_close_date,
    createdAt: r.created_at,
    stageEnteredAt: r.stage_entered_at,
    lastActivityAt: r.last_activity_at,
    openTasks: r.open_tasks,
    overdueTasks: r.overdue_tasks,
    hasContact: !!r.contact_id,
    engagement: {
      touches14: r.touches14,
      touchesPrev14: r.touches_prev14,
      lastInboundAt: r.last_inbound_at,
      lastOutboundAt: r.last_outbound_at,
      people30: r.people30,
      peoplePrev30: r.people_prev30,
    },
  };
}

/**
 * Deal health monitor (enhancement spec feature 4). Extends the deal intelligence agent's rule-based health
 * (`dealHealth` in ai/scoring.ts, the same signals and bands) from "on request" to every open deal: the worker scores
 * them hourly, keeps one score per day for trends, tells the owner once when a deal turns high risk, and publishes
 * `deal.health_dropped` so Automation Studio workflows can react. No model call is involved.
 */
@Injectable()
export class DealHealthService {
  private readonly log = new Logger(DealHealthService.name);
  private readonly sweeper = new SlicedSweep(HOUR);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Scores every open deal in one workspace (or one deal) and stores the result. Returns the number scored. */
  async refresh(tx: TenantTx, tenantId: string, dealId?: string, now = new Date()): Promise<number> {
    const rows = await loadDealFacts(tx, tenantId, dealId);
    const day = new Date(`${ymd(now)}T00:00:00Z`);
    const previous = new Map(
      (await tx.dealHealthScore.findMany({ where: { tenantId, dealId: { in: rows.map((r) => r.id) } }, select: { dealId: true, risk: true, alertedAt: true } })).map((p) => [p.dealId, p]),
    );
    for (const r of rows) {
      if (r.status !== 'OPEN') {
        await tx.dealHealthScore.deleteMany({ where: { dealId: r.id } });
        continue;
      }
      const h = dealHealth(toDealFacts(r), now);
      const before = previous.get(r.id);
      const alert = h.risk === 'high' && !before?.alertedAt;
      const signals = h.signals as unknown as Prisma.InputJsonValue;
      await tx.dealHealthScore.upsert({
        where: { dealId: r.id },
        create: { dealId: r.id, tenantId, health: h.health, risk: h.risk, signals, computedAt: now, alertedAt: alert ? now : null },
        update: { health: h.health, risk: h.risk, signals, computedAt: now, ...(alert ? { alertedAt: now } : h.risk !== 'high' ? { alertedAt: null } : {}) },
      });
      await tx.dealHealthDaily.upsert({
        where: { dealId_day: { dealId: r.id, day } },
        create: { dealId: r.id, day, tenantId, health: h.health, risk: h.risk },
        update: { health: h.health, risk: h.risk },
      });
      if (alert) {
        await this.notifications.send(tx, tenantId, [r.owner_id], {
          type: 'deal.health_dropped',
          title: `${r.name} is at high risk`,
          body: `Health ${h.health}/100: ${h.signals.map((s) => s.label).join(', ')}.`,
          link: `/app/deals/${r.id}`,
        });
        // The audit entry publishes the `deal.health_dropped` domain event for Automation Studio triggers.
        await this.audit.record(tx, {
          tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'deal.health_dropped', entityType: 'deal', entityId: r.id,
          metadata: { health: h.health, risk: h.risk, previousRisk: before?.risk ?? null, signals: h.signals.map((s) => s.key) },
        });
      }
    }
    return rows.length;
  }

  /** Worker job, at most hourly: rescore open deals in every workspace. */
  async sweep(force = false): Promise<number> {
    return this.sweeper.run(
      force,
      () => scanTenants(this.prisma.subscription, {}, 5000),
      async (tenantId) => {
        try {
          await this.prisma.run({ tenantId }, (tx) => this.refresh(tx, tenantId));
        } catch (err) {
          this.log.error({ err: errorMessage(err), tenantId }, 'deal health sweep failed');
        }
      },
    );
  }

  /** "Rescore now" from the at-risk page. */
  async refreshNow(auth: AuthContext): Promise<DealHealthSummary> {
    await this.prisma.run(auth, (tx) => this.refresh(tx, auth.tenantId));
    return this.summary(auth);
  }

  summary(auth: AuthContext): Promise<DealHealthSummary> {
    return this.prisma.run(auth, async (tx) => {
      const [groups, open, last] = await Promise.all([
        tx.dealHealthScore.groupBy({ by: ['risk'], where: { tenantId: auth.tenantId, deal: { status: 'OPEN', deletedAt: null } }, _count: true }),
        tx.opportunity.count({ where: { tenantId: auth.tenantId, status: 'OPEN', deletedAt: null } }),
        tx.dealHealthScore.findFirst({ where: { tenantId: auth.tenantId }, orderBy: { computedAt: 'desc' }, select: { computedAt: true } }),
      ]);
      const counts: Record<DealRisk, number> = { low: 0, medium: 0, high: 0 };
      for (const g of groups) counts[g.risk as DealRisk] = g._count;
      const scored = counts.low + counts.medium + counts.high;
      return { counts, unscored: Math.max(0, open - scored), lastSweepAt: last?.computedAt.toISOString() ?? null };
    });
  }

  list(auth: AuthContext, q: DealHealthQuery): Promise<DealHealthRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.dealHealthScore.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.risk ? { risk: q.risk } : {}),
          deal: { status: 'OPEN', deletedAt: null, ...(q.mine ? { ownerId: auth.userId } : {}) },
        },
        include: { deal: { select: { id: true, name: true, amount: true, currency: true, expectedCloseDate: true, ownerId: true, stage: { select: { name: true } } } } },
        orderBy: [{ health: 'asc' }, { computedAt: 'desc' }],
        take: 200,
      });
      const weekAgo = new Date(`${ymd(new Date(Date.now() - 7 * DAY))}T00:00:00Z`);
      const past = new Map(
        (await tx.dealHealthDaily.findMany({ where: { tenantId: auth.tenantId, day: weekAgo, dealId: { in: rows.map((r) => r.dealId) } }, select: { dealId: true, health: true } })).map((p) => [p.dealId, p.health]),
      );
      const owners = await ownerRefs(tx, rows.map((r) => r.deal.ownerId));
      return rows.map((r) => {
        const then = past.get(r.dealId);
        return {
          deal: {
            id: r.deal.id, name: r.deal.name, amount: Number(r.deal.amount), currency: r.deal.currency, stage: r.deal.stage.name,
            expectedCloseDate: r.deal.expectedCloseDate ? ymd(r.deal.expectedCloseDate) : null,
          },
          owner: r.deal.ownerId ? (owners.get(r.deal.ownerId) ?? null) : null,
          health: r.health,
          risk: r.risk as DealRisk,
          signals: r.signals as unknown as Signal[],
          change7d: then === undefined ? null : r.health - then,
          computedAt: r.computedAt.toISOString(),
        };
      });
    });
  }

  /** The stored score and up to 90 days of daily history for one deal. */
  detail(auth: AuthContext, dealId: string): Promise<DealHealthDetail> {
    return this.prisma.run(auth, async (tx) => {
      const deal = await tx.opportunity.findFirst({ where: { id: dealId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true } });
      if (!deal) throw notFound('Deal');
      const [current, history] = await Promise.all([
        tx.dealHealthScore.findUnique({ where: { dealId } }),
        tx.dealHealthDaily.findMany({ where: { dealId, day: { gte: new Date(Date.now() - 90 * DAY) } }, orderBy: { day: 'asc' } }),
      ]);
      const weekAgo = ymd(new Date(Date.now() - 7 * DAY));
      const then = history.find((h) => ymd(h.day) === weekAgo);
      return {
        current: current
          ? { health: current.health, risk: current.risk as DealRisk, signals: current.signals as unknown as Signal[], change7d: then ? current.health - then.health : null, computedAt: current.computedAt.toISOString() }
          : null,
        history: history.map((h) => ({ day: ymd(h.day), health: h.health, risk: h.risk as DealRisk })),
      };
    });
  }
}
