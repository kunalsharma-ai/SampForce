import type { TenantTx } from '@dealflow/database';
import { CALL_REACHED, type RateTable, type TargetMetric, toBase } from '@dealflow/types';
import { Detector } from '../achievements/detector';
import { Metrics, r2 } from '../command-center/metrics';
import { loadRates } from '../revenue/fx';

/**
 * Counts one measure for some people over [start, end), straight from the stored records (ADR 0096). Targets, recurring
 * tasks and rankings all count through here, so the same work never gives two different numbers. Deleted records never
 * count; qualified companies count only when they can be reached and are not a repeat of one already in SampForce.
 */
export class Measures {
  private rates: RateTable | null = null;
  private currency: string | null = null;

  constructor(
    private readonly tx: TenantTx,
    private readonly tenantId: string,
  ) {}

  async baseCurrency(): Promise<string> {
    this.currency ??= (await this.tx.tenant.findUniqueOrThrow({ where: { id: this.tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
    return this.currency;
  }

  private async rateTable(): Promise<RateTable> {
    this.rates ??= await loadRates(this.tx, this.tenantId);
    return this.rates;
  }

  private async metrics(users: string[], start: Date, end: Date): Promise<Metrics> {
    const now = new Date();
    return new Metrics(this.tx, { tenantId: this.tenantId, users, start, end, now, todayStart: now, tomorrowStart: now }, await this.baseCurrency(), await this.rateTable());
  }

  private interaction(users: string[], start: Date, end: Date, kinds: string[], type: string) {
    return this.tx.activity.count({
      where: {
        tenantId: this.tenantId, deletedAt: null, ownerId: { in: users }, occurredAt: { gte: start, lt: end },
        OR: [{ interaction: { in: kinds } }, { AND: [{ OR: [{ interaction: null }, { interaction: { isSet: false } }] }, { type: type as 'CALL' }] }],
      },
    });
  }

  async count(metric: TargetMetric, users: string[], start: Date, end: Date): Promise<number> {
    if (!users.length || end <= start) return 0;
    const t = this.tenantId;
    switch (metric) {
      case 'LEADS':
        return (await (await this.metrics(users, start, end)).leadsGenerated()).length;
      case 'QUALIFIED_COMPANIES':
        return (await new Detector(this.tx, t).validLeads(users, start, end)).counted;
      case 'CONTACTS':
        return this.tx.contact.count({
          where: { tenantId: t, deletedAt: null, createdById: { in: users }, createdAt: { gte: start, lt: end }, OR: [{ email: { not: null } }, { phone: { not: null } }] },
        });
      case 'CALLS':
        return this.interaction(users, start, end, ['CALL_OUTGOING', 'CALL_INCOMING'], 'CALL');
      case 'CALLS_CONNECTED':
        return this.tx.phoneCall.count({ where: { tenantId: t, deletedAt: null, userId: { in: users }, status: 'LOGGED', outcome: { in: [...CALL_REACHED] }, startedAt: { gte: start, lt: end } } });
      case 'MEETINGS':
        return this.interaction(users, start, end, ['MEETING'], 'MEETING');
      case 'FOLLOW_UPS_DONE':
        return this.tx.task.count({ where: { tenantId: t, deletedAt: null, followUpType: { not: null }, status: 'DONE', assigneeId: { in: users }, completedAt: { gte: start, lt: end } } });
      case 'DEALS_CREATED':
        return this.tx.opportunity.count({ where: { tenantId: t, deletedAt: null, ownerId: { in: users }, createdAt: { gte: start, lt: end } } });
      case 'DEAL_VALUE': {
        const deals = await this.tx.opportunity.findMany({ where: { tenantId: t, deletedAt: null, ownerId: { in: users }, createdAt: { gte: start, lt: end } }, select: { amount: true, currency: true }, take: 20_000 });
        const base = await this.baseCurrency();
        const rates = await this.rateTable();
        return r2(deals.reduce((a, d) => a + (toBase(Number(d.amount), d.currency, base, rates) ?? 0), 0));
      }
      case 'EMAILS_SENT': {
        const e = await (await this.metrics(users, start, end)).emailsSent();
        return e.logged.length + e.synced.length;
      }
      case 'RFQS':
        return (await (await this.metrics(users, start, end)).rfqsReceived()).length;
      case 'RFQS_CONVERTED':
        return (await (await this.metrics(users, start, end)).rfqsDecided('WON')).length;
      case 'CONVERSIONS':
        return (await (await this.metrics(users, start, end)).clientsConverted()).length;
      case 'DEALS_WON':
        return (await (await this.metrics(users, start, end)).revenue()).deals;
      case 'REVENUE':
        return r2((await (await this.metrics(users, start, end)).revenue()).amount);
    }
  }
}
