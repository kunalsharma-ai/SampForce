import { z } from 'zod';
import { type WorkingHours, workingHoursSchema } from './client-time';
import { customFieldFiltersParam } from './custom-fields';
import { type FieldSource, type Leader, leaderSchema, type MoreDetail, moreDetailSchema, OPERATING_STATUSES, type SocialLink, socialLinkSchema } from './company-enrichment';

// ───────────── Shared building blocks ─────────────

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().email('Enter a valid email').nullable())
  .nullable()
  .optional();

/** Loose international phone check: digits with optional +, spaces, dashes, dots and brackets. */
const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().regex(/^\+?[0-9 ().-]{6,}$/, 'Enter a valid phone number').nullable())
  .nullable()
  .optional();

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter ISO country code').nullable())
  .nullable()
  .optional();

const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');
const uuidRef = z.string().uuid().nullable().optional();
const money = z.coerce.number().min(0).max(1e13);
export const customFieldValuesSchema = z.record(z.string(), z.unknown()).optional();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(80).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  ownerId: z.string().uuid().optional(),
  status: z.string().max(40).optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  /** Deals only: expected close date on or after / on or before (YYYY-MM-DD). */
  closeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  closeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  /** Custom field filters (ADR 0062): a JSON list of {key, op, value}. */
  cf: customFieldFiltersParam,
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OwnerRef {
  id: string;
  name: string;
}

// ───────────── Companies ─────────────

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`))
  .pipe(z.string().url('Enter a valid web address').refine((v) => /^https?:\/\//i.test(v), 'Use an http or https address').nullable())
  .nullable()
  .optional();

/** One of several emails, phones or links of a company or employee. */
const contactPoint = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, label: z.string().trim().max(60).nullable().optional(), primary: z.boolean().optional() });
const pointList = <T extends z.ZodTypeAny>(value: T) => z.array(contactPoint(value)).max(20).optional();
/** A list of short texts (services, certifications): trimmed, blanks and repeats dropped. */
const textList = (max: number) =>
  z
    .array(z.string().trim().max(max))
    .max(60)
    .transform((list) => [...new Map(list.filter(Boolean).map((v) => [v.toLowerCase(), v])).values()])
    .optional();
const requiredEmail = z.string().trim().toLowerCase().max(254).email('Enter a valid email');
const requiredPhone = z.string().trim().max(40).regex(/^\+?[0-9 ().-]{6,}$/, 'Enter a valid phone number');
const requiredUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .transform((v) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`))
  .pipe(z.string().url('Enter a valid web address').refine((v) => /^https?:\/\//i.test(v), 'Use an http or https address'));

export const companyAddressSchema = z.object({
  label: z.string().trim().max(60).nullable().optional(),
  country: countryCode,
  state: optionalText(120),
  city: optionalText(120),
  address: optionalText(500),
  postalCode: optionalText(20),
});
export type CompanyAddress = z.infer<typeof companyAddressSchema>;
export interface ContactPoint {
  value: string;
  label?: string | null;
  primary?: boolean;
}

export const COMPANY_TYPES = ['Private company', 'Public company', 'Partnership', 'Government agency', 'Non-profit', 'Educational institution', 'Self-employed', 'Other'] as const;

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a company name').max(200),
  domain: optionalText(253),
  industry: optionalText(120),
  country: countryCode,
  ownerId: uuidRef,
  parentCompanyId: uuidRef,
  customFields: customFieldValuesSchema,
  // Company-centric CRM (lead creation). The lead number, creator and timestamps are never accepted from input.
  statusId: uuidRef,
  managerId: uuidRef,
  pocUserId: uuidRef,
  departmentId: uuidRef,
  teamId: uuidRef,
  website: optionalUrl,
  linkedinUrl: optionalUrl,
  primaryEmail: optionalEmail,
  primaryPhone: optionalPhone,
  overview: optionalText(5000),
  foundedYear: z.coerce.number().int().min(1600).max(2100).nullable().optional(),
  branchCount: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  companySize: optionalText(40),
  companyType: optionalText(60),
  headquarters: optionalText(200),
  specialties: optionalText(1000),
  businessCategory: optionalText(120),
  state: optionalText(120),
  city: optionalText(120),
  address: optionalText(500),
  postalCode: optionalText(20),
  timezone: optionalText(64),
  /** Office hours on the company's clock (ADR 0089); null goes back to the country's usual day. */
  workingHours: workingHoursSchema.nullable().optional(),
  notes: optionalText(5000),
  emails: pointList(requiredEmail),
  phones: pointList(requiredPhone),
  websites: pointList(requiredUrl),
  linkedinUrls: pointList(requiredUrl),
  addresses: z.array(companyAddressSchema).max(50).optional(),
  // Business Information from public sources (ADR 0076); people can type or correct every one of them.
  services: textList(200),
  products: textList(200),
  industriesServed: textList(120),
  certifications: textList(120),
  founders: textList(160),
  employeeCount: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  legalName: optionalText(200),
  parentCompanyName: optionalText(200),
  ownership: optionalText(300),
  ceo: optionalText(160),
  leadership: z.array(leaderSchema).max(30).optional(),
  operatingStatus: z.enum(OPERATING_STATUSES).nullable().optional(),
  contactPageUrl: optionalUrl,
  socialLinks: z.array(socialLinkSchema).max(30).optional(),
  moreDetails: z.array(moreDetailSchema).max(40).optional(),
});
export const companyUpdateSchema = companyInputSchema.partial();
export type CompanyInput = z.infer<typeof companyInputSchema>;

