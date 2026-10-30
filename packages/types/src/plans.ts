/**
 * Proposed launch plan catalogue (see docs/PRICING_STRATEGY.md). These are proposals, not
 * published prices. Entitlements are enforced through `effectiveEntitlements` in billing.ts.
 */
export const PLAN_CODES = [
  'free',
  'launch',
  'growth',
  'professional',
  'business',
  'enterprise',
  'enterprise_plus',
] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanEntitlements {
  maxUsers: number | null;
  maxPipelines: number | null;
  monthlyAiCredits: number;
  automationRunsPerMonth: number;
  apiAccess: boolean;
  /** Workspace-defined roles beyond the five system roles. */
  customRoles: boolean;
}

export const PLAN_ENTITLEMENTS: Record<PlanCode, PlanEntitlements> = {
  free: { maxUsers: 2, maxPipelines: 1, monthlyAiCredits: 50, automationRunsPerMonth: 500, apiAccess: false, customRoles: false },
  launch: { maxUsers: null, maxPipelines: 3, monthlyAiCredits: 200, automationRunsPerMonth: 2_000, apiAccess: false, customRoles: false },
  growth: { maxUsers: null, maxPipelines: 10, monthlyAiCredits: 500, automationRunsPerMonth: 10_000, apiAccess: true, customRoles: false },
  professional: { maxUsers: null, maxPipelines: 25, monthlyAiCredits: 1_000, automationRunsPerMonth: 50_000, apiAccess: true, customRoles: true },
  business: { maxUsers: null, maxPipelines: 50, monthlyAiCredits: 2_000, automationRunsPerMonth: 150_000, apiAccess: true, customRoles: true },
  enterprise: { maxUsers: null, maxPipelines: null, monthlyAiCredits: 3_000, automationRunsPerMonth: 500_000, apiAccess: true, customRoles: true },
  enterprise_plus: { maxUsers: null, maxPipelines: null, monthlyAiCredits: 3_000, automationRunsPerMonth: 1_000_000, apiAccess: true, customRoles: true },
};

export interface PlanCatalogEntry {
  code: PlanCode;
  name: string;
  /** USD per user per month; null = custom quote. */
  monthly: number | null;
  /** USD per user per month when billed annually. */
  annualMonthly: number | null;
  audience: string;
}

/** Proposed launch rate card. Must match the `plans` rows seeded by the database migration. */
export const PLAN_CATALOG: PlanCatalogEntry[] = [
  { code: 'free', name: 'DealFlow Free', monthly: 0, annualMonthly: 0, audience: 'Individuals' },
  { code: 'launch', name: 'DealFlow Launch', monthly: 8, annualMonthly: 6, audience: 'Startups' },
  { code: 'growth', name: 'DealFlow Growth', monthly: 15, annualMonthly: 12, audience: 'Growing teams' },
  { code: 'professional', name: 'DealFlow Professional', monthly: 29, annualMonthly: 23, audience: 'Advanced sales teams' },
  { code: 'business', name: 'DealFlow Business', monthly: 49, annualMonthly: 39, audience: 'Established businesses' },
  { code: 'enterprise', name: 'DealFlow Enterprise', monthly: 79, annualMonthly: 65, audience: 'Large organizations' },
  { code: 'enterprise_plus', name: 'DealFlow Enterprise Plus', monthly: null, annualMonthly: null, audience: 'Global enterprises' },
];
