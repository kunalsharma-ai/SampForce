import { Inject, Injectable } from '@nestjs/common';
import { CONSOLE_KPIS, type ConsoleActionKey, type ConsoleClientRow, type ConsoleDashboard, type ConsoleKpiKey } from '@dealflow/types';
import type { Prisma } from '@dealflow/database';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { ConsoleService } from './console.service';
import { PROVIDER_CHECK_PREFIX, readProviderCheck } from './provider-checks';

const DAY = 86_400_000;
const OPEN_TICKET = ['SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'AWAITING_USER'] as const;
const MONEY = new Set<ConsoleKpiKey>(['revenue.mrr', 'revenue.arr', 'revenue.total', 'revenue.outstanding']);

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** The last 12 months as YYYY-MM, oldest first. */
function lastMonths(now: Date, n = 12): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}

type Live = { metrics: Record<ConsoleKpiKey, number>; currency: string; rows: ConsoleClientRow[]; mrr: Map<string, number> };

/**
 * The Console Overview (ADR 0074, C5b): Action Required, 18 KPIs with their change against 30 days ago, and the
 * charts, from one call cached for a minute. Every figure is a count or sum across clients; no CRM record is read.
 * The worker stores the KPI values once a day (platform_metrics_daily) so the cards can show a trend.
 */
