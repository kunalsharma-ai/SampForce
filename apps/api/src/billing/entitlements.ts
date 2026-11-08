import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  type EffectiveEntitlements,
  effectiveEntitlements,
  FEATURE_BY_KEY,
  type FeatureKey,
  type FeatureOverride,
  FEATURE_KEYS,
  parsePlanEntitlements,
  PLAN_CODES,
  type PlanCode,
  type PlanEntitlements,
} from '@dealflow/types';

/** Anything that can read the plans table and the workspace's own rows (a tenant transaction or the operator scan). */
type Reader = Pick<TenantTx, 'plan' | 'subscription' | 'tenantFeatureOverride'>;

/** The live plan definitions: the `plans` table as operators edited it, with shipped values for anything missing. */
export async function planDefinitions(tx: Pick<TenantTx, 'plan'>): Promise<Record<PlanCode, PlanEntitlements>> {
  const rows = await tx.plan.findMany({ select: { code: true, entitlements: true } });
  const stored = new Map(rows.map((r) => [r.code, r.entitlements]));
  return Object.fromEntries(PLAN_CODES.map((c) => [c, parsePlanEntitlements(c, stored.get(c))])) as Record<PlanCode, PlanEntitlements>;
}

export async function featureOverrides(tx: Pick<TenantTx, 'tenantFeatureOverride'>, tenantId: string): Promise<FeatureOverride[]> {
  const rows = await tx.tenantFeatureOverride.findMany({ where: { tenantId }, select: { feature: true, enabled: true } });
  const known = new Set<string>(FEATURE_KEYS);
  return rows.filter((r) => known.has(r.feature)).map((r) => ({ feature: r.feature as FeatureKey, enabled: r.enabled }));
}

/** What the workspace may use right now; every plan-limit and plan-feature check goes through here. */
export async function entitlementsFor(tx: Reader, tenantId: string): Promise<EffectiveEntitlements> {
  const [sub, plans, overrides] = await Promise.all([
    tx.subscription.findUnique({ where: { tenantId }, select: { planCode: true, status: true, seats: true } }),
    planDefinitions(tx),
    featureOverrides(tx, tenantId),
  ]);
  return effectiveEntitlements(sub, { plans, overrides });
}

export function planLimit(message: string): ForbiddenException {
  return new ForbiddenException({ code: 'PLAN_LIMIT', message });
}

/** The refusal for a feature the workspace's plan does not include. The web app shows the upgrade page for it. */
export function featureNotIncluded(feature: FeatureKey): ForbiddenException {
  return new ForbiddenException({
    code: 'FEATURE_NOT_IN_PLAN',
    message: `${FEATURE_BY_KEY[feature].label} is not included in your plan. A workspace admin can upgrade on the Billing page.`,
    details: [{ path: 'feature', message: feature }],
  });
}

export async function hasFeature(tx: Reader, tenantId: string, feature: FeatureKey): Promise<boolean> {
  return (await entitlementsFor(tx, tenantId)).features.includes(feature);
}

/** Throws FEATURE_NOT_IN_PLAN unless the workspace's plan (with overrides) includes the feature. */
export async function assertFeature(tx: Reader, tenantId: string, feature: FeatureKey): Promise<void> {
  if (!(await hasFeature(tx, tenantId, feature))) throw featureNotIncluded(feature);
}

/**
 * Whether the workspace's "single sign-on required" setting is in force: only while its plan includes sso_scim. A
 * workspace that loses the feature must not lock out everyone but its owners, so the setting then lapses (it is kept
 * and applies again if the feature returns).
 */
export async function ssoEnforcedNow(prisma: { run<T>(ctx: { tenantId: string }, fn: (tx: TenantTx) => Promise<T>): Promise<T> }, tenantId: string, enforced: boolean): Promise<boolean> {
  if (!enforced) return false;
  return prisma.run({ tenantId }, (tx) => hasFeature(tx, tenantId, 'sso_scim'));
}
