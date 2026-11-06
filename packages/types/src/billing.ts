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
/** How a subscription is paid: an online provider, offline against a SampForce invoice, or not at all. */
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
  /** Paying offline: the open invoice, if any, and how to pay it (null: the SampForce team sends details). */
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
  /** What open invoices show now, or null: they say the SampForce team will send payment details. */
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

/** A provider in the operator console's provider setup list (ADR 0031, keys editable since ADR 0051). */
export const PROVIDER_KEYS = ['apollo', 'hunter', 'deepgram', 'google', 'microsoft', 'slack', 'zoom', 'docusign', 'anthropic', 'smtp', 'zapier', 'checkout', 'stripe', 'razorpay'] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
/**
 * Every provider has a connection test: a call that proves the keys and costs nothing. "checkout" is a group of
 * settings (online payments on or off, price ids), not a provider, so there is nothing to call.
 */
export const PROVIDER_CHECK_KEYS = ['apollo', 'hunter', 'deepgram', 'google', 'microsoft', 'slack', 'zoom', 'docusign', 'anthropic', 'smtp', 'zapier', 'stripe', 'razorpay'] as const;
export type ProviderCheckKey = (typeof PROVIDER_CHECK_KEYS)[number];

/** A URL the operator pastes into the provider's own console (a redirect URL, a webhook endpoint). */
export interface ProviderSetupUrl {
  label: string;
  url: string;
  /** Where in the provider's console it goes. */
  where: string;
}

/** Step-by-step setup for one provider, shown in the console next to its keys (ADR 0053). */
export interface ProviderSetupGuide {
  /** The provider's own console page where the keys are created. */
  consoleUrl: string | null;
  consoleLabel: string | null;
  steps: string[];
  urls: ProviderSetupUrl[];
}

/** Whether the provider's signed webhooks reach this deployment, for providers that send them (ADR 0053). */
export interface ProviderWebhookStatus {
  /** verified: an event signed with the secret set now arrived; rejected: the last one did not match; waiting: none yet. */
  state: 'waiting' | 'verified' | 'rejected' | 'stale';
  lastVerified: { at: string; event: string } | null;
  lastRejected: { at: string; reason: string } | null;
}

/** One key or setting a provider reads. Values are never returned: a secret shows only its last four characters. */
export interface OperatorProviderField {
  /** The environment variable name, which is also the name the console saves it under. */
  name: string;
  label: string;
  set: boolean;
  required: boolean;
  /** False for settings that are not credentials (a sender address, a URL); those are shown in full. */
  secret: boolean;
  /**
   * console: saved in the operator console (wins); environment: from the deployment's secrets; default: nobody set it
   * and the built-in default applies; missing: neither.
   */
  source: 'console' | 'environment' | 'default' | 'missing';
  /** How the console asks for it: a text box, a hidden secret box, or an on/off switch. */
  input: 'text' | 'secret' | 'switch';
  /** Last four characters of a secret (null when it is too short to show any), or the whole non-secret value. */
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  help: string | null;
}

export interface OperatorProviderRow {
  key: ProviderKey;
  name: string;
  usedFor: string;
  env: OperatorProviderField[];
  configured: boolean;
  /** Whether the connection test can run (every provider has one; it needs the required keys set). */
  checkable: boolean;
  /** What the connection test does and what it costs, in plain words. */
  checkNote: string | null;
  /** The last test run; `stale` when it used different keys from the ones set now. */
  lastCheck: { ok: boolean; at: string; message: string; by: string | null; stale: boolean } | null;
  /** not_configured → configured (not tested) → verified, or failed when the last test failed. */
  state: 'not_configured' | 'configured' | 'verified' | 'failed';
  /** What workspaces see for it today. */
  appStatus: string;
  /** How to create the keys in the provider's console, and the URLs to paste there. */
  setup: ProviderSetupGuide;
  /** For providers that send signed webhooks (Stripe, Razorpay, Zoom, DocuSign); null for the rest. */
  webhook: ProviderWebhookStatus | null;
}

/** A setting that stays in the deployment's environment, and why it cannot move into the console (ADR 0053). */
export interface DeploymentSettingRow {
  name: string;
  set: boolean;
  /** The value, only for settings that are not secret (the public URL, allowed origins); otherwise null. */
  value: string | null;
  why: string;
}

/** Saves keys in the operator console: a string sets the value, null removes the console value (falls back to the environment). */
export const providerKeysUpdateSchema = z.object({
  values: z
    .record(z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/), z.string().max(4096).nullable())
    .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 10, 'Change between one and ten keys at a time.'),
});
export type ProviderKeysUpdateInput = z.infer<typeof providerKeysUpdateSchema>;
