import type { TenantTx } from '@dealflow/database';
import { effectiveWorkspaceRules, type WorkspaceRules } from '@dealflow/types';

type Reader = Pick<TenantTx, 'subscription' | 'planWorkspaceRules'>;

/**
 * The Console rules in force for a client's workspaces (workspace redesign W3): its plan's rules with its own
 * override on top. Read on every request that resolves workspace access, so a Console change applies at once.
 */
export async function workspaceRulesFor(tx: Reader, tenantId: string): Promise<WorkspaceRules> {
  const sub = await tx.subscription.findUnique({ where: { tenantId }, select: { planCode: true, workspaceRules: true } });
  const plan = sub ? await tx.planWorkspaceRules.findUnique({ where: { planCode: sub.planCode }, select: { rules: true } }) : null;
  return effectiveWorkspaceRules(plan?.rules ?? null, sub?.workspaceRules ?? null);
}
