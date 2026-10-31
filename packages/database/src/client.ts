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
 *
 * `plan_cache_mode = force_custom_plan`: Prisma prepares every statement, and after five runs Postgres may
 * switch to a generic plan that ignores the parameter values. Tenant sizes differ by orders of magnitude, so a
 * generic plan estimates one row per tenant and picks nested loops; the Phase 8 load test measured the pipeline
 * replay query going from 30 ms to 20 s that way. Planning per execution costs well under a millisecond here.
 * `jit = off`: report queries with per-row currency lookups get high cost estimates, which trigger JIT
 * compilation; in the same load test JIT took 390 ms of a 410 ms report. These are short OLTP queries.
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
                                  set_config('app.user_id', ${ctx.userId ?? ''}, true),
                                  set_config('plan_cache_mode', 'force_custom_plan', true),
                                  set_config('jit', 'off', true)`;
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 10_000 },
  );
}
