import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { RoleInput, RoleRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { entitlementsFor, planLimit } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';

/**
 * Workspace-defined roles. The five system roles cannot be changed; custom roles need a plan with
 * the custom_roles plan feature, and nobody can hand out a permission they do not hold themselves.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<RoleRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.role.findMany({
        where: { tenantId: auth.tenantId },
        include: { _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } },
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      });
      return rows.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, isSystem: r.isSystem, members: r._count.memberships }));
    });
  }

  create(auth: AuthContext, input: RoleInput, meta: RequestMeta): Promise<RoleRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.assertAllowed(tx, auth, input.permissions);
      const base = `custom-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'role'}`;
      let key = base;
      for (let i = 2; await tx.role.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key } } }); i++) key = `${base}-${i}`;
      const row = await tx.role.create({ data: { tenantId: auth.tenantId, key, name: input.name, description: input.description ?? null, permissions: [...new Set(input.permissions)], isSystem: false } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'role.created', entityType: 'role', entityId: row.id, metadata: { key, permissions: row.permissions }, meta });
      return { id: row.id, key, name: row.name, description: row.description, permissions: row.permissions, isSystem: false, members: 0 };
    });
  }

  update(auth: AuthContext, id: string, input: RoleInput, meta: RequestMeta): Promise<RoleRow> {
    return this.prisma.run(auth, async (tx) => {
      const role = await this.customRole(tx, auth, id);
      await this.assertAllowed(tx, auth, input.permissions);
      const row = await tx.role.update({ where: { id: role.id }, data: { name: input.name, description: input.description ?? null, permissions: [...new Set(input.permissions)] } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'role.updated', entityType: 'role', entityId: id,
        metadata: { added: row.permissions.filter((p) => !role.permissions.includes(p)), removed: role.permissions.filter((p) => !row.permissions.includes(p)) }, meta,
      });
      const members = await tx.membership.count({ where: { roleId: id, status: 'ACTIVE' } });
      return { id, key: row.key, name: row.name, description: row.description, permissions: row.permissions, isSystem: false, members };
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const role = await this.customRole(tx, auth, id);
      const [members, invites] = await Promise.all([
        tx.membership.count({ where: { roleId: id } }),
        tx.invitation.count({ where: { roleId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
      ]);
      if (members || invites) throw new ConflictException({ code: 'ROLE_IN_USE', message: 'Move members and pending invitations to another role before deleting this one.' });
      await tx.invitation.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'role.deleted', entityType: 'role', entityId: id, metadata: { key: role.key }, meta });
    });
  }

  private async customRole(tx: TenantTx, auth: AuthContext, id: string) {
    const role = await tx.role.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found.' });
    if (role.isSystem) throw new BadRequestException({ code: 'SYSTEM_ROLE', message: 'System roles cannot be changed. Create a custom role instead.' });
    return role;
  }

  private async assertAllowed(tx: TenantTx, auth: AuthContext, permissions: string[]) {
    if (!(await entitlementsFor(tx, auth.tenantId)).features.includes('custom_roles')) throw planLimit('Custom roles are not included in your plan.');
    assertCanGrant(auth, permissions);
  }
}

/** Nobody may give out access they do not have; owners hold every permission. */
export function assertCanGrant(auth: AuthContext, permissions: string[]): void {
  const missing = permissions.filter((p) => !auth.permissions.includes(p));
  if (missing.length) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot grant permissions your own role does not have.', details: missing.map((p) => ({ path: 'permissions', message: p })) });
  }
}
