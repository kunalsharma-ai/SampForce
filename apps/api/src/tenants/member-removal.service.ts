import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { transactionLock, type TenantTx } from '@dealflow/database';
import type { MemberRemovalImpact, MemberRemoved, RemoveMemberInput } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { branchIds, resolveOrganisation } from '../workspaces/access';
import { assertCanGrant } from './roles.service';

const NOT_DELETED = { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] };
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Member not found.' });

/** Who the caller may remove and who may receive the records: null = anyone in the organisation (the Super Workspace). */
interface Scope {
  /** Workspaces whose people the caller may remove (strictly below their own). */
  targets: Set<string>;
  /** Workspaces whose people may receive the records (the caller's own and below). */
  receivers: Set<string>;
}

/**
 * Removing a person from the workspace completely (Team Management). Nothing in the CRM is erased: the companies,
 * contacts, leads, deals, RFQs and contracts they own, and their open tasks, go to the person the remover picks.
 * Their membership is deleted, so they disappear from the members list and their sign-in here stops on their next
 * request; their sessions in this workspace are ended; their invitations here are deleted, so they can be invited
 * again cleanly. Their account (which may belong to other workspaces) and the audit history stay. The route asks for
 * the remover's password first (ADR 0074).
 */
@Injectable()
export class MemberRemovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  impact(auth: AuthContext, membershipId: string): Promise<MemberRemovalImpact> {
    return this.prisma.run(auth, async (tx) => {
      const scope = await this.scopeOf(tx, auth);
      const target = await this.target(tx, auth, membershipId, scope);
      return this.impactOf(tx, auth, target, scope);
    });
  }

  remove(auth: AuthContext, membershipId: string, input: RemoveMemberInput, meta: RequestMeta): Promise<MemberRemoved> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `members:${auth.tenantId}`);
      const scope = await this.scopeOf(tx, auth);
      const target = await this.target(tx, auth, membershipId, scope);
      const impact = await this.impactOf(tx, auth, target, scope);
      const userId = target.userId;

      let receiver: { userId: string; name: string } | null = null;
      if (input.handoverToUserId) {
        const option = impact.handoverOptions.find((o) => o.userId === input.handoverToUserId);
        if (!option) throw new BadRequestException({ code: 'INVALID_HANDOVER', message: 'Choose one of the people offered to receive the records.' });
        receiver = option;
      } else if (impact.handoverRequired) {
        throw new BadRequestException({ code: 'HANDOVER_REQUIRED', message: 'Choose the person who receives their records and open tasks.' });
      }

      let recordsMoved = 0;
      if (receiver) {
        const owned = { tenantId: auth.tenantId, ownerId: userId };
        const data = { ownerId: receiver.userId };
        // Deleted records move too, so a restored record never points at someone who is no longer here.
        const moved = await Promise.all([
          tx.company.updateMany({ where: owned, data }),
          tx.contact.updateMany({ where: owned, data }),
          tx.lead.updateMany({ where: owned, data }),
          tx.opportunity.updateMany({ where: owned, data }),
          tx.rfq.updateMany({ where: owned, data }),
          tx.contract.updateMany({ where: owned, data }),
        ]);
        recordsMoved += moved.reduce((n, r) => n + r.count, 0);
        const receiverNode = (await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: receiver.userId }, select: { workspaceNodeId: true } }))?.workspaceNodeId ?? null;
        const tasks = await tx.task.findMany({ where: { tenantId: auth.tenantId, status: 'OPEN', assigneeId: userId, ...NOT_DELETED }, select: { id: true } });
        for (const t of tasks) {
          await tx.task.update({ where: { id: t.id }, data: { assigneeId: receiver.userId, workspaceNodeId: receiverNode, reassignedFromId: userId, reassignedAt: new Date() } });
        }
        recordsMoved += tasks.length;
      }

      // Nobody reports to someone who is gone.
      await tx.membership.updateMany({ where: { tenantId: auth.tenantId, reportingManagerId: userId }, data: { reportingManagerId: null } });
      const invitations = await tx.invitation.deleteMany({ where: { tenantId: auth.tenantId, email: target.email } });
      const sessions = await tx.session.updateMany({ where: { userId, activeTenantId: auth.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.teamMember.deleteMany({ where: { membershipId: target.id } });
      await tx.membership.delete({ where: { id: target.id } });

      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'member.removed', entityType: 'membership', entityId: target.id,
        metadata: { userId, email: target.email, name: target.name, role: target.roleKey, handoverToId: receiver?.userId ?? null, records: impact.records, invitationsDeleted: invitations.count, sessionsEnded: sessions.count },
        meta,
      });
      return { name: target.name, email: target.email, handoverTo: receiver?.name ?? null, recordsMoved, invitationsDeleted: invitations.count, sessionsEnded: sessions.count };
    });
  }

  private async target(tx: TenantTx, auth: AuthContext, membershipId: string, scope: Scope | null) {
    const m = await tx.membership.findFirst({
      where: { id: membershipId, tenantId: auth.tenantId },
      include: { user: { select: { name: true, email: true } }, role: true },
    });
    if (!m) throw notFound();
    if (scope && !scope.targets.has(m.workspaceNodeId ?? '')) throw notFound();
    if (m.userId === auth.userId) {
      throw new BadRequestException({ code: 'CANNOT_REMOVE_SELF', message: 'You cannot remove yourself. Ask another owner to do it.' });
    }
    if (m.role.key === 'owner') {
      if (auth.roleKey !== 'owner') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only an owner can remove an owner.' });
      const owners = await tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE', role: { key: 'owner' } } });
      const counted = m.status === 'ACTIVE' ? 1 : 0;
      if (owners - counted < 1) throw new BadRequestException({ code: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' });
    }
    // Nobody removes someone who holds access they do not have themselves.
    if (auth.roleKey !== 'owner') assertCanGrant(auth, m.role.permissions);
    return { id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, roleKey: m.role.key, roleName: m.role.name };
  }

  private async impactOf(tx: TenantTx, auth: AuthContext, target: { id: string; userId: string; name: string; email: string; roleName: string }, scope: Scope | null): Promise<MemberRemovalImpact> {
    const t = auth.tenantId;
    const owned = { tenantId: t, ownerId: target.userId };
    const live = { ...owned, ...NOT_DELETED };
    const [companies, contacts, leads, deals, rfqs, contracts, openTasks, invitations, others] = await Promise.all([
      tx.company.count({ where: live }),
      tx.contact.count({ where: live }),
      tx.lead.count({ where: live }),
      tx.opportunity.count({ where: live }),
      tx.rfq.count({ where: live }),
      tx.contract.count({ where: owned }),
      tx.task.count({ where: { tenantId: t, status: 'OPEN', assigneeId: target.userId, ...NOT_DELETED } }),
      tx.invitation.count({ where: { tenantId: t, email: target.email } }),
      tx.membership.findMany({
        where: { tenantId: t, status: 'ACTIVE', NOT: { userId: target.userId } },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const records = { companies, contacts, leads, deals, rfqs, contracts, openTasks };
    const options = others.filter((o) => !scope || scope.receivers.has(o.workspaceNodeId ?? ''));
    // The remover first: handing records to yourself is the usual choice.
    options.sort((a, b) => (a.userId === auth.userId ? -1 : b.userId === auth.userId ? 1 : 0));
    return {
      membershipId: target.id,
      userId: target.userId,
      name: target.name,
      email: target.email,
      roleName: target.roleName,
      records,
      invitations,
      handoverOptions: options.map((o) => ({ userId: o.userId, name: o.user.name, email: o.user.email })),
      handoverRequired: Object.values(records).some((n) => n > 0),
    };
  }

  /** Super Workspace people may remove anyone; someone in a lower workspace only the people in workspaces below theirs. */
  private async scopeOf(tx: TenantTx, auth: AuthContext): Promise<Scope | null> {
    if (!auth.workspaceNodeId) return null;
    const org = await resolveOrganisation(tx, auth.tenantId);
    const mine = org.byId.get(auth.workspaceNodeId);
    if (!mine || mine === org.root) return null;
    const branch = branchIds([...org.byId.values()].map((a) => a.node), mine.node.id);
    const below = new Set([...branch].filter((id) => id !== mine.node.id));
    return { targets: below, receivers: branch };
  }
}
