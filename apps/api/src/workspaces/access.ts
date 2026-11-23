import type { TenantTx } from '@dealflow/database';
import {
  type ActionGrants,
  allActions,
  capByRules,
  DEFAULT_WORKSPACE_DESIGNATION,
  type FeatureKey,
  intersectActions,
  intersectFeatures,
  parseActionGrants,
  type WorkspaceLevel,
  WORKSPACE_LEVELS,
  type WorkspaceRules,
} from '@dealflow/types';
import { entitlementsFor } from '../billing/entitlements';
import { workspaceRulesFor } from './workspace-rules';

/**
 * Workspace access (ADR 0071): what a workspace of the hierarchy may use, computed from the organisation's
 * subscription down the chain of parents on every call. Nothing is cached or copied, so a feature switched off at
 * any level, or a plan change by the Console Admin, applies to every workspace below at once.
 */

export interface StoredNode {
  id: string;
  tenantId: string;
  level: string;
  name: string;
  nameKey: string;
  designation: string;
  parentId: string | null;
  features: string[];
  actions: unknown;
  canCreateExecutives: boolean;
  canViewOtherManagers: boolean;
  canViewAuditLog: boolean;
  canChatWithPeers: boolean;
  /** Optional so stand-ins and older reads need not set them (W4). */
  deactivatedAt?: Date | null;
  deactivationReason?: string | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface NodeAccess {
  node: StoredNode;
  level: WorkspaceLevel;
  /** Effective features: the subscription's, narrowed by every grant on the way down. */
  features: FeatureKey[];
  /** Effective actions per module and feature. */
  actions: ActionGrants;
  /** True for the root, which is not stored until the organisation's first change to its hierarchy. */
  virtual?: boolean;
}

/** The parts of a transaction access needs (an operator scan has them too). */
type Reader = Pick<TenantTx, 'workspaceNode' | 'plan' | 'subscription' | 'tenantFeatureOverride' | 'planWorkspaceRules'>;

/** How workspace names are compared: case and repeated spaces do not make a name different. */
export const nameKeyOf = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function levelOf(value: string): WorkspaceLevel {
  return (WORKSPACE_LEVELS as readonly string[]).includes(value) ? (value as WorkspaceLevel) : 'EXECUTIVE';
}

/** A stand-in root for organisations that have not changed their hierarchy yet: everything, no ceiling. */
function virtualRoot(tenantId: string): StoredNode {
  return {
    id: `root:${tenantId}`,
    tenantId,
    level: 'SUPER',
    name: 'Super Workspace',
    nameKey: 'super workspace',
    designation: DEFAULT_WORKSPACE_DESIGNATION.SUPER,
    parentId: null,
    features: [],
    actions: null,
    canCreateExecutives: true,
    canViewOtherManagers: false,
    canViewAuditLog: false,
    canChatWithPeers: false,
    archivedAt: null,
    createdAt: new Date(0),
  };
}

export async function organisationNodes(tx: Pick<TenantTx, 'workspaceNode'>, tenantId: string): Promise<StoredNode[]> {
  return tx.workspaceNode.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
}

/**
 * Effective access of every workspace of the organisation, computed top-down in one pass. Archived workspaces keep
 * an entry (with nothing granted) so their former members get nothing rather than the root's access.
 */
export async function resolveOrganisation(tx: Reader, tenantId: string): Promise<{ root: NodeAccess; byId: Map<string, NodeAccess>; rules: WorkspaceRules }> {
  const [nodes, ent, rules] = await Promise.all([organisationNodes(tx, tenantId), entitlementsFor(tx, tenantId), workspaceRulesFor(tx, tenantId)]);
  const stored = nodes.find((n) => n.level === 'SUPER' && !n.parentId);
  const rootNode = stored ?? virtualRoot(tenantId);
  const ceiling = rootNode.actions ? parseActionGrants(rootNode.actions) : allActions();
  const root: NodeAccess = { node: rootNode, level: 'SUPER', features: ent.features, actions: ceiling, ...(stored ? {} : { virtual: true }) };
  const byId = new Map<string, NodeAccess>([[rootNode.id, root]]);
  const children = new Map<string, StoredNode[]>();
  for (const n of nodes) {
    if (n === stored) continue;
    const parent = n.parentId ?? rootNode.id;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  const queue: NodeAccess[] = [root];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const n of children.get(parent.node.id) ?? []) {
      if (byId.has(n.id)) continue;
      const live = !n.archivedAt && !parent.node.archivedAt;
      const level = levelOf(n.level);
      // The Console's rules for the level (W3) cap what the workspace above granted: withheld modules and Delete.
      const granted = { features: intersectFeatures(parent.features, n.features), actions: intersectActions(parent.actions, parseActionGrants(n.actions)) };
      const capped = !live ? { features: [], actions: {} } : level === 'SUPER' ? granted : capByRules(level, rules, granted.features, granted.actions);
      const access: NodeAccess = {
        node: live ? n : { ...n, archivedAt: n.archivedAt ?? parent.node.archivedAt },
        level,
        features: capped.features,
        actions: capped.actions,
      };
      byId.set(n.id, access);
      queue.push(access);
    }
  }
  // A node whose parent chain is broken (parent missing) gets nothing.
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, { node: n, level: levelOf(n.level), features: [], actions: {} });
  return { root, byId, rules };
}

