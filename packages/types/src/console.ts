import { z } from 'zod';
import { emailSchema } from './auth';
import { type ClientHealthSummary, HEALTH_BANDS } from './console-health';
import type { OperatorPermission } from './console-security';
import { FEATURE_KEYS, type FeatureKey, featureKeySchema } from './features';
import { type ActionGrants, actionGrantsSchema, type WorkspaceLevel } from './workspaces';

/**
 * Console Admin (ADR 0071, part 2): the platform owner's client organisations, subscription plans and workspace
 * limits. The Console is the existing operator console; these are its additions. Nothing here reads client CRM records.
 */

export const SUPPORT_LEVELS = ['STANDARD', 'PRIORITY', 'DEDICATED'] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];
export const SUPPORT_LEVEL_LABEL: Record<SupportLevel, string> = { STANDARD: 'Standard', PRIORITY: 'Priority', DEDICATED: 'Dedicated' };

/** Where a client stands with paying, set by the Console Admin for sales-led subscriptions. */
export const PAYMENT_STATUSES = ['PAID', 'PENDING', 'OVERDUE', 'WAIVED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { PAID: 'Paid', PENDING: 'Payment pending', OVERDUE: 'Overdue', WAIVED: 'No charge' };

export const BILLING_FREQUENCIES = ['MONTH', 'YEAR'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

/** Three-letter currency code, upper case. */
const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a three-letter currency code').transform((v) => v.toUpperCase());
const cents = z.number().int().min(0).max(1_000_000_000_00);
const limit = z.number().int().min(0).max(100_000_000);
const reason = z.string().trim().min(5).max(500);
const workspaceCap = z.number().int().min(0).max(100_000).nullable();

/** The limits a plan sets. Empty (null) means no limit. */
export const consolePlanLimitsSchema = z
  .object({
    maxUsers: limit.min(1).nullable(),
    maxPipelines: limit.min(1).nullable(),
    monthlyAiCredits: limit,
    automationRunsPerMonth: limit,
    maxManagerWorkspaces: workspaceCap,
    maxExecutiveWorkspaces: workspaceCap,
  })
  .strict();

/** The commercial side of a plan: what the Console Admin sells it for and how. */
export const consolePlanTermsSchema = z
  .object({
    description: z.string().trim().max(1000).nullable(),
    /** Price for one billing period, in the currency's minor units; null = priced per client. */
    priceCents: cents.nullable(),
    currency: currencySchema,
    billingFrequency: z.enum(BILLING_FREQUENCIES),
    supportLevel: z.enum(SUPPORT_LEVELS),
    /** Months a subscription to the plan runs before renewal. */
    durationMonths: z.number().int().min(1).max(120),
    autoRenew: z.boolean(),
    /** Plans a client on this one may be upgraded to; empty = any. */
    upgradeTo: z.array(z.string().trim().min(1).max(60)).max(50),
    /** Whether the Console still offers it for new clients. Clients already on it keep it. */
    available: z.boolean(),
  })
  .strict();

export const consolePlanCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    features: z.array(featureKeySchema).max(FEATURE_KEYS.length),
    limits: consolePlanLimitsSchema,
    terms: consolePlanTermsSchema,
    reason,
  })
  .strict();
export type ConsolePlanCreateInput = z.infer<typeof consolePlanCreateSchema>;

/** Editing a plan: anything left out stays as it is. Shipped plans keep their names. */
export const consolePlanUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    features: z.array(featureKeySchema).max(FEATURE_KEYS.length).optional(),
    limits: consolePlanLimitsSchema.optional(),
    terms: consolePlanTermsSchema.partial().optional(),
    reason,
  })
  .strict();
export type ConsolePlanUpdateInput = z.infer<typeof consolePlanUpdateSchema>;

export interface ConsolePlanTerms {
  description: string | null;
  priceCents: number | null;
  currency: string;
  billingFrequency: BillingFrequency;
  supportLevel: SupportLevel;
  durationMonths: number;
  autoRenew: boolean;
  upgradeTo: string[];
  available: boolean;
}

export interface ConsolePlanRow {
  code: string;
  name: string;
  /** True for a plan the Console Admin created; false for a shipped plan. */
  custom: boolean;
  features: FeatureKey[];
  limits: z.infer<typeof consolePlanLimitsSchema>;
  terms: ConsolePlanTerms;
  /** Client organisations on the plan now. */
  clients: number;
  updatedAt: string;
}

// ───────────── Client organisations ─────────────

