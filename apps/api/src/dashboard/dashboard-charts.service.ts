import { Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import { type DashboardCharts, type DashboardFilter, PERIOD_DAYS } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { type BucketUnit, bucketStart, buckets, quarterBounds, ratio, round, stageFunnel } from './kpi-math';

const DAY_MS = 86_400_000;
const n = (v: number | bigint | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Data for the Command Center charts (design spec Part 4). Same scoping as the summary: the workspace's default
 * currency, optionally one owner and one pipeline, over the selected period. Every series is also shown as a table.
 */
@Injectable()
export class DashboardChartsService {
  constructor(private readonly prisma: PrismaService) {}

  charts(auth: AuthContext, filter: DashboardFilter, now = new Date()): Promise<DashboardCharts> {
    const days = PERIOD_DAYS[filter.period];
    const periodStart = new Date(now.getTime() - days * DAY_MS);
    const owner = filter.ownerId === 'me' ? auth.userId : filter.ownerId;
    const unit: BucketUnit = days <= 90 ? 'week' : 'month';

    return this.prisma.run(auth, async (tx) => {
      const tid = auth.tenantId;
      const { defaultCurrency: currency } = await tx.tenant.findUniqueOrThrow({ where: { id: tid }, select: { defaultCurrency: true } });
      const dealWhere: Prisma.OpportunityWhereInput = {
        tenantId: tid,
        deletedAt: null,
        currency,
        ...(owner ? { ownerId: owner } : {}),
        ...(filter.pipelineId ? { pipelineId: filter.pipelineId } : {}),
      };

      // Revenue trajectory: won amount per week or month.
      const won = await tx.opportunity.findMany({ where: { ...dealWhere, status: 'WON', closedAt: { gte: periodStart, lte: now } }, select: { amount: true, closedAt: true } });
      const trend = buckets(periodStart, now, unit).map((b) => ({ start: b, won: 0, wonCount: 0 }));
      const index = new Map(trend.map((t, i) => [t.start.getTime(), i]));
      for (const w of won) {
        const i = index.get(bucketStart(w.closedAt!, unit).getTime());
        if (i !== undefined) {
          trend[i]!.won += n(w.amount);
          trend[i]!.wonCount += 1;
        }
      }
      const fmt = new Intl.DateTimeFormat('en-US', unit === 'week' ? { month: 'short', day: 'numeric', timeZone: 'UTC' } : { month: 'short', year: 'numeric', timeZone: 'UTC' });
      const revenueTrend = trend.map((t) => ({ start: t.start.toISOString().slice(0, 10), label: fmt.format(t.start), won: round(t.won)!, wonCount: t.wonCount }));

      // Stage conversion for deals created in the period.
      const pipeline = await tx.pipeline.findFirst({
        where: { tenantId: tid, deletedAt: null, ...(filter.pipelineId ? { id: filter.pipelineId } : {}) },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      let stageConversion: DashboardCharts['stageConversion'] = null;
      if (pipeline) {
        const deals = await tx.opportunity.findMany({
          where: { ...dealWhere, pipelineId: pipeline.id, createdAt: { gte: periodStart, lte: now } },
          select: { id: true, status: true, stageId: true, stageEvents: { select: { toStageId: true } } },
        });
        const rows = stageFunnel(
          pipeline.stages.map((s) => ({ id: s.id, position: s.position, category: s.category })),
          deals.map((d) => ({ status: d.status, currentStageId: d.stageId, enteredStageIds: d.stageEvents.map((e) => e.toStageId) })),
        );
        const names = new Map(pipeline.stages.map((s) => [s.id, s.name]));
        stageConversion = { pipelineId: pipeline.id, name: pipeline.name, stages: rows.map((r) => ({ ...r, name: names.get(r.stageId) ?? '', conversion: round(r.conversion, 4) })) };
      }

      // Win/loss and loss reasons.
      const closed = await tx.opportunity.groupBy({ by: ['status'], where: { ...dealWhere, status: { in: ['WON', 'LOST'] }, closedAt: { gte: periodStart, lte: now } }, _count: { _all: true }, _sum: { amount: true } });
      const wonRow = closed.find((c) => c.status === 'WON');
      const lostRow = closed.find((c) => c.status === 'LOST');
      const reasons = await tx.opportunity.groupBy({
        by: ['lossReason'],
        where: { ...dealWhere, status: 'LOST', closedAt: { gte: periodStart, lte: now } },
        _count: { _all: true },
        orderBy: { _count: { lossReason: 'desc' } },
        take: 6,
      });
      const wonCount = wonRow?._count._all ?? 0;
      const lostCount = lostRow?._count._all ?? 0;
      const winLoss = {
        won: round(n(wonRow?._sum.amount))!,
        wonCount,
        lost: round(n(lostRow?._sum.amount))!,
        lostCount,
        winRate: round(ratio(wonCount, wonCount + lostCount), 4),
        lossReasons: reasons.map((r) => ({ reason: r.lossReason?.trim() || 'No reason given', count: r._count._all })),
      };

      // Team performance.
      const [wonByOwner, openByOwner] = await Promise.all([
        tx.opportunity.groupBy({ by: ['ownerId'], where: { ...dealWhere, status: 'WON', closedAt: { gte: periodStart, lte: now } }, _sum: { amount: true }, _count: { _all: true } }),
        tx.opportunity.groupBy({ by: ['ownerId'], where: { ...dealWhere, status: 'OPEN' }, _sum: { amount: true }, _count: { _all: true } }),
      ]);
      const teamRows = [...new Set([...wonByOwner, ...openByOwner].map((g) => g.ownerId))].map((ownerId) => {
        const w = wonByOwner.find((g) => g.ownerId === ownerId);
        const o = openByOwner.find((g) => g.ownerId === ownerId);
        return { owner_id: ownerId, won: w?._sum.amount ?? null, won_count: w?._count._all ?? 0, open_value: o?._sum.amount ?? null, open_count: o?._count._all ?? 0 };
      });
      const acts = await tx.activity.groupBy({
        by: ['ownerId'],
        where: { tenantId: tid, deletedAt: null, occurredAt: { gte: periodStart, lte: now }, ...(owner ? { ownerId: owner } : {}) },
        _count: { _all: true },
      });
      const ids = [...new Set([...teamRows.map((r) => r.owner_id), ...acts.map((a) => a.ownerId)].filter((v): v is string => !!v))];
      const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      const userName = new Map(users.map((u) => [u.id, u.name]));
      const keys = [...new Set([...teamRows.map((r) => r.owner_id), ...acts.map((a) => a.ownerId)])];
      const team = keys
        .map((k) => {
          const r = teamRows.find((x) => x.owner_id === k);
          return {
            userId: k,
            name: k ? (userName.get(k) ?? 'Former member') : 'Unassigned',
            won: round(n(r?.won))!,
            wonCount: n(r?.won_count),
            openValue: round(n(r?.open_value))!,
            openCount: n(r?.open_count),
            activities: acts.find((a) => a.ownerId === k)?._count._all ?? 0,
          };
        })
        .sort((a, b) => b.won - a.won || b.openValue - a.openValue || a.name.localeCompare(b.name));

      // Risk distribution of open deals.
      const openDeals = await tx.opportunity.findMany({ where: { ...dealWhere, status: 'OPEN' }, select: { id: true, amount: true } });
      const scores = new Map(
        (await tx.dealHealthScore.findMany({ where: { tenantId: tid, dealId: { in: openDeals.map((d) => d.id) } }, select: { dealId: true, risk: true } })).map((h) => [h.dealId, h.risk]),
      );
      const riskRows: { risk: string; count: number; value: number }[] = [];
      for (const d of openDeals) {
        const key = scores.get(d.id) ?? 'unscored';
        const row = riskRows.find((x) => x.risk === key) ?? (riskRows.push({ risk: key, count: 0, value: 0 }), riskRows[riskRows.length - 1]!);
        row.count++;
        row.value += d.amount;
      }
      const risk = (['high', 'medium', 'low', 'unscored'] as const).map((r) => {
        const row = riskRows.find((x) => x.risk === r);
        return { risk: r, count: n(row?.count), value: round(n(row?.value))! };
      });

      // Goal attainment for this quarter.
      const q = quarterBounds(now);
      const period = `${q.start.getUTCFullYear()}-Q${Math.floor(q.start.getUTCMonth() / 3) + 1}`;
      const target = await tx.salesTarget.findFirst({ where: { tenantId: tid, period, userId: owner ?? null } });
      let goal: DashboardCharts['goal'] = null;
      if (target && Number(target.amount) > 0) {
        const agg = await tx.opportunity.aggregate({ where: { ...dealWhere, status: 'WON', closedAt: { gte: q.start, lt: q.end } }, _sum: { amount: true } });
        const wonQ = n(agg._sum.amount);
        goal = { period, target: Number(target.amount), won: round(wonQ)!, attainment: round(wonQ / Number(target.amount), 4)! };
      }

      return { currency, periodStart: periodStart.toISOString(), periodEnd: now.toISOString(), revenueTrend, stageConversion, winLoss, team, risk, goal };
    });
  }
}