/** Access of one workspace; null = the organisation's Super Workspace. */
export async function resolveWorkspaceAccess(tx: Reader, tenantId: string, nodeId: string | null | undefined): Promise<NodeAccess> {
  const org = await resolveOrganisation(tx, tenantId);
  if (!nodeId) return org.root;
  return org.byId.get(nodeId) ?? { ...org.root, features: [], actions: {} };
}

/** The level of a member's workspace: SUPER, MANAGER or EXECUTIVE. */
export async function workspaceLevelOf(tx: Pick<TenantTx, 'membership' | 'workspaceNode'>, tenantId: string, membershipId: string): Promise<WorkspaceLevel> {
  const m = await tx.membership.findFirst({ where: { tenantId, id: membershipId }, select: { workspaceNodeId: true } });
  if (!m?.workspaceNodeId) return 'SUPER';
  const node = await tx.workspaceNode.findFirst({ where: { tenantId, id: m.workspaceNodeId }, select: { level: true } });
  return node ? levelOf(node.level) : 'SUPER';
}

/** Ids of a workspace and every workspace below it. */
export function branchIds(nodes: readonly Pick<StoredNode, 'id' | 'parentId'>[], rootId: string): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes)
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
  }
  return out;
}

/**
 * Users who work in a workspace's branch (it and everything below it), for record visibility: a manager sees the
 * records of their own workspace and their executives'.
 */
export async function branchUserIds(tx: Pick<TenantTx, 'workspaceNode' | 'membership'>, tenantId: string, nodeId: string): Promise<string[]> {
  const nodes = await tx.workspaceNode.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
  const ids = [...branchIds(nodes, nodeId)];
  const members = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', workspaceNodeId: { in: ids } }, select: { userId: true } });
  return members.map((m) => m.userId);
}

/**
 * Whether a person's workspace, or any workspace above it, is deactivated (W4): the nearest deactivated one, or
 * null when everything up to the Super Workspace is live. Deleted (archived) workspaces count too.
 */
export async function deactivatedAbove(tx: Pick<TenantTx, 'workspaceNode'>, tenantId: string, nodeId: string | null | undefined): Promise<{ id: string; name: string } | null> {
  if (!nodeId) return null;
  const nodes = await tx.workspaceNode.findMany({ where: { tenantId }, select: { id: true, name: true, parentId: true, deactivatedAt: true, archivedAt: true } });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (let n = byId.get(nodeId); n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) {
    seen.add(n.id);
    if (n.deactivatedAt || n.archivedAt) return { id: n.id, name: n.name };
  }
  return null;
}