const subscriptionLimits = {
  /** Null = the plan's limit. */
  maxManagerWorkspaces: workspaceCap.optional(),
  maxExecutiveWorkspaces: workspaceCap.optional(),
};

/** POST /operator/clients: a new client organisation, its Super Workspace and an invitation for its administrator. */
export const consoleClientCreateSchema = z
  .object({
    organisation: z.object({ name: z.string().trim().min(2).max(120), currency: currencySchema.optional(), timezone: z.string().trim().min(1).max(64).optional() }).strict(),
    administrator: z.object({ name: z.string().trim().min(1).max(120), email: emailSchema, designation: z.string().trim().min(2).max(80).optional() }).strict(),
    planCode: z.string().trim().min(1).max(60),
    seats: z.number().int().min(1).max(100_000),
    billingFrequency: z.enum(BILLING_FREQUENCIES).optional(),
    /** First day of the subscription (YYYY-MM-DD); today when left out. */
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Months until renewal; the plan's duration when left out. */
    durationMonths: z.number().int().min(1).max(120).optional(),
    priceCents: cents.nullable().optional(),
    currency: currencySchema.optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).default('PENDING'),
    autoRenew: z.boolean().optional(),
    ...subscriptionLimits,
    /** Whether the Super Workspace may create Executive Workspaces itself. */
    superCanCreateExecutives: z.boolean().default(true),
    reason: reason.optional(),
  })
  .strict();
export type ConsoleClientCreateInput = z.input<typeof consoleClientCreateSchema>;

export interface ConsoleClientCreated {
  client: ConsoleClientDetail;
  /** The administrator's invitation link, shown once: email it to them. */
  inviteUrl: string;
}

/** PUT /operator/clients/:id/subscription: anything left out stays as it is. */
export const consoleSubscriptionSchema = z
  .object({
    planCode: z.string().trim().min(1).max(60).optional(),
    seats: z.number().int().min(1).max(100_000).optional(),
    billingFrequency: z.enum(BILLING_FREQUENCIES).optional(),
    /** Renewal date (YYYY-MM-DD). */
    renewsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    durationMonths: z.number().int().min(1).max(120).optional(),
    priceCents: cents.nullable().optional(),
    currency: currencySchema.optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    autoRenew: z.boolean().optional(),
    ...subscriptionLimits,
    reason,
  })
  .strict();
export type ConsoleSubscriptionInput = z.infer<typeof consoleSubscriptionSchema>;

/** Activate, suspend or deactivate a client's subscription. Suspending keeps the data and refuses sign-in. */
export const CLIENT_STATES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type ClientState = (typeof CLIENT_STATES)[number];
export const consoleClientStateSchema = z.object({ state: z.enum(CLIENT_STATES), reason }).strict();

/** Renews the subscription for another term (the plan's duration unless given), or upgrades it at the same time. */
export const consoleRenewSchema = z
  .object({ months: z.number().int().min(1).max(120).optional(), planCode: z.string().trim().min(1).max(60).optional(), paymentStatus: z.enum(PAYMENT_STATUSES).optional(), reason })
  .strict();
export type ConsoleRenewInput = z.infer<typeof consoleRenewSchema>;

/** The most a client's Super Workspace may do (its action ceiling) and whether it creates Executive Workspaces. */
export const consoleAuthoritySchema = z
  .object({ actions: actionGrantsSchema.nullable().optional(), canCreateExecutives: z.boolean().optional(), reason })
  .strict();
export type ConsoleAuthorityInput = z.infer<typeof consoleAuthoritySchema>;

export interface ConsoleSubscription {
  planCode: string;
  planName: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID';
  seats: number;
  billingFrequency: BillingFrequency;
  startedOn: string;
  renewsOn: string | null;
  durationMonths: number | null;
  priceCents: number | null;
  currency: string;
  paymentStatus: PaymentStatus | null;
  autoRenew: boolean;
  /** What the client may create, after the Console's own setting for this client (null = no limit). */
  limits: { managers: number | null; executives: number | null };
  /** True where the limit was set for this client rather than taken from the plan. */
  limitsSetForClient: { managers: boolean; executives: boolean };
}

/** The client's readable number: 123 becomes "SF-000123". */
export function customerIdOf(n: number | null | undefined): string | null {
  return typeof n === 'number' && n > 0 ? `SF-${String(n).padStart(6, '0')}` : null;
}

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();

