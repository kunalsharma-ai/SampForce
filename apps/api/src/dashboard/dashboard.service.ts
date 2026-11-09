import { Injectable } from '@nestjs/common';
import { type ActivityItem, type DashboardFilter, type DashboardSummary, type KpiValue, PERIOD_DAYS as DAYS } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { growth, quarterBounds, ratio, round } from './kpi-math';

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
  pipeline_value: number;
  weighted_value: number;
  open_count: number;
  won_value: number;
  won_count: number;
  won_prev_value: number;
  lost_count: number;
  avg_cycle_days: number | null;
  quarter_won: number;
  quarter_weighted: number;
}

/**
 * Computes Command Center metrics from live tenant data. Monetary KPIs include only deals
 * in the workspace's default currency until multi-currency conversion ships (Phase 5); the
 * KPI definitions say so explicitly.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(auth: AuthContext, filter: DashboardFilter = { period: '30d' }, now = new Date()): Promise<DashboardSummary> {
    const PERIOD_DAYS = DAYS[filter.period];
    const owner = filter.ownerId === 'me' ? auth.userId : filter.ownerId;
    const scope = owner ? ' Filtered by owner.' : '';
    const periodStart = new Date(now.getTime() - PERIOD_DAYS * DAY_MS);
    const prevStart = new Date(periodStart.getTime() - PERIOD_DAYS * DAY_MS);
    const quarter = quarterBounds(now);

    return this.prisma.run(auth, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      const currency = tenant.defaultCurrency;
      const tid = auth.tenantId;
      const leadBase = { tenantId: tid, deletedAt: null, ...(owner ? { ownerId: owner } : {}) };
      const activityOwner = owner ? { ownerId: owner } : {};
      const week = new Date(now.getTime() + 7 * DAY_MS);
      const taskBase = { tenantId: tid, status: 'OPEN' as const, ...(owner ? { assigneeId: owner } : {}) };
      const [overdueTasks, upcomingTasks] = await Promise.all([
        tx.task.count({ where: { ...taskBase, dueAt: { lt: now } } }),
        tx.task.count({ where: { ...taskBase, dueAt: { gte: now, lte: week } } }),
      ]);

      const [aiAssisted, runsFinished, runsSucceeded] = await Promise.all([
        tx.activity.count({ where: { tenantId: tid, deletedAt: null, ...activityOwner, aiAssisted: true, occurredAt: { gte: periodStart, lte: now } } }),
        tx.workflowExecution.count({ where: { tenantId: tid, status: { in: ['SUCCEEDED', 'FAILED'] }, finishedAt: { gte: periodStart } } }),
        tx.workflowExecution.count({ where: { tenantId: tid, status: 'SUCCEEDED', finishedAt: { gte: periodStart } } }),
      ]);
      const [totalLeads, newLeads, qualifiedLeads, convertedInPeriod, activitiesCompleted] = await Promise.all([
        tx.lead.count({ where: leadBase }),
        tx.lead.count({ where: { ...leadBase, createdAt: { gte: periodStart } } }),
        tx.lead.count({ where: { ...leadBase, status: 'QUALIFIED' } }),
        tx.lead.count({ where: { ...leadBase, createdAt: { gte: periodStart }, status: 'CONVERTED' } }),
        tx.activity.count({ where: { tenantId: tid, deletedAt: null, ...activityOwner, occurredAt: { gte: periodStart, lte: now } } }),
      ]);

      // Money KPIs, computed from the open deals and the deals closed since the comparison period began.
      const dealWhere = { tenantId: tid, deletedAt: null, currency, ...(owner ? { ownerId: owner } : {}), ...(filter.pipelineId ? { pipelineId: filter.pipelineId } : {}) };
      const earliest = new Date(Math.min(prevStart.getTime(), quarter.start.getTime()));
      const [openDeals, closedDeals] = await Promise.all([
        tx.opportunity.findMany({ where: { ...dealWhere, status: 'OPEN' }, select: { amount: true, probability: true, stageId: true, expectedCloseDate: true } }),
        tx.opportunity.findMany({ where: { ...dealWhere, status: { in: ['WON', 'LOST'] }, closedAt: { gte: earliest } }, select: { amount: true, status: true, closedAt: true, createdAt: true } }),
      ]);
      const stageProb = new Map(
        (await tx.pipelineStage.findMany({ where: { tenantId: tid, id: { in: [...new Set(openDeals.map((d) => d.stageId))] } }, select: { id: true, probability: true } })).map((st) => [st.id, st.probability]),
      );
      const weightOf = (d: (typeof openDeals)[number]) => (d.amount * (d.probability ?? stageProb.get(d.stageId) ?? 0)) / 100;
      const inQuarter = (d: Date | null) => !!d && d >= quarter.start && d < quarter.end;
      const wonSince = closedDeals.filter((d) => d.status === 'WON' && d.closedAt! >= periodStart);
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const money: MoneyRow = {
        pipeline_value: sum(openDeals.map((d) => d.amount)),
        weighted_value: sum(openDeals.map(weightOf)),
        open_count: openDeals.length,
        won_value: sum(wonSince.map((d) => d.amount)),
        won_count: wonSince.length,
        won_prev_value: sum(closedDeals.filter((d) => d.status === 'WON' && d.closedAt! >= prevStart && d.closedAt! < periodStart).map((d) => d.amount)),
        lost_count: closedDeals.filter((d) => d.status === 'LOST' && d.closedAt! >= periodStart).length,
        avg_cycle_days: wonSince.length ? sum(wonSince.map((d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / DAY_MS)) / wonSince.length : null,
        quarter_won: sum(closedDeals.filter((d) => d.status === 'WON' && inQuarter(d.closedAt)).map((d) => d.amount)),
        quarter_weighted: sum(openDeals.filter((d) => inQuarter(d.expectedCloseDate)).map(weightOf)),
      };

      const n = (v: number | null | undefined) => (v ? Number(v) : 0);
      const wonValue = n(money?.won_value);
      const wonCount = Number(money?.won_count ?? 0);
      const openCount = Number(money?.open_count ?? 0);
      const forecast = n(money?.quarter_won) + n(money?.quarter_weighted);
      const money_note = `Deals in ${currency} only.${scope}`;
      const lostCount = Number(money?.lost_count ?? 0);
      const winRate = ratio(wonCount, wonCount + lostCount);
      const avgDeal = ratio(wonValue, wonCount);
      const cycle = money?.avg_cycle_days ?? null;
      const velocity = winRate !== null && avgDeal !== null && cycle ? (openCount * avgDeal * winRate) / Math.max(cycle, 1) : null;

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
        { key: 'aiAssistedActivities', label: 'AI-assisted activities', value: aiAssisted, format: 'number', definition: `Activities in the last ${PERIOD_DAYS} days that an AI agent drafted and a person confirmed.` },
        { key: 'winRate', label: 'Win rate', value: round(winRate, 4), format: 'percent', definition: `Deals won ÷ deals won or lost in the last ${PERIOD_DAYS} days. Empty until a deal closes.${scope}` },
        { key: 'salesVelocity', label: 'Sales velocity', value: round(velocity), format: 'currency', definition: `Expected revenue per day: open deals × average won deal × win rate ÷ average sales cycle (days), all from the last ${PERIOD_DAYS} days. ${money_note}` },
        { key: 'overdueTasks', label: 'Overdue tasks', value: overdueTasks, format: 'number', definition: `Open tasks past their due date.${scope}` },
        { key: 'upcomingTasks', label: 'Due in 7 days', value: upcomingTasks, format: 'number', definition: `Open tasks due in the next 7 days.${scope}` },
        { key: 'automationSuccessRate', label: 'Automation success rate', value: round(ratio(runsSucceeded, runsFinished), 4), format: 'percent', definition: `Workflow runs that succeeded ÷ runs that finished (succeeded or failed) in the last ${PERIOD_DAYS} days. Empty until a run finishes.` },
      ];

      const pipeline = await tx.pipeline.findFirst({
        where: { tenantId: tid, deletedAt: null, ...(filter.pipelineId ? { id: filter.pipelineId } : {}) },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      let pipelineSummary: DashboardSummary['pipeline'] = null;
      if (pipeline) {
        const grouped = await tx.opportunity.groupBy({
          by: ['stageId'],
          where: { tenantId: tid, pipelineId: pipeline.id, deletedAt: null, currency, ...(owner ? { ownerId: owner } : {}) },
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
