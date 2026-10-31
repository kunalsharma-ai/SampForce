import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { TeamInput, TeamRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';

/** Sales teams: named groups of active members, used by team leaderboards and team challenges. */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<TeamRow[]> {
    return this.prisma.run(auth, (tx) => this.rows(tx, auth.tenantId));
  }

  create(auth: AuthContext, input: TeamInput, meta: RequestMeta): Promise<TeamRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.assertName(tx, auth.tenantId, input.name);
      const memberships = await this.memberships(tx, auth.tenantId, input.memberUserIds);
      const team = await tx.team.create({ data: { tenantId: auth.tenantId, name: input.name, description: input.description ?? null } });
      if (memberships.length) await tx.teamMember.createMany({ data: memberships.map((m) => ({ tenantId: auth.tenantId, teamId: team.id, membershipId: m.id })) });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'team.created', entityType: 'team', entityId: team.id, metadata: { name: input.name, members: input.memberUserIds.length }, meta });
      return (await this.rows(tx, auth.tenantId, team.id))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: TeamInput, meta: RequestMeta): Promise<TeamRow> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await tx.team.findFirst({ where: { id, tenantId: auth.tenantId } }))) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found.' });
      await this.assertName(tx, auth.tenantId, input.name, id);
      const memberships = await this.memberships(tx, auth.tenantId, input.memberUserIds);
      await tx.team.update({ where: { id }, data: { name: input.name, description: input.description ?? null } });
      await tx.teamMember.deleteMany({ where: { teamId: id } });
      if (memberships.length) await tx.teamMember.createMany({ data: memberships.map((m) => ({ tenantId: auth.tenantId, teamId: id, membershipId: m.id })) });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'team.updated', entityType: 'team', entityId: id, metadata: { name: input.name, members: input.memberUserIds.length }, meta });
      return (await this.rows(tx, auth.tenantId, id))[0]!;
    });
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const team = await tx.team.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!team) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found.' });
      await tx.team.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'team.deleted', entityType: 'team', entityId: id, metadata: { name: team.name }, meta });
    });
  }

  private async assertName(tx: TenantTx, tenantId: string, name: string, exceptId?: string) {
    if (await tx.team.findFirst({ where: { tenantId, name, ...(exceptId ? { id: { not: exceptId } } : {}) } })) throw new ConflictException({ code: 'DUPLICATE', message: `There is already a team called "${name}".` });
  }

  private async memberships(tx: TenantTx, tenantId: string, userIds: string[]) {
    const unique = [...new Set(userIds)];
    const rows = await tx.membership.findMany({ where: { tenantId, userId: { in: unique }, status: 'ACTIVE' }, select: { id: true } });
    if (rows.length !== unique.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Every team member must be an active member of this workspace.', details: [{ path: 'memberUserIds', message: 'includes someone who is not an active member' }] });
    return rows;
  }

  private async rows(tx: TenantTx, tenantId: string, id?: string): Promise<TeamRow[]> {
    const teams = await tx.team.findMany({
      where: { tenantId, ...(id ? { id } : {}) },
      orderBy: { name: 'asc' },
      include: { members: { include: { membership: { select: { status: true, user: { select: { id: true, name: true } } } } } } },
    });
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      members: t.members.filter((m) => m.membership.status === 'ACTIVE').map((m) => m.membership.user).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }
}
