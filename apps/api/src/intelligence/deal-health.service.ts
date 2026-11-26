import { Injectable, Logger } from '@nestjs/common';
import { aggregate, fromRawDate, LARGE_IN_LIST, Prisma, rawDate, type TenantTx } from '@dealflow/database';
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
/** Deals whose scores are stored per transaction in the hourly sweep. */
const SWEEP_BATCH = 250;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

interface FactRow {
  id: string;
  name: string;
  amount: number;
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

/**
 * Facts for the open deals of one workspace (or one deal). A handful of batched queries, joined here: the deal's
 * people are its main contact plus the contacts at its company.
 */
export async function loadDealFacts(tx: TenantTx, tenantId: string, dealId?: string): Promise<FactRow[]> {
  const deals = await tx.opportunity.findMany({
    where: { tenantId, deletedAt: null, ...(dealId ? { id: dealId } : { status: 'OPEN' }) },
    select: { id: true, name: true, amount: true, currency: true, status: true, expectedCloseDate: true, createdAt: true, contactId: true, companyId: true, ownerId: true, stageId: true, stage: { select: { name: true } } },
  });
  if (!deals.length) return [];
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY);
  const dealIds = deals.map((d) => d.id);
  const contactIds = [...new Set(deals.flatMap((d) => (d.contactId ? [d.contactId] : [])))];
  const companyIds = [...new Set(deals.flatMap((d) => (d.companyId ? [d.companyId] : [])))];
  // Native $in reads (see LARGE_IN_LIST): a sweep passes every open deal of the workspace and every person at their
  // companies, and Prisma's own `in` made the sweep outlast its transaction on large workspaces.
  const people = (
    await aggregate<{ _id: string; company_id: string | null }>(tx.contact, [
      { $match: { deleted_at: null, $or: [{ _id: { $in: contactIds } }, { company_id: { $in: companyIds } }] } },
      { $project: { company_id: 1 } },
    ])
  ).map((p) => ({ id: p._id, companyId: p.company_id }));
  const allPeople = people.map((p) => p.id);
  const since60 = rawDate(ago(60));
  const [stageEvents, lastActs, tasks, acts, emails, lastMail] = await Promise.all([
    aggregate<{ _id: { o: string; s: string }; at: unknown }>(tx.dealStageEvent, [
      { $match: { opportunity_id: { $in: dealIds } } },
      { $group: { _id: { o: '$opportunity_id', s: '$to_stage_id' }, at: { $max: '$occurred_at' } } },
    ]),
    aggregate<{ _id: string; at: unknown }>(tx.activity, [
      { $match: { deleted_at: null, opportunity_id: { $in: dealIds } } },
      { $group: { _id: '$opportunity_id', at: { $max: '$occurred_at' } } },
    ]),
    aggregate<{ opportunity_id: string; due_at: unknown }>(tx.task, [
      { $match: { deleted_at: null, status: 'OPEN', opportunity_id: { $in: dealIds } } },
      { $project: { _id: 0, opportunity_id: 1, due_at: 1 } },
    ]),
    aggregate<{ _id: string; opportunity_id: string | null; contact_id: string | null; occurred_at: unknown }>(tx.activity, [
      { $match: { deleted_at: null, occurred_at: { $gte: since60 }, $or: [{ opportunity_id: { $in: dealIds } }, { contact_id: { $in: allPeople } }] } },
      { $project: { opportunity_id: 1, contact_id: 1, occurred_at: 1 } },
    ]),
    aggregate<{ contact_id: string; direction: string; sent_at: unknown }>(tx.emailMessage, [
      { $match: { contact_id: { $in: allPeople }, sent_at: { $gte: since60 } } },
      { $project: { _id: 0, contact_id: 1, direction: 1, sent_at: 1 } },
    ]),
    aggregate<{ _id: { c: string; d: string }; at: unknown }>(tx.emailMessage, [
      { $match: { contact_id: { $in: allPeople } } },
      { $group: { _id: { c: '$contact_id', d: '$direction' }, at: { $max: '$sent_at' } } },
    ]),
  ]);
  const t14 = now - 14 * DAY, t28 = now - 28 * DAY, t30 = now - 30 * DAY, t60 = now - 60 * DAY;
  const maxDate = (ds: Array<Date | null | undefined>): Date | null => {
    let m: Date | null = null;
    for (const d of ds) if (d && (!m || d > m)) m = d;
    return m;
  };
  // Indexed once, so each deal reads its own rows instead of filtering every row of the workspace.
  const group = <T, K>(rows: T[], key: (r: T) => K | null | undefined): Map<K, T[]> => {
    const m = new Map<K, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (k === null || k === undefined) continue;
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const personIds = new Set(allPeople);
  const peopleByCompany = group(people, (p) => p.companyId);
  const actRows = acts.map((a) => ({ id: a._id, opportunityId: a.opportunity_id, contactId: a.contact_id, occurredAt: fromRawDate(a.occurred_at)! }));
  const actsByDeal = group(actRows, (a) => a.opportunityId);
  const actsByPerson = group(actRows, (a) => a.contactId);
  const mailByPerson = group(
    emails.map((m) => ({ contactId: m.contact_id, direction: m.direction, sentAt: fromRawDate(m.sent_at)! })),
    (m) => m.contactId,
  );
  const lastMailByPerson = group(
    lastMail.map((g) => ({ contactId: g._id.c, direction: g._id.d, at: fromRawDate(g.at) })),
    (g) => g.contactId,
  );
  const tasksByDeal = group(tasks.map((t) => ({ opportunityId: t.opportunity_id, dueAt: fromRawDate(t.due_at) })), (t) => t.opportunityId);
  const stageEntered = new Map(stageEvents.map((e) => [`${e._id.o}:${e._id.s}`, fromRawDate(e.at)]));
  const lastActivity = new Map(lastActs.map((g) => [g._id, fromRawDate(g.at)]));
  return deals.map((o) => {
    const ids = new Set<string>();
    if (o.contactId && personIds.has(o.contactId)) ids.add(o.contactId);
    if (o.companyId) for (const p of peopleByCompany.get(o.companyId) ?? []) ids.add(p.id);
    const seen = new Set<string>();
    const myActs: typeof actRows = [];
    for (const a of [...(actsByDeal.get(o.id) ?? []), ...[...ids].flatMap((id) => actsByPerson.get(id) ?? [])]) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      myActs.push(a);
    }
    const myMail = [...ids].flatMap((id) => mailByPerson.get(id) ?? []);
    const inWindow = (t: number, from: number, to = Infinity) => t >= from && t < to;
    const touches = (from: number, to?: number) =>
      myActs.filter((a) => inWindow(a.occurredAt.getTime(), from, to)).length + myMail.filter((m) => inWindow(m.sentAt.getTime(), from, to)).length;
    const peopleIn = (from: number, to?: number) => {
      const set = new Set<string>();
      for (const a of myActs) if (a.contactId && ids.has(a.contactId) && inWindow(a.occurredAt.getTime(), from, to)) set.add(a.contactId);
      for (const m of myMail) if (m.direction === 'INBOUND' && inWindow(m.sentAt.getTime(), from, to)) set.add(m.contactId);
      return set.size;
    };
    const myLastMail = [...ids].flatMap((id) => lastMailByPerson.get(id) ?? []);
    const last = (dir: 'INBOUND' | 'OUTBOUND') => maxDate(myLastMail.filter((g) => g.direction === dir).map((g) => g.at));
    const myTasks = tasksByDeal.get(o.id) ?? [];
    return {
      id: o.id,
      name: o.name,
      amount: o.amount,
      currency: o.currency,
      status: o.status,
      expected_close_date: o.expectedCloseDate,
      created_at: o.createdAt,
      contact_id: o.contactId,
      owner_id: o.ownerId,
      stage_name: o.stage.name,
      stage_entered_at: stageEntered.get(`${o.id}:${o.stageId}`) ?? null,
      last_activity_at: lastActivity.get(o.id) ?? null,
      open_tasks: myTasks.length,
      overdue_tasks: myTasks.filter((t) => t.dueAt && t.dueAt.getTime() < now).length,
      touches14: touches(t14),
      touches_prev14: touches(t28, t14),
      last_inbound_at: last('INBOUND'),
      last_outbound_at: last('OUTBOUND'),
      people30: peopleIn(t30),
      people_prev30: peopleIn(t60, t30),
    };
  });
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
    await this.store(tx, tenantId, rows, now);
    return rows.length;
  }

  /**
   * Stores the scores of these deals. A score or day row that did not change is not written again (only the time it
   * was scored moves on, in one write), so an hourly sweep of thousands of unchanged deals is a handful of writes.
   */
  private async store(tx: TenantTx, tenantId: string, rows: FactRow[], now: Date): Promise<void> {
    if (!rows.length) return;
    const day = new Date(`${ymd(now)}T00:00:00Z`);
    const ids = rows.map((r) => r.id);
    const [previousRows, todayRows] = await Promise.all([
      aggregate<{ _id: string; health: number; risk: string; signals: unknown; alerted_at: unknown }>(tx.dealHealthScore, [
        { $match: { _id: { $in: ids } } },
        { $project: { health: 1, risk: 1, signals: 1, alerted_at: 1 } },
      ]),
      aggregate<{ deal_id: string; health: number; risk: string }>(tx.dealHealthDaily, [
        { $match: { day: rawDate(day), deal_id: { $in: ids } } },
        { $project: { _id: 0, deal_id: 1, health: 1, risk: 1 } },
      ]),
    ]);
    const previous = new Map(previousRows.map((p) => [p._id, { risk: p.risk, health: p.health, signals: JSON.stringify(p.signals ?? null), alertedAt: fromRawDate(p.alerted_at) }]));
    const today = new Map(todayRows.map((d) => [d.deal_id, d]));
    const unchanged: string[] = [];
    for (const r of rows) {
      if (r.status !== 'OPEN') {
        await tx.dealHealthScore.deleteMany({ where: { dealId: r.id } });
        continue;
      }
      const h = dealHealth(toDealFacts(r), now);
      const before = previous.get(r.id);
      const alert = h.risk === 'high' && !before?.alertedAt;
      const signals = h.signals as unknown as Prisma.InputJsonValue;
      const clearsAlert = h.risk !== 'high' && !!before?.alertedAt;
      if (before && !alert && !clearsAlert && before.health === h.health && before.risk === h.risk && before.signals === JSON.stringify(signals)) unchanged.push(r.id);
      else
        await tx.dealHealthScore.upsert({
          where: { dealId: r.id },
          create: { dealId: r.id, tenantId, health: h.health, risk: h.risk, signals, computedAt: now, alertedAt: alert ? now : null },
          update: { health: h.health, risk: h.risk, signals, computedAt: now, ...(alert ? { alertedAt: now } : h.risk !== 'high' ? { alertedAt: null } : {}) },
        });
      const kept = today.get(r.id);
      if (!kept || kept.health !== h.health || kept.risk !== h.risk)
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
    for (let i = 0; i < unchanged.length; i += LARGE_IN_LIST)
      await tx.dealHealthScore.updateMany({ where: { tenantId, dealId: { in: unchanged.slice(i, i + LARGE_IN_LIST) } }, data: { computedAt: now } });
  }

  /**
   * Worker job, at most hourly: rescore open deals in every workspace. The facts are read in one transaction and the
   * scores stored in batches, each in its own short transaction, so a workspace with thousands of open deals never
   * outlasts a transaction's time limit (it used to fail every hour on such workspaces).
   */
  async sweep(force = false): Promise<number> {
    return this.sweeper.run(
      force,
      () => scanTenants(this.prisma.subscription, {}, 5000),
      async (tenantId) => {
        try {
          await this.rescore({ tenantId }, tenantId);
        } catch (err) {
          this.log.error({ err: errorMessage(err), tenantId }, 'deal health sweep failed');
        }
      },
    );
  }

  /** Rescores every open deal of a workspace: facts in one read, scores stored in batches of short transactions. */
  private async rescore(ctx: { tenantId: string }, tenantId: string): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.run(ctx, (tx) => loadDealFacts(tx, tenantId), { timeoutMs: 30_000 });
    for (let i = 0; i < rows.length; i += SWEEP_BATCH) {
      const batch = rows.slice(i, i + SWEEP_BATCH);
      await this.prisma.run(ctx, (tx) => this.store(tx, tenantId, batch, now), { timeoutMs: 30_000 });
    }
  }

  /** "Rescore now" from the at-risk page. */
  async refreshNow(auth: AuthContext): Promise<DealHealthSummary> {
    await this.rescore(auth, auth.tenantId);
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
