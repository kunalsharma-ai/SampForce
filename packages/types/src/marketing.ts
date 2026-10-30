import { z } from 'zod';
import type { OwnerRef } from './crm';

/** Segments, hosted lead forms with consent, and campaigns with first-touch attribution. */
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal('').transform(() => null));

export const MARKETING_CONSENT = ['UNKNOWN', 'OPTED_IN', 'OPTED_OUT'] as const;
export type MarketingConsent = (typeof MARKETING_CONSENT)[number];

// ───────────── Segments ─────────────

export type SegmentEntity = 'lead' | 'contact';
type FieldType = 'enum' | 'text' | 'number' | 'days' | 'tag' | 'boolean';
export interface SegmentFieldDef {
  label: string;
  type: FieldType;
  options?: readonly string[];
}

const OPS_BY_TYPE: Record<FieldType, readonly SegmentOp[]> = {
  enum: ['eq', 'neq'],
  text: ['eq', 'contains', 'is_empty', 'is_not_empty'],
  number: ['gte', 'lte'],
  days: ['lte'],
  tag: ['has', 'not_has'],
  boolean: ['is_true', 'is_false'],
};

export const SEGMENT_OPS = ['eq', 'neq', 'contains', 'is_empty', 'is_not_empty', 'gte', 'lte', 'has', 'not_has', 'is_true', 'is_false'] as const;
export type SegmentOp = (typeof SEGMENT_OPS)[number];

export const SEGMENT_OP_LABELS: Record<SegmentOp, string> = {
  eq: 'is', neq: 'is not', contains: 'contains', is_empty: 'is empty', is_not_empty: 'is not empty',
  gte: 'is at least', lte: 'is at most', has: 'has tag', not_has: 'does not have tag', is_true: 'is yes', is_false: 'is no',
};

export const SEGMENT_FIELDS: Record<SegmentEntity, Record<string, SegmentFieldDef>> = {
  lead: {
    status: { label: 'Status', type: 'enum', options: ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'] },
    marketingConsent: { label: 'Marketing consent', type: 'enum', options: MARKETING_CONSENT },
    source: { label: 'Source', type: 'text' },
    campaignSource: { label: 'Campaign source', type: 'text' },
    industry: { label: 'Industry', type: 'text' },
    country: { label: 'Country (2-letter code)', type: 'text' },
    estimatedValue: { label: 'Estimated value', type: 'number' },
    aiScore: { label: 'AI score', type: 'number' },
    tags: { label: 'Tags', type: 'tag' },
    createdWithinDays: { label: 'Created within (days)', type: 'days' },
    hasEmail: { label: 'Has an email address', type: 'boolean' },
  },
  contact: {
    marketingConsent: { label: 'Marketing consent', type: 'enum', options: MARKETING_CONSENT },
    jobTitle: { label: 'Job title', type: 'text' },
    country: { label: 'Country (2-letter code)', type: 'text' },
    createdWithinDays: { label: 'Created within (days)', type: 'days' },
    hasEmail: { label: 'Has an email address', type: 'boolean' },
    hasCompany: { label: 'Linked to a company', type: 'boolean' },
  },
};

export const opsFor = (entity: SegmentEntity, field: string): readonly SegmentOp[] => {
  const def = SEGMENT_FIELDS[entity][field];
  return def ? OPS_BY_TYPE[def.type] : [];
};

export const segmentRuleSchema = z.object({
  field: z.string().min(1).max(40),
  op: z.enum(SEGMENT_OPS),
  value: z.union([z.string().max(200), z.number()]).nullable().optional(),
});
export type SegmentRule = z.infer<typeof segmentRuleSchema>;

export const segmentRulesSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(segmentRuleSchema).max(20),
});
export type SegmentRules = z.infer<typeof segmentRulesSchema>;

export const segmentInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    description: text(1000),
    entity: z.enum(['lead', 'contact']),
    rules: segmentRulesSchema,
  })
  .superRefine((v, ctx) => {
    v.rules.rules.forEach((r, i) => {
      const def = SEGMENT_FIELDS[v.entity][r.field];
      if (!def) return ctx.addIssue({ code: 'custom', path: ['rules', 'rules', i, 'field'], message: `Unknown field ${r.field}` });
      if (!OPS_BY_TYPE[def.type].includes(r.op)) ctx.addIssue({ code: 'custom', path: ['rules', 'rules', i, 'op'], message: `${SEGMENT_OP_LABELS[r.op]} does not apply to ${def.label}` });
      const needsValue = !['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(r.op);
      if (needsValue && (r.value === null || r.value === undefined || r.value === '')) ctx.addIssue({ code: 'custom', path: ['rules', 'rules', i, 'value'], message: `Enter a value for ${def.label}` });
      if ((def.type === 'number' || def.type === 'days') && needsValue && Number.isNaN(Number(r.value))) ctx.addIssue({ code: 'custom', path: ['rules', 'rules', i, 'value'], message: `${def.label} needs a number` });
      if (def.options && needsValue && !def.options.includes(String(r.value))) ctx.addIssue({ code: 'custom', path: ['rules', 'rules', i, 'value'], message: `Choose one of ${def.options.join(', ')}` });
    });
  });
export type SegmentInput = z.infer<typeof segmentInputSchema>;

export interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  entity: SegmentEntity;
  rules: SegmentRules;
  createdBy: OwnerRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentPreview {
  total: number;
  /** Members who opted in to marketing; only these may receive marketing messages. */
  optedIn: number;
  optedOut: number;
  sample: { id: string; name: string; email: string | null; marketingConsent: MarketingConsent }[];
}

// ───────────── Forms ─────────────

export const FORM_FIELD_KEYS = ['fullName', 'email', 'phone', 'companyName', 'jobTitle', 'country', 'message'] as const;
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number];
export const FORM_FIELD_LABELS: Record<FormFieldKey, string> = {
  fullName: 'Full name', email: 'Work email', phone: 'Phone', companyName: 'Company', jobTitle: 'Job title', country: 'Country', message: 'How can we help?',
};

