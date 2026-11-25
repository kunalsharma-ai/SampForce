import { z } from 'zod';
import { GEO_COUNTRY_ROWS } from './geo-countries';

/*
 * Company-centric CRM configuration: organisation structure, record visibility, configurable statuses, lead
 * numbering and the country dataset. See docs/adr/0060-company-centric-crm.md.
 */

// ───────────── Record visibility (per role) ─────────────

export const RECORD_SCOPES = ['OWN', 'TEAM', 'ALL'] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];

/** Defaults for the system roles. Custom roles start at ALL (what everyone saw before visibility existed). */
export const SYSTEM_ROLE_VISIBILITY: Record<string, { recordScope: RecordScope; viewOthersDetails: boolean }> = {
  owner: { recordScope: 'ALL', viewOthersDetails: true },
  admin: { recordScope: 'ALL', viewOthersDetails: true },
  manager: { recordScope: 'TEAM', viewOthersDetails: true },
  member: { recordScope: 'OWN', viewOthersDetails: true },
  viewer: { recordScope: 'ALL', viewOthersDetails: true },
};

export const roleVisibilitySchema = z.object({
  recordScope: z.enum(RECORD_SCOPES),
  viewOthersDetails: z.boolean(),
});
export type RoleVisibilityInput = z.infer<typeof roleVisibilitySchema>;

// ───────────── Departments and designations ─────────────

export const DESIGNATION_TIERS = ['EXECUTIVE', 'MANAGER', 'SENIOR'] as const;
export type DesignationTier = (typeof DESIGNATION_TIERS)[number];

export const DEFAULT_DESIGNATIONS: ReadonlyArray<{ name: string; tier: DesignationTier }> = [
  { name: 'Sales Executive', tier: 'EXECUTIVE' },
  { name: 'Senior Sales Executive', tier: 'EXECUTIVE' },
  { name: 'Business Development Executive', tier: 'EXECUTIVE' },
  { name: 'Senior Business Development Executive', tier: 'EXECUTIVE' },
  { name: 'Business Development Manager', tier: 'MANAGER' },
  { name: 'Sales Manager', tier: 'MANAGER' },
  { name: 'Department Head', tier: 'SENIOR' },
  { name: 'Senior Management', tier: 'SENIOR' },
  { name: 'Administrator', tier: 'SENIOR' },
];
export const DEFAULT_DEPARTMENTS = ['Sales', 'Business Development'] as const;

const name = z.string().trim().min(1, 'Enter a name').max(120);
const description = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const departmentInputSchema = z.object({ name, description, archived: z.boolean().optional() });
export type DepartmentInput = z.infer<typeof departmentInputSchema>;
export const designationInputSchema = z.object({ name, tier: z.enum(DESIGNATION_TIERS), description, archived: z.boolean().optional() });
export type DesignationInput = z.infer<typeof designationInputSchema>;

export interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
  members: number;
}
export interface DesignationRow extends DepartmentRow {
  tier: DesignationTier;
}

export const memberOrgSchema = z.object({
  designationId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  /** User id of the person this member reports to. */
  reportingManagerId: z.string().uuid().nullable().optional(),
});
export type MemberOrgInput = z.infer<typeof memberOrgSchema>;

export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

// ───────────── Statuses ─────────────

export const CRM_STATUS_KINDS = ['COMPANY', 'EMPLOYEE'] as const;
export type CrmStatusKind = (typeof CRM_STATUS_KINDS)[number];

/** What a status means to reports and dashboards, whatever it is called. */
export const STATUS_MEANINGS = ['NEW', 'ACTIVE', 'CLIENT', 'CONCERN', 'ON_HOLD', 'LOST'] as const;
export type StatusMeaning = (typeof STATUS_MEANINGS)[number];

