import { type EnrichField, type FieldConfidence, type FieldSource, type FieldSourceKind, LIST_ENRICH_FIELDS } from '@dealflow/types';
import { type Candidate, display, itemKey } from './candidates';

/*
 * Decides what an auto-fill run writes (ADR 0076). Pure, so the rules are tested on their own:
 *  - A field someone typed, changed or cleared (source USER) is never written. A scalar field is written only while
 *    it is empty. A list (emails, offices, services ...) only gets the items it does not have yet, minus items
 *    someone removed or undid before (`rejected`).
 *  - Sources are ranked: the company's structured data, then its pages, then Wikidata, then AI; within one source,
 *    higher confidence first. When another source gives a different value, it is kept as an alternative, and the
 *    value is marked "uncertain" unless the winner is the company's own high-confidence statement.
 *  - The head-office address (street, city, state, postal code) is written as one block from one source, and only
 *    when none of it is filled, so a typed city is never mixed with another office's street.
 */

const RANK: Record<Exclude<FieldSourceKind, 'USER'>, number> = { SCHEMA_ORG: 0, WEBSITE: 1, WIKIDATA: 2, AI: 3 };
const CONF: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 };
const order = (a: Candidate, b: Candidate) => RANK[a.source] - RANK[b.source] || CONF[a.confidence] - CONF[b.confidence];

export type CompanyNow = Record<string, unknown> & { fieldSources: unknown };

export interface StoredFill {
  field: EnrichField;
  /** What was written: the value for a scalar, the added items for a list. */
  value: unknown;
  display: string;
  source: Exclude<FieldSourceKind, 'USER'>;
  url: string | null;
  confidence: FieldConfidence;
  undone: boolean;
}

export interface MergeResult {
  /** Fields to write on the company. */
  data: Record<string, unknown>;
  fills: StoredFill[];
  fieldSources: Record<string, FieldSource>;
}

const HQ_BLOCK = ['address', 'city', 'state', 'postalCode'] as const;
const PRIMARY_OF = { primaryEmail: 'emails', primaryPhone: 'phones', website: 'websites', linkedinUrl: 'linkedinUrls' } as const;

const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const sameValue = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? a.trim().toLowerCase() === b.trim().toLowerCase() : JSON.stringify(a) === JSON.stringify(b));

export function sourcesOf(raw: unknown): Record<string, FieldSource> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, FieldSource>) } : {};
}

export function merge(company: CompanyNow, candidates: Candidate[], runId: string, now: Date): MergeResult {
  const sources = sourcesOf(company.fieldSources);
  const data: Record<string, unknown> = {};
  const fills: StoredFill[] = [];
  const at = now.toISOString();
  const byField = new Map<EnrichField, Candidate[]>();
  for (const c of [...candidates].sort(order)) {
    if (empty(c.value)) continue;
    const list = byField.get(c.field) ?? [];
    list.push(c);
    byField.set(c.field, list);
  }
  const locked = (f: EnrichField) => sources[f]?.source === 'USER';
  const current = (f: string) => (f in data ? data[f] : company[f]);

  // Lists first: they may receive the item a primary field (email, phone) then points at.
  for (const field of LIST_ENRICH_FIELDS) {
    const cands = byField.get(field);
    if (!cands) continue;
    const have = (Array.isArray(company[field]) ? (company[field] as unknown[]) : []).slice();
    const keys = new Set(have.map((i) => itemKey(field, i)));
    const rejected = new Set(sources[field]?.rejected ?? []);
    const added: unknown[] = [];
    let first: Candidate | null = null;
    for (const c of cands) {
      for (const item of c.value as unknown[]) {
        const k = itemKey(field, item);
        if (!k || keys.has(k) || rejected.has(k)) continue;
        keys.add(k);
        added.push(field === 'emails' || field === 'phones' ? { ...(item as object), primary: false } : item);
        first ??= c;
      }
    }
    if (!added.length || !first) continue;
    data[field] = [...have, ...added];
    const prev = sources[field];
    sources[field] = {
      ...(prev ?? {}),
      source: first.source,
      url: first.url,
      at,
      confidence: first.confidence,
      runId,
      items: [...(prev?.items ?? []), ...added.map((i) => itemKey(field, i))],
    };
    fills.push({ field, value: added, display: display(field, added), source: first.source, url: first.url, confidence: first.confidence, undone: false });
  }

  // The head-office block, from one source.
  const blockFree = HQ_BLOCK.every((f) => empty(company[f]) && !locked(f));
  if (blockFree) {
    const lead = [...(byField.get('address') ?? []), ...(byField.get('city') ?? [])].sort(order)[0];
    if (lead) {
      for (const f of HQ_BLOCK) {
        const c = (byField.get(f) ?? []).find((x) => x.source === lead.source && x.url === lead.url);
        if (c) write(f, c, []);
      }
    }
  }

  for (const [field, cands] of byField) {
    if ((LIST_ENRICH_FIELDS as readonly string[]).includes(field) || (HQ_BLOCK as readonly string[]).includes(field)) continue;
    if (locked(field) || !empty(current(field))) continue;
    const winner = cands[0]!;
    write(field, winner, cands.slice(1));
  }

  function write(field: EnrichField, c: Candidate, others: Candidate[]) {
    const alternatives = others.filter((o) => o.source !== c.source && !sameValue(o.value, c.value)).map((o) => ({ value: display(field, o.value), source: o.source, url: o.url }));
    const unique = [...new Map(alternatives.map((a) => [a.value.toLowerCase(), a])).values()];
    const trusted = c.confidence === 'high' && (c.source === 'SCHEMA_ORG' || c.source === 'WEBSITE');
    const confidence: FieldConfidence = unique.length && !trusted ? 'uncertain' : c.confidence;
    data[field] = c.value;
    sources[field] = { source: c.source, url: c.url, at, confidence, runId, ...(unique.length ? { alternatives: unique.slice(0, 5) } : {}) };
    fills.push({ field, value: c.value, display: display(field, c.value), source: c.source, url: c.url, confidence, undone: false });
    // A primary email, phone, website or LinkedIn page is also the primary entry of its list.
    if (field in PRIMARY_OF) {
      const list = PRIMARY_OF[field as keyof typeof PRIMARY_OF];
      const items = ((current(list) as { value: string; label?: string | null; primary?: boolean }[] | undefined) ?? []).map((p) => ({ ...p, primary: false }));
      const i = items.findIndex((p) => p.value.toLowerCase() === String(c.value).toLowerCase());
      if (i >= 0) items[i] = { ...items[i]!, primary: true };
      else items.unshift({ value: String(c.value), label: null, primary: true });
      data[list] = items;
    }
    if (field === 'website') {
      try {
        data.domain = new URL(String(c.value)).hostname.replace(/^www\./, '');
      } catch {
        // The website was checked as a URL already.
      }
    }
  }

  return { data, fills, fieldSources: sources };
}

