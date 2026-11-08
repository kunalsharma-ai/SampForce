/** Plan codes, in price order. Kept apart so plans.ts and features.ts can both use them without an import cycle. */
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
