import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import {
  type ActionGrants,
  actionAllowed,
  type AssignWorkspaceMemberInput,
  type BlacklistWorkspaceInput,
  type CreateWorkspaceInput,
  type DeactivateWorkspaceInput,
  type DeleteWorkspaceInput,
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
  type WorkspaceDeleted,
  type WorkspaceEmailCheck,
  type WorkspaceImpact,
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
import { blacklistedNow, branchIds, nameKeyOf, type NodeAccess, resolveOrganisation, type StoredNode } from './access';

type Org = Awaited<ReturnType<typeof resolveOrganisation>>;

/** A refusal by the hierarchy rules: a machine-readable code, then the sentence for people. */
export class HierarchyError extends ForbiddenException {
  constructor(code: string, message: string) {
    super({ code, message });
  }
}
/** Not soft-deleted: on MongoDB a field never written is not null, so both are checked. */
const NOT_DELETED = { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] };
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
      if (input.accessLevel && input.level !== 'MANAGER') throw new BadRequestException({ code: 'INVALID_SETTING', message: 'The access level belongs to Manager Workspaces.' });
      if (input.executiveIds?.length && (input.level !== 'MANAGER' || me.level !== 'SUPER')) throw new BadRequestException({ code: 'INVALID_SETTING', message: 'Only a new Manager Workspace, created by the Super Workspace, takes existing Executive Workspaces.' });
      const movingExecutives = (input.executiveIds ?? []).map((x) => org.byId.get(x));
      if (movingExecutives.some((x) => !x || x.level !== 'EXECUTIVE' || x.node.archivedAt)) throw notFound();
      // One email, one role (W5, spec section 3): checked here as well as while the person types.
      if (input.person && 'inviteEmail' in input.person) {
        const clash = await this.emailClash(tx, auth.tenantId, org, input.person.inviteEmail);
        if (clash) throw new ConflictException({ code: clash.code, message: clash.message, details: [{ path: 'person.inviteEmail', message: clash.code }] });
      }

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
          department: input.department?.trim() || null,
          description: input.description?.trim() || null,
          accessLevel: input.level === 'MANAGER' ? (input.accessLevel ?? 'TEAM') : null,
          ...(input.status === 'DEACTIVATED' ? { deactivatedAt: new Date(), deactivatedById: auth.userId, deactivationReason: 'Created switched off' } : {}),
        },
      });
      if (movingExecutives.length) {
        await tx.workspaceNode.updateMany({ where: { tenantId: auth.tenantId, id: { in: movingExecutives.map((x) => x!.node.id) } }, data: { parentId: node.id } });
        for (const x of movingExecutives) await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.moved', entityType: 'workspace', entityId: x!.node.id, metadata: { from: x!.node.parentId, to: node.id }, meta });
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.created', entityType: 'workspace', entityId: node.id,
        metadata: { level: node.level, name: node.name, parentId: node.parentId, features: features.length, ...(input.status === 'DEACTIVATED' ? { status: 'DEACTIVATED' } : {}), ...(movingExecutives.length ? { executivesMoved: movingExecutives.length } : {}) }, meta,
      });
      if (input.person && 'userId' in input.person) await this.placeMember(tx, auth, node, input.person.userId, meta);
      let inviteUrl: string | undefined;
      if (input.person && 'inviteEmail' in input.person) {
        const p = input.person;
        ({ inviteUrl } = await this.invitations.createIn(tx, auth, { email: p.inviteEmail, roleKey: p.roleKey ?? (input.level === 'MANAGER' ? 'manager' : 'member'), workspaceNodeId: node.id, ...(p.name ? { name: p.name } : {}), ...(p.phone ? { phone: p.phone } : {}) }, meta));
      }
      const after = await resolveOrganisation(tx, auth.tenantId);
      return { ...(await this.rowOf(tx, auth, after, after.byId.get(node.id)!)), ...(inviteUrl ? { inviteUrl } : {}) };
    });
  }

  /** Whether an email may be given a new workspace (W5): answered while the person types in the wizard. */
  emailCheck(auth: AuthContext, email: string): Promise<WorkspaceEmailCheck> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = this.callerAccess(auth, org);
      if (me.level === 'EXECUTIVE') throw new HierarchyError('WORKSPACE_CREATE_FORBIDDEN', 'Executive Workspaces cannot create workspaces.');
      const clash = await this.emailClash(tx, auth.tenantId, org, email.trim().toLowerCase());
      return clash ? { available: false, ...clash } : { available: true };
    });
  }

  /**
   * One email, one role in an organisation (spec section 3): an address that already works in a workspace here, or
   * has a pending invitation to one, cannot be given another. The sentence names where, so the person knows why.
   * Its workspace name is shown only when the caller can see that workspace.
   */
  private async emailClash(tx: TenantTx, tenantId: string, org: Org, email: string): Promise<{ code: 'EMAIL_IN_WORKSPACE' | 'EMAIL_INVITED'; message: string } | null> {
    const place = (nodeId: string | null | undefined) => {
      const a = nodeId ? org.byId.get(nodeId) : org.root;
      return !a || a === org.root || (a.level === 'SUPER' && !a.node.parentId) ? null : a;
    };
    const member = await tx.membership.findFirst({ where: { tenantId, status: 'ACTIVE', user: { email } }, select: { workspaceNodeId: true } });
    if (member) {
      const a = place(member.workspaceNodeId);
      const message = !a
        ? 'This email is already a member of the Super Workspace. One email can hold only one role in your organisation.'
        : a.level === 'MANAGER'
          ? `This email is already the Manager of ${a.node.name}. One email can hold only one role in your organisation.`
          : `This email is already the Executive of ${a.node.name}. One email can hold only one role in your organisation.`;
      return { code: 'EMAIL_IN_WORKSPACE', message };
    }
    const invite = await tx.invitation.findFirst({ where: { tenantId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { workspaceNodeId: true } });
    if (invite) {
      const a = place(invite.workspaceNodeId);
      return {
        code: 'EMAIL_INVITED',
        message: a ? `This email already has a pending invitation to ${a.node.name}. Withdraw that invitation first.` : 'This email already has a pending invitation to the Super Workspace. Withdraw that invitation first.',
      };
    }
    return null;
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
  private ensureRoot(tx: TenantTx, auth: AuthContext): Promise<StoredNode> {
    return this.ensureRootIn(tx, auth.tenantId, auth.userId);
  }

  async ensureRootIn(tx: TenantTx, tenantId: string, createdById: string | null = null): Promise<StoredNode> {
    const found = await tx.workspaceNode.findFirst({ where: { tenantId, level: 'SUPER', parentId: null } });
    if (found) return found;
    return tx.workspaceNode.create({
      data: {
        tenantId, level: 'SUPER', name: 'Super Workspace', nameKey: nameKeyOf('Super Workspace'), parentId: null,
        designation: DEFAULT_WORKSPACE_DESIGNATION.SUPER, features: [], actions: null, canCreateExecutives: true, createdById,
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
      if (input.department !== undefined) data.department = input.department.trim() || null;
      if (input.description !== undefined) data.description = input.description.trim() || null;
      if (input.accessLevel !== undefined) {
        if (target.level !== 'MANAGER') throw new BadRequestException({ code: 'INVALID_SETTING', message: 'The access level belongs to Manager Workspaces.' });
        data.accessLevel = input.accessLevel;
      }
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

  // ───────────── Deactivating and deleting (W4) ─────────────

  /**
   * What deleting a workspace would touch, so the person sees it before confirming: who loses access, the records
   * that move, the Executive Workspaces that move with them, and which workspaces may receive them.
   */
  impact(auth: AuthContext, id: string): Promise<WorkspaceImpact> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'view');
      return this.impactOf(tx, auth.tenantId, org, target, this.callerAccess(auth, org), auth.userId);
    });
  }

  /**
   * What removing `target` touches. `me` is the workspace acting (null for the Console, which acts above the Super
   * Workspace) and `callerId` the person acting, who receives records handed to their own workspace.
   */
  async impactOf(tx: TenantTx, tenantId: string, org: Org, target: NodeAccess, me: NodeAccess | null, callerId: string | null): Promise<WorkspaceImpact> {
    const auth = { tenantId };
    const id = target.node.id;
    const [members, invites, below] = await Promise.all([
      tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', workspaceNodeId: id }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
      tx.invitation.count({ where: { tenantId: auth.tenantId, workspaceNodeId: id, acceptedAt: null, revokedAt: null } }),
      tx.workspaceNode.findMany({ where: { tenantId: auth.tenantId, parentId: id, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const people = members.map((m) => m.user.id);
    const owned = { ownerId: { in: people }, ...NOT_DELETED };
    const [companies, contacts, leads, deals, openTasks, belowPeople] = await Promise.all([
      people.length ? tx.company.count({ where: { tenantId: auth.tenantId, ...owned } }) : 0,
      people.length ? tx.contact.count({ where: { tenantId: auth.tenantId, ...owned } }) : 0,
      people.length ? tx.lead.count({ where: { tenantId: auth.tenantId, ...owned } }) : 0,
      people.length ? tx.opportunity.count({ where: { tenantId: auth.tenantId, ...owned } }) : 0,
      tx.task.count({ where: { tenantId: auth.tenantId, status: 'OPEN', AND: [NOT_DELETED, { OR: [{ assigneeId: { in: people } }, { workspaceNodeId: id }] }] } }),
      Promise.all(below.map((b) => tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE', workspaceNodeId: b.id } }))),
    ]);
    const records = { companies, contacts, leads, deals, openTasks };
    const nodes = [...org.byId.values()].map((a) => a.node);
    const excluded = branchIds(nodes, id);
    const candidates = [...org.byId.values()].filter(
      (a) =>
        !excluded.has(a.node.id) &&
        !a.node.archivedAt &&
        !a.node.deactivatedAt &&
        !blacklistedNow(a.node) &&
        (!me || a.node.id === me.node.id || me.level === 'SUPER' || (me.level === 'MANAGER' && a.level === 'EXECUTIVE' && a.node.parentId === me.node.id)) &&
        // An Executive Workspace cannot take over workspaces.
        !(below.length && a.level === 'EXECUTIVE'),
    );
    const handoverOptions = await Promise.all(
      candidates.map(async (a) => ({ id: a.node.id, name: a === org.root ? 'Super Workspace' : a.node.name, level: a.level, receiver: (await this.receiverOf(tx, tenantId, org, a, me, callerId))?.name ?? null })),
    );
    return {
      id,
      name: target.node.name,
      level: target.level,
      people: members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email })),
      pendingInvites: invites,
      workspacesBelow: below.map((b, i) => ({ id: b.id, name: b.name, people: belowPeople[i] ?? 0 })),
      records,
      handoverOptions: handoverOptions.sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'SUPER' ? -1 : b.level === 'SUPER' ? 1 : a.level === 'MANAGER' ? -1 : 1)),
      handoverRequired: below.length > 0 || Object.values(records).some((n) => n > 0),
    };
  }

  /** The person who receives handed-over records in a workspace: the caller in their own, otherwise its first member. */
  async receiverOf(tx: TenantTx, tenantId: string, org: Org, a: NodeAccess, me: NodeAccess | null, callerId: string | null): Promise<{ id: string; name: string } | null> {
    const auth = { tenantId };
    if (me && callerId && a.node.id === me.node.id) return tx.user.findUnique({ where: { id: callerId }, select: { id: true, name: true } });
    if (a === org.root) {
      const m = await tx.membership.findFirst({
        where: { tenantId: auth.tenantId, status: 'ACTIVE', OR: [{ workspaceNodeId: null }, { workspaceNodeId: { isSet: false } }, ...(a.virtual ? [] : [{ workspaceNodeId: a.node.id }])] },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      });
      return m ? tx.user.findUnique({ where: { id: m.userId }, select: { id: true, name: true } }) : null;
    }
    return this.headOf(tx, auth.tenantId, a.node.id);
  }

  /**
   * Deactivates a Manager or Executive Workspace: its people, and everyone in the workspaces below it, are stopped on
   * their next request until it is reactivated. Nothing else changes, so reactivating restores things exactly.
   */
  deactivate(auth: AuthContext, id: string, input: DeactivateWorkspaceInput, meta: RequestMeta): Promise<WorkspaceRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'edit');
      assertNotBlocked(target.node);
      await tx.workspaceNode.update({ where: { id }, data: { deactivatedAt: new Date(), deactivatedById: auth.userId, deactivationReason: input.reason } });
      const below = [...branchIds([...org.byId.values()].map((a) => a.node), id)].filter((x) => x !== id).length;
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.deactivated', entityType: 'workspace', entityId: id,
        metadata: { workspace: target.node.name, level: target.level, reason: input.reason, workspacesBelow: below }, meta,
      });
      const after = await resolveOrganisation(tx, auth.tenantId);
      return this.rowOf(tx, auth, after, after.byId.get(id)!);
    });
  }

  /**
   * Blacklists a Manager or Executive Workspace for a while: like deactivating it, its people and everyone below it
   * are stopped, but the block lifts by itself on the chosen day (or earlier, when it is reactivated).
   */
  blacklist(auth: AuthContext, id: string, input: BlacklistWorkspaceInput, meta: RequestMeta): Promise<WorkspaceRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'edit');
      assertNotBlocked(target.node);
      const until = blacklistEnd(input.until);
      await tx.workspaceNode.update({ where: { id }, data: { blacklistedUntil: until, blacklistedById: auth.userId, blacklistReason: input.reason } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.blacklisted', entityType: 'workspace', entityId: id,
        metadata: { workspace: target.node.name, level: target.level, reason: input.reason, until: until.toISOString() }, meta,
      });
      const after = await resolveOrganisation(tx, auth.tenantId);
      return this.rowOf(tx, auth, after, after.byId.get(id)!);
    });
  }

  /** Lifts a deactivation or a blacklist. A block the Console set can only be lifted by the Console. */
  reactivate(auth: AuthContext, id: string, meta: RequestMeta): Promise<WorkspaceRow> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'edit');
      if (!target.node.deactivatedAt && !blacklistedNow(target.node)) throw new ConflictException({ code: 'WORKSPACE_NOT_DEACTIVATED', message: 'This workspace is not deactivated.' });
      if (target.node.lockedByConsole) throw new HierarchyError('WORKSPACE_LOCKED_BY_CONSOLE', 'SampForce support blocked this workspace, so only they can lift it.');
      const was = target.node.deactivatedAt ? 'deactivated' : 'blacklisted';
      await tx.workspaceNode.update({ where: { id }, data: UNBLOCKED });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.reactivated', entityType: 'workspace', entityId: id, metadata: { workspace: target.node.name, level: target.level, was }, meta });
      const after = await resolveOrganisation(tx, auth.tenantId);
      return this.rowOf(tx, auth, after, after.byId.get(id)!);
    });
  }

  /**
   * Deletes a Manager or Executive Workspace. Nothing in the CRM is erased: its people's records and open tasks go to
   * the receiving workspace's person, a manager's Executive Workspaces move under the receiving workspace with their
   * people, and its own people lose access to the organisation (their accounts and history stay). The person typed
   * its name and their password (the guard checked the password).
   */
  delete(auth: AuthContext, id: string, input: DeleteWorkspaceInput, meta: RequestMeta): Promise<WorkspaceDeleted> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `workspaces:${auth.tenantId}`);
      const org = await resolveOrganisation(tx, auth.tenantId);
      const target = this.authorityOver(auth, org, id, 'workspace_management', 'delete');
      if (nameKeyOf(input.confirmName) !== nameKeyOf(target.node.name)) {
        throw new BadRequestException({ code: 'CONFIRM_NAME_MISMATCH', message: 'Type the workspace name exactly to delete it.' });
      }
      const me = this.callerAccess(auth, org);
      const impact = await this.impactOf(tx, auth.tenantId, org, target, me, auth.userId);
      let receiver: { id: string; name: string } | null = null;
      let handover: NodeAccess | null = null;
      if (input.handoverToId) {
        if (!impact.handoverOptions.some((o) => o.id === input.handoverToId)) {
          throw new BadRequestException({ code: 'INVALID_HANDOVER', message: 'Choose one of the workspaces offered to receive the records.' });
        }
        handover = org.byId.get(input.handoverToId)!;
        receiver = await this.receiverOf(tx, auth.tenantId, org, handover, me, auth.userId);
        if (!receiver) throw new BadRequestException({ code: 'HANDOVER_EMPTY', message: 'That workspace has nobody in it yet to receive the records. Choose another one.' });
      } else if (impact.handoverRequired) {
        throw new BadRequestException({ code: 'HANDOVER_REQUIRED', message: 'Choose the workspace that receives its records and workspaces.' });
      }
      const result = await this.removeNode(tx, auth.tenantId, org, target, impact, handover, receiver);
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.deleted', entityType: 'workspace', entityId: id,
        metadata: { workspace: target.node.name, level: target.level, handoverToId: handover?.node.id ?? null, receiverId: receiver?.id ?? null, records: impact.records, workspacesMoved: impact.workspacesBelow.map((w) => w.name), peopleRemoved: impact.people.map((p) => p.email) },
        meta,
      });
      return result;
    });
  }

  /**
   * The removal itself, shared with the Console: records and open tasks go to `receiver` (when there is one), the
   * workspaces below move under `handover`, its people lose access, and the node is archived under a name that frees
   * the old one. The people taken out are kept on the node so a restore brings exactly them back.
   */
  async removeNode(tx: TenantTx, tenantId: string, org: Org, target: NodeAccess, impact: WorkspaceImpact, handover: NodeAccess | null, receiver: { id: string; name: string } | null): Promise<WorkspaceDeleted> {
    const id = target.node.id;
    const people = impact.people.map((p) => p.userId);
    let recordsMoved = 0;
    if (receiver && handover) {
      const owned = { tenantId, ownerId: { in: people } };
      const data = { ownerId: receiver.id };
      if (people.length) {
        const moved = await Promise.all([tx.company.updateMany({ where: owned, data }), tx.contact.updateMany({ where: owned, data }), tx.lead.updateMany({ where: owned, data }), tx.opportunity.updateMany({ where: owned, data })]);
        recordsMoved += moved.reduce((n, r) => n + r.count, 0);
      }
      const handoverNode = handover.virtual ? null : handover.node.id;
      const tasks = await tx.task.findMany({ where: { tenantId, status: 'OPEN', AND: [NOT_DELETED, { OR: [{ assigneeId: { in: people } }, { workspaceNodeId: id }] }] }, select: { id: true, assigneeId: true } });
      for (const t of tasks) {
        await tx.task.update({
          where: { id: t.id },
          data: { assigneeId: receiver.id, workspaceNodeId: handoverNode, reassignedFromId: t.assigneeId, reassignedAt: new Date() },
        });
      }
      recordsMoved += tasks.length;
    }
    if (handover && impact.workspacesBelow.length) {
      const parentId = handover.virtual ? (await this.ensureRootIn(tx, tenantId)).id : handover.node.id;
      await tx.workspaceNode.updateMany({ where: { tenantId, id: { in: impact.workspacesBelow.map((w) => w.id) } }, data: { parentId } });
    }

    const stamp = new Date();
    if (people.length) await tx.membership.updateMany({ where: { tenantId, status: 'ACTIVE', workspaceNodeId: id }, data: { status: 'SUSPENDED' } });
    await tx.workspaceNode.update({ where: { id }, data: { archivedAt: stamp, removedMemberIds: people, nameKey: `${target.node.nameKey ?? nameKeyOf(target.node.name)}#archived-${stamp.getTime()}` } });
    await tx.invitation.updateMany({ where: { tenantId, workspaceNodeId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: stamp } });
    return { name: target.node.name, handoverTo: handover ? (handover === org.root ? 'Super Workspace' : handover.node.name) : null, recordsMoved, workspacesMoved: handover ? impact.workspacesBelow.length : 0, peopleRemoved: people.length };
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
      rules: org.rules,
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
      department: a.node.department ?? null,
      description: a.node.description ?? null,
      accessLevel: a.node.accessLevel === 'OWN' ? 'OWN' : 'TEAM',
      deactivatedAt: a.node.deactivatedAt?.toISOString() ?? null,
      deactivationReason: a.node.deactivationReason ?? null,
      blacklistedUntil: blacklistedNow(a.node) ? a.node.blacklistedUntil!.toISOString() : null,
      blacklistReason: blacklistedNow(a.node) ? (a.node.blacklistReason ?? null) : null,
      lockedByConsole: !!a.node.lockedByConsole && (!!a.node.deactivatedAt || blacklistedNow(a.node)),
      createdAt: a.node.createdAt.toISOString(),
    };
  }
}

/** Clears every block: a deactivation, a blacklist and the Console's hold on them. */
export const UNBLOCKED = { deactivatedAt: null, deactivatedById: null, deactivationReason: null, blacklistedUntil: null, blacklistedById: null, blacklistReason: null, lockedByConsole: null } as const;

/** One block at a time: a deactivated or blacklisted workspace is reactivated before it is blocked another way. */
export function assertNotBlocked(node: StoredNode): void {
  if (node.deactivatedAt) throw new ConflictException({ code: 'WORKSPACE_ALREADY_DEACTIVATED', message: 'This workspace is already deactivated.' });
  if (blacklistedNow(node)) throw new ConflictException({ code: 'WORKSPACE_ALREADY_BLACKLISTED', message: 'This workspace is already blacklisted. Reactivate it first to change the block.' });
}

/** The moment a blacklist ending on `day` (YYYY-MM-DD) lifts: the start of that day, UTC. It must be in the future. */
export function blacklistEnd(day: string): Date {
  const until = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose a day after today for the blacklist to end.', details: [{ path: 'until', message: 'Choose a day after today for the blacklist to end.' }] });
  }
  return until;
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
