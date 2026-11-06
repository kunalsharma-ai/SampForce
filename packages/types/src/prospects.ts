import { z } from 'zod';
import { EMAIL_STATUSES, type EmailStatus } from './crm';

// ───────────── Prospect Lists and prospect discovery (enhancement Part 2) ─────────────
//
// Prospects are people a team may want to contact, kept apart from leads and contacts until someone adds them to the
// CRM. They come from people typing them in, CSV or Excel files, the browser extension, or an approved data provider
// (Apollo.io for people and companies, Hunter.io for email verification), always through SampForce's backend.
// Without a provider key the provider runs in Mock Mode: it returns sample people on reserved ".example" domains,
// clearly labelled, which can be tried in lists but never added to the CRM, enrolled or exported.

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

// Email verification status uses the CRM's EMAIL_STATUSES (valid, risky, catch_all, invalid, unknown, bounced,
// needs_verification), so a prospect keeps its status when added as a lead.

export const PROSPECT_SOURCES = ['manual', 'csv', 'excel', 'extension', 'apollo', 'hunter', 'finder', 'sample'] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];
export const PROSPECT_SOURCE_LABELS: Record<ProspectSource, string> = {
  manual: 'Added by hand', csv: 'CSV file', excel: 'Excel file', extension: 'Browser extension', apollo: 'Apollo.io',
  hunter: 'Hunter.io', finder: 'Email finder', sample: 'Sample data (Mock Mode)',
};

/** Reserved top-level domain (RFC 2606) used for Mock Mode sample people, so a sample address can never be real. */
export const SAMPLE_DOMAIN_SUFFIX = '.example';
export function isSampleEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(SAMPLE_DOMAIN_SUFFIX);
}

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const domainField = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
  .pipe(z.string().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, 'Use a domain like acme.com').max(253))
  .optional()
  .or(z.literal('').transform(() => undefined));

export const prospectInputSchema = z
  .object({
    firstName: text(80),
    lastName: text(80),
    fullName: text(160),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254).optional().or(z.literal('').transform(() => undefined)),
    title: text(160),
    companyName: text(160),
    domain: domainField,
    industry: text(120),
    country: text(80),
    companySize: z.enum(COMPANY_SIZES).optional(),
    phone: text(40),
    notes: text(2000),
  })
  .refine((p) => p.email || ((p.fullName || p.firstName || p.lastName) && (p.companyName || p.domain)), {
    message: 'Give an email address, or a name and a company',
    path: ['email'],
  });
export type ProspectInput = z.infer<typeof prospectInputSchema>;

export const prospectUpdateSchema = z.object({
  firstName: text(80), lastName: text(80), fullName: text(160), title: text(160), companyName: text(160), domain: domainField,
  industry: text(120), country: text(80), companySize: z.enum(COMPANY_SIZES).nullable().optional(), phone: text(40), notes: text(2000),
});

export const prospectListInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  /** The team member who works this list. */
  assigneeId: z.string().uuid().nullable().optional(),
});
export type ProspectListInput = z.infer<typeof prospectListInputSchema>;

