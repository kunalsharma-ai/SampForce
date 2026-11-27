/*
 * Fields the Console can withhold from Manager and Executive Workspaces (redesign R8, ADR 0092). Each entry names a
 * record type and a field as people know it; `keys` are the properties it covers in API responses and inputs (a
 * phone number is stored three ways, an email also as a list). Names, owners, statuses and links between records
 * are never listed: without them a record cannot be found or worked on.
 */

export const FIELD_ENTITIES = ['company', 'contact', 'deal', 'rfq'] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export const FIELD_ENTITY_LABEL: Record<FieldEntity, string> = { company: 'Company', contact: 'Employee (contact)', deal: 'Deal', rfq: 'RFQ' };

export interface FieldAccessEntry {
  /** `entity.field`, as stored in the rules. */
  id: string;
  entity: FieldEntity;
  label: string;
  keys: readonly string[];
}

const f = (entity: FieldEntity, field: string, label: string, keys: readonly string[] = [field]): FieldAccessEntry => ({ id: `${entity}.${field}`, entity, label, keys });

export const FIELD_ACCESS_CATALOGUE: readonly FieldAccessEntry[] = [
  f('company', 'primaryEmail', 'Email', ['primaryEmail', 'emails']),
  f('company', 'primaryPhone', 'Phone', ['primaryPhone', 'phones']),
  f('company', 'website', 'Website', ['website', 'websites', 'domain']),
  f('company', 'linkedinUrl', 'LinkedIn', ['linkedinUrl', 'linkedinUrls']),
  f('company', 'address', 'Address', ['address', 'addresses', 'postalCode', 'state', 'city', 'headquarters']),
  f('company', 'industry', 'Industry', ['industry', 'businessCategory']),
  f('company', 'overview', 'Overview', ['overview', 'specialties']),
  f('company', 'companySize', 'Size and founding', ['companySize', 'companyType', 'foundedYear', 'branchCount', 'employeeCount']),
  f('company', 'business', 'Business information', ['services', 'products', 'industriesServed', 'certifications', 'founders', 'legalName']),
  f('company', 'notes', 'Notes', ['notes']),
  f('company', 'customFields', 'Custom fields', ['customFields']),
  f('contact', 'email', 'Email', ['email', 'emails']),
  f('contact', 'phone', 'Phone', ['phone', 'phoneIntl', 'phoneDigits', 'phones']),
  f('contact', 'linkedinUrl', 'LinkedIn', ['linkedinUrl']),
  f('contact', 'jobTitle', 'Designation and department', ['jobTitle', 'department']),
  f('contact', 'location', 'City and state', ['state', 'city']),
  f('contact', 'remarks', 'Remarks', ['remarks']),
  f('contact', 'customFields', 'Custom fields', ['customFields']),
  f('deal', 'amount', 'Amount', ['amount']),
  f('deal', 'probability', 'Probability', ['probability']),
  f('deal', 'expectedCloseDate', 'Expected close date', ['expectedCloseDate']),
  f('deal', 'customFields', 'Custom fields', ['customFields']),
  f('rfq', 'pricing', 'CPI and quotation', ['cpi', 'totalQuotation']),
  f('rfq', 'revenue', 'Expected and actual revenue', ['expectedRevenue', 'actualRevenue']),
  f('rfq', 'scope', 'Sample size, LOI and IR', ['sampleSize', 'loi', 'ir']),
  f('rfq', 'description', 'Description', ['description']),
  f('rfq', 'outcomeReason', 'Outcome reason', ['outcomeReason']),
];

export const FIELD_ACCESS_IDS = FIELD_ACCESS_CATALOGUE.map((e) => e.id) as [string, ...string[]];
const BY_ID = new Map(FIELD_ACCESS_CATALOGUE.map((e) => [e.id, e]));

/** The response and input properties hidden for each record type, from a list of hidden field ids. */
export function hiddenKeysByEntity(hidden: readonly string[]): Partial<Record<FieldEntity, string[]>> {
  const out: Partial<Record<FieldEntity, string[]>> = {};
  for (const id of hidden) {
    const e = BY_ID.get(id);
    if (e) out[e.entity] = [...new Set([...(out[e.entity] ?? []), ...e.keys])];
  }
  return out;
}

/** Whether a field (by its catalogue id, like `company.primaryEmail`) is hidden in a list of hidden ids. */
export function fieldHidden(hidden: readonly string[] | undefined, id: string): boolean {
  return !!hidden?.includes(id);
}

/** Which record type a property key belongs to under a parent key of a response (`company`, `contacts`…). */
export const ENTITY_OF_KEY: Readonly<Record<string, FieldEntity>> = {
  company: 'company',
  companies: 'company',
  parentCompany: 'company',
  contact: 'contact',
  contacts: 'contact',
  employees: 'contact',
  employee: 'contact',
  deal: 'deal',
  deals: 'deal',
  wonDeal: 'deal',
  rfq: 'rfq',
  rfqs: 'rfq',
};

/** The record type an API path is about, from its first segment after /api/v1. */
export function entityOfPath(path: string): FieldEntity | null {
  const seg = path.replace(/^\/?(api\/v1\/)?/, '').split(/[/?]/)[0];
  switch (seg) {
    case 'companies':
    case 'company-leads':
      return 'company';
    case 'contacts':
      return 'contact';
    case 'deals':
      return 'deal';
    case 'rfqs':
      return 'rfq';
    default:
      return null;
  }
}

/** Catalogue order, known ids only, no repeats. */
export const orderFieldIds = (ids: Iterable<string>): string[] => {
  const set = new Set(ids);
  return FIELD_ACCESS_CATALOGUE.map((e) => e.id).filter((id) => set.has(id));
};

export interface FieldAccess {
  /** Fields never shown and never changed. */
  hidden: string[];
  /** Fields shown but never changed (a hidden field is not also locked). */
  locked: string[];
}

/**
 * Field access of a Manager or Executive Workspace (ADR 0096): what the Console withholds from its level, what the
 * workspace above it has hidden or locked, and what that workspace set on it. Nothing a level above hid or locked can
 * be opened again below it: hidden only grows, and a locked field can only become hidden.
 */
export function combineFieldAccess(parent: FieldAccess, own: Partial<FieldAccess>, consoleHidden: readonly string[] = []): FieldAccess {
  const hidden = orderFieldIds([...parent.hidden, ...(own.hidden ?? []), ...consoleHidden]);
  const hiddenSet = new Set(hidden);
  const locked = orderFieldIds([...parent.locked, ...(own.locked ?? [])]).filter((id) => !hiddenSet.has(id));
  return { hidden, locked };
}

export const NO_FIELD_LIMITS: FieldAccess = { hidden: [], locked: [] };
