import { z } from 'zod';

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
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  ownerId: z.string().uuid().optional(),
  status: z.string().max(40).optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
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

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a company name').max(200),
  domain: optionalText(253),
  industry: optionalText(120),
  country: countryCode,
  ownerId: uuidRef,
  parentCompanyId: uuidRef,
  customFields: customFieldValuesSchema,
});
export const companyUpdateSchema = companyInputSchema.partial();
export type CompanyInput = z.infer<typeof companyInputSchema>;

export interface CompanyRow {
  id: string;
  name: string;
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
  companyId: uuidRef,
  ownerId: uuidRef,
  customFields: customFieldValuesSchema,
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
  company: { id: string; name: string } | null;
  owner: OwnerRef | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  customFields: customFieldValuesSchema,
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
  pipeline: { id: string; name: string };
  stage: StageRow;
  company: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  owner: OwnerRef | null;
  sourceLeadId: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
}

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200),
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
  dueAt: string | null;
  completedAt: string | null;
  overdue: boolean;
  assignee: OwnerRef | null;
  leadId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  createdAt: string;
}

// ───────────── Custom fields ─────────────

export const CUSTOM_FIELD_ENTITIES = ['LEAD', 'CONTACT', 'COMPANY', 'OPPORTUNITY'] as const;
export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'] as const;

export const customFieldDefSchema = z
  .object({
    entity: z.enum(CUSTOM_FIELD_ENTITIES),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, digits and underscores, starting with a letter'),
    label: z.string().trim().min(1).max(80),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    required: z.boolean().default(false),
  })
  .refine((d) => d.type !== 'SELECT' || d.options.length > 0, { message: 'Add at least one option', path: ['options'] });
export type CustomFieldDefInput = z.infer<typeof customFieldDefSchema>;

export interface CustomFieldDef {
  id: string;
  entity: (typeof CUSTOM_FIELD_ENTITIES)[number];
  key: string;
  label: string;
  type: (typeof CUSTOM_FIELD_TYPES)[number];
  options: string[];
  required: boolean;
  position: number;
}

// ───────────── Search ─────────────

export interface SearchHit {
  entity: 'lead' | 'contact' | 'company' | 'deal';
  id: string;
  title: string;
  subtitle: string | null;
  score: number;
}

// ───────────── Import ─────────────

export const IMPORT_ENTITIES = ['leads', 'contacts', 'companies'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const importRequestSchema = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  /** Raw CSV text (UTF-8). Files up to 2 MB / 5,000 rows are processed synchronously. */
  csv: z.string().min(1).max(2_000_000),
  /** CSV header → field key. Unmapped columns are ignored. */
  mapping: z.record(z.string(), z.string()),
  duplicateStrategy: z.enum(['skip', 'create']).default('skip'),
  dryRun: z.boolean().default(false),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export interface ImportResult {
  entity: ImportEntity;
  dryRun: boolean;
  totalRows: number;
  created: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
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
}
