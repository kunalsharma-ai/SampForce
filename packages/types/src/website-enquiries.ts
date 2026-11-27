import { z } from 'zod';

/*
 * Website Enquiry (ADR 0095). Every enquiry form, download form, case study and resource download, live chat enquiry,
 * newsletter sign-up and review sent on the company website reaches SampForce from the website's "Sampforce API":
 * a signed webhook within seconds, and a pull sync every few minutes as a safety net. Both carry the website's own id,
 * so a record arriving both ways is one row.
 */

/** The website's statuses for a lead; SampForce uses the same six and sends a change back to the website. */
export const ENQUIRY_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  won: 'Won',
  lost: 'Lost',
  spam: 'Spam',
};

/** What arrived: the website endpoint that received a lead, or a newsletter sign-up or a review. */
export const ENQUIRY_TYPES = ['enquiry', 'download', 'resource-download', 'case-study-download', 'chat', 'newsletter', 'review', 'careers'] as const;
export type EnquiryType = (typeof ENQUIRY_TYPES)[number];
export const ENQUIRY_TYPE_LABELS: Record<EnquiryType, string> = {
  enquiry: 'Enquiry forms',
  download: 'Download forms',
  'resource-download': 'Resource downloads',
  'case-study-download': 'Case study downloads',
  chat: 'Live chat enquiries',
  newsletter: 'Newsletter sign-ups',
  review: 'Reviews',
  careers: 'Job applications',
};

/** The website's enquiry kind for follow-up (it works it out; its super admin can change it). */
export const ENQUIRY_CATEGORIES = ['service', 'rfq', 'partnership', 'contact', 'download', 'chat', 'newsletter', 'review', 'careers', 'other'] as const;
export type EnquiryCategory = (typeof ENQUIRY_CATEGORIES)[number];
export const ENQUIRY_CATEGORY_LABELS: Record<EnquiryCategory, string> = {
  service: 'Service',
  rfq: 'RFQ',
  partnership: 'Partnership',
  contact: 'Contact',
  download: 'Download',
  chat: 'Chat',
  newsletter: 'Newsletter',
  review: 'Review',
  careers: 'Careers',
  other: 'Other',
};

export const ENQUIRY_RECORDS = ['lead', 'contact', 'review'] as const;
export type EnquiryRecord = (typeof ENQUIRY_RECORDS)[number];

/** A known value, or the fallback, so a new type or category on the website never breaks the list. */
export function knownType(v: unknown): EnquiryType {
  return (ENQUIRY_TYPES as readonly string[]).includes(String(v)) ? (v as EnquiryType) : 'enquiry';
}
export function knownCategory(v: unknown): EnquiryCategory {
  return (ENQUIRY_CATEGORIES as readonly string[]).includes(String(v)) ? (v as EnquiryCategory) : 'other';
}
export function knownStatus(v: unknown): EnquiryStatus {
  return (ENQUIRY_STATUSES as readonly string[]).includes(String(v)) ? (v as EnquiryStatus) : 'new';
}

// ───────────── What the website sends (lenient: unknown fields are kept in `raw`) ─────────────

const text = z.preprocess((v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v)), z.string().max(20_000));
const stamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Use a date like 2026-11-02');
const fieldMap = z.record(z.string(), z.unknown()).nullable().optional();

export const websiteContactPartSchema = z
  .object({
    name: text.optional(),
    firstName: text.optional(),
    lastName: text.optional(),
    email: text.optional(),
    phone: text.optional(),
    countryCode: text.optional(),
    country: text.optional(),
    company: text.optional(),
    designation: text.optional(),
  })
  .passthrough();