export const formFieldSchema = z.object({ key: z.enum(FORM_FIELD_KEYS), label: z.string().trim().min(1).max(80), required: z.boolean() });

export const leadFormInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    title: z.string().trim().min(1).max(160),
    intro: text(1000),
    fields: z.array(formFieldSchema).min(1).max(FORM_FIELD_KEYS.length),
    consentText: text(1000),
    successMessage: z.string().trim().min(1).max(500).default('Thank you. We will be in touch soon.'),
    source: z.string().trim().min(1).max(120).default('web_form'),
    campaignId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid().optional(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.fields.some((f) => f.key === 'fullName' && f.required), { message: 'The form must ask for a full name', path: ['fields'] })
  .refine((v) => new Set(v.fields.map((f) => f.key)).size === v.fields.length, { message: 'Each field can appear once', path: ['fields'] });
export type LeadFormInput = z.infer<typeof leadFormInputSchema>;

export interface LeadFormRow {
  id: string;
  name: string;
  publicToken: string;
  title: string;
  intro: string | null;
  fields: z.infer<typeof formFieldSchema>[];
  consentText: string | null;
  successMessage: string;
  source: string;
  campaign: { id: string; name: string } | null;
  owner: OwnerRef | null;
  active: boolean;
  submissions: number;
  createdAt: string;
}

/** What the public form page needs; nothing about the workspace beyond the form itself. */
export interface PublicFormView {
  title: string;
  intro: string | null;
  fields: z.infer<typeof formFieldSchema>[];
  consentText: string | null;
}

/** Builds the submission schema for one form, so the server validates exactly the fields it asked for. */
export function formSubmissionSchema(fields: z.infer<typeof formFieldSchema>[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny =
      f.key === 'email'
        ? z.string().trim().toLowerCase().email('Enter a valid email address').max(254)
        : f.key === 'country'
          ? z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code')
          : z.string().trim().min(1, `Enter ${f.label.toLowerCase()}`).max(f.key === 'message' ? 2000 : 200);
    if (!f.required) s = s.optional().or(z.literal('').transform(() => undefined));
    shape[f.key] = s;
  }
  return z.object({
    ...shape,
    consent: z.boolean().default(false),
    /** Honeypot: people never see or fill it. */
    website: z.string().max(0, 'Spam detected').optional().or(z.literal('')),
  });
}

// ───────────── Campaigns ─────────────

export const CAMPAIGN_CHANNELS = ['email', 'event', 'webinar', 'paid_ads', 'content', 'social', 'partner', 'other'] as const;

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(160),
    channel: z.enum(CAMPAIGN_CHANNELS),
    status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']).default('PLANNED'),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    budget: z.coerce.number().min(0).max(1e12).nullable().optional(),
    currency: currencyCode.optional(),
    utmCampaign: text(120),
    ownerId: z.string().uuid().nullable().optional(),
    description: text(2000),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });
export type CampaignInput = z.infer<typeof campaignInputSchema>;

export interface CampaignResults {
  leads: number;
  qualified: number;
  converted: number;
  deals: number;
  pipeline: number;
  won: number;
  wonDeals: number;
  /** Budget ÷ leads; null without a budget or leads. */
  costPerLead: number | null;
  /** Won ÷ budget; null without a budget. */
  returnOnSpend: number | null;
  /** Deals in another currency are left out of the money figures. */
  otherCurrencyDeals: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  channel: (typeof CAMPAIGN_CHANNELS)[number];
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  currency: string;
  utmCampaign: string | null;
  owner: OwnerRef | null;
  description: string | null;
  results: CampaignResults;
  createdAt: string;
}

export function campaignRatios(budget: number | null, leads: number, won: number): Pick<CampaignResults, 'costPerLead' | 'returnOnSpend'> {
  return {
    costPerLead: budget && leads ? Math.round((budget / leads) * 100) / 100 : null,
    returnOnSpend: budget ? Math.round((won / budget) * 100) / 100 : null,
  };
}

export const consentUpdateSchema = z.object({ marketingConsent: z.enum(MARKETING_CONSENT) });