/** A company's logo as the app shows it (ADR 0070). */
export interface CompanyLogoRef {
  /** Same-origin URL of the image; changes whenever the logo does, so it can be cached. Null while none is found. */
  url: string | null;
  /** AUTO (found from the website) or UPLOAD (chosen by someone). */
  source: 'AUTO' | 'UPLOAD';
  /** PENDING (still looking), FOUND, NOT_FOUND or FAILED. */
  status: 'PENDING' | 'FOUND' | 'NOT_FOUND' | 'FAILED';
  /** Pixel size of the image's larger side; null for SVG. Small icons are shown at a size that keeps them sharp. */
  width: number | null;
}

export interface CompanyRow {
  id: string;
  name: string;
  /** Null when no logo has been looked for (no website) and none was uploaded. */
  logo: CompanyLogoRef | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  owner: OwnerRef | null;
  parentCompany: { id: string; name: string } | null;
  contactCount: number;
  openDealCount: number;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  leadNumber: string | null;
  status: CrmStatusRef | null;
  statusChangedAt: string | null;
  /** The deal made or closed as won when the company became a client (ADR 0084). */
  wonDealId: string | null;
  wonAt: string | null;
  createdBy: PersonRef | null;
  updatedBy: PersonRef | null;
  manager: PersonRef | null;
  /** The internal point of contact (a workspace user), separate from the creator and the owner. */
  poc: PersonRef | null;
  /** The owner with their designation (owner above keeps its old shape). */
  ownerPerson: PersonRef | null;
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  website: string | null;
  linkedinUrl: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  overview: string | null;
  foundedYear: number | null;
  branchCount: number | null;
  companySize: string | null;
  companyType: string | null;
  headquarters: string | null;
  specialties: string | null;
  businessCategory: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  postalCode: string | null;
  timezone: string | null;
  workingHours: WorkingHours | null;
  notes: string | null;
  emails: ContactPoint[];
  phones: ContactPoint[];
  websites: ContactPoint[];
  linkedinUrls: ContactPoint[];
  addresses: CompanyAddress[];
  services: string[];
  products: string[];
  industriesServed: string[];
  certifications: string[];
  founders: string[];
  employeeCount: number | null;
  legalName: string | null;
  parentCompanyName: string | null;
  ownership: string | null;
  ceo: string | null;
  leadership: Leader[];
  operatingStatus: string | null;
  contactPageUrl: string | null;
  socialLinks: SocialLink[];
  moreDetails: MoreDetail[];
  /** AI summary of the company (ADR 0076), labelled as AI wherever it is shown. */
  aiSummary: string | null;
  aiSummaryAt: string | null;
  /** Where each Business Information value came from (auto-fill, or typed by someone). */
  fieldSources: Record<string, FieldSource>;
  /**
   * True when the record belongs to someone else and the caller's role may not see its details: contact details,
   * notes, overview and custom fields are left out.
   */
  restricted: boolean;
}

/** A CRM user shown with their designation ("Kunal Sharma – Business Development Manager"). */
export interface PersonRef {
  id: string;
  name: string;
  designation: string | null;
}

export interface CrmStatusRef {
  id: string;
  name: string;
  color: string;
  meaning: string | null;
}

