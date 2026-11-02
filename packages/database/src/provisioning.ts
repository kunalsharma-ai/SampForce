import { SYSTEM_ROLE_DEFINITIONS, SYSTEM_ROLES } from '@dealflow/types';
import type { TenantTx } from './client';

export const DEFAULT_PIPELINE_STAGES = [
  { name: 'Qualification', probability: 10, category: 'OPEN' },
  { name: 'Discovery', probability: 25, category: 'OPEN' },
  { name: 'Proposal', probability: 50, category: 'OPEN' },
  { name: 'Negotiation', probability: 75, category: 'OPEN' },
  { name: 'Closed Won', probability: 100, category: 'WON' },
  { name: 'Closed Lost', probability: 0, category: 'LOST' },
] as const;

export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workspace'
  );
}

export interface ProvisionTenantInput {
  tenantId: string;
  name: string;
  slug: string;
  ownerUserId: string;
  planCode?: string;
  isDemo?: boolean;
  /**
   * Writes starter content (the default pipeline and its stages) in the creator's language. The API passes `tr`;
   * without it the starter content is English.
   */
  text?: (english: string) => string;
}

/**
 * Creates a workspace with its system roles, owner membership, default sales pipeline and
 * a subscription. Must run inside `withDbContext` with `tenantId` set to `input.tenantId`
 * so the row-level-security insert policies accept the rows.
 */
export async function provisionTenant(tx: TenantTx, input: ProvisionTenantInput) {
  const say = input.text ?? ((english: string) => english);
  const tenant = await tx.tenant.create({
    data: { id: input.tenantId, name: input.name, slug: input.slug, isDemo: input.isDemo ?? false },
  });

  const roles = new Map<string, string>();
  for (const key of SYSTEM_ROLES) {
    const def = SYSTEM_ROLE_DEFINITIONS[key];
    const role = await tx.role.create({
      data: {
        tenantId: tenant.id,
        key,
        name: def.name,
        description: def.description,
        permissions: def.permissions,
        isSystem: true,
      },
    });
    roles.set(key, role.id);
  }

  const membership = await tx.membership.create({
    data: { tenantId: tenant.id, userId: input.ownerUserId, roleId: roles.get('owner')! },
  });

  const pipeline = await tx.pipeline.create({
    data: { tenantId: tenant.id, name: say('Sales Pipeline'), isDefault: true },
  });
  await tx.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s, position) => ({
      tenantId: tenant.id,
      pipelineId: pipeline.id,
      name: say(s.name),
      probability: s.probability,
      category: s.category,
      position,
    })),
  });

  await tx.subscription.create({
    data: { tenantId: tenant.id, planCode: input.planCode ?? 'free', status: 'ACTIVE', seats: 1 },
  });

  return { tenant, membership, pipeline, roleIds: roles };
}
