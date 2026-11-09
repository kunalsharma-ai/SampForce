import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  categoryOf,
  compareLines,
  computeTotals,
  DEFAULT_FORECAST_SETTINGS,
  FORECAST_METHOD,
  type ForecastSettings,
  type ForecastSettingsInput,
  type ForecastThresholds,
  forecastPeriod,
  type ProbabilitySource,
  type StageWinRate,
  type ForecastComparison,
  type ForecastLine,
  type ForecastSnapshotRow,
  type ForecastTotals,
  FORECAST_MAX_LINES,
  type ForecastView,
  toBase,
  totalsByOwner,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { loadRates } from '../revenue/fx';

const day = (d: Date) => d.toISOString().slice(0, 10);
/** Method label stored on snapshots that used win history for some deals. */
export const HISTORY_METHOD = 'historical-win-rate-v1';
export const thresholdsOf = (s: ForecastSettingsInput): ForecastThresholds => ({ commit: s.commitThreshold, bestCase: s.bestCaseThreshold });

/**
 * Quarter forecasts from deal data. The numbers come from the pure functions in @dealflow/types, and a
 * snapshot stores its deal lines, so any snapshot can be recomputed to the same totals.
 */
@Injectable()
export class ForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  current(auth: AuthContext, period: string | undefined): Promise<ForecastView> {
    return this.prisma.run(auth, async (tx) => {
      const view = await this.build(tx, auth.tenantId, period);
      return { ...view, lines: view.lines.slice(0, FORECAST_MAX_LINES) };
    });
  }

  async settings(tx: TenantTx, tenantId: string): Promise<ForecastSettings> {
    const row = await tx.forecastSettings.findUnique({ where: { tenantId } });
    if (!row) return { ...DEFAULT_FORECAST_SETTINGS, updatedBy: null, updatedAt: null };
    const by = row.updatedById ? (await ownerRefs(tx, [row.updatedById])).get(row.updatedById) ?? null : null;
    return {
      method: row.method as ForecastSettings['method'],
      commitThreshold: row.commitThreshold,
      bestCaseThreshold: row.bestCaseThreshold,
      historyMonths: row.historyMonths,
      minSample: row.minSample,
      updatedBy: by,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  getSettings(auth: AuthContext): Promise<ForecastSettings> {
    return this.prisma.run(auth, (tx) => this.settings(tx, auth.tenantId));
  }

  saveSettings(auth: AuthContext, input: ForecastSettingsInput, meta: RequestMeta): Promise<ForecastSettings> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.settings(tx, auth.tenantId);
      const data = { ...input, updatedById: auth.userId, updatedAt: new Date() };
      await tx.forecastSettings.upsert({ where: { tenantId: auth.tenantId }, create: { tenantId: auth.tenantId, ...data }, update: data });
      const { updatedBy: _b, updatedAt: _a, ...prev } = before;
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'forecast.settings_changed', entityType: 'forecast_settings', entityId: auth.tenantId, metadata: { before: prev, after: input }, meta });
      return this.settings(tx, auth.tenantId);
    });
  }

  /**
   * For each stage: of the deals closed in the history window that passed through it, how many were won.
   * Uses the stage-change log, so a deal counts for every stage it reached.
   */
  async stageWinRates(tx: TenantTx, tenantId: string, s: ForecastSettingsInput): Promise<StageWinRate[]> {
    const since = new Date(Date.now() - s.historyMonths * 30.44 * 86_400_000);
    const closed = await tx.opportunity.findMany({
      where: { tenantId, deletedAt: null, status: { in: ['WON', 'LOST'] }, closedAt: { gte: since } },
      select: { id: true, status: true },
    });
    const statusOf = new Map(closed.map((o) => [o.id, o.status]));
    const reached = await tx.dealStageEvent.findMany({
      where: { tenantId, opportunityId: { in: closed.map((o) => o.id) } },
      select: { opportunityId: true, toStageId: true },
    });
    // A deal counts once per stage it reached, however often it moved there.
    const byStage = new Map<string, { won: number; lost: number }>();
    const seen = new Set<string>();
    for (const e of reached) {
      const key = `${e.toStageId}:${e.opportunityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = byStage.get(e.toStageId) ?? { won: 0, lost: 0 };
      if (statusOf.get(e.opportunityId) === 'WON') c.won++;
      else c.lost++;
      byStage.set(e.toStageId, c);
    }
    const stages = await tx.pipelineStage.findMany({
      where: { tenantId, category: 'OPEN' },
      select: { id: true, name: true, probability: true, position: true, pipeline: { select: { name: true } } },
      orderBy: [{ pipelineId: 'asc' }, { position: 'asc' }],
    });
    return stages.map((st) => {
      const c = byStage.get(st.id) ?? { won: 0, lost: 0 };
      const n = c.won + c.lost;
      return { stageId: st.id, stage: st.name, pipeline: st.pipeline.name, stageProbability: st.probability, won: c.won, lost: c.lost, rate: n ? Math.round((c.won / n) * 1000) / 10 : null, usable: n >= s.minSample };
    });
  }

  async build(tx: TenantTx, tenantId: string, period: string | undefined, preloaded?: { settings: ForecastSettingsInput; rates?: StageWinRate[] }): Promise<ForecastView> {
    const settings = preloaded?.settings ?? (await this.settings(tx, tenantId));
    const thresholds = thresholdsOf(settings);
    const history = settings.method === 'history' ? (preloaded?.rates ?? (await this.stageWinRates(tx, tenantId, settings))) : [];
    const historyRate = new Map(history.filter((r) => r.usable && r.rate !== null).map((r) => [r.stageId, Math.round(r.rate!)]));
    const p = forecastPeriod(period);
    const start = new Date(`${p.start}T00:00:00Z`);
    const end = new Date(`${p.end}T00:00:00Z`);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } });
    const currency = tenant.defaultCurrency;
    const deals = await tx.opportunity.findMany({
      where: {
        tenantId,
        deletedAt: null,
        // The period filter runs in the database: loading every open deal took ~400 ms at 13k open deals.
        OR: [{ status: 'OPEN', expectedCloseDate: { gte: start, lt: end } }, { status: 'WON', closedAt: { gte: start, lt: end } }],
      },
      select: {
        id: true, name: true, amount: true, currency: true, probability: true, status: true, closedAt: true, expectedCloseDate: true, ownerId: true,
        stageId: true,
        stage: { select: { name: true, probability: true } },
      },
      orderBy: { id: 'asc' },
    });
    const noCloseDate = await tx.opportunity.count({ where: { tenantId, deletedAt: null, status: 'OPEN', expectedCloseDate: null } });
    const owners = await ownerRefs(tx, deals.map((d) => d.ownerId));
    const rates = await loadRates(tx, tenantId);
    const excluded = { otherCurrency: 0, noCloseDate };
    const lines: ForecastLine[] = [];
    for (const d of deals) {
      const closeDate = d.status === 'WON' ? d.closedAt : d.expectedCloseDate;
      if (!closeDate || closeDate < start || closeDate >= end) continue;
      // Other currencies count at the latest exchange rate; without a rate the deal is left out and reported.
      const amount = toBase(Number(d.amount), d.currency, currency, rates);
      if (amount === null) {
        excluded.otherCurrency++;
        continue;
      }
      let probability: number;
      let probabilitySource: ProbabilitySource;
      if (d.status === 'WON') [probability, probabilitySource] = [100, 'stage'];
      else if (d.probability !== null) [probability, probabilitySource] = [d.probability, 'deal'];
      else if (historyRate.has(d.stageId)) [probability, probabilitySource] = [historyRate.get(d.stageId)!, 'history'];
      else [probability, probabilitySource] = [d.stage.probability, 'stage'];
      lines.push({
        dealId: d.id,
        name: d.name,
        amount,
        ...(d.currency !== currency ? { originalAmount: Number(d.amount), originalCurrency: d.currency } : {}),
        probability,
        probabilitySource,
        status: d.status as 'OPEN' | 'WON',
        stage: d.stage.name,
        owner: d.ownerId ? (owners.get(d.ownerId) ?? null) : null,
        closeDate: day(closeDate),
      });
    }
    return {
      method: lines.some((l) => l.probabilitySource === 'history') ? HISTORY_METHOD : FORECAST_METHOD,
      assumptions: thresholds,
      period: p,
      currency,
      totals: computeTotals(lines, thresholds),
      byOwner: totalsByOwner(lines, thresholds),
      lines: lines.map((l) => ({ ...l, category: categoryOf(l, thresholds) })).sort((a, b) => b.amount - a.amount),
      lineCount: lines.length,
      excluded,
    };
  }

  snapshot(auth: AuthContext, period: string | undefined, label: string | undefined, meta: RequestMeta): Promise<ForecastSnapshotRow> {
    return this.prisma.run(auth, async (tx) => {
      const view = await this.build(tx, auth.tenantId, period);
      const lines: ForecastLine[] = view.lines.map(({ category: _c, ...l }) => l);
      const row = await tx.forecastSnapshot.create({
        data: {
          tenantId: auth.tenantId,
          label: label ?? null,
          periodStart: new Date(`${view.period.start}T00:00:00Z`),
          periodEnd: new Date(`${view.period.end}T00:00:00Z`),
          currency: view.currency,
          method: view.method,
          assumptions: view.assumptions as object,
          totals: view.totals as object,
          lines: lines as object[],
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'forecast.snapshot_created', entityType: 'forecast_snapshot', entityId: row.id,
        metadata: { period: view.period.label, base: view.totals.base }, meta,
      });
      return toRow(row, await ownerRefs(tx, [row.createdById]));
    });
  }

  list(auth: AuthContext, period: string | undefined): Promise<ForecastSnapshotRow[]> {
    const p = forecastPeriod(period);
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.forecastSnapshot.findMany({
        where: { tenantId: auth.tenantId, periodStart: new Date(`${p.start}T00:00:00Z`), periodEnd: new Date(`${p.end}T00:00:00Z`) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const names = await ownerRefs(tx, rows.map((r) => r.createdById));
      return rows.map((r) => toRow(r, names));
    });
  }

  /** Reloads a snapshot and recomputes its totals from its stored lines (they must match). */
  async verify(auth: AuthContext, id: string): Promise<{ stored: ForecastTotals; recomputed: ForecastTotals; matches: boolean }> {
    const s = await this.load(auth, id);
    const recomputed = computeTotals(s.lines, s.row.assumptions ?? undefined);
    const matches = (Object.keys(recomputed) as (keyof ForecastTotals)[]).every((k) => recomputed[k] === s.row.totals[k]);
    return { stored: s.row.totals, recomputed, matches };
  }

  async compare(auth: AuthContext, fromId: string, toId: string): Promise<ForecastComparison> {
    const [a, b] = await Promise.all([this.load(auth, fromId), this.load(auth, toId)]);
    const d = (k: 'won' | 'weighted' | 'base' | 'best') => Math.round((b.row.totals[k] - a.row.totals[k]) * 100) / 100;
    return {
      from: a.row,
      to: b.row,
      delta: { won: d('won'), weighted: d('weighted'), base: d('base'), best: d('best') },
      changes: compareLines(a.lines, b.lines),
    };
  }

  private load(auth: AuthContext, id: string): Promise<{ row: ForecastSnapshotRow; lines: ForecastLine[] }> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.forecastSnapshot.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!r) throw notFound('Forecast snapshot');
      return { row: toRow(r, await ownerRefs(tx, [r.createdById])), lines: r.lines as unknown as ForecastLine[] };
    });
  }
}

function toRow(
  r: { id: string; label: string | null; periodStart: Date; periodEnd: Date; currency: string; method: string; assumptions: unknown; totals: unknown; createdById: string | null; createdAt: Date },
  names: Map<string, { id: string; name: string }>,
): ForecastSnapshotRow {
  return {
    id: r.id,
    label: r.label,
    period: { start: day(r.periodStart), end: day(r.periodEnd) },
    currency: r.currency,
    method: r.method,
    assumptions: (r.assumptions as ForecastThresholds | null) ?? null,
    totals: r.totals as ForecastTotals,
    createdBy: r.createdById ? (names.get(r.createdById) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  };
}