// ───────────── Contacts ─────────────

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(120),
  lastName: optionalText(120),
  email: optionalEmail,
  phone: optionalPhone,
  jobTitle: optionalText(160),
  country: countryCode,
  timezone: optionalText(64),
  /** This person's own office hours (ADR 0089); null uses their company's. */
  workingHours: workingHoursSchema.nullable().optional(),
  companyId: uuidRef,
  ownerId: uuidRef,
  marketingConsent: z.enum(['UNKNOWN', 'OPTED_IN', 'OPTED_OUT']).optional(),
  customFields: customFieldValuesSchema,
  // Employee / POC fields (company-centric CRM). jobTitle is the designation, ownerId the assigned executive.
  statusId: uuidRef,
  department: optionalText(120),
  linkedinUrl: optionalUrl,
  state: optionalText(120),
  city: optionalText(120),
  remarks: optionalText(5000),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  emails: pointList(requiredEmail),
  phones: pointList(requiredPhone),
});
export const contactUpdateSchema = contactInputSchema.partial();
export type ContactInput = z.infer<typeof contactInputSchema>;

export interface ContactRow {
  id: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  country: string | null;
  timezone: string | null;
  workingHours: WorkingHours | null;
  company: { id: string; name: string } | null;
  owner: OwnerRef | null;
  marketingConsent: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT';
  consentSource: string | null;
  consentUpdatedAt: string | null;
  /** Last known state of the email address: bounced, needs_verification, valid, risky, … ; null = never checked. */
  emailStatus: EmailStatus | null;
  /** 0-100 from email engagement rules; null = never scored. */
  engagementScore: number | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  status: CrmStatusRef | null;
  statusChangedAt: string | null;
  statusChangedBy: PersonRef | null;
  department: string | null;
  linkedinUrl: string | null;
  state: string | null;
  city: string | null;
  remarks: string | null;
  nextFollowUpAt: string | null;
  emails: ContactPoint[];
  phones: ContactPoint[];
  ownerPerson: PersonRef | null;
  createdBy: PersonRef | null;
  /** See CompanyRow.restricted. */
  restricted: boolean;
}

// ───────────── Company leads: branches, the lead form, drafts, ownership, files (ADR 0060) ─────────────

export const branchInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a branch name').max(160),
  country: countryCode,
  state: optionalText(120),
  city: optionalText(120),
  address: optionalText(500),
  postalCode: optionalText(20),
  email: optionalEmail,
  phone: optionalPhone,
  contactPerson: optionalText(160),
  website: optionalUrl,
});
export type BranchInput = z.infer<typeof branchInputSchema>;

