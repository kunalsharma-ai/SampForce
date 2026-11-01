import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { type ListQuery, type OwnerRef, parseSortParam } from '@dealflow/types';

export function notFound(entity: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message: `${entity} not found.` });
}

export function badRef(field: string, message = 'refers to a record that does not exist'): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request contains invalid fields.',
    details: [{ path: field, message }],
  });
}

export function paging(q: Pick<ListQuery, 'page' | 'pageSize'>) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

/**
 * Prisma ordering from the list query. `sort` is one field (direction from `order`) or up to three comma-separated
 * fields, each prefixed with "-" for descending ("status,-createdAt"). Unknown fields are ignored; the id is always
 * the final tie-breaker so pages are stable.
 */
export function orderBy<T extends string>(q: Pick<ListQuery, 'sort' | 'order'>, allowed: readonly T[], fallback: T, nullable: readonly T[] = []) {
  const keys = parseSortParam(q.sort, q.order).filter((k) => (allowed as readonly string[]).includes(k.field));
  const unique = keys.filter((k, i) => keys.findIndex((x) => x.field === k.field) === i);
  const list = unique.length ? unique : [{ field: fallback, desc: q.order === 'desc' }];
  const last = list[list.length - 1]!;
  // Empty values sort last in both directions for nullable columns, so "highest priority first" starts with real values.
  const dir = (k: { field: string; desc: boolean }) =>
    (nullable as readonly string[]).includes(k.field) ? { sort: k.desc ? 'desc' : 'asc', nulls: 'last' } : k.desc ? 'desc' : 'asc';
  return [...list.map((k) => ({ [k.field]: dir(k) })), { id: last.desc ? 'desc' : 'asc' }] as Record<string, 'asc' | 'desc'>[];
}

/** Resolves user ids to display names. Users are global, so this never reveals tenant data. */
export async function ownerRefs(tx: TenantTx, ids: (string | null | undefined)[]): Promise<Map<string, OwnerRef>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u]));
}

export interface RefCheck {
  ownerId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  parentCompanyId?: string | null;
}

/**
 * Validates that referenced ids belong to the current tenant. Foreign keys alone are not enough:
 * referential checks bypass row-level security, so without this a request could link a record to
 * another tenant's row id. Lookups run under RLS, so foreign rows are simply "not found".
 */
export async function assertRefs(tx: TenantTx, tenantId: string, refs: RefCheck, fieldPrefix = ''): Promise<void> {
  const checks: Promise<void>[] = [];
  const check = (field: string, run: () => Promise<unknown>) =>
    checks.push(
      run().then((row) => {
        if (!row) throw badRef(fieldPrefix + field);
      }),
    );
  if (refs.ownerId)
    check('ownerId', () =>
      tx.membership.findFirst({ where: { tenantId, userId: refs.ownerId!, status: 'ACTIVE' }, select: { id: true } }),
    );
  if (refs.companyId)
    check('companyId', () => tx.company.findFirst({ where: { id: refs.companyId!, tenantId, deletedAt: null }, select: { id: true } }));
  if (refs.parentCompanyId)
    check('parentCompanyId', () =>
      tx.company.findFirst({ where: { id: refs.parentCompanyId!, tenantId, deletedAt: null }, select: { id: true } }),
    );
  if (refs.contactId)
    check('contactId', () => tx.contact.findFirst({ where: { id: refs.contactId!, tenantId, deletedAt: null }, select: { id: true } }));
  if (refs.leadId)
    check('leadId', () => tx.lead.findFirst({ where: { id: refs.leadId!, tenantId, deletedAt: null }, select: { id: true } }));
  if (refs.opportunityId)
    check('opportunityId', () =>
      tx.opportunity.findFirst({ where: { id: refs.opportunityId!, tenantId, deletedAt: null }, select: { id: true } }),
    );
  await Promise.all(checks);
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const num = (d: { toNumber(): number } | null | undefined): number | null => (d ? d.toNumber() : null);

/** Returns only the keys whose values changed, for audit metadata. */
export function diff(before: Record<string, unknown>, input: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    const prev = before[k] as unknown;
    const prevNorm = prev && typeof prev === 'object' && 'toNumber' in (prev as object) ? (prev as { toNumber(): number }).toNumber() : prev instanceof Date ? prev.toISOString() : prev;
    if (JSON.stringify(prevNorm) !== JSON.stringify(v)) out[k] = { from: prevNorm ?? null, to: v };
  }
  return out;
}

/** Consent columns for a change of marketing consent; UNKNOWN or no value records nothing. */
export function consentFields(consent: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT' | undefined, source: string) {
  if (!consent || consent === 'UNKNOWN') return {};
  return { marketingConsent: consent, consentSource: source, consentUpdatedAt: new Date() };
}

/** Campaign references must belong to the tenant, like other references (see assertRefs). */
export async function assertCampaign(tx: TenantTx, tenantId: string, campaignId: string | null | undefined): Promise<void> {
  if (!campaignId) return;
  const row = await tx.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { id: true } });
  if (!row) throw badRef('campaignId');
}

/** Appends to a deal's stage history (flow and replay views). Call on create and whenever the stage changes. */
export async function recordStageEvent(
  tx: TenantTx,
  e: { tenantId: string; opportunityId: string; pipelineId: string; fromStageId: string | null; toStageId: string; actorUserId: string | null; at?: Date },
): Promise<void> {
  await tx.dealStageEvent.create({
    data: {
      tenantId: e.tenantId, opportunityId: e.opportunityId, pipelineId: e.pipelineId, fromStageId: e.fromStageId,
      toStageId: e.toStageId, actorUserId: e.actorUserId, ...(e.at ? { occurredAt: e.at } : {}),
    },
  });
}
