import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  childPeriods,
  type ForecastPlan,
  type ForecastTotals,
  type ForecastTrendPoint,
  type ForecastTrends,
  forecastPeriod,
  type PeriodGranularity,
  type PlanRisk,
  type PlanTarget,
  previousPeriods,
  type ProbabilitySource,
  toBase,
} from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { loadRates } from '../revenue/fx';
import { ForecastService } from './forecast.service';

const DAY = 86_400_000;
const STALE_DAYS = 30;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/**
 * Enhancement feature 10: forecast planning. Targets against the forecast, gaps, coverage, risks in the period,
 * win-rate history by stage, and trends with forecast accuracy. Every number is computed from records.
 */
@Injectable()
export class ForecastPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forecast: ForecastService,
  ) {}

  plan(auth: AuthContext, period: string | undefined): Promise<ForecastPlan> {
    return this.prisma.run(auth, async (tx) => {
      const tenantId = auth.tenantId;
      const settings = await this.forecast.settings(tx, tenantId);
      const stageRates = await this.forecast.stageWinRates(tx, tenantId, settings);
      const view = await this.forecast.build(tx, tenantId, period, { settings, rates: stageRates });
      const label = view.period.label;

      const targetRows = await tx.salesTarget.findMany({ where: { tenantId, period: { in: [label, ...childPeriods(label), ...parentOf(label)] } } });
      const targetFor = (userId: string | null): PlanTarget => resolveTarget(label, targetRows.filter((t) => t.userId === userId).map((t) => ({ period: t.period, amount: t.amount.toNumber() })));
      const target = targetFor(null);
      const open = view.lines.filter((l) => l.status === 'OPEN');
      const openAmount = open.reduce((a, l) => a + l.amount, 0);
      const gapOf = (t: number | null, totals: ForecastTotals) => (t === null ? null : r2(t - totals.base));

      // Owners with a target but no deals in the period still appear, so a gap is never hidden.
      const ownerIds = new Set(view.byOwner.map((o) => o.owner?.id).filter((v): v is string => !!v));
      for (const t of targetRows) if (t.userId) ownerIds.add(t.userId);
      const users = await tx.user.findMany({ where: { id: { in: [...ownerIds] } }, select: { id: true, name: true } });
      const empty: ForecastTotals = { won: 0, commit: 0, bestCase: 0, pipeline: 0, weighted: 0, worst: 0, base: 0, best: 0, dealCount: 0 };
      const byOwner: ForecastPlan['byOwner'] = view.byOwner.map((o) => {
        const t = o.owner ? targetFor(o.owner.id) : { amount: null, source: null };
        return { owner: o.owner, target: t, totals: o.totals, attainment: t.amount ? pct(o.totals.won, t.amount) : null, gap: gapOf(t.amount, o.totals) };
      });
      for (const u of users) {
        if (byOwner.some((o) => o.owner?.id === u.id)) continue;
        const t = targetFor(u.id);
        if (t.amount === null) continue;
        byOwner.push({ owner: u, target: t, totals: empty, attainment: 0, gap: t.amount });
      }

      const sources: Record<ProbabilitySource, number> = { deal: 0, stage: 0, history: 0 };
      for (const l of open) sources[l.probabilitySource ?? 'stage']++;

      return {
        period: view.period,
        currency: view.currency,
        settings,
        totals: view.totals,
        target,
        attainment: target.amount ? pct(view.totals.won, target.amount) : null,
        gap: target.amount === null ? null : { worst: r2(target.amount - view.totals.worst), base: r2(target.amount - view.totals.base), best: r2(target.amount - view.totals.best) },
        coverage: target.amount !== null && target.amount - view.totals.won > 0 ? r2(openAmount / (target.amount - view.totals.won)) : null,
        byOwner,
        risks: await this.risks(tx, tenantId, open),
        stageRates,
        probabilitySources: sources,
      };
    });
  }

  private async risks(tx: TenantTx, tenantId: string, open: { dealId: string; name: string; amount: number; closeDate: string; owner: { name: string } | null }[]): Promise<ForecastPlan['risks']> {
    const ids = open.map((l) => l.dealId);
    const today = new Date().toISOString().slice(0, 10);
    const [last, health] = ids.length
      ? await Promise.all([
          tx.activity.groupBy({ by: ['opportunityId'], where: { tenantId, opportunityId: { in: ids } }, _max: { occurredAt: true } }),
          tx.dealHealthScore.findMany({ where: { tenantId, dealId: { in: ids }, risk: 'high' }, select: { dealId: true, health: true } }),
        ])
      : [[], []];
    const lastAt = new Map(last.map((a) => [a.opportunityId!, a._max.occurredAt]));
    const high = new Map(health.map((h) => [h.dealId, h.health]));
    const risk = (items: { l: (typeof open)[number]; detail: string }[]): PlanRisk => ({
      count: items.length,
      amount: r2(items.reduce((a, x) => a + x.l.amount, 0)),
      deals: items
        .sort((a, b) => b.l.amount - a.l.amount)
        .slice(0, 10)
        .map(({ l, detail }) => ({ id: l.dealId, name: l.name, amount: l.amount, owner: l.owner?.name ?? null, detail })),
    });
    const now = Date.now();
    return {
      overdue: risk(open.filter((l) => l.closeDate < today).map((l) => ({ l, detail: `Expected to close ${l.closeDate}` }))),
      stale: risk(
        open
          .filter((l) => {
            const at = lastAt.get(l.dealId);
            return !at || now - at.getTime() > STALE_DAYS * DAY;
          })
          .map((l) => {
            const at = lastAt.get(l.dealId);
            return { l, detail: at ? `No activity for ${Math.floor((now - at.getTime()) / DAY)} days` : 'No activity logged' };
          }),
      ),
      highRisk: risk(open.filter((l) => high.has(l.dealId)).map((l) => ({ l, detail: `Health ${high.get(l.dealId)} of 100` }))),
    };
  }

  trends(auth: AuthContext, granularity: PeriodGranularity, count: number): Promise<ForecastTrends> {
    return this.prisma.run(auth, async (tx) => {
      const tenantId = auth.tenantId;
      const currency = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
      const rates = await loadRates(tx, tenantId);
      const now = new Date();
      const current = granularity === 'year' ? `${now.getUTCFullYear()}` : granularity === 'quarter' ? `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}` : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const labels = previousPeriods(current, count);
      const first = forecastPeriod(labels[0]);
      const from = new Date(`${first.start}T00:00:00Z`);
      const closed = await tx.opportunity.findMany({
        where: { tenantId, deletedAt: null, status: { in: ['WON', 'LOST'] }, closedAt: { gte: from } },
        select: { status: true, amount: true, currency: true, closedAt: true, createdAt: true, lossReason: true },
      });
      const points: ForecastTrendPoint[] = [];
      const reasons = new Map<string, number>();
      for (const label of labels) {
        const p = forecastPeriod(label);
        const start = new Date(`${p.start}T00:00:00Z`);
        const end = new Date(`${p.end}T00:00:00Z`);
        const inP = closed.filter((d) => d.closedAt! >= start && d.closedAt! < end);
        const won = inP.filter((d) => d.status === 'WON');
        const lost = inP.filter((d) => d.status === 'LOST');
        for (const d of lost) {
          const r = d.lossReason?.trim() || 'No reason given';
          reasons.set(r, (reasons.get(r) ?? 0) + 1);
        }
        const wonAmount = r2(won.reduce((a, d) => a + (toBase(d.amount.toNumber(), d.currency, currency, rates) ?? 0), 0));
        const cycle = won.length ? Math.round(won.reduce((a, d) => a + (d.closedAt!.getTime() - d.createdAt.getTime()) / DAY, 0) / won.length) : null;
        const snap = await tx.forecastSnapshot.findFirst({ where: { tenantId, periodStart: start, periodEnd: end, currency }, orderBy: { createdAt: 'asc' }, select: { totals: true } });
        const predicted = snap ? (snap.totals as unknown as ForecastTotals).base : null;
        const finished = end <= now;
        points.push({
          period: label,
          won: wonAmount,
          wonCount: won.length,
          lostCount: lost.length,
          winRate: pct(won.length, won.length + lost.length),
          avgCycleDays: cycle,
          forecastAtStart: predicted,
          // Accuracy only for periods that have ended: a running period is not a miss yet.
          errorPercent: predicted && finished ? Math.round(((wonAmount - predicted) / predicted) * 1000) / 10 : null,
        });
      }
      return {
        granularity,
        currency,
        points,
        topLossReasons: [...reasons.entries()].map(([reason, n]) => ({ reason, count: n })).sort((a, b) => b.count - a.count).slice(0, 6),
      };
    });
  }
}

/** The quarter of a month, the year of a quarter: a month with no target can borrow a third of its quarter's. */
function parentOf(label: string): string[] {
  const p = forecastPeriod(label);
  if (p.granularity === 'month') return [`${label.slice(0, 4)}-Q${Math.floor((Number(label.slice(5, 7)) - 1) / 3) + 1}`];
  return [];
}

export function resolveTarget(label: string, rows: { period: string; amount: number }[]): PlanTarget {
  const own = rows.find((r) => r.period === label);
  if (own) return { amount: own.amount, source: 'set' };
  const parts = childPeriods(label);
  const fromParts = rows.filter((r) => parts.includes(r.period));
  if (fromParts.length) return { amount: r2(fromParts.reduce((a, r) => a + r.amount, 0)), source: 'from_parts' };
  const parent = parentOf(label)[0];
  const q = parent ? rows.find((r) => r.period === parent) : undefined;
  if (q) return { amount: r2(q.amount / 3), source: 'share_of_quarter' };
  return { amount: null, source: null };
}
