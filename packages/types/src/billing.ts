import { z } from 'zod';
import { emailSchema } from './auth';
import { PERMISSIONS } from './permissions';
import { PLAN_CATALOG, PLAN_ENTITLEMENTS, type PlanCode, type PlanEntitlements } from './plans';

// ───────────── Plans and entitlements ─────────────

/** Plans a workspace can buy itself. Free needs no checkout and Enterprise Plus is sold by quote. */
export const SELF_SERVE_PLANS = ['launch', 'growth', 'professional', 'business', 'enterprise'] as const satisfies readonly PlanCode[];
export type SelfServePlan = (typeof SELF_SERVE_PLANS)[number];

export const BILLING_PROVIDERS = ['STRIPE', 'RAZORPAY'] as const;
export type BillingProviderKey = (typeof BILLING_PROVIDERS)[number];
/** How a subscription is paid: an online provider, offline against a DealFlow invoice, or not at all. */
export type PaymentMethod = 'NONE' | 'OFFLINE' | BillingProviderKey;
export type Interval = 'MONTH' | 'YEAR';
export type SubscriptionState = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID';

/** Seats a trial workspace may fill. Trials have no payment details, so they get a fixed allowance. */
export const TRIAL_SEATS = 10;

export interface EffectiveEntitlements {
  /** The plan on the subscription, even when its allowances are not in force. */
  planCode: PlanCode;
  /** The plan whose allowances apply: Free while a subscription is unpaid or canceled. */
  appliedPlan: PlanCode;
  entitlements: PlanEntitlements;
  /** Members (plus pending invitations) allowed; null means no limit. */
  seatLimit: number | null;
  /** True when a paid plan's allowances are withheld because it is unpaid or canceled. */
  restricted: boolean;
}

/**
 * The single rule for what a workspace may use. Paid plans are limited by the seats paid for;
 * Free by its user cap. A subscription that is unpaid (grace period over) or canceled falls back to
 * Free allowances. Nothing is deleted when that happens: existing data stays readable and editable,
 * only new usage above the Free allowances is refused.
 */
export function effectiveEntitlements(sub: { planCode: string; status: SubscriptionState; seats: number } | null): EffectiveEntitlements {
  const planCode = (sub && sub.planCode in PLAN_ENTITLEMENTS ? sub.planCode : 'free') as PlanCode;
  const restricted = !!sub && planCode !== 'free' && (sub.status === 'UNPAID' || sub.status === 'CANCELED');
  const appliedPlan: PlanCode = restricted ? 'free' : planCode;
  const entitlements = PLAN_ENTITLEMENTS[appliedPlan];
  const seatLimit = entitlements.maxUsers ?? (sub?.status === 'TRIALING' ? Math.max(sub.seats, TRIAL_SEATS) : Math.max(1, sub?.seats ?? 1));
  return { planCode, appliedPlan, entitlements, seatLimit, restricted };
}

/** Limits that would be exceeded by moving to `target`, given current usage. Empty means the move is allowed. */
export function downgradeBlockers(target: PlanCode, seats: number, usage: { members: number; pipelines: number }): string[] {
  const ent = PLAN_ENTITLEMENTS[target];
  const out: string[] = [];
  const seatCap = ent.maxUsers ?? seats;
  if (usage.members > seatCap) out.push(`${usage.members} active members, but the new plan allows ${seatCap}.`);
  if (ent.maxPipelines !== null && usage.pipelines > ent.maxPipelines) out.push(`${usage.pipelines} pipelines, but the new plan allows ${ent.maxPipelines}.`);
  return out;
}

/** Catalogue price per seat per month in USD for an interval, or null for custom pricing. */
export function catalogPrice(code: PlanCode, interval: Interval): number | null {
  const p = PLAN_CATALOG.find((c) => c.code === code);
  if (!p) return null;
  return interval === 'YEAR' ? p.annualMonthly : p.monthly;
}

// ───────────── Workspace billing inputs ─────────────

export const checkoutSchema = z.object({
  provider: z.enum(BILLING_PROVIDERS),
  planCode: z.enum(SELF_SERVE_PLANS),
  interval: z.enum(['MONTH', 'YEAR']),
  seats: z.number().int().min(1).max(1000),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const seatsSchema = z.object({ seats: z.number().int().min(1).max(1000) });
export const changePlanSchema = z.object({ planCode: z.enum(SELF_SERVE_PLANS), interval: z.enum(['MONTH', 'YEAR']) });
export const trialSchema = z.object({ planCode: z.enum(SELF_SERVE_PLANS) });

/** A workspace asks for an invoice to pay offline (bank transfer). */
export const invoiceRequestSchema = z.object({
  planCode: z.enum(SELF_SERVE_PLANS),
  interval: z.enum(['MONTH', 'YEAR']),
  seats: z.number().int().min(1).max(1000),
});
export type InvoiceRequestInput = z.infer<typeof invoiceRequestSchema>;

/** Offline invoice total in cents: rate-card price × seats × months in the interval. Taxes are not included. */
export function offlineInvoiceCents(code: SelfServePlan, interval: Interval, seats: number): number {
  return Math.round(catalogPrice(code, interval)! * 100) * seats * (interval === 'YEAR' ? 12 : 1);
}

export const supportGrantSchema = z.object({
  hours: z.number().int().min(1).max(72),
  reason: z.string().trim().min(5).max(500),
});

// ───────────── Custom roles ─────────────

export const roleInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).nullable().optional(),
  permissions: z.array(z.enum(PERMISSIONS)).min(1).max(PERMISSIONS.length),
});
export type RoleInput = z.infer<typeof roleInputSchema>;

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  members: number;
}

