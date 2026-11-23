import { COMPANY_SIZES, MOBILE_FIELDS, type MobileCustomFieldDef, type MobileLiveRecordModule, type MobileRecord, type MobileResolvedConfig } from '@dealflow/types';

/*
 * How the phone shows and edits records (ADR 0072, M4). The server decides what the person may see and change; the
 * app only offers what the published configuration says, so a refused write is the exception, not the way to learn.
 */

export type FieldKind = 'text' | 'multiline' | 'email' | 'phone' | 'url' | 'number' | 'datetime' | 'date' | 'boolean' | 'companyStatus' | 'person' | 'company' | 'contact' | 'followUpType' | 'priority' | 'choice' | 'readonly';

/** How each built-in field is entered. Status and outcome of follow-ups and tasks change through their own buttons. */
export const FIELD_KIND: Record<MobileLiveRecordModule, Record<string, FieldKind>> = {
  companies: {
    name: 'text',
    leadNumber: 'readonly',
    status: 'companyStatus',
    owner: 'person',
    primaryEmail: 'email',
    primaryPhone: 'phone',
    website: 'url',
    industry: 'text',
    country: 'text',
    city: 'text',
    address: 'multiline',
    companySize: 'choice',
    nextFollowUpAt: 'readonly',
    notes: 'multiline',
    createdAt: 'readonly',
  },
  contacts: { firstName: 'text', lastName: 'text', jobTitle: 'text', company: 'company', email: 'email', phone: 'phone', department: 'text', city: 'text', owner: 'person', nextFollowUpAt: 'datetime', remarks: 'multiline' },
  follow_ups: { title: 'text', dueAt: 'datetime', followUpType: 'followUpType', company: 'company', contact: 'contact', assignee: 'person', status: 'readonly', priority: 'priority', outcome: 'readonly', remarks: 'multiline' },
  tasks: { title: 'text', description: 'multiline', dueAt: 'datetime', priority: 'priority', status: 'readonly', assignee: 'person', company: 'readonly' },
};

/** Fixed choices for 'choice' fields. */
export const FIELD_CHOICES: Record<string, readonly string[]> = { companySize: COMPANY_SIZES };
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export const PRIORITY_LABEL: Record<string, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High' };
export const RECORD_STATUS_LABEL: Record<string, string> = { OPEN: 'Open', DONE: 'Done', CANCELED: 'Cancelled' };

/** Fields the follow-up form must have to be saved (the server's own rules; the phone asks before sending). */
export const REQUIRED_ON_CREATE: Record<MobileLiveRecordModule, string[]> = {
  companies: ['name'],
  contacts: ['firstName'],
  follow_ups: ['title', 'company', 'followUpType', 'dueAt'],
  tasks: ['title'],
};

const CUSTOM_KIND: Record<string, FieldKind> = { TEXT: 'text', TEXTAREA: 'multiline', NUMBER: 'number', CURRENCY: 'number', DATE: 'date', DATETIME: 'datetime', SELECT: 'choice', CHECKBOX: 'boolean', BOOLEAN: 'boolean', URL: 'url', EMAIL: 'email', PHONE: 'phone' };

export interface FieldSpec {
  /** The field name as the server knows it: a MOBILE_FIELDS key, or `cf.<key>` for a custom field. */
  key: string;
  label: string;
  kind: FieldKind;
  /** Choices for 'choice' fields. */
  choices?: readonly string[];
  required: boolean;
  /** What the person may do with this field on the phone. */
  can: { edit: boolean; create: boolean; delete: boolean };
}

/** The fields this person sees for a module, in the web's order, custom fields last. */
export function visibleFields(config: MobileResolvedConfig, module: MobileLiveRecordModule, customFields: MobileCustomFieldDef[] = []): FieldSpec[] {
  const rules = config.fields[module] ?? {};
  const out: FieldSpec[] = [];
  for (const def of MOBILE_FIELDS[module]) {
    const rule = rules[def.key];
    if (!rule) continue;
    out.push({ key: def.key, label: def.label, kind: FIELD_KIND[module][def.key] ?? 'text', choices: FIELD_CHOICES[def.key], required: !!def.required || REQUIRED_ON_CREATE[module].includes(def.key), can: rule });
  }
  for (const cf of customFields) {
    const rule = rules[`cf.${cf.key}`];
    if (!rule) continue;
    const kind = cf.edit ? (CUSTOM_KIND[cf.type] ?? 'readonly') : 'readonly';
    out.push({ key: `cf.${cf.key}`, label: cf.label, kind, choices: cf.options, required: false, can: cf.edit ? rule : { edit: false, create: false, delete: false } });
  }
  return out;
}