/** A lead from GET /leads, GET /leads/:id or a lead.* webhook. */
export const websiteLeadSchema = z
  .object({
    id: z.string().min(1).max(200),
    object: z.literal('lead').optional(),
    type: text.optional(),
    category: text.optional(),
    status: text.optional(),
    createdAt: stamp,
    updatedAt: stamp.optional(),
    form: z.object({ key: text.optional(), name: text.optional() }).passthrough().nullable().optional(),
    contact: websiteContactPartSchema.nullable().optional(),
    enquiry: z
      .object({ service: text.optional(), timeline: text.optional(), message: text.optional(), resource: text.optional(), title: text.optional(), interest: text.optional() })
      .passthrough()
      .nullable()
      .optional(),
    page: text.optional(),
    consent: z.boolean().nullable().optional(),
    extraFields: fieldMap,
    otherFields: fieldMap,
    owner: text.optional(),
    adminNote: text.optional(),
    backfill: z.boolean().optional(),
  })
  .passthrough();
export type WebsiteLead = z.infer<typeof websiteLeadSchema>;

/** A contact from GET /contacts or a newsletter.subscribed webhook (one per email address). */
export const websiteContactSchema = z
  .object({
    id: z.string().min(1).max(320),
    object: z.literal('contact').optional(),
    email: text,
    name: text.optional(),
    phone: text.optional(),
    company: text.optional(),
    country: text.optional(),
    designation: text.optional(),
    subscribed: z.boolean().nullable().optional(),
    subscribedAt: z.string().nullable().optional(),
    forms: z.array(z.string()).nullable().optional(),
    sources: z.array(z.string()).nullable().optional(),
    createdAt: stamp,
    updatedAt: stamp.optional(),
  })
  .passthrough();
export type WebsiteContact = z.infer<typeof websiteContactSchema>;

/** A review from GET /reviews or a review.created webhook. */
export const websiteReviewSchema = z
  .object({
    id: z.string().min(1).max(200),
    object: z.literal('review').optional(),
    status: text.optional(),
    rating: z.coerce.number().min(0).max(10).nullable().optional(),
    review: text.optional(),
    services: z.array(z.string()).nullable().optional(),
    reply: text.optional(),
    contact: websiteContactPartSchema.nullable().optional(),
    page: text.optional(),
    createdAt: stamp,
    updatedAt: stamp.optional(),
  })
  .passthrough();
export type WebsiteReview = z.infer<typeof websiteReviewSchema>;

export const WEBSITE_EVENTS = ['lead.created', 'lead.updated', 'newsletter.subscribed', 'review.created', 'careers.created', 'ping'] as const;
export type WebsiteEvent = (typeof WEBSITE_EVENTS)[number];

export const websiteDeliverySchema = z
  .object({
    id: z.string().min(1).max(200),
    event: z.string().min(1).max(80),
    createdAt: z.string().optional(),
    attempt: z.number().optional(),
    data: z.unknown(),
  })
  .passthrough();

// ───────────── SampForce API ─────────────

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(z.enum(values)).max(values.length).optional());

export const ENQUIRY_VIEWS = ['all', 'unread', 'starred', 'open', 'converted'] as const;
export type EnquiryView = (typeof ENQUIRY_VIEWS)[number];

export const enquiryListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  view: z.enum(ENQUIRY_VIEWS).default('all'),
  status: csv(ENQUIRY_STATUSES),
  type: csv(ENQUIRY_TYPES),
  category: csv(ENQUIRY_CATEGORIES),
  form: z.string().trim().max(120).optional(),
  /** Only those sent on or after this day (YYYY-MM-DD) or time. */
  since: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Use a date like 2026-11-02').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type EnquiryListQuery = z.infer<typeof enquiryListQuerySchema>;

