import { defaultPlanFeatures, FEATURE_CATALOG_VERSION, FEATURES, type FeatureKey, normaliseFeatures } from './features';

/**
 * Proposed launch plan catalogue (see docs/PRICING_STRATEGY.md). These are proposals, not
 * published prices. Entitlements are enforced through `effectiveEntitlements` in billing.ts.
 */
export { PLAN_CODES, type PlanCode } from './plan-codes';
import { PLAN_CODES, type PlanCode } from './plan-codes';

export interface PlanLimits {
  maxUsers: number | null;
  maxPipelines: number | null;
  monthlyAiCredits: number;
  automationRunsPerMonth: number;
  /** Workspace limits (ADR 0071): Manager and Executive Workspaces an organisation may create; null = no limit. */
  maxManagerWorkspaces: number | null;
  maxExecutiveWorkspaces: number | null;
}

export interface PlanEntitlements extends PlanLimits {
  /** What the plan includes (ADR 0057). Custom roles and API access are features too. */
  features: FeatureKey[];
}

const LIMITS: Record<PlanCode, PlanLimits> = {
  free: { maxUsers: 2, maxPipelines: 1, monthlyAiCredits: 50, automationRunsPerMonth: 500, maxManagerWorkspaces: 1, maxExecutiveWorkspaces: 2 },
  launch: { maxUsers: null, maxPipelines: 3, monthlyAiCredits: 200, automationRunsPerMonth: 2_000, maxManagerWorkspaces: 3, maxExecutiveWorkspaces: 10 },
  growth: { maxUsers: null, maxPipelines: 10, monthlyAiCredits: 500, automationRunsPerMonth: 10_000, maxManagerWorkspaces: 10, maxExecutiveWorkspaces: 50 },
  professional: { maxUsers: null, maxPipelines: 25, monthlyAiCredits: 1_000, automationRunsPerMonth: 50_000, maxManagerWorkspaces: 25, maxExecutiveWorkspaces: 150 },
  business: { maxUsers: null, maxPipelines: 50, monthlyAiCredits: 2_000, automationRunsPerMonth: 150_000, maxManagerWorkspaces: null, maxExecutiveWorkspaces: null },
  enterprise: { maxUsers: null, maxPipelines: null, monthlyAiCredits: 3_000, automationRunsPerMonth: 500_000, maxManagerWorkspaces: null, maxExecutiveWorkspaces: null },
  enterprise_plus: { maxUsers: null, maxPipelines: null, monthlyAiCredits: 3_000, automationRunsPerMonth: 1_000_000, maxManagerWorkspaces: null, maxExecutiveWorkspaces: null },
};

/**
 * The shipped plan definitions. The `plans` table holds the live ones, which platform operators edit in the console;
 * these apply only where a row has no value (a new deployment before migration, or a key a later release added).
 */
export const PLAN_ENTITLEMENTS: Record<PlanCode, PlanEntitlements> = Object.fromEntries(
  PLAN_CODES.map((c) => [c, { ...LIMITS[c], features: defaultPlanFeatures(c) }]),
) as Record<PlanCode, PlanEntitlements>;

/** Reads a stored `plans.entitlements` value, filling anything missing or malformed from the shipped definition. */
const workspaceCap = (v: unknown, fallback: number | null) => (v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback);

/**
 * A stored feature list. Keys added to the catalogue after the list was saved (FeatureDef.since) are included when
 * the plan includes them by default, so a new release never takes a module away from a plan nobody has edited since.
 */
function storedFeatures(code: PlanCode, list: unknown[], version: unknown): FeatureKey[] {
  const saved = typeof version === 'number' ? version : 1;
  const keys = list.filter((f): f is string => typeof f === 'string');
  if (saved < FEATURE_CATALOG_VERSION) {
    const defaults = new Set(defaultPlanFeatures(code));
    for (const f of FEATURES) if ((f.since ?? 1) > saved && defaults.has(f.key)) keys.push(f.key);
  }
  return normaliseFeatures(keys);
}

export function parsePlanEntitlements(code: PlanCode, stored: unknown): PlanEntitlements {
  const d = PLAN_ENTITLEMENTS[code];
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback);
  const cap = (v: unknown, fallback: number | null) => (v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback);
  return {
    maxUsers: 'maxUsers' in s ? cap(s.maxUsers, d.maxUsers) : d.maxUsers,
    maxPipelines: 'maxPipelines' in s ? cap(s.maxPipelines, d.maxPipelines) : d.maxPipelines,
    monthlyAiCredits: num(s.monthlyAiCredits, d.monthlyAiCredits),
    automationRunsPerMonth: num(s.automationRunsPerMonth, d.automationRunsPerMonth),
    features: Array.isArray(s.features) ? storedFeatures(code, s.features, s.catalogVersion) : d.features,
    maxManagerWorkspaces: 'maxManagerWorkspaces' in s ? workspaceCap(s.maxManagerWorkspaces, d.maxManagerWorkspaces) : d.maxManagerWorkspaces,
    maxExecutiveWorkspaces: 'maxExecutiveWorkspaces' in s ? workspaceCap(s.maxExecutiveWorkspaces, d.maxExecutiveWorkspaces) : d.maxExecutiveWorkspaces,
  };
}

export interface PlanCatalogEntry {
  code: PlanCode;
  name: string;
  /** USD per user per month; null = custom quote. */
  monthly: number | null;
  /** USD per user per month when billed annually. */
  annualMonthly: number | null;
  audience: string;
}

/** Launch rate card (approved 2026-10-31). Must match the `plans` rows seeded by the database migration. */
export const PLAN_CATALOG: PlanCatalogEntry[] = [
  { code: 'free', name: 'SampForce Free', monthly: 0, annualMonthly: 0, audience: 'Individuals' },
  { code: 'launch', name: 'SampForce Launch', monthly: 8, annualMonthly: 6, audience: 'Startups' },
  { code: 'growth', name: 'SampForce Growth', monthly: 15, annualMonthly: 12, audience: 'Growing teams' },
  { code: 'professional', name: 'SampForce Professional', monthly: 29, annualMonthly: 23, audience: 'Advanced sales teams' },
  { code: 'business', name: 'SampForce Business', monthly: 49, annualMonthly: 39, audience: 'Established businesses' },
  { code: 'enterprise', name: 'SampForce Enterprise', monthly: 79, annualMonthly: 65, audience: 'Large organizations' },
  { code: 'enterprise_plus', name: 'SampForce Enterprise Plus', monthly: null, annualMonthly: null, audience: 'Global enterprises' },
];