/** The fields a form offers: on a new record those the person may set, on an edit those they may change. */
export function formFields(fields: FieldSpec[], mode: 'create' | 'edit'): FieldSpec[] {
  return fields.filter((f) => f.kind !== 'readonly' && (mode === 'create' ? f.can.create : f.can.edit));
}

/** A record's stored value for a field, custom fields included. */
export function valueOf(r: MobileRecord, key: string): unknown {
  if (key.startsWith('cf.')) return (r.customFields ?? {})[key.slice(3)];
  return r[key];
}

const isRef = (v: unknown): v is { id: string; name: string } => !!v && typeof v === 'object' && 'id' in v && 'name' in v;

/** The value as a form holds it: text for inputs, ids for references, 'true'/'' for switches. */
export function toFormValue(v: unknown, kind: FieldKind): string {
  if (v === null || v === undefined) return '';
  if (isRef(v)) return v.id;
  if (kind === 'datetime' && typeof v === 'string') return localDateTime(new Date(v));
  if (kind === 'date' && typeof v === 'string') return v.slice(0, 10);
  if (kind === 'boolean') return v ? 'true' : '';
  return String(v);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-11-24 10:30 in the phone's own time. */
export function localDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Reads "2026-11-24 10:30" (or "2026-11-24", as 09:00) in the phone's time; null when it is not a date. */
export function parseLocalDateTime(text: string): Date | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 9 : Number(m[4]), m[5] === undefined ? 0 : Number(m[5])];
  const date = new Date(y, mo - 1, d, h, mi);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) return null;
  return date;
}

/** Quick picks for a date: later today, tomorrow morning, next week. */
export function datePresets(now: Date): { label: string; value: string }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0);
    return localDateTime(d);
  };
  const laterToday = now.getHours() < 16 ? [{ label: 'Later today', value: at(0, Math.max(now.getHours() + 2, 9)) }] : [];
  return [...laterToday, { label: 'Tomorrow', value: at(1, 9) }, { label: 'Next week', value: at(7, 9) }];
}

export class FormError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function toWire(text: string, f: FieldSpec): unknown {
  const v = text.trim();
  if (v === '') return null;
  switch (f.kind) {
    case 'datetime': {
      const d = parseLocalDateTime(v);
      if (!d) throw new FormError(f.key, 'Use a date such as 2026-12-01 14:30.');
      return d.toISOString();
    }
    case 'date':
      if (!parseLocalDateTime(v)) throw new FormError(f.key, 'Use a date such as 2026-12-01 14:30.');
      return v.slice(0, 10);
    case 'number': {
      const n = Number(v.replace(',', '.'));
      if (!Number.isFinite(n)) throw new FormError(f.key, 'Enter a number.');
      return n;
    }
    case 'boolean':
      return v === 'true';
    default:
      return v;
  }
}

/**
 * What to send for a form: on a new record every filled-in field, on an edit only what changed. Custom fields go
 * under `customFields`; empty values clear a field (null), which the server allows only with the field's delete rule.
 */
export function buildBody(fields: FieldSpec[], values: Record<string, string>, original: Record<string, string> | null): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const f of fields) {
    const now = values[f.key] ?? '';
    if (original ? now.trim() === (original[f.key] ?? '').trim() : now.trim() === '') continue;
    if (f.required && now.trim() === '') throw new FormError(f.key, 'This field is required.');
    const wire = toWire(now, f);
    if (f.key.startsWith('cf.')) custom[f.key.slice(3)] = wire;
    else body[f.key] = wire;
  }
  if (Object.keys(custom).length) body.customFields = custom;
  return body;
}

/** The fields a new record still needs before it can be saved. */
export function missingRequired(module: MobileLiveRecordModule, fields: FieldSpec[], values: Record<string, string>): string[] {
  const offered = new Set(fields.map((f) => f.key));
  return [...REQUIRED_ON_CREATE[module], ...fields.filter((f) => f.required).map((f) => f.key)].filter((k, i, all) => all.indexOf(k) === i && offered.has(k) && !(values[k] ?? '').trim());
}

/** The line a list shows for a record, and the smaller one under it. */
export function recordTitle(module: MobileLiveRecordModule, r: MobileRecord): string {
  if (module === 'contacts') return [r.firstName, r.lastName].filter(Boolean).join(' ') || '—';
  return String((module === 'companies' ? r.name : r.title) ?? '—');
}

export function refName(v: unknown): string | null {
  return isRef(v) ? v.name : null;
}
