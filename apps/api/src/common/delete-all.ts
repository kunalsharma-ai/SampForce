import { BadRequestException, ConflictException } from '@nestjs/common';
import type { BulkActionResult, DeleteAllInput, z } from '@dealflow/types';
import type { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from './auth-context';
import type { PrismaService } from './prisma.service';

/** How many records are deleted at the same time. */
const CONCURRENCY = 8;

/** Parses a list's own query (as sent by its screen) with that list's schema, or answers 400 naming the bad field. */
export function parseListQuery<S extends z.ZodTypeAny>(schema: S, raw: Record<string, string>): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request contains invalid fields.',
      details: parsed.error.issues.map((i) => ({ path: `query.${i.path.join('.')}`, message: i.message })),
    });
  }
  return parsed.data as z.output<S>;
}

/** Every id from a paged list, page after page until a short one. */
export async function allPages(page: (n: number) => Promise<{ items: { id: string }[]; pageSize: number }>): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 1; ; n++) {
    const { items, pageSize } = await page(n);
    ids.push(...items.map((r) => r.id));
    if (items.length < pageSize) break;
  }
  return [...new Set(ids)];
}

/**
 * Deletes every record a list shows (ADR 0096): the ids are found first, then each record goes through the list's own
 * single delete, so its rules, side effects and audit entry are the same as deleting it by hand. If the list no longer
 * has the count the person saw, nothing is deleted. A record that cannot be deleted is reported, not hidden.
 */
export async function deleteAllMatching(
  deps: { prisma: PrismaService; audit: AuditService },
  auth: AuthContext,
  meta: RequestMeta,
  entityType: string,
  input: DeleteAllInput,
  ids: string[],
  remove: (id: string) => Promise<unknown>,
): Promise<BulkActionResult> {
  if (ids.length !== input.expected) {
    throw new ConflictException({
      code: 'SELECTION_CHANGED',
      message: `The list changed: it now has ${ids.length.toLocaleString('en-US')} records, not ${input.expected.toLocaleString('en-US')}. Check it and try again.`,
      details: [{ path: 'expected', message: String(ids.length) }],
    });
  }
  const result: BulkActionResult = { updated: 0, failed: [] };
  const one = async (id: string) => {
    try {
      await remove(id);
      result.updated += 1;
    } catch (e) {
      const body = (e as { getResponse?: () => unknown }).getResponse?.() as { message?: string } | undefined;
      result.failed.push({ id, message: body?.message ?? 'Could not delete this record.' });
    }
  };
  for (let i = 0; i < ids.length; i += CONCURRENCY) await Promise.all(ids.slice(i, i + CONCURRENCY).map(one));
  await deps.prisma.run(auth, (tx) =>
    deps.audit.record(tx, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: 'records.bulk_delete', entityType,
      metadata: { matched: ids.length, updated: result.updated, failed: result.failed.length, query: input.query }, meta,
    }),
  );
  return result;
}