export const enquiryUpdateSchema = z
  .object({
    status: z.enum(ENQUIRY_STATUSES).optional(),
    stage: z.string().trim().max(80).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    starred: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type EnquiryUpdateInput = z.infer<typeof enquiryUpdateSchema>;

/** Convert into a company and employee: the suggested matches unless another company is chosen. */
export const enquiryConvertSchema = z.object({
  /** An existing company to add the employee to; omitted = the matched company, else a new one from the enquiry. */
  companyId: z.string().uuid().nullable().optional(),
  /** A company name to create when no company matches (defaults to the one on the enquiry). */
  companyName: z.string().trim().min(1).max(200).optional(),
  /** Also create the employee (default true). False links only the company. */
  createEmployee: z.boolean().default(true),
});
export type EnquiryConvertInput = z.infer<typeof enquiryConvertSchema>;

export interface EnquiryPersonRef {
  id: string;
  name: string;
}

export interface EnquiryWriteBack {
  /** waiting: queued for the website; sent: the website has it; failed: it gave up after several tries; none: nothing to send. */
  state: 'none' | 'waiting' | 'sent' | 'failed';
  at: string | null;
  error: string | null;
}

export interface EnquiryRow {
  id: string;
  record: EnquiryRecord;
  externalId: string;
  type: EnquiryType;
  category: EnquiryCategory;
  status: EnquiryStatus;
  websiteStatus: string | null;
  form: { key: string | null; name: string | null };
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  countryCode: string | null;
  company: string | null;
  designation: string | null;
  service: string | null;
  message: string | null;
  resource: string | null;
  rating: number | null;
  submittedAt: string;
  receivedAt: string;
  source: 'webhook' | 'pull';
  /** Not yet opened by anyone in SampForce. */
  unread: boolean;
  starred: boolean;
  assignee: EnquiryPersonRef | null;
  stage: string | null;
  converted: { company: EnquiryPersonRef | null; contact: EnquiryPersonRef | null } | null;
}

export interface EnquiryDetail extends EnquiryRow {
  timeline: string | null;
  page: string | null;
  consent: boolean;
  subscribed: boolean | null;
  fields: { label: string; value: string }[];
  websiteOwner: string | null;
  websiteNote: string | null;
  note: string | null;
  websiteUpdatedAt: string;
  lastSyncedAt: string;
  seen: { at: string; by: string | null } | null;
  convertedAt: string | null;
  writeBack: EnquiryWriteBack;
  /** What "Convert" would use: an existing employee with the same email and an existing company by name or domain. */
  matches: { contact: (EnquiryPersonRef & { companyId: string | null }) | null; company: EnquiryPersonRef | null };
}

export interface EnquiryPage {
  items: EnquiryRow[];
  total: number;
}

export interface EnquiryCount<K extends string = string> {
  key: K;
  label: string;
  count: number;
  unread: number;
}

export interface EnquirySummary {
  /** Whether the Console set this workspace as the one that receives the website's enquiries. */
  connected: boolean;
  total: number;
  unread: number;
  today: number;
  week: number;
  converted: number;
  /** Converted share of leads (not sign-ups or reviews), 0-100, or null before the first lead. */
  conversionRate: number | null;
  byType: EnquiryCount<EnquiryType>[];
  byCategory: EnquiryCount<EnquiryCategory>[];
  byStatus: EnquiryCount<EnquiryStatus>[];
  byForm: EnquiryCount[];
  /** Arrivals per day for the last 14 days, oldest first (UTC days). */
  daily: { day: string; count: number }[];
  /** The newest unread ones, for the "just in" strip. */
  latest: EnquiryRow[];
  averageRating: number | null;
  sync: EnquirySyncStatus;
}

export interface EnquirySyncStatus {
  configured: boolean;
  /** The last signed webhook delivery that arrived, and the last one refused. */
  lastDelivery: { at: string; event: string } | null;
  lastRefused: { at: string; reason: string } | null;
  /** The last pull sync. */
  lastPull: { at: string; ok: boolean; message: string; received: number } | null;
  nextPullAt: string | null;
}

export interface EnquiryConvertResult {
  enquiry: EnquiryDetail;
  company: EnquiryPersonRef | null;
  contact: EnquiryPersonRef | null;
  created: { company: boolean; contact: boolean };
}
