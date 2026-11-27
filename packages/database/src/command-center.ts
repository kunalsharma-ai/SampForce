import type { PrismaClient } from '@prisma/client';
import { nextSequenceBlock, withDbContext, type TenantTx } from './client';

/** DEAL-0001: the deal number of a sequence value (ADR 0063). */
export function formatDealNumber(seq: number): string {
  return `DEAL-${String(seq).padStart(4, '0')}`;
}

/**
 * Numbers deals that have no number yet, oldest first, and copies the lead creator from their company. Deal creation
 * numbers its deal at once; this covers deals made before the upgrade and by other paths (imports, seed data).
 */
export async function assignDealNumbers(tx: TenantTx, tenantId: string, limit = 100): Promise<number> {
  const pending = await tx.opportunity.findMany({
    where: { tenantId, OR: [{ dealSeq: null }, { dealSeq: { isSet: false } }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, companyId: true, leadCreatorId: true },
    take: limit,
  });
  if (!pending.length) return 0;
  const companyIds = [...new Set(pending.map((p) => p.companyId).filter((c): c is string => !!c))];
  const creators = new Map(
    (companyIds.length ? await tx.company.findMany({ where: { tenantId, id: { in: companyIds } }, select: { id: true, createdById: true } }) : []).map((c) => [c.id, c.createdById]),
  );
  // One counter write for the batch, and batches small enough to finish well inside a transaction's time limit.
  const first = await nextSequenceBlock(tx, `deal:${tenantId}`, pending.length);
  for (const [i, d] of pending.entries()) {
    const seq = first + i;
    await tx.opportunity.update({
      where: { id: d.id },
      data: { dealSeq: seq, dealNumber: formatDealNumber(seq), ...(!d.leadCreatorId && d.companyId ? { leadCreatorId: creators.get(d.companyId) ?? null } : {}) },
    });
  }
  return pending.length;
}

/** Runs from db:setup for every workspace; idempotent. */
export async function upgradeCommandCenter(prisma: PrismaClient, log: (line: string) => void = () => {}): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const { id: tenantId } of tenants) {
    let numbered = 0;
    for (let n = 1; n > 0; numbered += n) n = await withDbContext(prisma, { system: true }, (tx) => assignDealNumbers(tx, tenantId));
    if (numbered) log(`numbered ${numbered} deals in ${tenantId}`);
  }
}
