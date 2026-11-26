import type { TenantTx } from '@dealflow/database';
import type { MenuSections, MenuSectionsInput } from '@dealflow/types';

type Tx = Pick<TenantTx, 'tenantFeatureOverride' | 'workspaceNode'>;

/** Whether the Leads and Accounts pages are shown for a client (redesign, menu). */
export async function readMenuSections(tx: Pick<TenantTx, 'tenantFeatureOverride'>, tenantId: string): Promise<MenuSections> {
  const rows = await tx.tenantFeatureOverride.findMany({ where: { tenantId, feature: { in: ['leads_section', 'accounts_section'] } } });
  const on = (f: string) => rows.some((r) => r.feature === f && r.enabled);
  return { leads: on('leads_section'), accounts: on('accounts_section') };
}

/**
 * Shows or hides the Leads and Accounts pages for a whole client: the switch applies to the organisation and to every
 * Manager and Executive Workspace in it, so nobody has to hand it down one by one. Since R8 (ADR 0092) only the
 * Console Admin changes it; the Console's section rules can still withhold either page from one level.
 */
export async function writeMenuSections(tx: Tx, tenantId: string, input: MenuSectionsInput, updatedBy: string, reason: string): Promise<MenuSections> {
  const wanted = { leads_section: input.leads, accounts_section: input.accounts } as const;
  for (const [feature, enabled] of Object.entries(wanted)) {
    await tx.tenantFeatureOverride.upsert({
      where: { tenantId_feature: { tenantId, feature } },
      create: { tenantId, feature, enabled, reason, updatedBy },
      update: { enabled, reason, updatedBy },
    });
  }
  const nodes = await tx.workspaceNode.findMany({ where: { tenantId }, select: { id: true, features: true } });
  for (const n of nodes) {
    const features = n.features.filter((f) => !(f in wanted));
    for (const [feature, enabled] of Object.entries(wanted)) if (enabled) features.push(feature);
    if (features.length !== n.features.length || features.some((f, i) => f !== n.features[i])) await tx.workspaceNode.update({ where: { id: n.id }, data: { features } });
  }
  return { leads: input.leads, accounts: input.accounts };
}
