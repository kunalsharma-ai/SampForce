import {
  companyInputSchema,
  companyUpdateSchema,
  contactInputSchema,
  contactUpdateSchema,
  dealInputSchema,
  dealUpdateSchema,
  LEAD_STATUSES,
  leadInputSchema,
  leadUpdateSchema,
} from '@dealflow/types';
import type { ZodTypeAny } from 'zod';
import type { CrmEntity } from './crm';

export type FieldType = 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'company' | 'contact' | 'owner' | 'tags' | 'pipeline';

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  /** Only shown when creating (e.g. pipeline and stage, which change via "move"). */
  createOnly?: boolean;
  wide?: boolean;
}

const owner: FieldSpec = { name: 'ownerId', label: 'Owner', type: 'owner', hint: 'Defaults to you' };
const consent: FieldSpec = {
  name: 'marketingConsent',
  label: 'Marketing consent',
  type: 'select',
  hint: 'Record only what the person told you. Opted-out people are never exported for marketing.',
  options: [
    { value: 'UNKNOWN', label: 'Not asked' },
    { value: 'OPTED_IN', label: 'Opted in' },
    { value: 'OPTED_OUT', label: 'Opted out' },
  ],
};
const country: FieldSpec = { name: 'country', label: 'Country', type: 'text', placeholder: 'US', hint: '2-letter ISO code' };

export const FIELDS: Record<CrmEntity, FieldSpec[]> = {
  leads: [
    { name: 'fullName', label: 'Full name', type: 'text', required: true, wide: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'companyName', label: 'Company', type: 'text' },
    { name: 'jobTitle', label: 'Job title', type: 'text' },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: LEAD_STATUSES.filter((s) => s !== 'CONVERTED').map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })),
    },
    { name: 'source', label: 'Source', type: 'text', placeholder: 'Website, referral, event…' },
    { name: 'estimatedValue', label: 'Estimated value', type: 'number' },
    { name: 'currency', label: 'Currency', type: 'text', placeholder: 'USD' },
    { name: 'industry', label: 'Industry', type: 'text' },
    country,
    { name: 'city', label: 'City', type: 'text' },
    { name: 'website', label: 'Website', type: 'url' },
    { name: 'tags', label: 'Tags', type: 'tags', hint: 'Separate with commas', wide: true },
    consent,
    owner,
  ],
  contacts: [
    { name: 'firstName', label: 'First name', type: 'text', required: true },
    { name: 'lastName', label: 'Last name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'jobTitle', label: 'Job title', type: 'text' },
    { name: 'companyId', label: 'Company', type: 'company' },
    country,
    { name: 'timezone', label: 'Time zone', type: 'text', placeholder: 'America/New_York' },
    consent,
    owner,
  ],
  companies: [
    { name: 'name', label: 'Company name', type: 'text', required: true, wide: true },
    { name: 'domain', label: 'Domain', type: 'text', placeholder: 'example.com' },
    { name: 'industry', label: 'Industry', type: 'text' },
    country,
    { name: 'parentCompanyId', label: 'Parent company', type: 'company' },
    owner,
  ],
  deals: [
    { name: 'name', label: 'Deal name', type: 'text', required: true, wide: true },
    { name: 'amount', label: 'Amount', type: 'number' },
    { name: 'currency', label: 'Currency', type: 'text', placeholder: 'Workspace default' },
    { name: 'pipelineId', label: 'Pipeline and stage', type: 'pipeline', createOnly: true, wide: true },
    { name: 'expectedCloseDate', label: 'Expected close', type: 'date' },
    { name: 'probability', label: 'Probability override (%)', type: 'number', hint: 'Leave empty to use the stage probability' },
    { name: 'companyId', label: 'Company', type: 'company' },
    { name: 'contactId', label: 'Primary contact', type: 'contact' },
    owner,
  ],
};

export const SCHEMAS: Record<CrmEntity, { create: ZodTypeAny; update: ZodTypeAny }> = {
  leads: { create: leadInputSchema, update: leadUpdateSchema },
  contacts: { create: contactInputSchema, update: contactUpdateSchema },
  companies: { create: companyInputSchema, update: companyUpdateSchema },
  deals: { create: dealInputSchema, update: dealUpdateSchema },
};

type Ref = { id: string; name: string } | null | undefined;

/** Maps an API row onto form state (pickers hold {id, name}). */
export function toFormValues(entity: CrmEntity, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[entity]) {
    if (f.type === 'owner') out.ownerId = (row.owner as Ref)?.id ?? '';
    else if (f.type === 'company') {
      const ref = (f.name === 'parentCompanyId' ? row.parentCompany : row.company) as Ref;
      out[f.name] = ref ? { id: ref.id, name: ref.name } : null;
    } else if (f.type === 'contact') out.contactId = (row.contact as Ref) ?? null;
    else if (f.type === 'tags') out.tags = ((row.tags as string[]) ?? []).join(', ');
    else if (f.type === 'pipeline') continue;
    else out[f.name] = row[f.name] ?? '';
  }
  for (const [k, v] of Object.entries((row.customFields as Record<string, unknown>) ?? {})) {
    if (k !== 'qualification') out[`cf.${k}`] = v ?? '';
  }
  return out;
}

/** Converts form state into an API payload. Empty optional values become null (edit) or are omitted (create). */
export function toPayload(entity: CrmEntity, values: Record<string, unknown>, mode: 'create' | 'edit', customKeys: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const empty = mode === 'create' ? undefined : null;
  for (const f of FIELDS[entity]) {
    if (f.createOnly && mode === 'edit') continue;
    const v = values[f.name];
    switch (f.type) {
      case 'company':
      case 'contact':
        out[f.name] = (v as Ref)?.id ?? empty;
        break;
      case 'owner':
        out.ownerId = v ? v : undefined;
        break;
      case 'tags':
        out.tags = String(v ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        break;
      case 'number':
        out[f.name] = v === '' || v === undefined || v === null ? (f.name === 'amount' ? undefined : empty) : Number(v);
        break;
      case 'pipeline':
        out.pipelineId = values.pipelineId || undefined;
        out.stageId = values.stageId || undefined;
        break;
      case 'date':
        out[f.name] = v ? v : empty;
        break;
      case 'select':
        out[f.name] = v ? v : undefined;
        break;
      default:
        if (f.name === 'currency') out.currency = v ? v : entity === 'leads' ? empty : undefined;
        else out[f.name] = v === undefined ? undefined : v;
    }
  }
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    // Only send currently defined fields; values of archived fields stay on the record untouched.
    if (!k.startsWith('cf.') || !customKeys.includes(k.slice(3))) continue;
    if (v === '' || v === undefined) {
      if (mode === 'edit') custom[k.slice(3)] = null;
    } else custom[k.slice(3)] = v;
  }
  out.customFields = custom;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/** "Opted in (form: Webinar sign-up)" for detail pages. */
export function consentLabel(consent: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT', source: string | null): string {
  const label = consent === 'OPTED_IN' ? 'Opted in' : consent === 'OPTED_OUT' ? 'Opted out' : 'Not asked';
  return source && consent !== 'UNKNOWN' ? `${label} (${source.replace(/^form:/, 'form: ')})` : label;
}
