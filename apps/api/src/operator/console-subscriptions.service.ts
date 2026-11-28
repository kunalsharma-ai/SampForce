import { Injectable } from '@nestjs/common';
import {
  type ClientSubscriptionState,
  type ConsoleClientRow,
  type ConsoleSubscriptionRow,
  type ConsoleSubscriptionsSummary,
  SUBSCRIPTION_STATES,
} from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { ConsoleService } from './console.service';
import type { OperatorContext } from './operator-auth';

const DAY = 86_400_000;
const LIST = 20;
/** Clients the page reads at most; far more than the Console has today, and the lists show the first 20 each. */
const MAX_CLIENTS = 5000;
/** Subscriptions that run and are (meant to be) paid for. A trial is free, so it adds nothing to the monthly value. */
const PAYING: ClientSubscriptionState[] = ['ACTIVE', 'PENDING', 'PAYMENT_FAILED'];

/**
 * The Console's subscriptions and billing page (control center K4): clients by subscription state, what moved over
 * the chosen days (from the subscription history), the agreed monthly value, and the four work lists an account
 * manager acts on: trials ending, renewals due, payment problems and cancellations.
 */
@Injectable()
export class ConsoleSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly console: ConsoleService,
  ) {}

  async summary(op: OperatorContext, days: number, now = new Date()): Promise<ConsoleSubscriptionsSummary> {
    const rows = (await this.console.rows({}, MAX_CLIENTS)).filter((r) => r.subscription);
    const since = new Date(now.getTime() - days * DAY);
    const moves = await this.prisma.run({ operatorScan: true }, (tx) =>
      tx.subscriptionEvent.groupBy({ by: ['kind'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    );
    const n = (...kinds: string[]) => moves.filter((m) => kinds.includes(m.kind)).reduce((a, m) => a + m._count._all, 0);

    const states = Object.fromEntries(SUBSCRIPTION_STATES.map((s) => [s, 0])) as Record<ClientSubscriptionState, number>;
    for (const r of rows) states[r.subscription!.state] += 1;

    const value = new Map<string, { cents: number; clients: number }>();
    let unpriced = 0;
    for (const r of rows) {
      const s = r.subscription!;
      if (!PAYING.includes(s.state)) continue;
      if (s.priceCents === null) {
        unpriced += 1;
        continue;
      }
      const v = value.get(s.currency) ?? { cents: 0, clients: 0 };
      v.cents += s.billingFrequency === 'YEAR' ? Math.round(s.priceCents / 12) : s.priceCents;
      v.clients += 1;
      value.set(s.currency, v);
    }

    const within = (date: string | null, d: number) => !!date && new Date(date).getTime() - now.getTime() <= d * DAY;
    const row = (r: ConsoleClientRow, date: string | null): ConsoleSubscriptionRow => {
      const s = r.subscription!;
      return { id: r.id, name: r.name, customerId: r.customerId, planName: s.planName, state: s.state, date, priceCents: s.priceCents, currency: s.currency, billingFrequency: s.billingFrequency, paymentStatus: s.paymentStatus };
    };
    const byDate = (a: ConsoleSubscriptionRow, b: ConsoleSubscriptionRow) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.name.localeCompare(b.name);
    const pick = (keep: (r: ConsoleClientRow) => boolean, date: (r: ConsoleClientRow) => string | null) => rows.filter(keep).map((r) => row(r, date(r))).sort(byDate).slice(0, LIST);

    return {
      generatedAt: now.toISOString(),
      states,
      movements: {
        days,
        started: n('CREATED'),
        upgraded: n('UPGRADED'),
        downgraded: n('DOWNGRADED'),
        renewed: n('RENEWED'),
        trialsStarted: n('TRIAL_STARTED'),
        cancelled: n('CANCELLED'),
        reactivated: n('REACTIVATED'),
        paymentFailed: n('PAYMENT_FAILED'),
      },
      monthlyValue: op.permissions.includes('billing.view') ? [...value].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => b.cents - a.cents) : null,
      unpriced,
      trialsEnding: pick((r) => r.subscription!.state === 'TRIAL' && within(r.subscription!.trialEndsAt, 14), (r) => r.subscription!.trialEndsAt),
      renewalsDue: pick(
        (r) => ['ACTIVE', 'PENDING'].includes(r.subscription!.state) && !r.subscription!.cancelAtPeriodEnd && within(r.subscription!.renewsOn, 30),
        (r) => r.subscription!.renewsOn,
      ),
      paymentProblems: pick((r) => r.subscription!.state === 'PAYMENT_FAILED' || r.subscription!.state === 'PENDING', (r) => r.subscription!.renewsOn),
      cancelling: pick((r) => r.subscription!.cancelAtPeriodEnd && r.subscription!.state !== 'CANCELLED', (r) => r.subscription!.renewsOn),
    };
  }
}