export const PROSPECT_SORTS = ['newest', 'name', 'company', 'title', 'country'] as const;
export const prospectQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  industry: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  companySize: z.enum(COMPANY_SIZES).optional(),
  title: z.string().trim().max(160).optional(),
  emailStatus: z.enum([...EMAIL_STATUSES, 'none']).optional(),
  /** new: not in the CRM yet. in_crm: added as a lead or matched to a contact. */
  stage: z.enum(['new', 'in_crm']).optional(),
  source: z.enum(PROSPECT_SOURCES).optional(),
  sort: z.enum(PROSPECT_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ProspectQuery = z.infer<typeof prospectQuerySchema>;
export const PROSPECT_PAGE_SIZE = 50;

const ids = z.array(z.string().uuid()).min(1, 'Choose at least one prospect').max(500);
export const prospectMoveSchema = z.object({ prospectIds: ids, toListId: z.string().uuid(), copy: z.boolean().default(false) });
export const prospectIdsSchema = z.object({ prospectIds: ids });
export const prospectToCrmSchema = z.object({ prospectIds: ids, sequenceId: z.string().uuid().optional() });
export const prospectAddSchema = z.object({ prospects: z.array(prospectInputSchema).min(1).max(100) });

/** Column mapping for a CSV or Excel import: SampForce field → column index in the file. */
export const PROSPECT_IMPORT_FIELDS = ['fullName', 'firstName', 'lastName', 'email', 'title', 'companyName', 'domain', 'industry', 'country', 'companySize', 'phone', 'notes'] as const;
export type ProspectImportField = (typeof PROSPECT_IMPORT_FIELDS)[number];
export const PROSPECT_IMPORT_FIELD_LABELS: Record<ProspectImportField, string> = {
  fullName: 'Full name', firstName: 'First name', lastName: 'Last name', email: 'Email', title: 'Job title', companyName: 'Company',
  domain: 'Company website', industry: 'Industry', country: 'Country', companySize: 'Company size', phone: 'Phone', notes: 'Notes',
};
export const prospectImportCommitSchema = z.object({
  mapping: z.record(z.enum(PROSPECT_IMPORT_FIELDS), z.number().int().min(0).max(199)),
});
export const MAX_PROSPECT_IMPORT_ROWS = 5_000;
export const MAX_PROSPECT_IMPORT_BYTES = 5 * 1024 * 1024;

/** Guesses the SampForce field for a column heading. */
export function guessProspectField(header: string): ProspectImportField | null {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  const table: [RegExp, ProspectImportField][] = [
    [/^(email|emailaddress|workemail|businessemail|mail)$/, 'email'],
    [/^(firstname|givenname|first)$/, 'firstName'],
    [/^(lastname|surname|familyname|last)$/, 'lastName'],
    [/^(name|fullname|contactname|person)$/, 'fullName'],
    [/^(title|jobtitle|position|role|designation)$/, 'title'],
    [/^(company|companyname|organisation|organization|account|employer)$/, 'companyName'],
    [/^(website|domain|companywebsite|companydomain|url)$/, 'domain'],
    [/^(industry|sector|vertical)$/, 'industry'],
    [/^(country|location|region)$/, 'country'],
    [/^(companysize|employees|size|headcount|numberofemployees)$/, 'companySize'],
    [/^(phone|phonenumber|mobile|telephone)$/, 'phone'],
    [/^(notes|note|comments)$/, 'notes'],
  ];
  return table.find(([re]) => re.test(h))?.[1] ?? null;
}

/** Maps "250", "200-500" or "1,001-5,000 employees" onto a size band. */
export function companySizeFrom(value: string | number | null | undefined): CompanySize | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const s = String(value).replace(/,/g, '');
  if ((COMPANY_SIZES as readonly string[]).includes(s)) return s as CompanySize;
  const n = Number(s.match(/\d+/)?.[0]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  if (n <= 500) return '201-500';
  if (n <= 1000) return '501-1000';
  if (n <= 5000) return '1001-5000';
  return '5001+';
}

// Provider search

export const providerSearchSchema = z.object({
  /** Company websites to search within. */
  domains: z.array(z.string().trim().toLowerCase().max(253)).max(10).default([]),
  titles: z.array(z.string().trim().max(80)).max(10).default([]),
  countries: z.array(z.string().trim().max(80)).max(10).default([]),
  sizes: z.array(z.enum(COMPANY_SIZES)).max(7).default([]),
  keywords: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).max(50).default(1),
}).refine((s) => s.domains.length || s.titles.length || s.keywords, { message: 'Give a company website, a job title or keywords', path: ['domains'] });
export type ProviderSearchInput = z.infer<typeof providerSearchSchema>;

export const PROVIDER_MODES = ['live', 'mock', 'pending'] as const;
/** live: a key is set and the last call succeeded. pending: a key is set but no call has succeeded yet. mock: no key. */
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export interface ProviderPerson {
  /** The provider's id, used to reveal the email address later. */
  providerId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  companyName: string | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  companySize: CompanySize | null;
  /** Present only when the provider returned it. Apollo's search does not; revealing it is a separate step. */
  email: string | null;
  emailStatus: EmailStatus | null;
  /** True for Mock Mode sample people. */
  sample: boolean;
}