/**
 * Undoes fills of one run. A scalar is cleared only while it still holds the value the run wrote, and is then marked
 * as cleared by the person (so it is not filled again). List items the run added are removed and remembered as
 * rejected, so they are not added again either.
 */
export function undo(company: CompanyNow, fills: StoredFill[], runId: string, fields: EnrichField[] | undefined, userId: string, now: Date): { data: Record<string, unknown>; fills: StoredFill[]; undone: EnrichField[] } {
  const sources = sourcesOf(company.fieldSources);
  const data: Record<string, unknown> = {};
  const undone: EnrichField[] = [];
  const at = now.toISOString();
  const next = fills.map((f) => ({ ...f }));
  for (const f of next) {
    if (f.undone || (fields && !fields.includes(f.field))) continue;
    const src = sources[f.field];
    if ((LIST_ENRICH_FIELDS as readonly string[]).includes(f.field)) {
      const addedKeys = new Set((f.value as unknown[]).map((i) => itemKey(f.field, i)));
      const list = (Array.isArray(data[f.field]) ? data[f.field] : company[f.field]) as unknown[] | undefined;
      const kept = (list ?? []).filter((i) => !addedKeys.has(itemKey(f.field, i)));
      data[f.field] = kept;
      const rest = (src?.items ?? []).filter((k) => !addedKeys.has(k));
      const rejected = [...new Set([...(src?.rejected ?? []), ...addedKeys])];
      sources[f.field] = { ...(src ?? { source: f.source, url: f.url, confidence: f.confidence }), at: src?.at ?? at, runId: src?.runId ?? runId, items: rest, rejected } as FieldSource;
      if (f.field === 'emails' || f.field === 'phones') repairPrimary(f.field === 'emails' ? 'primaryEmail' : 'primaryPhone', kept as { value: string; primary?: boolean }[], company, data);
    } else {
      if (src?.runId !== runId || !sameValue(company[f.field], f.value)) {
        f.undone = true;
        continue;
      }
      data[f.field] = null;
      sources[f.field] = { source: 'USER', url: null, at, confidence: 'high', runId: null, byUserId: userId };
      if (f.field in PRIMARY_OF) {
        const list = PRIMARY_OF[f.field as keyof typeof PRIMARY_OF];
        const items = ((data[list] ?? company[list]) as { value: string; primary?: boolean }[] | undefined) ?? [];
        data[list] = items.filter((p) => p.value.toLowerCase() !== String(f.value).toLowerCase());
      }
      if (f.field === 'website') data.domain = null;
    }
    f.undone = true;
    undone.push(f.field);
  }
  data.fieldSources = sources;
  return { data, fills: next, undone };
}

/** After items are removed, the primary field points at a remaining item (or nothing). */
function repairPrimary(field: 'primaryEmail' | 'primaryPhone', kept: { value: string; primary?: boolean }[], company: CompanyNow, data: Record<string, unknown>) {
  const primary = String(company[field] ?? '');
  if (!primary || kept.some((p) => p.value.toLowerCase() === primary.toLowerCase())) return;
  data[field] = null;
}

/**
 * Bookkeeping for a change someone made: a changed scalar becomes theirs (never auto-filled again); list items they
 * removed that auto-fill had added are remembered so they are not added back.
 */
export function userEdits(before: CompanyNow, input: Record<string, unknown>, userId: string, now: Date, fields: readonly EnrichField[]): Record<string, FieldSource> | null {
  const sources = sourcesOf(before.fieldSources);
  let changed = false;
  for (const f of fields) {
    if (!(f in input) || input[f] === undefined) continue;
    const was = before[f];
    const is = input[f];
    if ((LIST_ENRICH_FIELDS as readonly string[]).includes(f)) {
      const src = sources[f];
      if (!src?.items?.length) continue;
      const nowKeys = new Set(((is as unknown[]) ?? []).map((i) => itemKey(f, i)));
      const removed = src.items.filter((k) => !nowKeys.has(k));
      if (!removed.length) continue;
      sources[f] = { ...src, items: src.items.filter((k) => nowKeys.has(k)), rejected: [...new Set([...(src.rejected ?? []), ...removed])] };
      changed = true;
    } else if (!sameValue(was ?? null, is ?? null)) {
      sources[f] = { source: 'USER', url: null, at: now.toISOString(), confidence: 'high', runId: null, byUserId: userId };
      changed = true;
    }
  }
  return changed ? sources : null;
}
