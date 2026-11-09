import { Prisma, PrismaClient } from '@prisma/client';
import { RetryableDuplicateError } from './duplicates';
import { currentDbContext, type DbContext, dbContextStorage, workspaceGuard } from './scope';

const ROOT_CLIENT = Symbol('sampforce.rootClient');

export type { DbContext } from './scope';

export type TenantTx = Prisma.TransactionClient;

function makeClient(url?: string) {
  const base = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  return base.$extends(workspaceGuard(base));
}

/** The guarded client type. Its queries follow the workspace rules in scope.ts. */
export type SampforceClient = ReturnType<typeof makeClient>;

/**
 * Creates the guarded client every part of the API uses. Pass `{ system: true }` to `withDbContext` for owner
 * access (scripts and test set-up only).
 */
export function createPrismaClient(url?: string): SampforceClient {
  return makeClient(url);
}

/** Prisma's error for a MongoDB write conflict or transient transaction error, which is safe to retry. */
function isRetryable(err: unknown): boolean {
  if (err instanceof RetryableDuplicateError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === 'P2034';
  const msg = err instanceof Error ? err.message : '';
  return /WriteConflict|TransientTransactionError|write conflict/i.test(msg);
}

const MAX_ATTEMPTS = 12;

/**
 * Runs `fn` inside a MongoDB transaction with the workspace context set.
 *
 * The context lives in AsyncLocalStorage for the duration of `fn`, so every query made through the transaction
 * client (and any helper it calls) is filtered to the context's workspace by the guard in scope.ts. MongoDB does not
 * wait for locks: two transactions writing the same document make one of them fail with a write conflict at once,
 * where PostgreSQL would have queued it. Those transactions are retried with a short random back-off, so callers see
 * the same "eventually one after the other" behaviour as before. `fn` must therefore not have side effects outside
 * the database that cannot run twice.
 */
export async function withDbContext<T>(
  prisma: SampforceClient | PrismaClient,
  ctx: DbContext,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const client = prisma as unknown as PrismaClient;
  for (let attempt = 1; ; attempt++) {
    try {
      return await dbContextStorage.run({ ...ctx, [ROOT_CLIENT]: client } as DbContext, () =>
        client.$transaction((tx) => fn(tx), { timeout: options?.timeoutMs ?? 10_000, maxWait: 10_000 }),
      );
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
      // Exponential back-off with jitter, up to a second: a transaction holding a lock may be waiting on a provider.
      const ceiling = Math.min(1000, 10 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, Math.floor(ceiling / 2 + Math.random() * (ceiling / 2))));
    }
  }
}

/** Runs `fn` with the workspace context set but without a transaction (for long read-only scans). */
export function withDbScope<T>(ctx: DbContext, fn: () => Promise<T>): Promise<T> {
  return dbContextStorage.run({ ...ctx }, fn);
}

async function ensureCounter(id: string): Promise<void> {
  const root = (currentDbContext() as Record<symbol, unknown> | undefined)?.[ROOT_CLIENT] as PrismaClient | undefined;
  if (!root) throw new Error('counters need withDbContext');
  // Outside the transaction on purpose: two transactions creating the same counter would otherwise abort with a
  // duplicate key; created here, the race is harmless.
  const exists = await root.counter.findUnique({ where: { id }, select: { id: true } });
  if (exists) return;
  try {
    await root.counter.create({ data: { id, value: 0 } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  }
}

/**
 * Serialises transactions on `key` until the current one ends (was pg_advisory_xact_lock). Writing the lock
 * document makes a second transaction that writes it fail with a write conflict, and withDbContext retries it
 * after this one commits.
 */
export async function transactionLock(tx: TenantTx, key: string): Promise<void> {
  await ensureCounter(`lock:${key}`);
  await tx.counter.update({ where: { id: `lock:${key}` }, data: { value: { increment: 1 } } });
}

/** The next value of a named sequence, inside the current transaction (was nextval). Starts at 1. */
export async function nextSequenceValue(tx: TenantTx, name: string): Promise<number> {
  await ensureCounter(`seq:${name}`);
  const row = await tx.counter.update({ where: { id: `seq:${name}` }, data: { value: { increment: 1 } } });
  return row.value;
}
