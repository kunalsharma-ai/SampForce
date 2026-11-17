import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { MemberOrgInput, MemberRow, TenantDetails, UpdateTenantInput } from '@dealflow/types';
import { reportingTree } from '../crm/visibility';
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
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.membership.findMany({
        where: { tenantId: auth.tenantId },
        include: { user: { select: { name: true, email: true, mfaEnabledAt: true } }, role: true },
        orderBy: { createdAt: 'asc' },
      });
      return toMemberRows(tx, auth.tenantId, rows);
    });
  }

  /**
   * Sets a member's designation, department and reporting manager. A person cannot report to themselves or to
   * someone who (directly or not) reports to them.
   */
  setMemberOrg(auth: AuthContext, membershipId: string, input: MemberOrgInput, meta: RequestMeta): Promise<MemberRow> {
    return this.prisma.run(auth, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: auth.tenantId } });
      if (!m) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Member not found.' });
      const bad = (path: string, message = 'refers to a record that does not exist') =>
        new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path, message }] });
      if (input.designationId && !(await tx.designation.findFirst({ where: { tenantId: auth.tenantId, id: input.designationId, archivedAt: null } }))) throw bad('designationId');
      if (input.departmentId && !(await tx.department.findFirst({ where: { tenantId: auth.tenantId, id: input.departmentId, archivedAt: null } }))) throw bad('departmentId');
      if (input.reportingManagerId) {
        if (input.reportingManagerId === m.userId) throw bad('reportingManagerId', 'a person cannot report to themselves');
        if (!(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: input.reportingManagerId, status: 'ACTIVE' } }))) throw bad('reportingManagerId');
        if ((await reportingTree(tx, auth.tenantId, m.userId)).includes(input.reportingManagerId)) throw bad('reportingManagerId', 'this person already reports to them');
      }
      const updated = await tx.membership.update({
        where: { id: m.id },
        data: {
          ...(input.designationId !== undefined ? { designationId: input.designationId } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.reportingManagerId !== undefined ? { reportingManagerId: input.reportingManagerId } : {}),
        },
        include: { user: { select: { name: true, email: true, mfaEnabledAt: true } }, role: true },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'member.org_changed', entityType: 'membership', entityId: m.id,
        metadata: { userId: m.userId, from: { designationId: m.designationId, departmentId: m.departmentId, reportingManagerId: m.reportingManagerId }, to: input }, meta,
      });
      return (await toMemberRows(tx, auth.tenantId, [updated]))[0]!;
    });
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
        include: { user: { select: { name: true, email: true, mfaEnabledAt: true } }, role: true },
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
      return (await toMemberRows(tx, auth.tenantId, [updated]))[0]!;
    });
  }
}

type MembershipWith = {
  id: string; userId: string; createdAt: Date; status: 'ACTIVE' | 'SUSPENDED'; externalId: string | null;
  designationId: string | null; departmentId: string | null; reportingManagerId: string | null;
  user: { name: string; email: string; mfaEnabledAt: Date | null };
  role: { key: string; name: string };
};

async function toMemberRows(tx: TenantTx, tenantId: string, rows: MembershipWith[]): Promise<MemberRow[]> {
  const [designations, departments, managers] = await Promise.all([
    tx.designation.findMany({ where: { tenantId }, select: { id: true, name: true, tier: true } }),
    tx.department.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.reportingManagerId).filter((v): v is string => !!v))] } }, select: { id: true, name: true } }),
  ]);
  const des = new Map(designations.map((d) => [d.id, d]));
  const dep = new Map(departments.map((d) => [d.id, d]));
  const mgr = new Map(managers.map((u) => [u.id, u]));
  return rows.map((m) => {
    const d = m.designationId ? des.get(m.designationId) : undefined;
    return {
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.createdAt.toISOString(),
      status: m.status,
      mfaEnabled: !!m.user.mfaEnabledAt,
      provisioned: !!m.externalId,
      designation: d ? { id: d.id, name: d.name, tier: d.tier as 'EXECUTIVE' | 'MANAGER' | 'SENIOR' } : null,
      department: m.departmentId && dep.has(m.departmentId) ? dep.get(m.departmentId)! : null,
      reportingManager: m.reportingManagerId && mgr.has(m.reportingManagerId) ? mgr.get(m.reportingManagerId)! : null,
    };
  });
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
