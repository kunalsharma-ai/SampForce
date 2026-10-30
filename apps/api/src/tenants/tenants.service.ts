import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MemberRow, TenantDetails, UpdateTenantInput } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertCanGrant } from './roles.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current(auth: AuthContext): Promise<TenantDetails> {
    const t = await this.prisma.run(auth, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } }));
    return toDetails(t);
  }

  async update(auth: AuthContext, input: UpdateTenantInput, meta: RequestMeta): Promise<TenantDetails> {
    if (input.defaultTimezone && !isValidTimeZone(input.defaultTimezone)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Unknown time zone.' });
    }
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      const after = await tx.tenant.update({ where: { id: auth.tenantId }, data: input });
      const changes = Object.fromEntries(
        Object.keys(input).map((k) => [k, { from: before[k as keyof typeof before], to: after[k as keyof typeof after] }]),
      );
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'tenant.updated',
        entityType: 'tenant',
        entityId: auth.tenantId,
        metadata: { changes },
        meta,
      });
      return toDetails(after);
    });
  }

  async members(auth: AuthContext): Promise<MemberRow[]> {
    const rows = await this.prisma.run(auth, (tx) =>
      tx.membership.findMany({
        where: { tenantId: auth.tenantId },
        include: { user: { select: { name: true, email: true } }, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async changeMemberRole(auth: AuthContext, membershipId: string, roleKey: string, meta: RequestMeta): Promise<MemberRow> {
    return this.prisma.run(auth, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: auth.tenantId },
        include: { role: true },
      });
      if (!membership) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Member not found.' });
      const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key: roleKey } } });
      if (!role) throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: 'That role does not exist.' });

      if (auth.roleKey !== 'owner') assertCanGrant(auth, role.permissions);
      const touchesOwner = role.key === 'owner' || membership.role.key === 'owner';
      if (touchesOwner && auth.roleKey !== 'owner') {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only an owner can grant or remove the owner role.' });
      }
      if (membership.role.key === 'owner' && role.key !== 'owner') {
        const owners = await tx.membership.count({
          where: { tenantId: auth.tenantId, status: 'ACTIVE', role: { key: 'owner' } },
        });
        if (owners <= 1) {
          throw new BadRequestException({ code: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' });
        }
      }

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { roleId: role.id },
        include: { user: { select: { name: true, email: true } }, role: true },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'member.role_changed',
        entityType: 'membership',
        entityId: membership.id,
        metadata: { from: membership.role.key, to: role.key, userId: membership.userId },
        meta,
      });
      return {
        membershipId: updated.id,
        userId: updated.userId,
        name: updated.user.name,
        email: updated.user.email,
        roleKey: updated.role.key,
        roleName: updated.role.name,
        joinedAt: updated.createdAt.toISOString(),
      };
    });
  }
}

function toDetails(t: {
  id: string;
  name: string;
  slug: string;
  brandColor: string | null;
  defaultCurrency: string;
  defaultTimezone: string;
  defaultLocale: string;
  isDemo: boolean;
  createdAt: Date;
}): TenantDetails {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    brandColor: t.brandColor,
    defaultCurrency: t.defaultCurrency,
    defaultTimezone: t.defaultTimezone,
    defaultLocale: t.defaultLocale,
    isDemo: t.isDemo,
    createdAt: t.createdAt.toISOString(),
  };
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
