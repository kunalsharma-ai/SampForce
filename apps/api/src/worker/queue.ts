import type { Prisma, PrismaClient, TenantTx } from '@dealflow/database';

/**
 * Runs a claim query with the narrow `worker_scan` policy enabled, so the worker can see due work
 * across tenants. Only queue tables carry that policy; everything a job then reads or changes runs
 * in that job's own tenant context.
 */
export function claim<T>(prisma: PrismaClient, query: Prisma.Sql): Promise<T[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.worker_scan', 'on', true)`;
    return tx.$queryRaw<T[]>(query);
  });
}

/** Switches an open worker transaction from the cross-tenant scan to one tenant's context. */
export async function enterTenant(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.worker_scan', 'off', true),
                              set_config('app.tenant_id', ${tenantId}, true),
                              set_config('app.user_id', '', true)`;
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 1000);