type DefaultStatus = { name: string; color: string; meaning: StatusMeaning };
export const DEFAULT_STATUSES: Record<CrmStatusKind, ReadonlyArray<DefaultStatus>> = {
  COMPANY: [
    { name: 'New Lead', color: '#7dd3fc', meaning: 'NEW' },
    { name: 'Discussion Phase', color: '#3b82f6', meaning: 'ACTIVE' },
    { name: 'Revert Soon', color: '#f97316', meaning: 'ACTIVE' },
    { name: 'Call Scheduled', color: '#a855f7', meaning: 'ACTIVE' },
    { name: 'Meeting Scheduled', color: '#7c3aed', meaning: 'ACTIVE' },
    { name: 'RFQ Received', color: '#06b6d4', meaning: 'ACTIVE' },
    { name: 'RFQ Received – Not Won', color: '#f59e0b', meaning: 'ACTIVE' },
    { name: 'Receiving Regular RFQs', color: '#22c55e', meaning: 'CLIENT' },
    { name: 'RFQs Below Target Pricing', color: '#9ca3af', meaning: 'ACTIVE' },
    { name: 'Negotiation', color: '#14b8a6', meaning: 'ACTIVE' },
    { name: 'Existing Client', color: '#15803d', meaning: 'CLIENT' },
    { name: 'Client Concern / Issue', color: '#ff7f50', meaning: 'CONCERN' },
    { name: 'On Hold', color: '#64748b', meaning: 'ON_HOLD' },
    { name: 'Rejected', color: '#ef4444', meaning: 'LOST' },
    { name: 'Not Interested', color: '#991b1b', meaning: 'LOST' },
  ],
  EMPLOYEE: [
    { name: 'New Contact', color: '#7dd3fc', meaning: 'NEW' },
    { name: 'Discussion Phase', color: '#3b82f6', meaning: 'ACTIVE' },
    { name: 'Email Sent', color: '#60a5fa', meaning: 'ACTIVE' },
    { name: 'Awaiting Response', color: '#fbbf24', meaning: 'ACTIVE' },
    { name: 'Revert Soon', color: '#f97316', meaning: 'ACTIVE' },
    { name: 'Call Scheduled', color: '#a855f7', meaning: 'ACTIVE' },
    { name: 'Meeting Scheduled', color: '#7c3aed', meaning: 'ACTIVE' },
    { name: 'RFQ Received', color: '#06b6d4', meaning: 'ACTIVE' },
    { name: 'RFQ Under Discussion', color: '#0ea5e9', meaning: 'ACTIVE' },
    { name: 'Negotiation', color: '#14b8a6', meaning: 'ACTIVE' },
    { name: 'Existing Client Contact', color: '#15803d', meaning: 'CLIENT' },
    { name: 'Follow-up Required', color: '#eab308', meaning: 'ACTIVE' },
    { name: 'Client Raised Concern', color: '#ff7f50', meaning: 'CONCERN' },
    { name: 'Rejected', color: '#ef4444', meaning: 'LOST' },
    { name: 'Not Interested', color: '#991b1b', meaning: 'LOST' },
    { name: 'On Hold', color: '#64748b', meaning: 'ON_HOLD' },
  ],
};

export const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Use a colour like #1a2b3c');

export const crmStatusInputSchema = z.object({
  kind: z.enum(CRM_STATUS_KINDS),
  name,
  description,
  color: hexColor,
  meaning: z.enum(STATUS_MEANINGS).default('ACTIVE'),
  isDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type CrmStatusInput = z.infer<typeof crmStatusInputSchema>;
export const crmStatusUpdateSchema = crmStatusInputSchema.omit({ kind: true }).partial();
export type CrmStatusUpdate = z.infer<typeof crmStatusUpdateSchema>;
export const statusReorderSchema = reorderSchema.extend({ kind: z.enum(CRM_STATUS_KINDS) });

export interface CrmStatusRow {
  id: string;
  kind: CrmStatusKind;
  name: string;
  description: string | null;
  color: string;
  meaning: StatusMeaning;
  position: number;
  isDefault: boolean;
  archived: boolean;
  /** Records currently in this status. */
  inUse: number;
}

// ───────────── Lead numbering ─────────────

/** Workspace initials: "Frequent Research Fieldwork Solutions" gives FRFS, "Acme" gives ACME. */
export function defaultLeadPrefix(workspaceName: string): string {
  const words = workspaceName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const prefix = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'LEAD').slice(0, 4);
  return prefix.toUpperCase().slice(0, 6) || 'LEAD';
}

export function formatLeadNumber(prefix: string, seq: number, digits: number): string {
  return `${prefix}${String(seq).padStart(digits, '0')}`;
}

export const leadNumberingSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, 'Use 1 to 10 letters, digits or dashes'),
  digits: z.coerce.number().int().min(1).max(8),
  /** Re-letter every existing number to the new prefix and digits (the sequence is kept); otherwise new leads only. */
  applyToExisting: z.boolean().default(false),
});
export type LeadNumberingInput = z.infer<typeof leadNumberingSchema>;
export interface LeadNumberingRow {
  prefix: string;
  digits: number;
  /** True while the prefix is the workspace initials rather than one set by an administrator. */
  isDefaultPrefix: boolean;
  /** The number the next new company lead will get. */
  next: string;
  /** Company leads numbered so far. */
  issued: number;
}

// ───────────── Duplicate detection ─────────────

export const companyDuplicateCheckSchema = z.object({
  name: z.string().trim().max(200).optional(),
  website: z.string().trim().max(500).nullable().optional(),
  linkedinUrl: z.string().trim().max(500).nullable().optional(),
  emails: z.array(z.string().trim().max(254)).max(20).optional(),
  phones: z.array(z.string().trim().max(40)).max(20).optional(),
  /** Leave this company out (when editing it). */
  excludeId: z.string().uuid().optional(),
});
export type CompanyDuplicateCheck = z.infer<typeof companyDuplicateCheckSchema>;
export const contactDuplicateCheckSchema = z.object({
  emails: z.array(z.string().trim().max(254)).max(20).optional(),
  phones: z.array(z.string().trim().max(40)).max(20).optional(),
  linkedinUrl: z.string().trim().max(500).nullable().optional(),
  excludeId: z.string().uuid().optional(),
});
export type ContactDuplicateCheck = z.infer<typeof contactDuplicateCheckSchema>;

