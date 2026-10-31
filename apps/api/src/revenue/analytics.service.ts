import { ConflictException, Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  type ExchangeRateRow,
  type exchangeRateInputSchema,
  type ForecastTotals,
  forecastPeriod,
  quarterPeriod,
  type RevenueAnalytics,
  type SalesTargetRow,
  type salesTargetInputSchema,
  salesVelocity,
  toBase,
  winRate,
  type z,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, notFound, ownerRefs } from '../crm/crm-helpers';
import { loadRates } from './fx';

const DAY = 86_400_000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Previous `n` quarter labels ending with `label`. */
function quartersBack(label: string, n: number): string[] {
  let y = Number(label.slice(0, 4));
  let q = Number(label.slice(6));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-Q${q}`);
    q--;
    if (q === 0) {
      q = 4;
      y--;
    }
  }
  return out;
}

/**
 * Revenue analytics for one quarter, in the workspace currency. Deals in other currencies are converted
 * with the latest manually entered exchange rate; deals with no rate are left out and counted.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  revenue(auth: AuthContext, period: string | undefined): Promise<RevenueAnalytics> {
    return this.prisma.run(auth, async (tx) => {
      const p = quarterPeriod(period);
      const start = new Date(`${p.start}T00:00:00Z`);
      const end = new Date(`${p.end}T00:00:00Z`);
      const base = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
      const rates = await loadRates(tx, auth.tenantId);
      let noRate = 0;
      const conv = (amount: { toNumber(): number }, currency: string) => {
        const v = toBase(amount.toNumber(), currency, base, rates);
        if (v === null) noRate++;
        return v;
      };

      const closed = await tx.opportunity.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null, status: { in: ['WON', 'LOST'] }, closedAt: { gte: start, lt: end } },
        select: { id: true, amount: true, currency: true, status: true, ownerId: true, createdAt: true, closedAt: true, lossReason: true, sourceLeadId: true },
      });
      const won = closed.filter((d) => d.status === 'WON').map((d) => ({ ...d, value: conv(d.amount, d.currency) })).filter((d): d is typeof d & { value: number } => d.value !== null);
      const lost = closed.filter((d) => d.status === 'LOST');
      const wonTotal = r2(won.reduce((a, d) => a + d.value, 0));
      const avgDealSize = avg(won.map((d) => d.value));
      const avgCycleDays = avg(won.map((d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / DAY));
      const overallWinRate = winRate(won.length, lost.length);

      const months = new Map<string, { won: number; deals: number }>();
      for (let m = new Date(start); m < end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) months.set(m.toISOString().slice(0, 7), { won: 0, deals: 0 });
      for (const d of won) {
        const m = months.get(d.closedAt!.toISOString().slice(0, 7))!;
        m.won += d.value;
        m.deals++;
      }

      const targets = await tx.salesTarget.findMany({ where: { tenantId: auth.tenantId, period: p.label } });
      const ownerIds = [...new Set([...closed.map((d) => d.ownerId), ...targets.map((t) => t.userId)].filter((v): v is string => !!v))];
      const names = await ownerRefs(tx, ownerIds);
      const byOwnerMap = new Map<string, { won: number; deals: number; lost: number }>();
      const bucket = (id: string | null) => {
        const key = id ?? '';
        if (!byOwnerMap.has(key)) byOwnerMap.set(key, { won: 0, deals: 0, lost: 0 });
        return byOwnerMap.get(key)!;
      };
      for (const d of won) {
        const b = bucket(d.ownerId);
        b.won += d.value;
        b.deals++;
      }
      for (const d of lost) bucket(d.ownerId).lost++;
      for (const t of targets) if (t.userId) bucket(t.userId);
      const byOwner = [...byOwnerMap.entries()].map(([id, v]) => {
        const target = targets.find((t) => (t.userId ?? '') === id && t.userId !== null)?.amount.toNumber() ?? null;
        return { owner: id ? (names.get(id) ?? null) : null, won: r2(v.won), deals: v.deals, lost: v.lost, winRate: winRate(v.deals, v.lost), target, attainment: target ? r2((v.won / target) * 100) : null };
      }).sort((a, b) => b.won - a.won);

      const leadIds = [...new Set(won.map((d) => d.sourceLeadId).filter((v): v is string => !!v))];
      const sources = new Map((await tx.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, source: true } })).map((l) => [l.id, l.source]));
      const bySourceMap = new Map<string, { won: number; deals: number }>();
      for (const d of won) {
        const s = (d.sourceLeadId && sources.get(d.sourceLeadId)) || 'Direct or unknown';
        const b = bySourceMap.get(s) ?? { won: 0, deals: 0 };
        b.won += d.value;
        b.deals++;
        bySourceMap.set(s, b);
      }

      // Product revenue comes from the latest accepted quote on each won deal.
      const quotes = won.length
        ? await tx.quote.findMany({ where: { tenantId: auth.tenantId, status: 'ACCEPTED', opportunityId: { in: won.map((d) => d.id) } }, include: { lines: true }, orderBy: [{ number: 'desc' }, { version: 'desc' }] })
        : [];
      const seen = new Set<string>();
      const products = new Map<string, { name: string; revenue: number; quantity: number }>();
      for (const q of quotes) {
        if (seen.has(q.opportunityId)) continue;
        seen.add(q.opportunityId);
        for (const l of q.lines) {
          const v = toBase(l.netTotal.toNumber(), q.currency, base, rates);
          if (v === null) continue;
          const pr = products.get(l.productId) ?? { name: l.name, revenue: 0, quantity: 0 };
          pr.revenue += v;
          pr.quantity += l.quantity.toNumber();
          products.set(l.productId, pr);
        }
      }

      const lossMap = new Map<string, { deals: number; amount: number }>();
      for (const d of lost) {
        const key = d.lossReason?.trim() || 'No reason given';
        const b = lossMap.get(key) ?? { deals: 0, amount: 0 };
        b.deals++;
        b.amount += conv(d.amount, d.currency) ?? 0;
        lossMap.set(key, b);
      }

      const open = await tx.opportunity.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, status: 'OPEN' }, select: { amount: true, currency: true, expectedCloseDate: true } });
      const openInPeriod = r2(open.filter((d) => d.expectedCloseDate && d.expectedCloseDate >= start && d.expectedCloseDate < end).reduce((a, d) => a + (conv(d.amount, d.currency) ?? 0), 0));
      const target = targets.find((t) => t.userId === null)?.amount.toNumber() ?? null;
      const remaining = target !== null ? target - wonTotal : null;

      const leads = await tx.lead.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, createdAt: { gte: start, lt: end } }, select: { id: true, status: true } });
      const wonFromLeads = leads.length ? await tx.opportunity.count({ where: { tenantId: auth.tenantId, deletedAt: null, status: 'WON', sourceLeadId: { in: leads.map((l) => l.id) } } }) : 0;

      return {
        period: p,
        currency: base,
        won: { total: wonTotal, deals: won.length, avgDealSize: avgDealSize === null ? null : r2(avgDealSize), avgCycleDays: avgCycleDays === null ? null : Math.round(avgCycleDays * 10) / 10 },
        closed: { won: won.length, lost: lost.length, winRate: overallWinRate },
        byMonth: [...months.entries()].map(([month, v]) => ({ month, won: r2(v.won), deals: v.deals })),
        byOwner,
        bySource: [...bySourceMap.entries()].map(([source, v]) => ({ source, won: r2(v.won), deals: v.deals })).sort((a, b) => b.won - a.won),
        byProduct: [...products.entries()].map(([productId, v]) => ({ productId, name: v.name, revenue: r2(v.revenue), quantity: v.quantity })).sort((a, b) => b.revenue - a.revenue),
        lossReasons: [...lossMap.entries()].map(([reason, v]) => ({ reason, deals: v.deals, amount: r2(v.amount) })).sort((a, b) => b.deals - a.deals),
        velocity: { openDeals: open.length, perDay: salesVelocity(open.length, overallWinRate, avgDealSize, avgCycleDays) },
        target: { amount: target, attainment: target ? r2((wonTotal / target) * 100) : null, openInPeriod, coverage: remaining && remaining > 0 ? r2(openInPeriod / remaining) : null },
        funnel: { leads: leads.length, qualified: leads.filter((l) => l.status === 'QUALIFIED' || l.status === 'CONVERTED').length, converted: leads.filter((l) => l.status === 'CONVERTED').length, wonFromLeads },
        actualVsForecast: await this.actualVsForecast(tx, auth.tenantId, p.label, base, rates),
        excluded: { noExchangeRate: noRate },
      };
    });
  }

  /** For each recent quarter with a snapshot: the first snapshot's base forecast against what was actually won. */
  private async actualVsForecast(tx: TenantTx, tenantId: string, label: string, base: string, rates: Map<string, number>): Promise<RevenueAnalytics['actualVsForecast']> {
    const out: RevenueAnalytics['actualVsForecast'] = [];
    for (const q of quartersBack(label, 4)) {
      const p = quarterPeriod(q);
      const start = new Date(`${p.start}T00:00:00Z`);
      const end = new Date(`${p.end}T00:00:00Z`);
      const snap = await tx.forecastSnapshot.findFirst({ where: { tenantId, periodStart: start, periodEnd: end, currency: base }, orderBy: { createdAt: 'asc' } });
      if (!snap) continue;
      const won = await tx.opportunity.findMany({ where: { tenantId, deletedAt: null, status: 'WON', closedAt: { gte: start, lt: end } }, select: { amount: true, currency: true } });
      const actual = r2(won.reduce((a, d) => a + (toBase(d.amount.toNumber(), d.currency, base, rates) ?? 0), 0));
      const predicted = (snap.totals as unknown as ForecastTotals).base;
      out.push({ period: q, predicted, snapshotAt: snap.createdAt.toISOString(), actual, errorPercent: predicted ? Math.round(((actual - predicted) / predicted) * 1000) / 10 : null });
    }
    return out;
  }

  rates(auth: AuthContext): Promise<{ base: string; rates: ExchangeRateRow[] }> {
    return this.prisma.run(auth, async (tx) => {
      const base = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
      const rows = await tx.exchangeRate.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ currency: 'asc' }, { effectiveDate: 'desc' }], take: 500 });
      return { base, rates: rows.map((r) => ({ id: r.id, currency: r.currency, rate: r.rate.toNumber(), effectiveDate: r.effectiveDate.toISOString().slice(0, 10), source: r.source, createdAt: r.createdAt.toISOString() })) };
    });
  }

  setRate(auth: AuthContext, input: z.infer<typeof exchangeRateInputSchema>, meta: RequestMeta): Promise<{ id: string }> {
    return this.prisma.run(auth, async (tx) => {
      const base = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
      if (input.currency === base) throw new ConflictException({ code: 'BASE_CURRENCY', message: `${base} is the workspace currency; it needs no rate.` });
      const date = new Date(input.effectiveDate);
      const row = await tx.exchangeRate.upsert({
        where: { tenantId_currency_effectiveDate: { tenantId: auth.tenantId, currency: input.currency, effectiveDate: date } },
        create: { tenantId: auth.tenantId, currency: input.currency, rate: input.rate, effectiveDate: date, createdById: auth.userId },
        update: { rate: input.rate, createdById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'exchange_rate.set', entityType: 'exchange_rate', entityId: row.id, metadata: { ...input, base }, meta });
      return { id: row.id };
    });
  }

  targets(auth: AuthContext, period: string | undefined): Promise<SalesTargetRow[]> {
    const p = forecastPeriod(period);
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.salesTarget.findMany({ where: { tenantId: auth.tenantId, period: p.label } });
      const names = await ownerRefs(tx, rows.map((r) => r.userId));
      return rows.map((r) => ({ id: r.id, period: r.period, user: r.userId ? (names.get(r.userId) ?? null) : null, amount: r.amount.toNumber() })).sort((a, b) => (a.user ? 1 : 0) - (b.user ? 1 : 0));
    });
  }

  setTarget(auth: AuthContext, input: z.infer<typeof salesTargetInputSchema>, meta: RequestMeta): Promise<{ id: string }> {
    return this.prisma.run(auth, async (tx) => {
      await assertRefs(tx, auth.tenantId, { ownerId: input.userId }, 'user');
      // Prisma cannot upsert on a unique index with a null column, so find first.
      const existing = await tx.salesTarget.findFirst({ where: { tenantId: auth.tenantId, period: input.period, userId: input.userId } });
      const row = existing
        ? await tx.salesTarget.update({ where: { id: existing.id }, data: { amount: input.amount } })
        : await tx.salesTarget.create({ data: { tenantId: auth.tenantId, period: input.period, userId: input.userId, amount: input.amount } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sales_target.set', entityType: 'sales_target', entityId: row.id, metadata: { ...input, from: existing?.amount.toNumber() ?? null }, meta });
      return { id: row.id };
    });
  }

  removeTarget(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.salesTarget.deleteMany({ where: { id, tenantId: auth.tenantId } });
      if (!count) throw notFound('Target');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sales_target.deleted', entityType: 'sales_target', entityId: id, meta });
    });
  }
}