/** PATCH /operator/clients/:id/profile: the client's company details. Empty text clears a field. */
export const consoleClientProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    legalName: optionalText(160),
    website: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v) || null)
      .refine((v) => v === null || /^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(v), 'Use a web address such as example.com')
      .nullable(),
    industry: optionalText(80),
    countryCode: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{2})?$/, 'Use a two-letter country code')
      .transform((v) => v.toUpperCase() || null)
      .nullable(),
    regionCode: optionalText(10),
    city: optionalText(120),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    postalCode: optionalText(20),
    contactName: optionalText(120),
    contactEmail: z
      .string()
      .trim()
      .max(254)
      .transform((v) => v.toLowerCase() || null)
      .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Use an email address such as name@example.com')
      .nullable(),
    contactPhone: z
      .string()
      .trim()
      .max(40)
      .refine((v) => v === '' || /^\+?[0-9 ()./-]{6,}$/.test(v), 'Use digits, spaces and an optional + only')
      .transform((v) => v || null)
      .nullable(),
  })
  .strict();
export type ConsoleClientProfileInput = z.infer<typeof consoleClientProfileSchema>;

/** The client's company details as the Console keeps them. */
export interface ConsoleClientProfile {
  legalName: string | null;
  website: string | null;
  industry: string | null;
  countryCode: string | null;
  regionCode: string | null;
  city: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface ConsoleClientRow {
  id: string;
  name: string;
  /** "SF-000123"; given to every client in the order they joined. */
  customerId: string | null;
  countryCode: string | null;
  city: string | null;
  /** Versioned address of the client's logo, or null without one. */
  logoUrl: string | null;
  state: ClientState;
  createdAt: string;
  people: number;
  subscription: ConsoleSubscription | null;
  usage: { managers: number; executives: number };
  /** The administrator has not accepted the invitation yet. */
  awaitingAdministrator: boolean;
  /** The latest health score (C5); null until the worker first measures the client. */
  health: ClientHealthSummary | null;
}

export interface ConsoleWorkspaceRow {
  id: string;
  level: WorkspaceLevel;
  name: string;
  designation: string;
  parentId: string | null;
  people: number;
  features: number;
  canCreateExecutives: boolean;
  archived: boolean;
}

export interface ConsoleHistoryRow {
  at: string;
  by: string | null;
  action: string;
  reason: string | null;
  /** Short lines describing what changed, such as "Plan: Growth → Plan B". */
  changes: string[];
}

export interface ConsoleClientDetail extends ConsoleClientRow {
  profile: ConsoleClientProfile;
  /** The Super Workspace's ceiling: actions per module, null = every action. */
  authority: { actions: ActionGrants | null; canCreateExecutives: boolean };
  features: FeatureKey[];
  workspaces: ConsoleWorkspaceRow[];
  administrators: { name: string; email: string; designation: string | null }[];
  pendingAdministrator: { email: string; expiresAt: string } | null;
  history: ConsoleHistoryRow[];
}

/** GET /operator/overview: the Console Admin's dashboard. Platform figures only; no individual sales records. */
export interface ConsoleOverview {
  clients: { total: number; active: number; suspended: number; deactivated: number };
  superWorkspaces: number;
  subscriptions: { active: number; inactive: number; trialing: number };
  plansSold: { code: string; name: string; clients: number }[];
  /** Agreed subscription value per month, by currency (minor units). */
  monthlyRecurring: { currency: string; cents: number }[];
  /** Open invoices plus clients marked pending or overdue, by currency. */
  outstanding: { currency: string; cents: number; clients: number }[];
  workspaces: { managers: number; executives: number };
  renewals: { id: string; name: string; renewsOn: string; planName: string; autoRenew: boolean }[];
  needsAttention: { id: string; name: string; why: string }[];
  /** Support queries that reached the Console and wait on it, and how many clients raised them. */
  support: { waiting: number; clients: number };
}

// ───────────── Locations (ADR 0074, C4) ─────────────

/** A city on the Locations page: from the shipped list, added by an operator, or renamed by one. */
export interface ConsoleCityRow {
  name: string;
  region: string | null;
  /** Set for a city an operator added or renamed; the id removes that change. */
  edit: { id: string; kind: 'added' | 'renamed'; originalName: string | null; by: string | null; at: string } | null;
}

const placeName = z.string().trim().min(1).max(120);
const regionCode = z.string().trim().max(10).transform((v) => v || null).nullable();

/** POST /operator/locations/cities: add a city the list does not have. */
export const consoleCityAddSchema = z.object({ countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()), regionCode, name: placeName }).strict();
export type ConsoleCityAddInput = z.infer<typeof consoleCityAddSchema>;

/** POST /operator/locations/cities/rename: give a listed city another name. */
export const consoleCityRenameSchema = z
  .object({ countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()), regionCode, originalName: placeName, name: placeName })
  .strict();