export interface BranchRow {
  id: string;
  companyId: string;
  name: string;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  postalCode: string | null;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  website: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An employee written in the lead form: the company is the lead being created. */
export const leadEmployeeSchema = contactInputSchema.omit({ companyId: true });
export type LeadEmployeeInput = z.infer<typeof leadEmployeeSchema>;

/** "+ Create new lead": the company, its branches and its employees, saved together in one transaction. */
export const companyLeadSchema = z.object({
  company: companyInputSchema,
  branches: z.array(branchInputSchema).max(50).default([]),
  employees: z.array(leadEmployeeSchema).max(50).default([]),
  /** The draft this lead was written in; it is deleted once the lead is saved. */
  draftId: z.string().uuid().optional(),
});
export type CompanyLeadInput = z.input<typeof companyLeadSchema>;

export interface CompanyLeadResult {
  company: CompanyRow;
  branchIds: string[];
  employeeIds: string[];
}

/** The steps of the lead form, in order. */
export const LEAD_FORM_STEPS = ['company', 'location', 'business', 'employees', 'ownership', 'status', 'remarks', 'review'] as const;
export type LeadFormStep = (typeof LEAD_FORM_STEPS)[number];

export const leadDraftSchema = z.object({
  step: z.number().int().min(0).max(LEAD_FORM_STEPS.length - 1).default(0),
  /** What was typed so far, as the form keeps it. Not validated until the lead is saved. */
  data: z
    .record(z.string(), z.unknown())
    .refine((d) => JSON.stringify(d).length <= 200_000, 'This draft is too large to save.'),
});
export type LeadDraftInput = z.input<typeof leadDraftSchema>;

export interface LeadDraftRow {
  id: string;
  /** The company name typed so far. */
  title: string | null;
  step: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Why a lead moved to someone else (section 16 of the specification), plus routine reassignment. */
export const LEAD_TRANSFER_REASONS = ['REASSIGNED', 'SENIOR_DISCUSSION', 'HIGH_VALUE', 'NEGOTIATION', 'CLIENT_CONCERN', 'TECHNICAL', 'MANAGEMENT', 'OTHER'] as const;
export type LeadTransferReason = (typeof LEAD_TRANSFER_REASONS)[number];

export const ownerChangeSchema = z.object({
  ownerId: z.string().uuid(),
  reason: z.enum(LEAD_TRANSFER_REASONS).nullable().optional(),
  note: optionalText(1000),
});
export type OwnerChangeInput = z.infer<typeof ownerChangeSchema>;

export interface OwnerChangeRow {
  id: string;
  from: PersonRef | null;
  to: PersonRef | null;
  by: PersonRef | null;
  reason: LeadTransferReason | null;
  note: string | null;
  createdAt: string;
}

/** Renaming a file kept with a company. The file itself does not change. */
export const companyFileRenameSchema = z.object({ name: z.string().trim().min(1, 'Enter a file name').max(200) }).strict();
export type CompanyFileRename = z.infer<typeof companyFileRenameSchema>;

export interface CompanyFileRow {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: PersonRef | null;
  createdAt: string;
}

/** An employee's relationship with the team, from activities, synced emails and tasks. */
export interface EmployeeStats {
  emailsSent: number;
  responsesReceived: number;
  calls: number;
  meetings: number;
  followUpsPending: number;
  lastInteractionAt: string | null;
  latestUpdate: { type: 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE'; subject: string; at: string } | null;
  nextFollowUpAt: string | null;
}

// ───────────── Leads ─────────────

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Qualification frameworks; answers are stored in custom_fields under `qualification`. */
export const QUALIFICATION_FRAMEWORKS = {
  BANT: ['budget', 'authority', 'need', 'timeline'],
  MEDDICC: ['metrics', 'economicBuyer', 'decisionCriteria', 'decisionProcess', 'identifyPain', 'champion', 'competition'],
} as const;

export const leadInputSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter a name').max(200),
  companyName: optionalText(200),
  jobTitle: optionalText(160),
  industry: optionalText(120),
  email: optionalEmail,
  phone: optionalPhone,
  country: countryCode,
  city: optionalText(120),
  timezone: optionalText(64),
  website: optionalText(253),
  source: optionalText(120),
  campaignSource: optionalText(120),
  campaignId: uuidRef,
  marketingConsent: z.enum(['UNKNOWN', 'OPTED_IN', 'OPTED_OUT']).optional(),
  estimatedValue: money.nullable().optional(),
  currency: currencyCode.nullable().optional(),
  status: z.enum(LEAD_STATUSES).exclude(['CONVERTED']).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  ownerId: uuidRef,
  customFields: customFieldValuesSchema,
});
export const leadUpdateSchema = leadInputSchema.partial();
export type LeadInput = z.infer<typeof leadInputSchema>;

export const leadConvertSchema = z.object({
  createDeal: z.boolean().default(true),
  dealName: z.string().trim().min(1).max(200).optional(),
  dealAmount: money.optional(),
  pipelineId: z.string().uuid().optional(),
  /** Attach to an existing company instead of creating or matching one by name. */
  companyId: z.string().uuid().optional(),
});
export type LeadConvertInput = z.infer<typeof leadConvertSchema>;

export const assignSchema = z.object({ ownerId: z.string().uuid() });

export interface LeadRow {
  id: string;
  fullName: string;
  companyName: string | null;
  jobTitle: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  source: string | null;
  campaignSource: string | null;
  campaignId: string | null;
  marketingConsent: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT';
  consentSource: string | null;
  consentUpdatedAt: string | null;
  /** Last known state of the email address: bounced, needs_verification, valid, risky, … ; null = never checked. */
  emailStatus: EmailStatus | null;
  /** 0-100 from email engagement rules; null = never scored. */
  engagementScore: number | null;
  estimatedValue: number | null;
  currency: string | null;
  status: LeadStatus;
  tags: string[];
  owner: OwnerRef | null;
  customFields: Record<string, unknown>;
  convertedAt: string | null;
  convertedContactId: string | null;
  convertedOpportunityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateCandidate {
  id: string;
  label: string;
  entity: 'lead' | 'contact';
  reason: 'email' | 'phone' | 'name_company';
}

export interface LeadConvertResult {
  leadId: string;
  contactId: string;
  companyId: string | null;
  opportunityId: string | null;
}

// ───────────── Pipelines & deals ─────────────

export const stageInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  probability: z.coerce.number().int().min(0).max(100),
  category: z.enum(['OPEN', 'WON', 'LOST']).default('OPEN'),
});
export const pipelineInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a pipeline name').max(80),
    stages: z.array(stageInputSchema).min(2, 'Add at least two stages').max(20),
  })
  .refine((p) => p.stages.some((s) => s.category === 'WON'), { message: 'Include a Won stage', path: ['stages'] })
  .refine((p) => p.stages.some((s) => s.category === 'LOST'), { message: 'Include a Lost stage', path: ['stages'] });
