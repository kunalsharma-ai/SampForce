import { Prisma, PrismaClient } from '@prisma/client';

export type TenantTx = Prisma.TransactionClient;

export interface DbContext {
  /** Tenant whose rows are visible inside the transaction. */
  tenantId?: string | null;
  /** Authenticated user, used by policies that let users see their own memberships. */
  userId?: string | null;
}

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}

/**
 * Runs `fn` inside a transaction with the row-level-security context set.
 *
 * `set_config(..., true)` scopes the settings to the transaction, so a pooled connection
 * can never leak one tenant's context into another request. Every tenant-scoped query in
 * the API must go through this helper; the database role used at runtime has no BYPASSRLS,
 * so a query issued outside it simply sees no tenant rows.
 */
export async function withDbContext<T>(
  prisma: PrismaClient,
  ctx: DbContext,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                                  set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 10_000 },
  );
}
