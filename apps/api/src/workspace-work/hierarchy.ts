import type { TenantTx } from '@dealflow/database';
import { actionAllowed, FEATURE_BY_KEY, type FeatureKey, WORKSPACE_ACTION_LABEL, type WorkspaceAction, type WorkspaceLevel } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { branchIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { HierarchyError } from '../workspaces/workspaces.service';

/** Shared rules for work handed down the hierarchy (ADR 0071, part 4): who is where, and who may hand work to whom. */

export type Org = Awaited<ReturnType<typeof resolveOrganisation>>;

export function callerOf(auth: AuthContext, org: Org): NodeAccess {
  if (!auth.workspaceNodeId) return org.root;
  return org.byId.get(auth.workspaceNodeId) ?? { ...org.root, features: [], actions: {} };
}

export function assertAction(me: NodeAccess, feature: FeatureKey, action: WorkspaceAction): void {
  if (!me.features.includes(feature)) throw new HierarchyError('FEATURE_NOT_GRANTED', `${FEATURE_BY_KEY[feature].label} is not available in your workspace.`);
  if (!actionAllowed(me.actions, feature, action)) throw new HierarchyError('ACTION_NOT_GRANTED', `Your workspace may not ${WORKSPACE_ACTION_LABEL[action].toLowerCase()} in ${FEATURE_BY_KEY[feature].label}.`);
}

export function may(me: NodeAccess, feature: FeatureKey, action: WorkspaceAction): boolean {
  return me.features.includes(feature) && actionAllowed(me.actions, feature, action);
}

/**
 * Whether the caller's workspace hands work down to `target`: the Super Workspace to any workspace below it, a
 * manager to its own Executive Workspaces. Nobody hands work to their own workspace or to one above.
 */
export function handsDownTo(me: NodeAccess, target: NodeAccess, org: Org): boolean {
  if (target === org.root || target.node.archivedAt || target.node.id === me.node.id) return false;
  if (me.level === 'SUPER') return true;
  return me.level === 'MANAGER' && target.level === 'EXECUTIVE' && target.node.parentId === me.node.id;
}

/** Workspace ids the caller can see work of: everything for the Super Workspace, its branch for a manager, itself otherwise. */
export function visibleNodeIds(me: NodeAccess, org: Org): Set<string> {
  const nodes = [...org.byId.values()].map((a) => a.node);
  if (me.level === 'SUPER') return new Set(nodes.map((n) => n.id));
  if (me.level === 'MANAGER') return branchIds(nodes, me.node.id);
  return new Set([me.node.id]);
}

export function refOf(a: NodeAccess, org: Org, orgName: string): { id: string; name: string; level: WorkspaceLevel } {
  return { id: a.node.id, name: a === org.root ? orgName : a.node.name, level: a.level };
}

/** People working in one workspace (the root also holds everyone not placed in a workspace). */
export async function peopleIn(tx: TenantTx, tenantId: string, a: NodeAccess, org: Org): Promise<{ id: string; name: string }[]> {
  const where = a === org.root
    ? { OR: [{ workspaceNodeId: null }, { workspaceNodeId: { isSet: false } }, ...(a.virtual ? [] : [{ workspaceNodeId: a.node.id }])] }
    : { workspaceNodeId: a.node.id };
  const rows = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', ...where }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' }, take: 200 });
  return rows.map((m) => ({ id: m.user.id, name: m.user.name }));
}
