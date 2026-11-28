import type { Prisma, TenantTx } from '@dealflow/database';
import { PLAN_CATALOG, subscriptionStateOf, type SubscriptionEventKind, type ClientSubscriptionState } from '@dealflow/types';
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
  operator?: { id: string | null; email: string } | null;
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

/** A plan's price per month for telling upgrades from downgrades: the Console's terms, else the shipped list price. */
async function monthlyPriceOf(tx: TenantTx, code: string): Promise<{ priceCents: number | null; yearly: boolean }> {
  const row = await tx.plan.findUnique({ where: { code }, select: { terms: true } });
  const t = (row?.terms && typeof row.terms === 'object' ? row.terms : {}) as { priceCents?: unknown; billingFrequency?: unknown };
  if (typeof t.priceCents === 'number') return { priceCents: t.priceCents, yearly: t.billingFrequency === 'YEAR' };
  const shipped = PLAN_CATALOG.find((p) => p.code === code);
  return { priceCents: shipped && shipped.monthly !== null ? shipped.monthly * 100 : null, yearly: false };
}

export async function planMoveBetween(tx: TenantTx, fromCode: string, toCode: string): Promise<SubscriptionEventKind> {
  return planMoveKind(await monthlyPriceOf(tx, fromCode), await monthlyPriceOf(tx, toCode));
}

/**
 * Records a change made outside the Console's own subscription actions (self-serve billing, the billing provider,
 * the background worker, the operator's plan override): reads the subscription as it is now, compares it with
 * `before`, and writes one event. A plan change becomes an upgrade or downgrade unless `kind` says otherwise.
 */
export async function recordSubscriptionChange(
  tx: TenantTx,
  e: { tenantId: string; before: Sub; kind?: SubscriptionEventKind; changes?: string[]; reason?: string | null; operator?: { id: string | null; email: string } | null },
): Promise<void> {
  const [after, tenant] = await Promise.all([
    tx.subscription.findUnique({ where: { tenantId: e.tenantId } }),
    tx.tenant.findUnique({ where: { id: e.tenantId }, select: { status: true } }),
  ]);
  if (!after || !tenant) return;
  const moved = e.before.planCode !== after.planCode;
  const changes = [...(e.changes ?? [])];
  if (moved) changes.unshift(`Plan: ${e.before.planCode} → ${after.planCode}`);
  if (e.before.status !== after.status) changes.push(`Status: ${e.before.status} → ${after.status}`);
  if (e.before.seats !== after.seats) changes.push(`Seats: ${e.before.seats} → ${after.seats}`);
  const kind = e.kind ?? (moved ? await planMoveBetween(tx, e.before.planCode, after.planCode) : 'TERMS_CHANGED');
  if (!e.kind && !changes.length) return;
  await recordSubscriptionEvent(tx, {
    tenantId: e.tenantId, kind, fromPlan: moved ? e.before.planCode : null, toPlan: moved ? after.planCode : null,
    fromState: stateOfSubscription(tenant.status, e.before), toState: stateOfSubscription(tenant.status, after), changes, reason: e.reason ?? null, operator: e.operator ?? null,
  });
}