@Injectable()
export class ConsoleOverviewService {
  private cache: { at: number; data: ConsoleDashboard } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly console: ConsoleService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private scan<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ operatorScan: true }, fn);
  }

  async dashboard(now = new Date()): Promise<ConsoleDashboard> {
    if (this.cache && now.getTime() - this.cache.at < this.env.CONSOLE_OVERVIEW_CACHE_MS) return this.cache.data;
    const data = await this.build(now);
    this.cache = { at: now.getTime(), data };
    return data;
  }

  /** Drops the cached figures (tests, and after the worker writes a snapshot). */
  forget(): void {
    this.cache = null;
  }

  /** The worker's pass: today's KPI values, once a day. Returns 1 when it wrote them. */
  async snapshot(now = new Date()): Promise<number> {
    const day = utcDay(now);
    if (await this.prisma.platformMetricDaily.findUnique({ where: { day }, select: { day: true } })) return 0;
    const live = await this.live(now);
    await this.prisma.platformMetricDaily.upsert({ where: { day }, create: { day, metrics: live.metrics, currency: live.currency }, update: {} });
    return 1;
  }

  /** The KPI values as they are now. */
  private async live(now: Date): Promise<Live> {
    const rows = await this.console.rows({}, 10_000);
    const since30 = new Date(now.getTime() - 30 * DAY);
    const soon = now.getTime() + 14 * DAY;
    const ids = rows.map((r) => r.id);
    const [members, devices, tickets, nodes, paid, open] = await Promise.all([
      this.scan((tx) => tx.membership.findMany({ where: { tenantId: { in: ids }, status: 'ACTIVE' }, select: { userId: true }, distinct: ['userId'] })),
      this.scan((tx) => tx.mobileDevice.findMany({ where: { tenantId: { in: ids }, signedOutAt: null }, select: { userId: true }, distinct: ['userId'] })),
      this.scan((tx) => tx.supportTicket.count({ where: { handlerLevel: 'CONSOLE', status: { in: [...OPEN_TICKET] } } })),
      this.scan((tx) => tx.workspaceNode.groupBy({ by: ['level'], where: { tenantId: { in: ids }, archivedAt: null }, _count: { _all: true } })),
      this.scan((tx) => tx.invoice.groupBy({ by: ['currency'], where: { tenantId: { in: ids }, status: 'PAID' }, _sum: { amountPaidCents: true } })),
      this.scan((tx) => tx.invoice.findMany({ where: { tenantId: { in: ids }, status: 'OPEN' }, select: { currency: true, totalCents: true, amountPaidCents: true }, take: 5000 })),
    ]);
    const userIds = members.map((m) => m.userId);
    const activeUsers = userIds.length ? await this.scan((tx) => tx.user.count({ where: { id: { in: userIds }, lastLoginAt: { gte: since30 } } })) : 0;

    // Money in the currency with the most subscription revenue; the others are listed apart.
    const mrr = new Map<string, number>();
    const owed = new Map<string, number>();
    for (const r of rows) {
      const s = r.subscription;
      if (!s || r.state !== 'ACTIVE' || s.status === 'CANCELED' || s.status === 'UNPAID' || s.priceCents === null || s.paymentStatus === 'WAIVED') continue;
      const monthly = s.billingFrequency === 'YEAR' ? Math.round(s.priceCents / 12) : s.priceCents;
      mrr.set(s.currency, (mrr.get(s.currency) ?? 0) + monthly);
      if (s.paymentStatus === 'PENDING' || s.paymentStatus === 'OVERDUE') owed.set(s.currency, (owed.get(s.currency) ?? 0) + s.priceCents);
    }
    for (const i of open) owed.set(i.currency.toUpperCase(), (owed.get(i.currency.toUpperCase()) ?? 0) + Math.max(0, i.totalCents - i.amountPaidCents));
    const currency = [...mrr.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
    const level = (l: string) => nodes.find((n) => n.level === l)?._count._all ?? 0;
    const live = (r: ConsoleClientRow) => r.state === 'ACTIVE' && !!r.subscription && r.subscription.status !== 'CANCELED' && r.subscription.status !== 'UNPAID';

    const metrics: Record<ConsoleKpiKey, number> = {
      'clients.total': rows.length,
      'clients.active': rows.filter((r) => r.state === 'ACTIVE').length,
      'clients.suspended': rows.filter((r) => r.state === 'SUSPENDED').length,
      'clients.trial': rows.filter((r) => r.state === 'ACTIVE' && r.subscription?.status === 'TRIALING').length,
      // Every client has exactly one Super Workspace.
      'workspaces.super': rows.length,
      'workspaces.manager': level('MANAGER'),
      'workspaces.executive': level('EXECUTIVE'),
      'people.users': userIds.length,
      'people.active': activeUsers,
      'people.mobile': devices.length,
      'revenue.subscriptions': rows.filter((r) => live(r) && (r.subscription!.status === 'ACTIVE' || r.subscription!.status === 'PAST_DUE')).length,
      'revenue.expiring': rows.filter((r) => live(r) && r.subscription!.renewsOn && new Date(`${r.subscription!.renewsOn}T00:00:00Z`).getTime() <= soon).length,
      'revenue.mrr': mrr.get(currency) ?? 0,
      'revenue.arr': (mrr.get(currency) ?? 0) * 12,
      'revenue.total': paid.find((p) => p.currency.toUpperCase() === currency)?._sum.amountPaidCents ?? 0,
      'revenue.outstanding': owed.get(currency) ?? 0,
      'revenue.failed': rows.filter((r) => r.subscription?.status === 'PAST_DUE' || r.subscription?.status === 'UNPAID').length,
      'support.open': tickets,
    };
    return { metrics, currency, rows, mrr };
  }

  private async build(now: Date): Promise<ConsoleDashboard> {
    const live = await this.live(now);
    const { rows, metrics, currency } = live;
    const ids = rows.map((r) => r.id);
    const names = new Map(rows.map((r) => [r.id, r.name]));
    const months = lastMonths(now);
    const from = new Date(`${months[0]}-01T00:00:00Z`);
    const since48h = new Date(now.getTime() - 2 * DAY);
    const days = Array.from({ length: 30 }, (_, i) => utcDay(new Date(now.getTime() - (29 - i) * DAY)));

    const [snapshots, churn, paidInv, openInv, lostInv, stale, mobile, phones, recent, checks, older, churnedBefore] = await Promise.all([
      this.prisma.platformMetricDaily.findMany({ where: { day: { gte: utcDay(new Date(now.getTime() - 31 * DAY)) } }, orderBy: { day: 'asc' } }),
      this.prisma.platformAuditLog.findMany({ where: { action: 'client.state_changed', createdAt: { gte: from }, after: { equals: { state: 'DEACTIVATED' } } }, select: { targetTenantId: true, createdAt: true } }),
      this.scan((tx) => tx.invoice.findMany({ where: { tenantId: { in: ids }, status: 'PAID', paidAt: { gte: from } }, select: { paidAt: true, amountPaidCents: true, currency: true } })),
      this.scan((tx) => tx.invoice.findMany({ where: { tenantId: { in: ids }, status: 'OPEN', issuedAt: { gte: from } }, select: { issuedAt: true, totalCents: true, amountPaidCents: true, currency: true } })),
      this.scan((tx) => tx.invoice.findMany({ where: { tenantId: { in: ids }, status: 'UNCOLLECTIBLE', issuedAt: { gte: from } }, select: { issuedAt: true, totalCents: true, currency: true } })),
      this.scan((tx) => tx.supportTicket.count({ where: { handlerLevel: 'CONSOLE', status: { in: [...OPEN_TICKET] }, createdAt: { lt: since48h } } })),
      this.scan((tx) => tx.mobileAccess.findMany({ where: { tenantId: { in: ids } }, select: { status: true, activatedAt: true, maxDevices: true, tenantId: true } })),
      this.scan((tx) => tx.mobileDevice.count({ where: { tenantId: { in: ids }, signedOutAt: null } })),
      this.scan((tx) => tx.workspaceNode.findMany({ where: { tenantId: { in: ids }, level: { in: ['MANAGER', 'EXECUTIVE'] }, archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, tenantId: true, level: true, name: true, createdAt: true } })),
      this.prisma.platformSetting.findMany({ where: { key: { startsWith: PROVIDER_CHECK_PREFIX } } }),
      // Clients that joined before the 12 months, for the running count of active clients.
      this.scan((tx) => tx.tenant.count({ where: { deletedAt: null, createdAt: { lt: from } } })),
      this.prisma.platformAuditLog.count({ where: { action: 'client.state_changed', createdAt: { lt: from }, after: { equals: { state: 'DEACTIVATED' } } } }),
    ]);

    // ── KPIs: today's value, the value 30 days ago and one point a day ──
    const byDay = new Map(snapshots.map((s) => [s.day, s.metrics as Record<string, number>]));
    const today = utcDay(now);
    const monthAgo = utcDay(new Date(now.getTime() - 30 * DAY));
    const kpis = CONSOLE_KPIS.map((key) => {
      const sameCurrency = (day: string) => !MONEY.has(key) || snapshots.find((s) => s.day === day)?.currency === currency;
      const at = (day: string) => (day === today ? metrics[key] : sameCurrency(day) ? (byDay.get(day)?.[key] ?? null) : null);
      return { key, value: metrics[key], currency: MONEY.has(key) ? currency : null, previous: at(monthAgo), series: days.map(at) };
    });

    // ── Action Required ──
    const unusedSeats = rows.reduce((a, r) => {
      const l = r.subscription?.limits;
      if (!l || r.state !== 'ACTIVE') return a;
      return a + (l.managers !== null ? Math.max(0, l.managers - r.usage.managers) : 0) + (l.executives !== null ? Math.max(0, l.executives - r.usage.executives) : 0);
    }, 0);
    const providerErrors = checks.filter((c) => readProviderCheck(c.value)?.ok === false).length;
    const counts: Record<ConsoleActionKey, number> = {
      overdue: rows.filter((r) => r.subscription?.paymentStatus === 'OVERDUE').length,
      expiring: metrics['revenue.expiring'],
      failed: metrics['revenue.failed'],
      tickets: stale,
      suspended: metrics['clients.suspended'],
      seats: unusedSeats,
      mobile: mobile.filter((m) => m.status === 'REQUESTED').length,
      providers: providerErrors,
    };

    // ── Client growth: new and deactivated per month, and the clients still active at each month's end ──
    const created = new Map<string, number>();
    for (const r of rows) {
      const m = r.createdAt.slice(0, 7);
      if (m >= months[0]!) created.set(m, (created.get(m) ?? 0) + 1);
    }
    const churned = new Map<string, number>();
    for (const c of churn) churned.set(monthOf(c.createdAt), (churned.get(monthOf(c.createdAt)) ?? 0) + 1);
    let running = older - churnedBefore;
    const growth = months.map((month) => {
      running += (created.get(month) ?? 0) - (churned.get(month) ?? 0);
      return { month, new: created.get(month) ?? 0, churned: churned.get(month) ?? 0, active: Math.max(0, running) };
    });

    // ── Revenue per month in the dashboard currency ──
    const cur = (c: string) => c.toUpperCase() === currency;
    const revenue = months.map((month) => {
      const lastDay = month === monthOf(now) ? today : utcDay(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
      const snap = month === monthOf(now) ? metrics['revenue.mrr'] : snapshots.find((s) => s.day === lastDay && s.currency === currency) ? (byDay.get(lastDay)?.['revenue.mrr'] ?? null) : null;
      return {
        month,
        paidCents: paidInv.filter((i) => cur(i.currency) && monthOf(i.paidAt!) === month).reduce((a, i) => a + i.amountPaidCents, 0),
        outstandingCents: openInv.filter((i) => cur(i.currency) && monthOf(i.issuedAt) === month).reduce((a, i) => a + Math.max(0, i.totalCents - i.amountPaidCents), 0),
        failedCents: lostInv.filter((i) => cur(i.currency) && monthOf(i.issuedAt) === month).reduce((a, i) => a + i.totalCents, 0),
        mrrCents: snap,
      };
    });

    // ── Subscriptions by plan and billing cycle ──
    const plans = new Map<string, { code: string; name: string; month: number; year: number }>();
    for (const r of rows) {
      const s = r.subscription;
      if (!s || r.state !== 'ACTIVE' || s.status === 'CANCELED' || s.status === 'UNPAID') continue;
      const p = plans.get(s.planCode) ?? { code: s.planCode, name: s.planName, month: 0, year: 0 };
      if (s.billingFrequency === 'YEAR') p.year += 1;
      else p.month += 1;
      plans.set(s.planCode, p);
    }

    // ── Workspace utilisation across clients with limits ──
    const util = { manager: { allocated: 0, used: 0 }, executive: { allocated: 0, used: 0 } };
    const top: ConsoleDashboard['utilisation']['top'] = [];
    for (const r of rows) {
      const l = r.subscription?.limits;
      if (!l || r.state !== 'ACTIVE') continue;
      let allocated = 0;
      let used = 0;
      if (l.managers !== null) {
        util.manager.allocated += l.managers;
        util.manager.used += r.usage.managers;
        allocated += l.managers;
        used += r.usage.managers;
      }
      if (l.executives !== null) {
        util.executive.allocated += l.executives;
        util.executive.used += r.usage.executives;
        allocated += l.executives;
        used += r.usage.executives;
      }
      if (allocated > 0 && used > 0) top.push({ id: r.id, name: r.name, used, allocated });
    }
    top.sort((a, b) => b.used / b.allocated - a.used / a.allocated || b.used - a.used);

    const enabled = mobile.filter((m) => m.status === 'APPROVED' && m.activatedAt);
    const limited = enabled.filter((m) => m.maxDevices !== null);

    return {
      generatedAt: now.toISOString(),
      currency,
      otherCurrencies: [...live.mrr.entries()].filter(([c]) => c !== currency).map(([c, cents]) => ({ currency: c, mrrCents: cents })),
      actions: (Object.keys(counts) as ConsoleActionKey[]).map((key) => ({ key, count: counts[key] })),
      kpis,
      growth,
      workspaces: { super: metrics['workspaces.super'], manager: metrics['workspaces.manager'], executive: metrics['workspaces.executive'] },
      revenue,
      plans: [...plans.values()].sort((a, b) => b.month + b.year - (a.month + a.year)),
      utilisation: { ...util, top: top.slice(0, 5) },
      mobile: {
        enabledClients: enabled.length,
        requested: counts.mobile,
        seatsUsed: phones,
        // Only meaningful when every enabled client has a limit; otherwise some seats are unlimited.
        seatsAllocated: enabled.length && limited.length === enabled.length ? limited.reduce((a, m) => a + m.maxDevices!, 0) : null,
        people: metrics['people.mobile'],
      },
      recentWorkspaces: recent.map((n) => ({ id: n.id, clientId: n.tenantId, clientName: names.get(n.tenantId) ?? 'A client', level: n.level as 'MANAGER' | 'EXECUTIVE', name: n.name, createdAt: n.createdAt.toISOString() })),
    };
  }
}
