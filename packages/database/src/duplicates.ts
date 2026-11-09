import { Prisma } from '@prisma/client';

/**
 * Thrown when a write raced another transaction on a unique key that the caller meant to skip quietly. The
 * transaction is aborted by then (MongoDB aborts a transaction on any write error), so withDbContext retries it;
 * on the retry the duplicate is found first and skipped.
 */
export class RetryableDuplicateError extends Error {
  constructor() {
    super('duplicate key race; retrying the transaction');
    this.name = 'RetryableDuplicateError';
  }
}

const UNIQUES = new Map<string, string[][]>();
for (const m of Prisma.dmmf.datamodel.models) {
  const sets: string[][] = [];
  for (const f of m.fields) if (f.isId || f.isUnique) sets.push([f.name]);
  for (const u of m.uniqueIndexes) sets.push([...u.fields]);
  UNIQUES.set(m.name, sets);
}

interface Delegate {
  findFirst(args: { where: Record<string, unknown>; select: Record<string, true> }): Promise<unknown>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
}

/**
 * `createMany({ skipDuplicates: true })` for MongoDB, where Prisma does not support it. Rows that would break a
 * unique key (an existing document or an earlier row of the same batch) are left out. As on PostgreSQL, a unique key
 * with a null in it never counts as a duplicate.
 */
export async function createManySkipDuplicates(
  delegate: unknown,
  model: Prisma.ModelName,
  rows: Array<Record<string, unknown>>,
): Promise<{ count: number }> {
  const d = delegate as Delegate;
  const sets = UNIQUES.get(model) ?? [];
  const seen = new Set<string>();
  const keep: Record<string, unknown>[] = [];
  rows: for (const row of rows) {
    for (const fields of sets) {
      if (fields.some((f) => row[f] === undefined || row[f] === null)) continue;
      const key = `${fields.join(',')}=${fields.map((f) => String(row[f] instanceof Date ? (row[f] as Date).toISOString() : row[f])).join('\u0000')}`;
      if (seen.has(key)) continue rows;
      const where = Object.fromEntries(fields.map((f) => [f, row[f]]));
      if (await d.findFirst({ where, select: { [fields[0]!]: true } })) continue rows;
      seen.add(key);
    }
    keep.push(row);
  }
  if (keep.length === 0) return { count: 0 };
  try {
    return await d.createMany({ data: keep });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new RetryableDuplicateError();
    throw err;
  }
}