/**
 * A possible duplicate. Only what is needed to recognise it is returned, so a check never reveals details of a
 * record the caller may not see.
 */
export interface DuplicateMatch {
  id: string;
  entity: 'company' | 'contact';
  name: string;
  leadNumber: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  reasons: Array<'name' | 'domain' | 'email' | 'phone' | 'linkedin'>;
  /** Whether the caller can open it. */
  visible: boolean;
}

// ───────────── Countries ─────────────

export interface GeoCountry {
  code: string;
  /** English name; show Intl.DisplayNames in the reader's language where available. */
  name: string;
  dialCode: string;
  currency: string;
  timezones: readonly string[];
}

export const GEO_COUNTRIES: readonly GeoCountry[] = GEO_COUNTRY_ROWS.map(([code, name, dialCode, currency, timezones]) => ({
  code,
  name,
  dialCode,
  currency,
  timezones,
}));

const BY_CODE = new Map(GEO_COUNTRIES.map((c) => [c.code, c]));
export function geoCountry(code: string | null | undefined): GeoCountry | undefined {
  return code ? BY_CODE.get(code.toUpperCase()) : undefined;
}

/** Emoji flag from regional indicators (a fallback where the SVG flags cannot be shown, such as emails). */
export function flagEmoji(code: string): string {
  return /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
}

export interface GeoRegion {
  code: string;
  name: string;
  type: string;
}
export interface GeoCity {
  name: string;
  region: string | null;
}

// ───────────── Duplicate keys ─────────────

const LEGAL_SUFFIXES = new Set([
  'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'lp', 'pvt', 'private', 'plc', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'srl', 'spa',
  'bv', 'nv', 'oy', 'ab', 'as', 'pte', 'pty', 'kk', 'co', 'corp', 'corporation', 'company', 'group', 'holdings', 'the',
]);
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'mail.com', 'yandex.com', 'zoho.com', 'rediffmail.com', 'qq.com', '163.com']);

/** Company name for duplicate checks: case, accents, punctuation and legal suffixes ignored ("Acme Pvt. Ltd." = "ACME"). */
export function companyNameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    // Runs of single letters ("S A" from "S.A.", "I B M") become one word.
    .reduce<string[]>((acc, w, i, all) => {
      if (w.length === 1 && i > 0 && all[i - 1]!.length === 1) acc[acc.length - 1] += w;
      else acc.push(w);
      return acc;
    }, []);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[0]!)) words.shift();
  return words.join(' ') || null;
}

export function domainKey(urlOrDomain: string | null | undefined): string | null {
  if (!urlOrDomain) return null;
  const raw = urlOrDomain.trim().toLowerCase();
  const host = raw.includes('@') ? raw.split('@').pop()! : raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0]!;
  const d = host.replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !d.endsWith('linkedin.com') ? d : null;
}

export function phoneKey(phone: string | null | undefined): string | null {
  const d = phone?.replace(/\D/g, '') ?? '';
  return d.length >= 6 ? d.slice(-10) : null;
}

/** "https://www.linkedin.com/company/acme/" gives "company/acme". */
export function linkedinKey(url: string | null | undefined): string | null {
  const m = url ? /linkedin\.com\/((?:company|in|school|showcase)\/[^/?#]+)/i.exec(url) : null;
  return m ? decodeURIComponent(m[1]!).toLowerCase() : null;
}

/**
 * Keys stored on a record (match_keys) and looked up when checking for duplicates: d: domain, e: email, p: phone,
 * l: LinkedIn. With emailDomains (companies), a work email's domain counts as a domain too; free mail never does.
 */
export function matchKeys(input: { websites?: Array<string | null | undefined>; emails?: Array<string | null | undefined>; phones?: Array<string | null | undefined>; linkedin?: Array<string | null | undefined>; emailDomains?: boolean }): string[] {
  const keys = new Set<string>();
  for (const w of input.websites ?? []) {
    const d = domainKey(w);
    if (d) keys.add(`d:${d}`);
  }
  for (const e of input.emails ?? []) {
    const v = e?.trim().toLowerCase();
    if (!v || !v.includes('@')) continue;
    keys.add(`e:${v}`);
    const d = domainKey(v);
    if (d && !FREE_MAIL_DOMAINS.has(d) && input.emailDomains) keys.add(`d:${d}`);
  }
  for (const p of input.phones ?? []) {
    const k = phoneKey(p);
    if (k) keys.add(`p:${k}`);
  }
  for (const l of input.linkedin ?? []) {
    const k = linkedinKey(l);
    if (k) keys.add(`l:${k}`);
  }
  return [...keys].sort();
}