export type ConsoleCityRenameInput = z.infer<typeof consoleCityRenameSchema>;

export const consoleCityQuerySchema = z.object({
  region: z.string().trim().max(10).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ───────────── Clients list: filters, sort, paging, bulk actions (ADR 0074, C4b) ─────────────

export const CONSOLE_CLIENT_SORTS = ['name', 'customerId', 'country', 'plan', 'payment', 'state', 'people', 'managers', 'executives', 'created', 'renews', 'health'] as const;
export type ConsoleClientSort = (typeof CONSOLE_CLIENT_SORTS)[number];
export const CONSOLE_CLIENT_PAGE_SIZES = [25, 50, 100] as const;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.enum(values).optional());

/** GET /operator/clients/page and /operator/clients/export: every filter is optional and they combine. */
export const consoleClientListQuerySchema = z.object({
  /** Name, legal name, slug, customer ID ("SF-000123", "123") or an administrator's email. */
  search: z.string().trim().max(100).optional(),
  state: optionalEnum(CLIENT_STATES),
  plan: z.string().trim().max(60).optional(),
  billing: optionalEnum(BILLING_FREQUENCIES),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()).optional().or(z.literal('').transform(() => undefined)),
  /** A payment status, or NONE for clients without one. */
  payment: optionalEnum([...PAYMENT_STATUSES, 'NONE'] as const),
  createdFrom: isoDay.optional().or(z.literal('').transform(() => undefined)),
  /** A health band, or NONE for clients not measured yet. */
  health: optionalEnum([...HEALTH_BANDS, 'NONE'] as const),
  createdTo: isoDay.optional().or(z.literal('').transform(() => undefined)),
  sort: z.enum(CONSOLE_CLIENT_SORTS).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().refine((n) => (CONSOLE_CLIENT_PAGE_SIZES as readonly number[]).includes(n), 'Choose 25, 50 or 100 per page.').default(25),
});
export type ConsoleClientListQuery = z.infer<typeof consoleClientListQuerySchema>;

export interface ConsoleClientPage {
  items: ConsoleClientRow[];
  total: number;
  page: number;
  perPage: number;
}

export const CONSOLE_BULK_ACTIONS = ['state', 'extend', 'feature', 'notify'] as const;
export type ConsoleBulkAction = (typeof CONSOLE_BULK_ACTIONS)[number];
/** Who may run each bulk action: the same permission as doing it to one client. */
export const BULK_PERMISSION: Record<ConsoleBulkAction, OperatorPermission> = {
  state: 'clients.status',
  extend: 'subscriptions.manage',
  feature: 'features.manage',
  notify: 'notifications.broadcast',
};
/** Typed by the operator before a bulk action that takes access away. */
export const BULK_CONFIRM_WORD = 'CONFIRM';

/**
 * POST /operator/clients/bulk: one action over up to 200 clients. Suspending or deactivating needs `confirm` set to
 * CONFIRM. Each client is changed (and audited) on its own; one more entry records the run.
 */
export const consoleClientBulkSchema = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('state'), ids: z.array(z.string().uuid()).min(1).max(200), state: z.enum(CLIENT_STATES), reason, confirm: z.string().optional() }).strict(),
    z.object({ action: z.literal('extend'), ids: z.array(z.string().uuid()).min(1).max(200), days: z.number().int().min(1).max(366), reason }).strict(),
    z.object({ action: z.literal('feature'), ids: z.array(z.string().uuid()).min(1).max(200), feature: featureKeySchema, enabled: z.boolean().nullable(), reason }).strict(),
    z
      .object({ action: z.literal('notify'), ids: z.array(z.string().uuid()).min(1).max(200), subject: z.string().trim().min(3).max(150), message: z.string().trim().min(10).max(5000) })
      .strict(),
  ])
  .superRefine((v, ctx) => {
    if (v.action === 'state' && v.state !== 'ACTIVE' && v.confirm !== BULK_CONFIRM_WORD) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm'], message: 'Type CONFIRM to change these clients.' });
    }
  });
export type ConsoleClientBulkInput = z.infer<typeof consoleClientBulkSchema>;

export interface ConsoleClientBulkResult {
  action: ConsoleBulkAction;
  /** Clients the action changed (or emailed). */
  done: { id: string; name: string }[];
  /** Clients it left as they were, with why: already in that state, no subscription, no administrator… */
  skipped: { id: string; name: string; reason: string }[];
  failed: { id: string; name: string; reason: string }[];
}
