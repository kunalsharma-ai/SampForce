import { createHash } from 'node:crypto';
import type { TenantTx } from '@dealflow/database';
import { recordModelLabel } from '@dealflow/types';

/*
 * Which record an action is about (ADR 0097): the kind, the id, a name to show and a fingerprint of the record as it
 * is now. An approval stores the fingerprint; if the record changes before the approved action runs, the
 * fingerprint differs and the action is refused until someone asks again.
 */

export interface RouteRecord {
  /** Prisma model name (Company, Opportunity...), or null when the route is not about a known record kind. */
  model: string | null;
  recordType: string;
  recordTypeLabel: string;
  scope: 'single' | 'bulk' | 'all';
  ids: string[];
  count: number | null;
}

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

/** One-record routes: path (after /api/v1, no query) -> model. */
const SINGLE: [RegExp, string][] = [
  [new RegExp(`^/companies/${UUID}/branches/${UUID}$`), 'CompanyBranch'],
  [new RegExp(`^/companies/${UUID}$`), 'Company'],
  [new RegExp(`^/contacts/${UUID}$`), 'Contact'],
  [new RegExp(`^/leads/${UUID}$`), 'Lead'],
  [new RegExp(`^/deals/${UUID}$`), 'Opportunity'],
  [new RegExp(`^/pipelines/${UUID}$`), 'Pipeline'],
  [new RegExp(`^/tasks/${UUID}$`), 'Task'],
  [new RegExp(`^/assigned-tasks/${UUID}$`), 'Task'],
  [new RegExp(`^/activities/${UUID}$`), 'Activity'],
  [new RegExp(`^/interactions/${UUID}$`), 'Activity'],
  [new RegExp(`^/rfqs/${UUID}$`), 'Rfq'],
  [new RegExp(`^/calls/dialers/${UUID}$`), 'Dialer'],
  [new RegExp(`^/calls/${UUID}$`), 'PhoneCall'],
  [new RegExp(`^/targets/${UUID}$`), 'WorkspaceTarget'],
  [new RegExp(`^/analytics/targets/${UUID}$`), 'SalesTarget'],
  [new RegExp(`^/quotes/${UUID}$`), 'Quote'],
  [new RegExp(`^/meeting-records/${UUID}$`), 'MeetingRecord'],
  [new RegExp(`^/voice-notes/${UUID}$`), 'VoiceNote'],
  [new RegExp(`^/company-files/${UUID}$`), 'CompanyFile'],
  [new RegExp(`^/custom-fields/${UUID}$`), 'CustomField'],
  [new RegExp(`^/territories/${UUID}$`), 'Territory'],
  [new RegExp(`^/workflows/${UUID}$`), 'Workflow'],
  [new RegExp(`^/prospect-lists/${UUID}$`), 'ProspectList'],
  [new RegExp(`^/email-templates/${UUID}$`), 'EmailTemplate'],
  [new RegExp(`^/reports/${UUID}$`), 'Report'],
  [new RegExp(`^/dashboards/${UUID}$`), 'Dashboard'],
  [new RegExp(`^/segments/${UUID}$`), 'Segment'],
];

/** The phone app's record routes name the module. */
const MOBILE_MODULE: Record<string, string> = { companies: 'Company', contacts: 'Contact', tasks: 'Task', follow_ups: 'Activity', deals: 'Opportunity' };

/** "Delete all" routes: list path -> model. */
const DELETE_ALL: [RegExp, string][] = [
  [/^\/rfqs\/delete-all$/, 'Rfq'],
  [/^\/follow-ups\/delete-all$/, 'Activity'],
  [/^\/tasks\/delete-all$/, 'Task'],
  [/^\/activities\/delete-all$/, 'Activity'],
  [/^\/quotes\/delete-all$/, 'Quote'],
  [/^\/meeting-records\/delete-all$/, 'MeetingRecord'],
  [new RegExp(`^/companies/${UUID}/interactions/delete-all$`), 'Activity'],
  [/^\/calls\/delete-all$/, 'PhoneCall'],
  [/^\/voice-notes\/delete-all$/, 'VoiceNote'],
];

