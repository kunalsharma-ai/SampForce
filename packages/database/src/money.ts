/**
 * Fields that were NUMERIC(p, s) on PostgreSQL and are stored as doubles on MongoDB (Prisma's MongoDB connector has
 * no decimal type). PostgreSQL rounded every write to the column's scale; the client extension in scope.ts does the
 * same on every write of these fields, so stored values keep at most that many decimals (ADR 0058).
 */
export const DECIMAL_SCALE: Record<string, Record<string, number>> = {
  Lead: { estimatedValue: 2 },
  Opportunity: { amount: 2 },
  CommercialSettings: { discountApprovalThreshold: 2 },
  PriceBookEntry: { unitPrice: 2 },
  TaxRate: { rate: 3 },
  Quote: { subtotal: 2, discountTotal: 2, taxTotal: 2, total: 2, maxDiscountPercent: 2 },
  QuoteLine: { quantity: 2, unitPrice: 2, discountPercent: 2, taxPercent: 3, netTotal: 2, taxTotal: 2 },
  Contract: { value: 2 },
  Campaign: { budget: 2 },
  ExchangeRate: { rate: 8 },
  SalesTarget: { amount: 2 },
  VoiceNote: { durationSeconds: 2 },
  GamificationBadge: { threshold: 2 },
  GamificationAward: { value: 2 },
  GamificationCompetition: { goal: 2 },
  QuotePayment: { amount: 2 },
};

/** Rounds half away from zero to `scale` decimals, as PostgreSQL rounds NUMERIC. */
export function roundTo(value: number, scale: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** scale;
  const r = Math.round(Math.abs(value) * f + Number.EPSILON * f) / f;
  return value < 0 ? -r : r;
}

/** Rounds a money amount to cents. */
export const roundMoney = (value: number): number => roundTo(value, 2);

function toNumber(v: unknown): unknown {
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (v && typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') return (v as { toNumber(): number }).toNumber();
  return v;
}

/** Rounds the decimal fields of one write's `data` (a row, a list of rows, or field update operations). */
export function roundDecimals(model: string, data: unknown): unknown {
  const scales = DECIMAL_SCALE[model];
  if (!scales || !data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((d) => roundDecimals(model, d));
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const [field, scale] of Object.entries(scales)) {
    if (!(field in out)) continue;
    const v = toNumber(out[field]);
    if (typeof v === 'number') out[field] = roundTo(v, scale);
    else if (v && typeof v === 'object') {
      const ops: Record<string, unknown> = { ...(v as Record<string, unknown>) };
      if (typeof toNumber(ops.set) === 'number') ops.set = roundTo(toNumber(ops.set) as number, scale);
      out[field] = ops;
    } else out[field] = v;
  }
  return out;
}