export type PipelineInput = z.infer<typeof pipelineInputSchema>;

export interface StageRow {
  id: string;
  name: string;
  position: number;
  probability: number;
  category: 'OPEN' | 'WON' | 'LOST';
}

export interface PipelineRow {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageRow[];
  dealCount: number;
}

export const DEAL_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type DealPriority = (typeof DEAL_PRIORITIES)[number];

export const dealInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a deal name').max(200),
  amount: money.default(0),
  currency: currencyCode.optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  companyId: uuidRef,
  contactId: uuidRef,
  ownerId: uuidRef,
  priority: z.enum(DEAL_PRIORITIES).nullable().optional(),
  customFields: customFieldValuesSchema,
  /** Revenue attribution (ADR 0063): the assigned manager and the people who helped win the deal. */
  managerId: uuidRef,
  supportingUserIds: z.array(z.string().uuid()).max(20).optional(),
});
export const dealUpdateSchema = dealInputSchema.partial();
export type DealInput = z.infer<typeof dealInputSchema>;

export const dealMoveSchema = z.object({
  stageId: z.string().uuid(),
  lossReason: z.string().trim().max(300).optional(),
});
export type DealMoveInput = z.infer<typeof dealMoveSchema>;

export interface DealRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  probability: number | null;
  effectiveProbability: number;
  status: 'OPEN' | 'WON' | 'LOST';
  expectedCloseDate: string | null;
  closedAt: string | null;
  lossReason: string | null;
  priority: DealPriority | null;
  /** Latest stored health score (deal intelligence), or null when the deal has not been scored yet. */
  health: { score: number; risk: 'low' | 'medium' | 'high'; computedAt: string } | null;
  pipeline: { id: string; name: string };
  stage: StageRow;
  company: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  owner: OwnerRef | null;
  sourceLeadId: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** DEAL-0001; null for deals numbered on the next set-up run. */
  dealNumber: string | null;
  managerId: string | null;
  leadCreatorId: string | null;
  supportingUserIds: string[];
}

/** One open deal in the priority view, with the reasons it ranks where it does. */
export interface PriorityDeal {
  deal: DealRow;
  score: number;
  reasons: string[];
}

/** Open deals grouped by expected close month (plus overdue and undated), for the forecast view. */
export interface DealForecastBucket {
  key: string;
  label: string;
  count: number;
  value: number;
  weighted: number;
  deals: DealRow[];
}
export interface DealForecast {
  currency: string;
  buckets: DealForecastBucket[];
}

export interface DealHistoryItem {
  id: string;
  action: string;
  actorName: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const bulkDealUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  ownerId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
});

// ───────────── Activities & tasks ─────────────

export const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE'] as const;

const relatedRefs = {
  leadId: uuidRef,
  contactId: uuidRef,
  companyId: uuidRef,
  opportunityId: uuidRef,
};

export const activityInputSchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().trim().min(1, 'Enter a subject').max(200),
  body: optionalText(10_000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  ...relatedRefs,
});
export type ActivityInput = z.infer<typeof activityInputSchema>;

/** Editing a logged activity: what it was, what happened and when. The records it is linked to stay as they are. */
export const activityUpdateSchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES).optional(),
    subject: z.string().trim().min(1, 'Enter a subject').max(200).optional(),
    body: optionalText(10_000),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type ActivityUpdate = z.infer<typeof activityUpdateSchema>;

export interface ActivityRow {
  id: string;
  type: (typeof ACTIVITY_TYPES)[number];
  subject: string;
  body: string | null;
  occurredAt: string;
  owner: OwnerRef | null;
  aiAssisted: boolean;
  leadId: string | null;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  /** Set once someone has changed the activity after logging it. */
  editedAt?: string | null;
  /** The interaction kind when it was logged as a company interaction; its type then follows that kind. */
  interaction?: string | null;
}