// ───────────── Billing overview ─────────────

export interface UsageMeter {
  used: number;
  /** null = no limit. */
  limit: number | null;
}

export interface CatalogPlan {
  code: PlanCode;
  name: string;
  audience: string;
  monthly: number | null;
  annualMonthly: number | null;
  entitlements: PlanEntitlements;
  selfServe: boolean;
  /** Which provider/interval combinations have a price configured in this deployment. */
  checkout: Record<BillingProviderKey, Record<Interval, boolean>>;
}

export interface BillingOverview {
  plan: { code: PlanCode; name: string };
  appliedPlan: PlanCode;
  status: SubscriptionState;
  interval: Interval;
  seats: number;
  seatLimit: number | null;
  restricted: boolean;
  provider: PaymentMethod;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  trialAvailable: boolean;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  /** Providers that can take new subscriptions here: keys configured and online payments turned on. */
  providers: Record<BillingProviderKey, boolean>;
  /** Paying offline: the open invoice, if any, and how to pay it (null: the DealFlow team sends details). */
  offline: { instructions: string | null; openInvoice: InvoiceRow | null };
  portalAvailable: boolean;
  usage: { members: UsageMeter; pendingInvitations: number; pipelines: UsageMeter; aiCredits: UsageMeter; automationRuns: UsageMeter };
  catalog: CatalogPlan[];
  salesContact: string | null;
  /** False while the rate card is a proposal; the UI labels prices a preview. */
  pricingPublished: boolean;
  trialDays: number;
}

export interface InvoiceRow {
  id: string;
  provider: 'OFFLINE' | BillingProviderKey;
  number: string | null;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
  currency: string;
  /** Minor units (cents/paise), as the provider reports them. */
  totalCents: number;
  amountPaidCents: number;
  taxCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  /** Offline invoices: what paying it buys. */
  planCode: PlanCode | null;
  interval: Interval | null;
  seats: number | null;
  paymentReference: string | null;
}

export interface SupportGrantRow {
  id: string;
  reason: string;
  grantedBy: { id: string; name: string } | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

// ───────────── Onboarding ─────────────

export const ONBOARDING_STEPS = ['profile', 'pipeline', 'invite', 'import', 'deal', 'automation'] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  dismissed: boolean;
  steps: { key: OnboardingStepKey; label: string; done: boolean; href: string }[];
}

// ───────────── Operator console ─────────────

export const operatorLoginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

export const operatorPlanSchema = z.object({
  planCode: z.enum(['free', 'launch', 'growth', 'professional', 'business', 'enterprise', 'enterprise_plus']),
  seats: z.number().int().min(1).max(100_000),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID']),
  trialEndsAt: z.string().datetime().nullable().optional(),
  reason: z.string().trim().min(5).max(500),
});
export type OperatorPlanInput = z.infer<typeof operatorPlanSchema>;

export const operatorStatusSchema = z.object({ suspended: z.boolean(), reason: z.string().trim().min(5).max(500) });

/** An operator records the offline payment of an open invoice: the plan it names starts or renews. */
export const operatorPaymentSchema = z.object({
  reference: z.string().trim().min(2).max(120),
  /** Day the money arrived (YYYY-MM-DD); defaults to today. Not in the future. */
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type OperatorPaymentInput = z.infer<typeof operatorPaymentSchema>;
export const operatorVoidSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/** Payment instructions shown on open offline invoices. Empty clears the console value. */
export const paymentInstructionsSchema = z.object({ instructions: z.string().trim().max(2000) });

export interface OperatorSettings {
  /** What open invoices show now, or null: they say the DealFlow team will send payment details. */
  paymentInstructions: string | null;
  /** Where it comes from: the console (editable here), the OFFLINE_PAYMENT_INSTRUCTIONS setting, or nowhere. */
  paymentInstructionsSource: 'console' | 'config' | 'none';
  updatedAt: string | null;
  updatedBy: string | null;
}

/** An open offline invoice in the operator console's "waiting for payment" list. */
export interface OperatorOpenInvoice extends InvoiceRow {
  tenant: { id: string; name: string };
}

export interface OperatorMe {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SUPPORT';
}

export interface OperatorTenantRow {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION';
  isDemo: boolean;
  createdAt: string;
  members: number;
  subscription: { planCode: string; status: SubscriptionState; seats: number; provider: string; currentPeriodEnd: string | null; trialEndsAt: string | null } | null;
  supportAccessUntil: string | null;
}

export interface OperatorTenantDetail extends OperatorTenantRow {
  invoices: InvoiceRow[];
  /** Present only while the workspace has granted support access. */
  support: null | {
    members: { name: string; email: string; role: string; joinedAt: string }[];
    audit: { action: string; actorType: string; createdAt: string; entityType: string | null }[];
  };
}

/** GET /public/pricing: what the public pricing page shows. */
export interface PublicPricing {
  published: boolean;
  currency: 'USD';
  trialDays: number;
  graceDays: number;
  salesContact: string | null;
  /** False: plans are paid offline against an invoice instead of online checkout. */
  onlinePayments: boolean;
  plans: (Omit<CatalogPlan, 'checkout'> & { buyOnline: boolean })[];
}

export interface PlatformAuditRow {
  id: string;
  operator: { id: string; email: string } | null;
  action: string;
  targetTenantId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