export interface ProviderSearchResult {
  provider: 'apollo';
  mode: ProviderMode;
  people: ProviderPerson[];
  page: number;
  hasMore: boolean;
  usage: ProspectUsage;
  notice: string | null;
}

export const providerAddSchema = z.object({
  people: z
    .array(
      z.object({
        providerId: z.string().max(100),
        fullName: z.string().trim().max(160),
        firstName: z.string().max(80).nullable(),
        lastName: z.string().max(80).nullable(),
        title: z.string().max(160).nullable(),
        companyName: z.string().max(160).nullable(),
        domain: z.string().max(253).nullable(),
        industry: z.string().max(120).nullable(),
        country: z.string().max(80).nullable(),
        companySize: z.enum(COMPANY_SIZES).nullable(),
        email: z.string().email().max(254).nullable(),
        emailStatus: z.enum(EMAIL_STATUSES).nullable(),
        sample: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  /** Ask the provider for each person's email address (uses provider credits and the daily allowance). */
  revealEmails: z.boolean().default(false),
});

export interface ProspectUsage {
  /** Provider calls (searches, reveals, verifications) by this person in the last 24 hours. */
  used: number;
  limit: number;
}

export interface ProspectProviderStatus {
  apollo: { mode: ProviderMode; detail: string };
  hunter: { mode: ProviderMode; detail: string };
}

export const prospectSettingsSchema = z.object({
  /** Provider calls each person may make in 24 hours. */
  dailyLimit: z.number().int().min(0).max(5000),
  /** Per-person overrides. */
  userLimits: z.record(z.string().uuid(), z.number().int().min(0).max(5000)),
});
export type ProspectSettingsInput = z.infer<typeof prospectSettingsSchema>;

export interface ProspectSettings extends ProspectSettingsInput {
  providers: ProspectProviderStatus;
  members: { id: string; name: string; used: number; limit: number }[];
}

// Rows

export interface ProspectListRow {
  id: string;
  name: string;
  description: string | null;
  owner: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  prospects: number;
  inCrm: number;
  withEmail: number;
  samples: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProspectRow {
  id: string;
  listId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailStatus: EmailStatus | null;
  emailCheckedAt: string | null;
  title: string | null;
  companyName: string | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  companySize: CompanySize | null;
  phone: string | null;
  notes: string | null;
  source: ProspectSource;
  sample: boolean;
  suppressed: boolean;
  crm: { type: 'lead' | 'contact'; id: string; label: string } | null;
  createdAt: string;
}

export interface Facet {
  value: string;
  count: number;
}

export interface ProspectListDetail {
  list: ProspectListRow;
  prospects: ProspectRow[];
  total: number;
  page: number;
  pageSize: number;
  facets: { industry: Facet[]; country: Facet[]; companySize: Facet[]; title: Facet[]; emailStatus: Facet[]; source: Facet[] };
}

export interface ProspectBulkResult {
  /** Per prospect: what happened. */
  results: { prospectId: string; outcome: 'added' | 'existing' | 'skipped' | 'failed'; reason?: string; crm?: { type: 'lead' | 'contact'; id: string; label: string } }[];
  enrollment?: { enrolled: number; skipped: unknown[] };
}

export interface ProspectAddResult {
  added: number;
  /** Already in this list (same email, or same name at the same company). */
  duplicates: number;
  invalid: { row: number; message: string }[];
  /** Already a lead or contact in SampForce; still added to the list, marked "In CRM". */
  inCrm: number;
}

export interface ProspectImportPreview {
  importId: string;
  fileName: string;
  headers: string[];
  sample: string[][];
  rows: number;
  mapping: Partial<Record<ProspectImportField, number>>;
}

export interface ListPerformance {
  sequences: {
    sequence: { id: string; name: string };
    enrolled: number;
    active: number;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    completed: number;
  }[];
  totals: { enrolled: number; sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number };
}
