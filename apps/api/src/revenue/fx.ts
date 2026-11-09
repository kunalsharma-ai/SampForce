import type { TenantTx } from '@dealflow/database';
import type { RateTable } from '@dealflow/types';

/** Latest manually entered rate per currency on or before `asOf` (default today), into the workspace currency. */
export async function loadRates(tx: TenantTx, tenantId: string, asOf = new Date()): Promise<RateTable> {
  const rows = await tx.exchangeRate.findMany({
    where: { tenantId, effectiveDate: { lte: asOf } },
    orderBy: [{ currency: 'asc' }, { effectiveDate: 'desc' }],
    distinct: ['currency'],
    select: { currency: true, rate: true },
  });
  return new Map(rows.map((r) => [r.currency, Number(r.rate)]));
}