const TABLE_MODEL: Record<string, string> = { companies: 'Company', contacts: 'Contact', leads: 'Lead', deals: 'Opportunity' };

const typeOf = (model: string) => model.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

/** The record an action is about, from its path and body; null when it is not about records we know. */
export function recordOfRoute(path: string, body: unknown): RouteRecord | null {
  const bare = path.split('?')[0]!;
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const one = (model: string, id: string): RouteRecord => ({ model, recordType: typeOf(model), recordTypeLabel: recordModelLabel(model), scope: 'single', ids: [id], count: 1 });
  for (const [re, model] of SINGLE) {
    const m = re.exec(bare);
    if (m) return one(model, m[m.length - 1]!);
  }
  const mobile = new RegExp(`^/mobile/records/([a-z_]+)/${UUID}$`).exec(bare);
  if (mobile && MOBILE_MODULE[mobile[1]!]) return one(MOBILE_MODULE[mobile[1]!]!, mobile[2]!);
  if (bare === '/records/bulk' && typeof b.entity === 'string' && TABLE_MODEL[b.entity]) {
    const model = TABLE_MODEL[b.entity]!;
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string') : [];
    const all = b.all as { expected?: unknown } | undefined;
    const count = ids.length ? ids.length : typeof all?.expected === 'number' ? all.expected : null;
    return { model, recordType: typeOf(model), recordTypeLabel: recordModelLabel(model, count ?? 2), scope: ids.length ? 'bulk' : 'all', ids, count };
  }
  for (const [re, model] of DELETE_ALL) {
    if (re.test(bare)) {
      const count = typeof b.expected === 'number' ? b.expected : null;
      return { model, recordType: typeOf(model), recordTypeLabel: recordModelLabel(model, count ?? 2), scope: 'all', ids: [], count };
    }
  }
  return null;
}

const NAME_FIELDS = ['name', 'title', 'subject', 'number', 'reference', 'label', 'fileName', 'toNumber', 'phone', 'email'];

type Delegate = { findMany(args: unknown): Promise<Record<string, unknown>[]> };
const delegateOf = (tx: TenantTx, model: string) => (tx as unknown as Record<string, Delegate | undefined>)[model.charAt(0).toLowerCase() + model.slice(1)];

/** A readable name for a record. */
export function nameOfRecord(model: string, r: Record<string, unknown>): string | null {
  if (model === 'Contact' || model === 'Lead') {
    const full = [r.firstName, r.lastName].filter((x) => typeof x === 'string' && x).join(' ');
    if (full) return full;
  }
  for (const f of NAME_FIELDS) if (typeof r[f] === 'string' && r[f]) return String(r[f]).slice(0, 200);
  if (typeof r.body === 'string' && r.body) return r.body.slice(0, 80);
  return null;
}

/** Stable JSON: object keys sorted, so the same value always gives the same text. */
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * The records as they are now: their names and one fingerprint over all of them. Missing records count as missing,
 * so a record deleted or created meanwhile changes the fingerprint too. Null when the kind is unknown or the action
 * covers every record of a list (the list's own count check guards that one).
 */
export async function lookAtRecords(tx: TenantTx, tenantId: string, rr: RouteRecord): Promise<{ name: string | null; fingerprint: string | null; found: number }> {
  if (!rr.model || !rr.ids.length) return { name: null, fingerprint: null, found: 0 };
  const delegate = delegateOf(tx, rr.model);
  if (!delegate) return { name: null, fingerprint: null, found: 0 };
  const rows = await delegate.findMany({ where: { tenantId, id: { in: rr.ids } } });
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const fingerprint = sha256(canonical(rr.ids.map((id) => byId.get(id) ?? null)));
  const name = rr.ids.length === 1 ? (byId.get(rr.ids[0]!) ? nameOfRecord(rr.model, byId.get(rr.ids[0]!)!) : null) : null;
  return { name, fingerprint, found: rows.length };
}
