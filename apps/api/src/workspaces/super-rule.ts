import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma.service';

/**
 * One person, one Super Workspace (workspace management, section 17). Someone who already owns the Super Workspace
 * of a company cannot become the owner of another company's Super Workspace, unless the Console explicitly allowed
 * it on that company's administrator invitation. Inside a company nobody can create a Super Workspace at all: only
 * Manager and Executive Workspaces (WorkspacesService refuses the level).
 */

/** The companies, other than `exceptTenantId`, whose Super Workspace this person owns (live or closing, not erased). */
export async function superWorkspacesOwnedBy(prisma: PrismaService, userId: string, exceptTenantId?: string): Promise<{ tenantId: string; name: string }[]> {
  return prisma.run({ system: true }, async (tx) => {
    const rows = await tx.membership.findMany({
      where: { userId, status: 'ACTIVE', role: { key: 'owner' }, tenant: { deletedAt: null, OR: [{ erasedAt: null }, { erasedAt: { isSet: false } }] }, ...(exceptTenantId ? { tenantId: { not: exceptTenantId } } : {}) },
      select: { tenantId: true, workspaceNodeId: true, tenant: { select: { name: true } } },
    });
    const out: { tenantId: string; name: string }[] = [];
    for (const r of rows) {
      // An owner without a workspace sits in the Super Workspace; an owner placed in a stored node counts only if it is the Super one.
      const inSuper = !r.workspaceNodeId || (await tx.workspaceNode.count({ where: { tenantId: r.tenantId, id: r.workspaceNodeId, level: 'SUPER' } })) > 0;
      if (inSuper) out.push({ tenantId: r.tenantId, name: r.tenant.name });
    }
    return out;
  });
}

/** For the Console: refuses an administrator email that already owns a Super Workspace, unless another one is allowed. */
export async function assertSuperAllowedForEmail(prisma: PrismaService, email: string, allowAnother: boolean | undefined, exceptTenantId?: string): Promise<{ owns: string[] }> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const owned = user ? await superWorkspacesOwnedBy(prisma, user.id, exceptTenantId) : [];
  if (owned.length && !allowAnother) {
    throw new ConflictException({
      code: 'SUPER_WORKSPACE_LIMIT',
      message: `${email} already owns the Super Workspace of ${owned[0]!.name}. One person owns one Super Workspace: tick “Allow another Super Workspace” to let them own this one too.`,
      details: [{ path: 'administrator.email', message: owned.map((o) => o.name).join(', ') }],
    });
  }
  return { owns: owned.map((o) => o.name) };
}

/** At acceptance: the person owns a Super Workspace elsewhere and the Console did not allow another. */
export function superWorkspaceRefused(company: string): ForbiddenException {
  return new ForbiddenException({
    code: 'SUPER_WORKSPACE_LIMIT',
    message: `You already own the Super Workspace of ${company}. One person owns one Super Workspace; SampForce support can allow another.`,
  });
}