/** States an email address can be in. Provider checks (Prospect Finder) and bounces set them. */
export const EMAIL_STATUSES = ['valid', 'risky', 'catch_all', 'invalid', 'unknown', 'bounced', 'needs_verification'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  valid: 'Verified',
  risky: 'Risky',
  catch_all: 'Accept-all domain',
  invalid: 'Invalid',
  unknown: 'Could not check',
  bounced: 'Bounced',
  needs_verification: 'Check before emailing',
};

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200),
  priority: z.enum(TASK_PRIORITIES).optional(),
  description: optionalText(5_000),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  assigneeId: uuidRef,
  leadId: uuidRef,
  contactId: uuidRef,
  opportunityId: uuidRef,
});
export const taskUpdateSchema = taskInputSchema.partial().extend({
  status: z.enum(['OPEN', 'DONE', 'CANCELED']).optional(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['OPEN', 'DONE', 'CANCELED']).default('OPEN'),
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
});

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: 'OPEN' | 'DONE' | 'CANCELED';
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  overdue: boolean;
  assignee: OwnerRef | null;
  leadId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  createdAt: string;
}

// Custom fields live in custom-fields.ts (ADR 0062).

// ───────────── Search ─────────────

export interface SearchHit {
  entity: 'lead' | 'contact' | 'company' | 'deal' | 'rfq';
  id: string;
  title: string;
  subtitle: string | null;
  score: number;
}

// ───────────── Import ─────────────

/** `companies_contacts`: one row is a company and one of its employees (ADR 0066). */
export const IMPORT_ENTITIES = ['leads', 'contacts', 'companies', 'companies_contacts'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

/**
 * Mapping targets that create a custom field from the column's heading while importing: `new` on a single-record
 * import, `new:company` or `new:contact` on the combined one.
 */
export const NEW_FIELD_TARGETS = ['new', 'new:company', 'new:contact'] as const;

export const importRequestSchema = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  /** Raw CSV text (UTF-8). Files up to 2 MB / 5,000 rows are processed synchronously. */
  csv: z.string().min(1).max(2_000_000),
  /** CSV header → field key. Unmapped columns are ignored. */
  mapping: z.record(z.string(), z.string()).default({}),
  /** Map the columns the mapping leaves out by their headings, and turn the ones nothing matches into new custom fields. */
  autoMap: z.boolean().default(false),
  duplicateStrategy: z.enum(['skip', 'create']).default('skip'),
  dryRun: z.boolean().default(false),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

/** A custom field the import adds (dry run: would add) for a column no existing field matched. */
export interface ImportNewField {
  column: string;
  entity: 'COMPANY' | 'CONTACT' | 'LEAD';
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER';
}

export interface ImportResult {
  entity: ImportEntity;
  dryRun: boolean;
  totalRows: number;
  /** Rows imported (dry run: rows that would be). */
  created: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
  /** The mapping that was used, after automatic matching. */
  mapping?: Record<string, string>;
  newFields?: ImportNewField[];
  /** Combined import: companies created, existing companies the rows were matched to, and employees created. */
  companiesCreated?: number;
  companiesMatched?: number;
  contactsCreated?: number;
}

/** POST /imports/file: an Excel workbook (sent as the request body) read into CSV text for the import. */
export interface ImportFileResult {
  csv: string;
  sheet: string;
  rows: number;
}

// ───────────── Invitations ─────────────

export const invitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  roleKey: z.string().min(1).max(40),
});
export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(1).max(200).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type InvitationInput = z.infer<typeof invitationInputSchema>;
export interface InvitationRow {
  id: string;
  email: string;
  roleKey: string;
  roleName: string;
  expiresAt: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

/** Returned once, when an invitation is created. Email delivery is not configured yet, so the inviter shares the link. */
export interface InvitationCreated extends InvitationRow {
  inviteUrl: string;
  emailDelivery: 'not_configured';
}

/** Public preview shown on the accept page before the invitee signs in or creates an account. */
export interface InvitationPreview {
  tenantName: string;
  email: string;
  roleName: string;
  hasAccount: boolean;
  /** The name the inviter typed (W5), to pre-fill a new account. */
  name?: string;
}

/** Shared field builders, for the company-centric CRM schemas (company-crm.ts). */
export const fieldSchemas = { optionalText, optionalEmail, optionalPhone, countryCode, uuidRef };
