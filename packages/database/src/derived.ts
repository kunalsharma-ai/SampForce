/**
 * Fields computed from other fields on every write. PostgreSQL computed these inside queries
 * (`right(regexp_replace(phone, '\D', '', 'g'), 10)`); MongoDB cannot match on such an expression with an index,
 * so the database client stores them next to the source field (ADR 0058). Only the client writes them.
 */

/** Last ten digits of a phone number, for duplicate checks (null when it has no digits). */
export function phoneDigitsKey(phone: string | null | undefined): string | null {
  const d = phone?.replace(/\D/g, '') ?? '';
  return d ? d.slice(-10) : null;
}

/** International digits (no + or 00) of a phone written in international form, else null. */
export function phoneIntlKey(phone: string | null | undefined): string | null {
  const t = phone?.trim() ?? '';
  if (!/^(\+|00)/.test(t)) return null;
  const d = t.replace(/^00/, '').replace(/\D/g, '');
  return d || null;
}

import { Prisma } from '@prisma/client';

/**
 * Enum fields people sort by. PostgreSQL sorted an enum by its declaration order (LOW, MEDIUM, HIGH); MongoDB stores
 * the names and would sort them alphabetically. A rank field next to each holds the position, and the client sorts on
 * it instead (see `rankOrderBy`).
 */
export const RANKED_ENUMS: Record<string, Record<string, string>> = {
  Opportunity: { status: 'statusRank', priority: 'priorityRank' },
  Lead: { status: 'statusRank' },
};

const ENUM_ORDER = new Map(Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)]));
const FIELD_ENUM = new Map<string, { enumName: string; default: string | null }>();
for (const m of Prisma.dmmf.datamodel.models) {
  for (const f of m.fields) {
    if (f.kind === 'enum') FIELD_ENUM.set(`${m.name}.${f.name}`, { enumName: f.type, default: typeof f.default === 'string' ? f.default : null });
  }
}

function rankOf(model: string, field: string, value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const meta = FIELD_ENUM.get(`${model}.${field}`);
  const idx = meta ? (ENUM_ORDER.get(meta.enumName) ?? []).indexOf(value) : -1;
  return idx >= 0 ? idx : null;
}

function addRanks(model: string, row: Record<string, unknown>, isCreate: boolean): void {
  const ranked = RANKED_ENUMS[model];
  if (!ranked) return;
  for (const [field, rankField] of Object.entries(ranked)) {
    let v = row[field];
    if (v && typeof v === 'object' && 'set' in (v as object)) v = (v as { set: unknown }).set;
    if (v === undefined && isCreate) v = FIELD_ENUM.get(`${model}.${field}`)?.default ?? null;
    if (v === undefined) continue;
    row[rankField] = rankOf(model, field, v);
  }
}

/** Rewrites `orderBy` entries on ranked enum fields to sort on the rank field. */
export function rankOrderBy(model: string, orderBy: unknown): unknown {
  const ranked = RANKED_ENUMS[model];
  if (!ranked || !orderBy) return orderBy;
  const map = (entry: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(entry).map(([k, v]) => [ranked[k] ?? k, v]));
  return Array.isArray(orderBy) ? orderBy.map((e) => map(e as Record<string, unknown>)) : map(orderBy as Record<string, unknown>);
}

const DERIVED: Record<string, (row: Record<string, unknown>, phone: string | null) => void> = {
  Lead: (row, phone) => {
    row.phoneDigits = phoneDigitsKey(phone);
  },
  Contact: (row, phone) => {
    row.phoneDigits = phoneDigitsKey(phone);
    row.phoneIntl = phoneIntlKey(phone);
  },
};

function phoneValue(v: unknown): { present: boolean; value: string | null } {
  if (v === undefined) return { present: false, value: null };
  if (v === null || typeof v === 'string') return { present: true, value: v };
  if (typeof v === 'object' && v && 'set' in v) {
    const s = (v as { set: unknown }).set;
    return { present: true, value: typeof s === 'string' ? s : null };
  }
  return { present: false, value: null };
}

/** Adds the derived fields to a create or update `data` (one row or a list). */
export function withDerivedFields(model: string, data: unknown, isCreate = false): unknown {
  const derive = DERIVED[model];
  if ((!derive && !RANKED_ENUMS[model]) || !data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((d) => withDerivedFields(model, d, isCreate));
  const row = { ...(data as Record<string, unknown>) };
  const p = phoneValue(row.phone);
  if (derive && p.present) derive(row, p.value);
  addRanks(model, row, isCreate);
  return row;
}
