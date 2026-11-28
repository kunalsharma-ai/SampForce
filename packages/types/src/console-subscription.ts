import { z } from 'zod';

/**
 * Console control center K3: where a client's subscription stands, in the words the Console uses, and what happened to
 * it over time. The state is derived from the stored subscription and the client's status, never stored, so it cannot
 * drift from what the client can actually do.
 */
export const SUBSCRIPTION_STATES = ['ACTIVE', 'TRIAL', 'PENDING', 'EXPIRED', 'SUSPENDED', 'CANCELLED', 'PAYMENT_FAILED'] as const;
export type ClientSubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const SUBSCRIPTION_STATE_LABEL: Record<ClientSubscriptionState, string> = {
  ACTIVE: 'Active',
  TRIAL: 'Trial',
  PENDING: 'Pending payment',
  EXPIRED: 'Expired',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  PAYMENT_FAILED: 'Payment failed',
};

export const SUBSCRIPTION_STATE_HINT: Record<ClientSubscriptionState, string> = {
  ACTIVE: 'Paid or not charged, and within its term.',
  TRIAL: 'On a free trial that has not ended.',
  PENDING: 'Running, but the payment for this term has not been recorded yet.',
  EXPIRED: 'The term or trial ended and it does not renew by itself.',
  SUSPENDED: 'The Console suspended the client, or its owner closed the company. Nobody can sign in.',
  CANCELLED: 'Cancelled. The data is kept and the subscription can be reactivated.',
  PAYMENT_FAILED: 'A payment failed or is overdue.',
};

export interface ClientSubscriptionStateInput {
  tenantStatus: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID';
  paymentStatus: string | null;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
}

const time = (d: Date | string | null) => (d === null ? null : new Date(d).getTime());

/** The Console's word for a subscription. The first rule that matches wins, so a cancelled client never shows "overdue". */
export function subscriptionStateOf(s: ClientSubscriptionStateInput, now: Date = new Date()): ClientSubscriptionState {
  const t = now.getTime();
  if (s.status === 'CANCELED') return 'CANCELLED';
  if (s.tenantStatus === 'SUSPENDED' || s.tenantStatus === 'PENDING_DELETION') return 'SUSPENDED';
  if (s.status === 'UNPAID' || s.status === 'PAST_DUE' || s.paymentStatus === 'OVERDUE') return 'PAYMENT_FAILED';
  if (s.status === 'TRIALING') {
    const end = time(s.trialEndsAt);
    return end !== null && end <= t ? 'EXPIRED' : 'TRIAL';
  }
  const end = time(s.currentPeriodEnd);
  if (end !== null && end <= t && (!s.autoRenew || s.cancelAtPeriodEnd)) return 'EXPIRED';
  if (s.paymentStatus === 'PENDING') return 'PENDING';
  return 'ACTIVE';
}

/** What happened to a subscription. Upgrades and downgrades are told apart by the plans' monthly price. */
export const SUBSCRIPTION_EVENT_KINDS = [
  'CREATED',
  'UPGRADED',
  'DOWNGRADED',
  'PLAN_CHANGED',
  'RENEWED',
  'TERMS_CHANGED',
  'PAYMENT_CHANGED',
  'TRIAL_STARTED',
  'TRIAL_EXTENDED',
  'CANCEL_SCHEDULED',
  'CANCELLED',
  'REACTIVATED',
  'SUSPENDED',
  'RESUMED',
] as const;
export type SubscriptionEventKind = (typeof SUBSCRIPTION_EVENT_KINDS)[number];

export const SUBSCRIPTION_EVENT_LABEL: Record<SubscriptionEventKind, string> = {
  CREATED: 'Subscription started',
  UPGRADED: 'Upgraded',
  DOWNGRADED: 'Downgraded',
  PLAN_CHANGED: 'Plan changed',
  RENEWED: 'Renewed',
  TERMS_CHANGED: 'Terms changed',
  PAYMENT_CHANGED: 'Payment status changed',
  TRIAL_STARTED: 'Trial started',
  TRIAL_EXTENDED: 'Trial extended',
  CANCEL_SCHEDULED: 'Cancels at the end of the term',
  CANCELLED: 'Cancelled',
  REACTIVATED: 'Reactivated',
  SUSPENDED: 'Suspended',
  RESUMED: 'Access restored',
};

export interface ConsoleSubscriptionEvent {
  id: string;
  at: string;
  kind: SubscriptionEventKind;
  fromPlan: string | null;
  toPlan: string | null;
  fromState: ClientSubscriptionState | null;
  toState: ClientSubscriptionState | null;
  /** "Seats: 5 → 12" style lines, as in the client's history. */
  changes: string[];
  reason: string | null;
  /** The operator's email; null when the client or the billing provider made the change. */
  by: string | null;
}

const reason = z.string().trim().min(5).max(500);

/** POST /operator/clients/:id/subscription/cancel: now (access to paid features ends today) or at the end of the term. */
export const consoleSubscriptionCancelSchema = z.object({ when: z.enum(['NOW', 'PERIOD_END']), reason }).strict();
export type ConsoleSubscriptionCancelInput = z.infer<typeof consoleSubscriptionCancelSchema>;

/** POST /operator/clients/:id/subscription/reactivate: a cancelled or expired subscription runs again. */
export const consoleSubscriptionReactivateSchema = z
  .object({ months: z.number().int().min(1).max(120).optional(), reason })
  .strict();
export type ConsoleSubscriptionReactivateInput = z.infer<typeof consoleSubscriptionReactivateSchema>;

/** POST /operator/clients/:id/subscription/trial: starts a trial, or adds days to the one running. */
export const consoleSubscriptionTrialSchema = z
  .object({ days: z.number().int().min(1).max(90), planCode: z.string().trim().min(1).max(60).optional(), reason })
  .strict();
export type ConsoleSubscriptionTrialInput = z.infer<typeof consoleSubscriptionTrialSchema>;
