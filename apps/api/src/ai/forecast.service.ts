import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  categoryOf,
  compareLines,
  computeTotals,
  FORECAST_METHOD,
  type ForecastComparison,
  type ForecastLine,
  type ForecastSnapshotRow,
  type ForecastTotals,
  type ForecastView,
  quarterPeriod,
  totalsByOwner,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';

const day = (d: Date) => d.toISOString().slice(0, 10);

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
    return this.prisma.run(auth, (tx) => this.build(tx, auth.tenantId, period));
  }

  private async build(tx: TenantTx, tenantId: string, period: string | undefined): Promise<ForecastView> {
    const p = quarterPeriod(period);
    const start = new Date(`${p.start}T00:00:00Z`);
    const end = new Date(`${p.end}T00:00:00Z`);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } });
    const currency = tenant.defaultCurrency;
    const deals = await tx.opportunity.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ status: 'OPEN' }, { status: 'WON', closedAt: { gte: start, lt: end } }],
      },
      include: { stage: { select: { name: true, probability: true } } },
      orderBy: { id: 'asc' },
    });
    const owners = await ownerRefs(tx, deals.map((d) => d.ownerId));
    const excluded = { otherCurrency: 0, noCloseDate: 0 };
    const lines: ForecastLine[] = [];
    for (const d of deals) {
      const closeDate = d.status === 'WON' ? d.closedAt : d.expectedCloseDate;
      if (d.status === 'OPEN' && !closeDate) {
        excluded.noCloseDate++;
        continue;
      }
      if (!closeDate || closeDate < start || closeDate >= end) continue;
      if (d.currency !== currency) {
        excluded.otherCurrency++;
        continue;
      }
      lines.push({
        dealId: d.id,
        name: d.name,
        amount: Number(d.amount),
        probability: d.status === 'WON' ? 100 : (d.probability ?? d.stage.probability),
        status: d.status as 'OPEN' | 'WON',
        stage: d.stage.name,
        owner: d.ownerId ? (owners.get(d.ownerId) ?? null) : null,
        closeDate: day(closeDate),
      });
    }
    return {
      method: FORECAST_METHOD,
      period: p,
      currency,
      totals: computeTotals(lines),
      byOwner: totalsByOwner(lines),
      lines: lines.map((l) => ({ ...l, category: categoryOf(l) })).sort((a, b) => b.amount - a.amount),
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
    const p = quarterPeriod(period);
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.forecastSnapshot.findMany({
        where: { tenantId: auth.tenantId, periodStart: new Date(`${p.start}T00:00:00Z`) },
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
    const recomputed = computeTotals(s.lines);
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
  r: { id: string; label: string | null; periodStart: Date; periodEnd: Date; currency: string; method: string; totals: unknown; createdById: string | null; createdAt: Date },
  names: Map<string, { id: string; name: string }>,
): ForecastSnapshotRow {
  return {
    id: r.id,
    label: r.label,
    period: { start: day(r.periodStart), end: day(r.periodEnd) },
    currency: r.currency,
    method: r.method,
    totals: r.totals as ForecastTotals,
    createdBy: r.createdById ? (names.get(r.createdById) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  };
}
