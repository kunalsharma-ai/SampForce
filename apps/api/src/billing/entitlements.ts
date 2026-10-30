import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { type EffectiveEntitlements, effectiveEntitlements } from '@dealflow/types';

/** What the workspace may use right now; every plan-limit check goes through here. */
export async function entitlementsFor(tx: TenantTx, tenantId: string): Promise<EffectiveEntitlements> {
  const sub = await tx.subscription.findUnique({ where: { tenantId }, select: { planCode: true, status: true, seats: true } });
  return effectiveEntitlements(sub);
}

export function planLimit(message: string): ForbiddenException {
  return new ForbiddenException({ code: 'PLAN_LIMIT', message });
}
