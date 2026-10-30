import { Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { ActivityItem, DashboardSummary, KpiValue } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { growth, quarterBounds, ratio, round } from './kpi-math';

const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

const ACTION_LABELS: Record<string, string> = {
  'tenant.created': 'created the workspace',
  'tenant.updated': 'updated workspace settings',
  'auth.login': 'signed in',
  'auth.logout': 'signed out',
  'auth.workspace_switched': 'switched into this workspace',
  'member.role_changed': 'changed a member role',
};

interface MoneyRow {
  pipeline_value: Prisma.Decimal | null;
  weighted_value: Prisma.Decimal | null;
  open_count: bigint;
  won_value: Prisma.Decimal | null;
  won_count: bigint;
  won_prev_value: Prisma.Decimal | null;
  avg_cycle_days: number | null;
  quarter_won: Prisma.Decimal | null;
  quarter_weighted: Prisma.Decimal | null;
}

/**
 * Computes Command Center metrics from live tenant data. Monetary KPIs include only deals
 * in the workspace's default currency until multi-currency conversion ships (Phase 5); the
 * KPI definitions say so explicitly.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(auth: AuthContext, now = new Date()): Promise<DashboardSummary> {
    const periodStart = new Date(now.getTime() - PERIOD_DAYS * DAY_MS);
    const prevStart = new Date(periodStart.getTime() - PERIOD_DAYS * DAY_MS);
    const quarter = quarterBounds(now);

    return this.prisma.run(auth, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      const currency = tenant.defaultCurrency;
      const tid = auth.tenantId;
      const leadBase = { tenantId: tid, deletedAt: null };

      const [totalLeads, newLeads, qualifiedLeads, convertedInPeriod, activitiesCompleted] = await Promise.all([
        tx.lead.count({ where: leadBase }),
        tx.lead.count({ where: { ...leadBase, createdAt: { gte: periodStart } } }),
        tx.lead.count({ where: { ...leadBase, status: 'QUALIFIED' } }),
        tx.lead.count({ where: { ...leadBase, createdAt: { gte: periodStart }, status: 'CONVERTED' } }),
        tx.activity.count({ where: { tenantId: tid, deletedAt: null, occurredAt: { gte: periodStart, lte: now } } }),
      ]);

      const [money] = await tx.$queryRaw<MoneyRow[]>`
        SELECT
          SUM(o.amount) FILTER (WHERE o.status = 'OPEN')                                        AS pipeline_value,
          SUM(o.amount * COALESCE(o.probability, s.probability) / 100.0) FILTER (WHERE o.status = 'OPEN') AS weighted_value,
          COUNT(*) FILTER (WHERE o.status = 'OPEN')                                             AS open_count,
          SUM(o.amount) FILTER (WHERE o.status = 'WON' AND o.closed_at >= ${periodStart})        AS won_value,
          COUNT(*) FILTER (WHERE o.status = 'WON' AND o.closed_at >= ${periodStart})             AS won_count,
          SUM(o.amount) FILTER (WHERE o.status = 'WON' AND o.closed_at >= ${prevStart}
                                 AND o.closed_at < ${periodStart})                              AS won_prev_value,
          AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) / 86400.0)
            FILTER (WHERE o.status = 'WON' AND o.closed_at >= ${periodStart})                    AS avg_cycle_days,
          SUM(o.amount) FILTER (WHERE o.status = 'WON' AND o.closed_at >= ${quarter.start}
                                 AND o.closed_at < ${quarter.end})                              AS quarter_won,
          SUM(o.amount * COALESCE(o.probability, s.probability) / 100.0)
            FILTER (WHERE o.status = 'OPEN' AND o.expected_close_date >= ${quarter.start}::date
                    AND o.expected_close_date < ${quarter.end}::date)                            AS quarter_weighted
        FROM opportunities o
        JOIN pipeline_stages s ON s.id = o.stage_id
        WHERE o.tenant_id = ${tid}::uuid AND o.deleted_at IS NULL AND o.currency = ${currency}`;

      const n = (v: Prisma.Decimal | null | undefined) => (v ? Number(v) : 0);
      const wonValue = n(money?.won_value);
      const wonCount = Number(money?.won_count ?? 0);
      const openCount = Number(money?.open_count ?? 0);
      const forecast = n(money?.quarter_won) + n(money?.quarter_weighted);
      const money_note = `Deals in ${currency} only.`;

      const kpis: KpiValue[] = [
        { key: 'totalLeads', label: 'Total leads', value: totalLeads, format: 'number', definition: 'All active (not deleted) leads.' },
        { key: 'newLeads', label: 'New leads', value: newLeads, format: 'number', definition: `Leads created in the last ${PERIOD_DAYS} days.` },
        { key: 'qualifiedLeads', label: 'Qualified leads', value: qualifiedLeads, format: 'number', definition: 'Leads currently marked Qualified.' },
        { key: 'activeOpportunities', label: 'Active opportunities', value: openCount, format: 'number', definition: `Open deals. ${money_note}` },
        { key: 'pipelineValue', label: 'Pipeline value', value: round(n(money?.pipeline_value)), format: 'currency', definition: `Sum of open deal amounts. ${money_note}` },
        { key: 'weightedPipelineValue', label: 'Weighted pipeline', value: round(n(money?.weighted_value)), format: 'currency', definition: `Open amounts × deal probability (or stage probability). ${money_note}` },
        { key: 'closedWonRevenue', label: 'Closed-won revenue', value: round(wonValue), format: 'currency', definition: `Won in the last ${PERIOD_DAYS} days. ${money_note}` },
        { key: 'conversionRate', label: 'Lead conversion rate', value: round(ratio(convertedInPeriod, newLeads), 4), format: 'percent', definition: `Leads created in the last ${PERIOD_DAYS} days that have converted.` },
        { key: 'averageDealSize', label: 'Average deal size', value: round(ratio(wonValue, wonCount)), format: 'currency', definition: `Average won amount, last ${PERIOD_DAYS} days. ${money_note}` },
        { key: 'averageSalesCycleDays', label: 'Average sales cycle', value: round(money?.avg_cycle_days ?? null, 1), format: 'days', definition: `Days from deal creation to win, for deals won in the last ${PERIOD_DAYS} days.` },
        { key: 'forecastRevenue', label: 'Quarter forecast', value: round(forecast), format: 'currency', definition: `Won this quarter plus weighted open deals expected to close this quarter. A rule-based projection, not a guarantee. ${money_note}` },
        { key: 'revenueGrowth', label: 'Revenue growth', value: round(growth(wonValue, n(money?.won_prev_value)), 4), format: 'percent', definition: `Closed-won revenue vs the previous ${PERIOD_DAYS} days.` },
        { key: 'activitiesCompleted', label: 'Team activities', value: activitiesCompleted, format: 'number', definition: `Calls, emails, meetings and notes logged in the last ${PERIOD_DAYS} days.` },
        { key: 'aiAssistedActivities', label: 'AI-assisted activities', value: null, format: 'number', definition: 'Activities drafted or performed with AI assistance.', availableFrom: 'Phase 4 (AI gateway)' },
        { key: 'automationSuccessRate', label: 'Automation success rate', value: null, format: 'percent', definition: 'Successful workflow executions ÷ all executions.', availableFrom: 'Phase 3 (workflow engine)' },
      ];

      const pipeline = await tx.pipeline.findFirst({
        where: { tenantId: tid, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      let pipelineSummary: DashboardSummary['pipeline'] = null;
      if (pipeline) {
        const grouped = await tx.opportunity.groupBy({
          by: ['stageId'],
          where: { tenantId: tid, pipelineId: pipeline.id, deletedAt: null, currency },
          _count: { _all: true },
          _sum: { amount: true },
        });
        const byStage = new Map(grouped.map((g) => [g.stageId, g]));
        pipelineSummary = {
          pipelineId: pipeline.id,
          name: pipeline.name,
          stages: pipeline.stages.map((s) => ({
            stageId: s.id,
            name: s.name,
            probability: s.probability,
            dealCount: byStage.get(s.id)?._count._all ?? 0,
            value: n(byStage.get(s.id)?._sum.amount ?? null),
          })),
        };
      }

      const logs = await tx.auditLog.findMany({
        where: { tenantId: tid },
        orderBy: { createdAt: 'desc' },
        take: 12,
      });
      const actorIds = [...new Set(logs.map((l) => l.actorUserId).filter((v): v is string => !!v))];
      const actors = actorIds.length
        ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
        : [];
      const names = new Map(actors.map((a) => [a.id, a.name]));
      const recentActivity: ActivityItem[] = logs.map((l) => ({
        id: l.id,
        action: l.action,
        summary: ACTION_LABELS[l.action] ?? l.action,
        actorName: l.actorUserId ? (names.get(l.actorUserId) ?? null) : null,
        createdAt: l.createdAt.toISOString(),
      }));

      return {
        generatedAt: now.toISOString(),
        currency,
        periodStart: periodStart.toISOString(),
        periodEnd: now.toISOString(),
        kpis,
        pipeline: pipelineSummary,
        recentActivity,
      };
    });
  }
}
