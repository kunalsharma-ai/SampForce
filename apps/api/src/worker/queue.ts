import { withDbScope } from '@dealflow/database';
import type { PrismaService } from '../common/prisma.service';

/**
 * Background work on MongoDB (ADR 0058, replacing the PostgreSQL `FOR UPDATE SKIP LOCKED` claims of ADR 0007).
 *
 * The worker finds due documents across workspaces in a `workerScan` context, which the workspace guard only allows
 * on the queue collections. A claim is then one conditional update per candidate: it matches only while the
 * document is still due and writes the lease (a later `nextRunAt`, `lockedUntil`, or a new status), so when several
 * workers race for the same document exactly one update matches. Everything a job then reads or changes runs in that
 * job's own workspace context.
 */

/** Runs `fn` with the worker's cross-workspace read of the queue collections. */
export function scan<T>(fn: () => Promise<T>): Promise<T> {
  return withDbScope({ workerScan: true }, fn);
}

type Where = Record<string, unknown>;

/** Any Prisma model delegate; the arguments are checked by Prisma at run time. */
interface ClaimDelegate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany(args: any): Promise<unknown[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMany(args: any): Promise<{ count: number }>;
}

/**
 * Claims up to `limit` due documents. `where` says what is due, `lease` what claiming writes (it must make the
 * document no longer match `where`), `select` what the caller needs back (the values before the lease).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function claimDue<Row extends { id: string } = { id: string } & Record<string, any>>(
  delegate: ClaimDelegate,
  opts: { where: Where; lease: Record<string, unknown>; select: Record<string, true>; orderBy?: unknown; limit: number },
): Promise<Row[]> {
  return scan(async () => {
    const candidates = (await delegate.findMany({
      where: opts.where,
      orderBy: opts.orderBy,
      take: opts.limit,
      select: { id: true, ...opts.select },
    })) as Row[];
    const claimed: Row[] = [];
    for (const c of candidates) {
      const hit = await delegate.updateMany({ where: { AND: [{ id: c.id }, opts.where] }, data: opts.lease });
      if (hit.count === 1) claimed.push(c);
    }
    return claimed;
  });
}

/** Distinct workspace ids of the documents matching `where` in a queue collection (read-only scans). */
export async function scanTenants(
  delegate: ClaimDelegate,
  where: Where,
  take = 1000,
): Promise<string[]> {
  const rows = (await scan(() => delegate.findMany({ where, select: { tenantId: true }, distinct: ['tenantId'], take }))) as Array<{ tenantId: string }>;
  return rows.map((r) => r.tenantId);
}

export type WorkerPrisma = PrismaService;

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 1000);
