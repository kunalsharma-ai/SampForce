import { z } from 'zod';

/*
 * Custom fields (ADR 0061). An administrator adds typed fields to companies, employees, inbound leads, deals,
 * follow-ups and RFQs in Settings → CRM configuration → Custom fields. Values live in the record's `custom_fields`
 * document under the field's key. A field can be required, have a default, be shown to and edited by some
 * designations only, be switched off without losing its values, and be searched, filtered, reported and exported.
 */

export const CUSTOM_FIELD_ENTITIES = ['COMPANY', 'CONTACT', 'LEAD', 'OPPORTUNITY', 'FOLLOW_UP', 'RFQ'] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'CURRENCY',
  'DATE',
  'DATETIME',
  'SELECT',
  'MULTISELECT',
  'CHECKBOX',
  'BOOLEAN',
  'URL',
  'EMAIL',
  'PHONE',
  'FILE',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Everything a workspace had before ADR 0061. The rest needs the `custom_fields_advanced` plan feature. */
export const BASIC_CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'];
export const BASIC_CUSTOM_FIELD_ENTITIES: readonly CustomFieldEntity[] = ['COMPANY', 'CONTACT', 'LEAD', 'OPPORTUNITY'];

export const CHOICE_FIELD_TYPES: readonly CustomFieldType[] = ['SELECT', 'MULTISELECT'];
/** Types whose values are plain text that global search can look through. */
export const SEARCHABLE_FIELD_TYPES: readonly CustomFieldType[] = ['TEXT', 'TEXTAREA', 'SELECT', 'MULTISELECT', 'URL', 'EMAIL', 'PHONE'];

export const CUSTOM_FIELD_LIMITS = { perEntity: 100, options: 100, text: 2_000, textarea: 10_000, files: 5, fileBytes: 10 * 1024 * 1024 } as const;

const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');
const optionalDescription = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** A stored file value: the upload's id and what to show. */
export interface CustomFieldFile {
  id: string;
  name: string;
  size: number;
  contentType: string;
}
export interface CurrencyValue {
  amount: number;
  currency: string;
}

const definitionShape = {
  label: z.string().trim().min(1, 'Enter a name').max(80),
  description: optionalDescription,
  options: z.array(z.string().trim().min(1).max(80)).max(CUSTOM_FIELD_LIMITS.options).default([]),
  required: z.boolean().default(false),
  /** Stored as the field's value type; checked against the type by the API. */
  defaultValue: z.unknown().optional(),
  /** CURRENCY: the currency a bare number means. */
  currency: currencyCode.nullable().optional(),
  /** Designation ids that may see the field. Empty: everyone who can see the record's details. */
  viewDesignationIds: z.array(z.string().uuid()).max(100).default([]),
  /** Designation ids that may change it. Empty: everyone who can change the record. */
  editDesignationIds: z.array(z.string().uuid()).max(100).default([]),
  /** Shown on create forms (the lead form for companies and employees). Off: only on the record page. */
  showInForms: z.boolean().default(true),
  /** Global search looks through the value (text-like types only). */
  searchable: z.boolean().default(false),
  active: z.boolean().default(true),
};

function checkChoices(d: { type?: CustomFieldType; options?: string[] }, ctx: z.RefinementCtx) {
  if (d.type && CHOICE_FIELD_TYPES.includes(d.type) && (d.options?.length ?? 0) === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Add at least one option', path: ['options'] });
  }
  if (d.options && new Set(d.options.map((o) => o.toLowerCase())).size !== d.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Each option can appear once', path: ['options'] });
  }
}

export const customFieldDefSchema = z
  .object({
    entity: z.enum(CUSTOM_FIELD_ENTITIES),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, digits and underscores, starting with a letter'),
    type: z.enum(CUSTOM_FIELD_TYPES),
    ...definitionShape,
  })
  .superRefine(checkChoices);
export type CustomFieldDefInput = z.infer<typeof customFieldDefSchema>;

