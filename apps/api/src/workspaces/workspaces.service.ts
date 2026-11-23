import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import {
  type ActionGrants,
  actionAllowed,
  type AssignWorkspaceMemberInput,
  type CreateWorkspaceInput,
  DEFAULT_WORKSPACE_DESIGNATION,
  defaultChildActions,
  FEATURE_BY_KEY,
  type FeatureKey,
  type MoveWorkspaceInput,
  normaliseActions,
  normaliseFeatures,
  parseActionGrants,
  type UpdateWorkspaceInput,
  type WorkspaceAction,
  WORKSPACE_ACTION_LABEL,
  WORKSPACE_LEVEL_LABEL,
  type WorkspaceIdentity,
  type WorkspaceLevel,
  type WorkspacePermissionsInput,
  type WorkspaceRow,
  type WorkspaceTree,
  type WorkspaceUsage,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { entitlementsFor } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { InvitationsService } from '../tenants/invitations.service';
import { branchIds, nameKeyOf, type NodeAccess, resolveOrganisation, type StoredNode } from './access';

type Org = Awaited<ReturnType<typeof resolveOrganisation>>;

/** A refusal by the hierarchy rules: a machine-readable code, then the sentence for people. */
export class HierarchyError extends ForbiddenException {
  constructor(code: string, message: string) {
    super({ code, message });
  }
}
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });

/**
 * The workspace hierarchy of an organisation (ADR 0071): creating Manager and Executive Workspaces within the
 * subscription's limits, handing features and actions down, moving people and workspaces. Every rule is checked
 * here, inside the transaction that makes the change, whatever the screens show.
 */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationsService,
  ) {}

  // ───────────── Reading ─────────────

  tree(auth: AuthContext): Promise<WorkspaceTree> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      return this.treeOf(tx, auth, org);
    });
  }

  identity(auth: AuthContext): Promise<WorkspaceIdentity> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const mine = this.callerAccess(auth, org);
      const [tenant, membership] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { id: true, name: true } }),
        tx.membership.findFirst({ where: { tenantId: auth.tenantId, id: auth.membershipId }, select: { designationId: true, reportingManagerId: true } }),
      ]);
      const [designation, manager] = await Promise.all([
        membership?.designationId ? tx.designation.findFirst({ where: { tenantId: auth.tenantId, id: membership.designationId }, select: { name: true } }) : null,
        membership?.reportingManagerId ? tx.user.findUnique({ where: { id: membership.reportingManagerId }, select: { id: true, name: true } }) : null,
      ]);
      const parent = mine.node.parentId ? org.byId.get(mine.node.parentId) : null;
      return {
        id: mine.node.id,
        level: mine.level,
        levelLabel: WORKSPACE_LEVEL_LABEL[mine.level],
        name: mine.virtual ? tenant.name : mine.node.name,
        designation: mine.node.designation,
        organizationId: tenant.id,
        organizationName: tenant.name,
        jobTitle: designation?.name ?? null,
        reportingManager: manager ?? (parent ? await this.headOf(tx, auth.tenantId, parent.node.id) : null),
        parent: parent ? { id: parent.node.id, name: parent.virtual ? tenant.name : parent.node.name, level: parent.level } : null,
        actions: mine.actions,
      };
    });
  }

  private async headOf(tx: TenantTx, tenantId: string, nodeId: string): Promise<{ id: string; name: string } | null> {
    const m = await tx.membership.findFirst({ where: { tenantId, status: 'ACTIVE', workspaceNodeId: nodeId }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
    return m ? tx.user.findUnique({ where: { id: m.userId }, select: { id: true, name: true } }) : null;
  }

  // ───────────── Creating ─────────────

  create(auth: AuthContext, input: CreateWorkspaceInput, meta: RequestMeta): Promise<WorkspaceRow & { inviteUrl?: string }> {
    return this.prisma.run(auth, async (tx) => {
      // One creation at a time per organisation, so two requests at once can never pass a limit together.
      await transactionLock(tx, `workspaces:${auth.tenantId}`);
      const root = await this.ensureRoot(tx, auth);
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = this.callerAccess(auth, org);
      if (me.level === 'EXECUTIVE') throw new HierarchyError('WORKSPACE_CREATE_FORBIDDEN', 'Executive Workspaces cannot create workspaces.');
      this.assertAction(me, 'workspace_management', 'create');
      const parent = this.parentFor(input, me, org, root);
      if (input.level === 'MANAGER' && me.level !== 'SUPER') throw new HierarchyError('WORKSPACE_CREATE_FORBIDDEN', 'Only the Super Workspace creates Manager Workspaces.');
      if (input.level === 'EXECUTIVE') {
        if (me.level === 'SUPER' && !org.root.node.canCreateExecutives)
          throw new HierarchyError('WORKSPACE_CREATE_FORBIDDEN', 'Your subscription does not let the Super Workspace create Executive Workspaces. Ask SampForce support.');
        if (me.level === 'MANAGER' && !me.node.canCreateExecutives)
          throw new HierarchyError('WORKSPACE_CREATE_FORBIDDEN', 'Your Super Workspace has not allowed this Manager Workspace to create Executive Workspaces.');
        if (me.level === 'MANAGER' && parent.node.id !== me.node.id) throw new HierarchyError('WORKSPACE_CREATE_FORBIDDEN', 'A manager creates Executive Workspaces only in their own team.');
      }
      await this.assertCapacity(tx, auth.tenantId, input.level, 1);

      const nameKey = nameKeyOf(input.name);
      if (await tx.workspaceNode.findFirst({ where: { tenantId: auth.tenantId, nameKey }, select: { id: true } }))
        throw new ConflictException({ code: 'WORKSPACE_NAME_TAKEN', message: 'A workspace with this name already exists in your organisation.' });

      const features = input.features ? this.grantableFeatures(parent, input.features) : parent.features;
      const actions = input.actions ? this.grantableActions(parent, input.actions) : defaultChildActions(input.level, parent.actions);
      const node = await tx.workspaceNode.create({
        data: {
          tenantId: auth.tenantId,
          level: input.level,
          name: input.name.trim(),
          nameKey,
          parentId: parent.node.id,
          designation: input.designation?.trim() || DEFAULT_WORKSPACE_DESIGNATION[input.level],
          features,
          actions: actions as Prisma.InputJsonValue,
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.created', entityType: 'workspace', entityId: node.id,
        metadata: { level: node.level, name: node.name, parentId: node.parentId, features: features.length }, meta,
      });
      if (input.person && 'userId' in input.person) await this.placeMember(tx, auth, node, input.person.userId, meta);
      let inviteUrl: string | undefined;
      if (input.person && 'inviteEmail' in input.person) {
        ({ inviteUrl } = await this.invitations.createIn(tx, auth, { email: input.person.inviteEmail, roleKey: input.person.roleKey ?? (input.level === 'MANAGER' ? 'manager' : 'member'), workspaceNodeId: node.id }, meta));
      }
      const after = await resolveOrganisation(tx, auth.tenantId);
      return { ...(await this.rowOf(tx, auth, after, after.byId.get(node.id)!)), ...(inviteUrl ? { inviteUrl } : {}) };
    });
  }

  /** The parent of a new workspace: the root for managers; the named manager, or the caller's own team, for executives. */
  private parentFor(input: CreateWorkspaceInput, me: NodeAccess, org: Org, root: StoredNode): NodeAccess {
    if (input.level === 'MANAGER') {
      if (input.parentId && input.parentId !== root.id) throw new BadRequestException({ code: 'INVALID_PARENT', message: 'Manager Workspaces sit directly under the Super Workspace.' });
      return org.root;
    }
    const id = input.parentId ?? (me.level === 'MANAGER' ? me.node.id : root.id);
    const parent = org.byId.get(id);
    // A parent in another organisation is simply not found: the workspace guard never returns its documents.
    if (!parent || parent.node.archivedAt) throw notFound();
    if (parent.level === 'EXECUTIVE') throw new BadRequestException({ code: 'INVALID_PARENT', message: 'An Executive Workspace cannot have workspaces under it.' });
    return parent;
  }

  /** Throws PLAN_LIMIT when the organisation already has as many workspaces of the level as its subscription allows. */
  private async assertCapacity(tx: TenantTx, tenantId: string, level: Exclude<WorkspaceLevel, 'SUPER'>, adding: number): Promise<void> {
    const usage = await this.usage(tx, tenantId);
    const u = level === 'MANAGER' ? usage.managers : usage.executives;
    if (u.max !== null && u.used + adding > u.max) {
      throw new ForbiddenException({
        code: 'WORKSPACE_LIMIT_REACHED',
        message:
          level === 'MANAGER'
            ? `Your subscription allows ${u.max} Manager Workspaces and ${u.used} are in use. Ask SampForce to raise the limit.`
            : `Your subscription allows ${u.max} Executive Workspaces and ${u.used} are in use. Ask SampForce to raise the limit.`,
        details: [{ path: level === 'MANAGER' ? 'managers' : 'executives', message: `${u.used}/${u.max}` }],
      });
    }
  }

  async usage(tx: TenantTx, tenantId: string): Promise<WorkspaceUsage> {
    const [ent, sub, managers, executives] = await Promise.all([
      entitlementsFor(tx, tenantId),
      tx.subscription.findUnique({ where: { tenantId }, select: { maxManagerWorkspaces: true, maxExecutiveWorkspaces: true } }),
      tx.workspaceNode.count({ where: { tenantId, level: 'MANAGER', archivedAt: null } }),
      tx.workspaceNode.count({ where: { tenantId, level: 'EXECUTIVE', archivedAt: null } }),
    ]);
    return {
      managers: { used: managers, max: sub?.maxManagerWorkspaces ?? ent.entitlements.maxManagerWorkspaces },
      executives: { used: executives, max: sub?.maxExecutiveWorkspaces ?? ent.entitlements.maxExecutiveWorkspaces },
    };
  }

  /** The organisation's stored root, created on the first change to its hierarchy. */
  private async ensureRoot(tx: TenantTx, auth: AuthContext): Promise<StoredNode> {
    const found = await tx.workspaceNode.findFirst({ where: { tenantId: auth.tenantId, level: 'SUPER', parentId: null } });
    if (found) return found;
    return tx.workspaceNode.create({
      data: {
        tenantId: auth.tenantId, level: 'SUPER', name: 'Super Workspace', nameKey: nameKeyOf('Super Workspace'), parentId: null,
        designation: DEFAULT_WORKSPACE_DESIGNATION.SUPER, features: [], actions: null, canCreateExecutives: true, createdById: auth.userId,
      },
    });
  }

  // ───────────── Changing ─────────────

  update(auth: AuthContext, id: string, input: UpdateWorkspaceInput, meta: RequestMeta): Promise<WorkspaceRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'edit');
      const data: Prisma.WorkspaceNodeUpdateInput = {};
      if (input.name) {
        const nameKey = nameKeyOf(input.name);
        const clash = await tx.workspaceNode.findFirst({ where: { tenantId: auth.tenantId, nameKey, NOT: { id } }, select: { id: true } });
        if (clash) throw new ConflictException({ code: 'WORKSPACE_NAME_TAKEN', message: 'A workspace with this name already exists in your organisation.' });
        Object.assign(data, { name: input.name.trim(), nameKey });
      }
      if (input.designation) data.designation = input.designation.trim();
      await tx.workspaceNode.update({ where: { id }, data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.updated', entityType: 'workspace', entityId: id, metadata: { from: { name: target.node.name, designation: target.node.designation }, to: input }, meta });
      const after = await resolveOrganisation(tx, auth.tenantId);
      return this.rowOf(tx, auth, after, after.byId.get(id)!);
    });
  }

  /**
   * Changes what a parent hands down to one child workspace. The caller must be that workspace's parent level and
   * may grant only what their own workspace has: a request for anything more is refused with FEATURE_NOT_GRANTED or
   * ACTION_NOT_GRANTED, never trimmed silently.
   */
  setPermissions(auth: AuthContext, id: string, input: WorkspacePermissionsInput, meta: RequestMeta): Promise<WorkspaceRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'permission_management', 'manage');
      const parent = target.node.parentId ? org.byId.get(target.node.parentId)! : org.root;
      const data: Prisma.WorkspaceNodeUpdateInput = {};
      const before = { features: target.node.features, actions: parseActionGrants(target.node.actions), canCreateExecutives: target.node.canCreateExecutives, canViewOtherManagers: target.node.canViewOtherManagers };
      if (input.features) data.features = this.grantableFeatures(parent, input.features);
      if (input.actions) data.actions = this.grantableActions(parent, input.actions) as Prisma.InputJsonValue;
      if (input.canCreateExecutives !== undefined || input.canViewOtherManagers !== undefined || input.canViewAuditLog !== undefined) {
        if (target.level !== 'MANAGER') throw new BadRequestException({ code: 'INVALID_SETTING', message: 'These settings belong to Manager Workspaces.' });
        if (this.callerAccess(auth, org).level !== 'SUPER') throw new HierarchyError('SELF_GRANT_FORBIDDEN', 'Only the Super Workspace changes what a Manager Workspace may create or see.');
        if (input.canCreateExecutives !== undefined) data.canCreateExecutives = input.canCreateExecutives;
        if (input.canViewOtherManagers !== undefined) data.canViewOtherManagers = input.canViewOtherManagers;
        if (input.canViewAuditLog !== undefined) data.canViewAuditLog = input.canViewAuditLog;
      }
      if (input.canChatWithPeers !== undefined) {
        if (target.level === 'SUPER') throw new BadRequestException({ code: 'INVALID_SETTING', message: 'This setting belongs to Manager and Executive Workspaces.' });
        data.canChatWithPeers = input.canChatWithPeers;
      }
      await tx.workspaceNode.update({ where: { id }, data });
      const added = (data.features as string[] | undefined)?.filter((f) => !before.features.includes(f)) ?? [];
      const removed = data.features ? before.features.filter((f) => !(data.features as string[]).includes(f)) : [];
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.permissions_changed', entityType: 'workspace', entityId: id,
        // Only what actually changed, so the audit log reads as the change someone made, not the whole form.
        metadata: {
          workspace: target.node.name, featuresEnabled: added, featuresDisabled: removed,
          ...(input.actions && grantsKey(before.actions) !== grantsKey(data.actions) ? { actionsFrom: before.actions, actionsTo: data.actions } : {}),
          ...flagChanges(target.node, input),
        },
        meta,
      });
      // Switching a feature on or off is also its own entry, so the audit log can answer "who turned this off?".
      if (added.length || removed.length) {
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.features_changed', entityType: 'workspace', entityId: id,
          metadata: { workspace: target.node.name, featuresEnabled: added, featuresDisabled: removed }, meta,
        });
      }
      const after = await resolveOrganisation(tx, auth.tenantId);
      return this.rowOf(tx, auth, after, after.byId.get(id)!);
    });
  }

  /** Moves an Executive Workspace to another manager (or directly under the Super Workspace). Super Workspace only. */
  move(auth: AuthContext, id: string, input: MoveWorkspaceInput, meta: RequestMeta): Promise<WorkspaceRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = this.callerAccess(auth, org);
      if (me.level !== 'SUPER') throw new HierarchyError('WORKSPACE_TRANSFER_FORBIDDEN', 'Only the Super Workspace moves workspaces between teams.');
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'manage');
      if (target.level !== 'EXECUTIVE') throw new BadRequestException({ code: 'INVALID_PARENT', message: 'Only Executive Workspaces move between teams.' });
      const root = await this.ensureRoot(tx, auth);
      const parent = input.parentId ? org.byId.get(input.parentId) : org.byId.get(root.id) ?? org.root;
      if (!parent || parent.node.archivedAt) throw notFound();
      if (parent.level === 'EXECUTIVE') throw new BadRequestException({ code: 'INVALID_PARENT', message: 'An Executive Workspace cannot have workspaces under it.' });
      const parentId = parent.virtual ? root.id : parent.node.id;
      await tx.workspaceNode.update({ where: { id }, data: { parentId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.moved', entityType: 'workspace', entityId: id, metadata: { from: target.node.parentId, to: parentId }, meta });
      const after = await resolveOrganisation(tx, auth.tenantId);
      return this.rowOf(tx, auth, after, after.byId.get(id)!);
    });
  }

  /** Puts a member of the organisation into a workspace (Super Workspace only; an Executive Workspace holds one person). */
  assignMember(auth: AuthContext, id: string, input: AssignWorkspaceMemberInput, meta: RequestMeta): Promise<WorkspaceRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      if (this.callerAccess(auth, org).level !== 'SUPER') throw new HierarchyError('WORKSPACE_TRANSFER_FORBIDDEN', 'Only the Super Workspace moves people between workspaces.');
      const target = id === org.root.node.id ? org.root : this.authorityOver(auth, org, id, 'workspace_management', 'manage');
      const node = target.virtual ? await this.ensureRoot(tx, auth) : target.node;
      await this.placeMember(tx, auth, node, input.userId, meta);
      const after = await resolveOrganisation(tx, auth.tenantId);
      return this.rowOf(tx, auth, after, after.byId.get(node.id)!);
    });
  }

  private async placeMember(tx: TenantTx, auth: AuthContext, node: StoredNode, userId: string, meta: RequestMeta): Promise<void> {
    const membership = await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId, status: 'ACTIVE' } });
    if (!membership) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That person is not a member of your organisation.' });
    if (membership.id === auth.membershipId) throw new HierarchyError('SELF_GRANT_FORBIDDEN', 'You cannot move yourself to another workspace.');
    if (node.level === 'EXECUTIVE') {
      const taken = await tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE', workspaceNodeId: node.id, NOT: { id: membership.id } } });
      if (taken > 0) throw new ConflictException({ code: 'WORKSPACE_OCCUPIED', message: 'An Executive Workspace belongs to one person, and this one already has someone.' });
    }
    const workspaceNodeId = node.level === 'SUPER' && !node.parentId ? null : node.id;
    await tx.membership.update({ where: { id: membership.id }, data: { workspaceNodeId } });
    await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.member_assigned', entityType: 'workspace', entityId: node.id, metadata: { userId, from: membership.workspaceNodeId, to: workspaceNodeId }, meta });
  }

  /** Archives an empty workspace; its name and history stay. A workspace with people or workspaces under it is kept. */
  archive(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'delete');
      const [people, children] = await Promise.all([
        tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE', workspaceNodeId: id } }),
        tx.workspaceNode.count({ where: { tenantId: auth.tenantId, parentId: id, archivedAt: null } }),
      ]);
      if (people || children) throw new ConflictException({ code: 'WORKSPACE_NOT_EMPTY', message: 'Move its people and workspaces elsewhere before archiving it.' });
      const stamp = new Date();
      await tx.workspaceNode.update({ where: { id }, data: { archivedAt: stamp, nameKey: `${target.node.nameKey ?? nameKeyOf(target.node.name)}#archived-${stamp.getTime()}` } });
      await tx.invitation.updateMany({ where: { tenantId: auth.tenantId, workspaceNodeId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: stamp } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.archived', entityType: 'workspace', entityId: id, metadata: { name: target.node.name, level: target.level }, meta });
    });
  }

  // ───────────── Rules ─────────────

  /** The caller's own workspace (members without one are in the Super Workspace). */
  callerAccess(auth: AuthContext, org: Org): NodeAccess {
    if (!auth.workspaceNodeId) return org.root;
    return org.byId.get(auth.workspaceNodeId) ?? { ...org.root, features: [], actions: {} };
  }

  private assertAction(me: NodeAccess, feature: FeatureKey, action: WorkspaceAction): void {
    if (!me.features.includes(feature)) throw new HierarchyError('FEATURE_NOT_GRANTED', `${FEATURE_BY_KEY[feature].label} is not available in your workspace.`);
    if (!actionAllowed(me.actions, feature, action)) throw new HierarchyError('ACTION_NOT_GRANTED', `Your workspace may not ${WORKSPACE_ACTION_LABEL[action].toLowerCase()} in ${FEATURE_BY_KEY[feature].label}.`);
  }

  /**
   * The workspace `id` if the caller is its parent level: the Super Workspace over every other workspace, a manager
   * over their own Executive Workspaces. Nobody has authority over their own workspace or anything above it.
   */
  private authorityOver(auth: AuthContext, org: Org, id: string, feature: FeatureKey, action: WorkspaceAction): NodeAccess {
    const me = this.callerAccess(auth, org);
    const target = org.byId.get(id);
    if (!target || target === org.root) throw notFound();
    if (target.node.id === me.node.id) throw new HierarchyError('SELF_GRANT_FORBIDDEN', 'A workspace cannot change its own permissions. The workspace above it does.');
    this.assertAction(me, feature, action);
    if (me.level === 'SUPER') return target;
    if (me.level === 'MANAGER' && target.level === 'EXECUTIVE' && target.node.parentId === me.node.id) return target;
    if (me.level === 'MANAGER' && target.level === 'EXECUTIVE') throw notFound();
    throw new HierarchyError('WORKSPACE_ADMIN_FORBIDDEN', 'Only the workspace above this one can manage it.');
  }

  /** Requested features, all of which the parent must have. */
  private grantableFeatures(parent: NodeAccess, requested: readonly string[]): FeatureKey[] {
    const list = normaliseFeatures(requested);
    const beyond = list.filter((f) => !parent.features.includes(f));
    if (beyond.length) {
      throw new ForbiddenException({
        code: 'FEATURE_NOT_GRANTED',
        message: `${FEATURE_BY_KEY[beyond[0]!].label} is not available to the workspace above, so it cannot be granted here.`,
        details: beyond.map((f) => ({ path: 'features', message: f })),
      });
    }
    // A subfeature without its feature would never work; keep what the request says, the inheritance drops orphans.
    return list;
  }

  /** Requested actions, none of which may go beyond the parent's. */
  private grantableActions(parent: NodeAccess, requested: ActionGrants): ActionGrants {
    const out: ActionGrants = {};
    for (const [key, list] of Object.entries(requested)) {
      const wanted = normaliseActions(list ?? []);
      const theirs = parent.actions[key] ?? (FEATURE_BY_KEY[key as FeatureKey] ? (parent.actions[FEATURE_BY_KEY[key as FeatureKey].group] ?? []) : []);
      const beyond = wanted.filter((a) => !theirs.includes(a));
      if (beyond.length) {
        throw new ForbiddenException({
          code: 'ACTION_NOT_GRANTED',
          message: `The workspace above cannot ${WORKSPACE_ACTION_LABEL[beyond[0]!].toLowerCase()} in ${FEATURE_BY_KEY[key as FeatureKey]?.label ?? key}, so it cannot be granted here.`,
          details: beyond.map((a) => ({ path: `actions.${key}`, message: a })),
        });
      }
      out[key] = wanted;
    }
    return out;
  }

  // ───────────── Rows ─────────────

  private async treeOf(tx: TenantTx, auth: AuthContext, org: Org): Promise<WorkspaceTree> {
    const me = this.callerAccess(auth, org);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { id: true, name: true } });
    const nodes = [...org.byId.values()].map((a) => a.node);
    const visible = me.level === 'SUPER' ? new Set(nodes.map((n) => n.id)) : me.level === 'MANAGER' ? branchIds(nodes, me.node.id) : new Set([me.node.id]);
    const rows: WorkspaceRow[] = [];
    for (const a of org.byId.values()) if (visible.has(a.node.id) && !a.node.archivedAt) rows.push(await this.rowOf(tx, auth, org, a, tenant.name));
    const usage = await this.usage(tx, auth.tenantId);
    const room = (u: { used: number; max: number | null }) => u.max === null || u.used < u.max;
    const may = (f: FeatureKey, a: WorkspaceAction) => me.features.includes(f) && actionAllowed(me.actions, f, a);
    return {
      organization: tenant,
      usage,
      mine: await this.rowOf(tx, auth, org, me, tenant.name),
      canCreate: {
        managers: me.level === 'SUPER' && may('workspace_management', 'create') && room(usage.managers),
        executives: may('workspace_management', 'create') && room(usage.executives) && (me.level === 'SUPER' ? org.root.node.canCreateExecutives : me.level === 'MANAGER' && me.node.canCreateExecutives),
      },
      workspaces: rows,
    };
  }

  private async rowOf(tx: TenantTx, auth: AuthContext, org: Org, a: NodeAccess, orgName?: string): Promise<WorkspaceRow> {
    const me = this.callerAccess(auth, org);
    const memberWhere = a === org.root ? { OR: [{ workspaceNodeId: null }, { workspaceNodeId: { isSet: false } }, ...(a.virtual ? [] : [{ workspaceNodeId: a.node.id }])] } : { workspaceNodeId: a.node.id };
    const [members, invites] = await Promise.all([
      tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', ...memberWhere }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' }, take: 200 }),
      a.virtual ? [] : tx.invitation.findMany({ where: { tenantId: auth.tenantId, workspaceNodeId: a.node.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { email: true } }),
    ]);
    const parent = a.node.parentId ? org.byId.get(a.node.parentId) : null;
    const editable = a !== org.root && a.node.id !== me.node.id && (me.level === 'SUPER' || (me.level === 'MANAGER' && a.node.parentId === me.node.id));
    return {
      id: a.node.id,
      organizationId: auth.tenantId,
      level: a.level,
      name: a === org.root ? (orgName ?? a.node.name) : a.node.name,
      designation: a.node.designation,
      parentId: a.node.parentId,
      people: members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email })),
      pendingInvites: invites.map((i) => i.email),
      features: a.features,
      actions: a.actions,
      restrictedFeatures: parent ? parent.features.filter((f) => !a.features.includes(f)) : [],
      canCreateExecutives: a.node.canCreateExecutives,
      canViewOtherManagers: a.node.canViewOtherManagers,
      canViewAuditLog: a.node.canViewAuditLog,
      canChatWithPeers: a.node.canChatWithPeers,
      editable,
      createdAt: a.node.createdAt.toISOString(),
    };
  }
}

/** The yes/no settings a permission change really changed, with their new values. */
function flagChanges(node: StoredNode, input: WorkspacePermissionsInput): Partial<Record<'canCreateExecutives' | 'canViewOtherManagers' | 'canViewAuditLog' | 'canChatWithPeers', boolean>> {
  const out: Partial<Record<'canCreateExecutives' | 'canViewOtherManagers' | 'canViewAuditLog' | 'canChatWithPeers', boolean>> = {};
  for (const k of ['canCreateExecutives', 'canViewOtherManagers', 'canViewAuditLog', 'canChatWithPeers'] as const) if (input[k] !== undefined && input[k] !== node[k]) out[k] = input[k];
  return out;
}

/** Action grants written the same way whatever their order, to tell whether they changed. */
function grantsKey(grants: unknown): string {
  const entries = Object.entries((grants ?? {}) as Record<string, string[] | undefined>)
    .map(([k, v]) => [k, [...(v ?? [])].sort()] as const)
    .filter(([, v]) => v.length)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}
