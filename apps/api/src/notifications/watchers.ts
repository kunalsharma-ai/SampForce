import type { TenantTx } from '@dealflow/database';
import { resolveOrganisation } from '../workspaces/access';

/**
 * The people who look after someone's work and are told about it (on-screen notifications, Kunal's spec section 9):
 * the managers of an Executive Workspace and everyone who manages members (the Super Workspace). Work done in the
 * Super Workspace itself has nobody above it. The person themselves is never included.
 */
export async function watchersOf(tx: TenantTx, tenantId: string, userId: string | null | undefined, superUsers: () => Promise<string[]>): Promise<string[]> {
  if (!userId) return [];
  const membership = await tx.membership.findFirst({ where: { tenantId, userId, status: 'ACTIVE' }, select: { workspaceNodeId: true } });
  if (!membership) return [];
  const org = await resolveOrganisation(tx, tenantId);
  const mine = membership.workspaceNodeId ? org.byId.get(membership.workspaceNodeId) : null;
  if (!mine || mine === org.root) return [];
  const watchers = new Set<string>();
  if (mine.level === 'EXECUTIVE' && mine.node.parentId && mine.node.parentId !== org.root.node.id) {
    const managers = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', workspaceNodeId: mine.node.parentId }, select: { userId: true } });
    for (const m of managers) watchers.add(m.userId);
  }
  for (const u of await superUsers()) watchers.add(u);
  watchers.delete(userId);
  return [...watchers];
}