/** The entity, key and type never change (stored values depend on them); everything else can. */
export const customFieldUpdateSchema = z
  .object({
    label: definitionShape.label.optional(),
    description: optionalDescription,
    options: z.array(z.string().trim().min(1).max(80)).max(CUSTOM_FIELD_LIMITS.options).optional(),
    required: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    currency: currencyCode.nullable().optional(),
    viewDesignationIds: z.array(z.string().uuid()).max(100).optional(),
    editDesignationIds: z.array(z.string().uuid()).max(100).optional(),
    showInForms: z.boolean().optional(),
    searchable: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .superRefine(checkChoices);
export type CustomFieldUpdate = z.infer<typeof customFieldUpdateSchema>;

export const customFieldReorderSchema = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES), ids: z.array(z.string().uuid()).min(1).max(CUSTOM_FIELD_LIMITS.perEntity) });

export interface CustomFieldDef {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  description: string | null;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  defaultValue: unknown;
  currency: string | null;
  viewDesignationIds: string[];
  editDesignationIds: string[];
  showInForms: boolean;
  searchable: boolean;
  active: boolean;
  position: number;
  /** What the caller may do with the field's values. */
  access: { view: boolean; edit: boolean };
}

/** True when the definition uses something outside the basic set (needs `custom_fields_advanced`). */
export function isAdvancedField(d: { entity: CustomFieldEntity; type: CustomFieldType; viewDesignationIds?: string[]; editDesignationIds?: string[] }): boolean {
  return (
    !BASIC_CUSTOM_FIELD_TYPES.includes(d.type) ||
    !BASIC_CUSTOM_FIELD_ENTITIES.includes(d.entity) ||
    (d.viewDesignationIds?.length ?? 0) > 0 ||
    (d.editDesignationIds?.length ?? 0) > 0
  );
}

// ───────────── Filters ─────────────

export const CUSTOM_FIELD_FILTER_OPS = ['eq', 'neq', 'contains', 'gte', 'lte', 'in', 'set', 'unset'] as const;
export type CustomFieldFilterOp = (typeof CUSTOM_FIELD_FILTER_OPS)[number];

export const customFieldFilterSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    op: z.enum(CUSTOM_FIELD_FILTER_OPS),
    value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]).optional(),
  })
  .strict();
export type CustomFieldFilter = z.infer<typeof customFieldFilterSchema>;

/** List endpoints take custom field filters as `cf`, a JSON array, so one query string carries several. */
export const customFieldFiltersParam = z
  .string()
  .max(4_000)
  .transform((v, ctx) => {
    try {
      const parsed = z.array(customFieldFilterSchema).max(10).safeParse(JSON.parse(v));
      if (parsed.success) return parsed.data;
    } catch {
      /* reported below */
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a JSON list of {key, op, value} filters.' });
    return z.NEVER;
  })
  .optional();

/** Which operators make sense for a type (the filter builder offers only these; the API refuses the rest). */
export function filterOpsFor(type: CustomFieldType): readonly CustomFieldFilterOp[] {
  switch (type) {
    case 'NUMBER':
    case 'CURRENCY':
    case 'DATE':
    case 'DATETIME':
      return ['eq', 'gte', 'lte', 'set', 'unset'];
    case 'SELECT':
      return ['eq', 'neq', 'in', 'set', 'unset'];
    case 'MULTISELECT':
      return ['eq', 'in', 'set', 'unset'];
    case 'CHECKBOX':
    case 'BOOLEAN':
      return ['eq'];
    case 'FILE':
      return ['set', 'unset'];
    default:
      return ['contains', 'eq', 'set', 'unset'];
  }
}

/** How a value reads in a table cell, an export or a search hit (dates stay ISO; the page formats them). */
export function customFieldText(type: CustomFieldType, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  switch (type) {
    case 'MULTISELECT':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'CHECKBOX':
    case 'BOOLEAN':
      return value === true ? 'Yes' : value === false ? 'No' : '';
    case 'CURRENCY': {
      const v = value as CurrencyValue;
      return typeof v === 'object' && v ? `${v.amount} ${v.currency}` : String(value);
    }
    case 'FILE':
      return Array.isArray(value) ? (value as CustomFieldFile[]).map((f) => f.name).join(', ') : '';
    default:
      return String(value);
  }
}
