import type { Prisma, TenantTx } from '@dealflow/database';
import { subscriptionStateOf, type SubscriptionEventKind, type ClientSubscriptionState } from '@dealflow/types';
import type { OperatorContext } from './operator-auth';

type Sub = Prisma.SubscriptionGetPayload<object>;

/** The Console's state of a stored subscription for a client with the given status. */
export function stateOfSubscription(tenantStatus: string, s: Pick<Sub, 'status' | 'paymentStatus' | 'trialEndsAt' | 'currentPeriodEnd' | 'autoRenew' | 'cancelAtPeriodEnd'>, now = new Date()): ClientSubscriptionState {
  return subscriptionStateOf({ tenantStatus, status: s.status, paymentStatus: s.paymentStatus, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, autoRenew: s.autoRenew, cancelAtPeriodEnd: s.cancelAtPeriodEnd }, now);
}

/**
 * Upgrade or downgrade, by the plans' price per month. A plan priced per client (no list price) counts as the top
 * plan, as it is sold to the largest clients; equal prices are a plain plan change.
 */
export function planMoveKind(from: { priceCents: number | null; yearly: boolean }, to: { priceCents: number | null; yearly: boolean }): SubscriptionEventKind {
  const monthly = (p: { priceCents: number | null; yearly: boolean }) => (p.priceCents === null ? Number.POSITIVE_INFINITY : p.yearly ? p.priceCents / 12 : p.priceCents);
  const a = monthly(from);
  const b = monthly(to);
  return b > a ? 'UPGRADED' : b < a ? 'DOWNGRADED' : 'PLAN_CHANGED';
}

export interface SubscriptionEventInput {
  tenantId: string;
  kind: SubscriptionEventKind;
  fromPlan?: string | null;
  toPlan?: string | null;
  fromState?: ClientSubscriptionState | null;
  toState?: ClientSubscriptionState | null;
  changes?: string[];
  reason?: string | null;
  operator?: Pick<OperatorContext, 'id' | 'email'> | null;
}

/** One line of a client's subscription history, written in the client's own transaction so it lands with the change. */
export async function recordSubscriptionEvent(tx: TenantTx, e: SubscriptionEventInput): Promise<void> {
  await tx.subscriptionEvent.create({
    data: {
      tenantId: e.tenantId,
      kind: e.kind,
      fromPlan: e.fromPlan ?? null,
      toPlan: e.toPlan ?? null,
      fromState: e.fromState && e.fromState !== e.toState ? e.fromState : null,
      toState: e.fromState && e.fromState !== e.toState ? (e.toState ?? null) : null,
      changes: e.changes ?? [],
      reason: e.reason ?? null,
      operatorId: e.operator?.id ?? null,
      operatorEmail: e.operator?.email ?? null,
    },
  });
}
