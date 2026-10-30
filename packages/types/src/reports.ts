import { z } from 'zod';
import type { Permission } from './permissions';

/**
 * Report builder. A report is a saved, validated definition (entity, filters, grouping, one metric, a chart type).
 * The API turns it into SQL only from the field catalogue below, so nothing in a definition is ever SQL text.
 */
export const REPORT_ENTITIES = ['deals', 'leads', 'contacts', 'companies', 'activities', 'tasks', 'quotes', 'contracts'] as const;
export type ReportEntity = (typeof REPORT_ENTITIES)[number];

export type ReportFieldKind = 'text' | 'enum' | 'date' | 'number' | 'money' | 'boolean' | 'user' | 'country';

export interface ReportField {
  key: string;
  label: string;
  kind: ReportFieldKind;
  /** Allowed values for `enum` fields. */
  options?: readonly string[];
  /** Can rows be grouped by this field? (Free text such as names is filterable but not groupable.) */
  groupable?: boolean;
}

export interface ReportEntityDef {
  key: ReportEntity;
  label: string;
  /** Singular noun for counts ("12 deals"). */
  noun: string;
  permission: Permission;
  fields: readonly ReportField[];
}

const OWNER: ReportField = { key: 'owner', label: 'Owner', kind: 'user', groupable: true };
const CREATED: ReportField = { key: 'createdAt', label: 'Created', kind: 'date', groupable: true };
const COUNTRY: ReportField = { key: 'country', label: 'Country', kind: 'country', groupable: true };
const CONSENT: ReportField = { key: 'marketingConsent', label: 'Marketing consent', kind: 'enum', options: ['UNKNOWN', 'OPTED_IN', 'OPTED_OUT'], groupable: true };

export const REPORT_CATALOG: Record<ReportEntity, ReportEntityDef> = {
  deals: {
    key: 'deals', label: 'Deals', noun: 'deal', permission: 'deals:read',
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'pipeline', label: 'Pipeline', kind: 'text', groupable: true },
      { key: 'stage', label: 'Stage', kind: 'text', groupable: true },
      { key: 'status', label: 'Status', kind: 'enum', options: ['OPEN', 'WON', 'LOST'], groupable: true },
      OWNER,
      { key: 'company', label: 'Company', kind: 'text', groupable: true },
      { key: 'country', label: 'Company country', kind: 'country', groupable: true },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'probability', label: 'Probability (%)', kind: 'number' },
      { key: 'lossReason', label: 'Loss reason', kind: 'text', groupable: true },
      { key: 'expectedCloseDate', label: 'Expected close', kind: 'date', groupable: true },
      { key: 'closedAt', label: 'Closed', kind: 'date', groupable: true },
      CREATED,
    ],
  },
  leads: {
    key: 'leads', label: 'Leads', noun: 'lead', permission: 'leads:read',
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum', options: ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'], groupable: true },
      { key: 'source', label: 'Source', kind: 'text', groupable: true },
      { key: 'industry', label: 'Industry', kind: 'text', groupable: true },
      COUNTRY,
      OWNER,
      CONSENT,
      { key: 'estimatedValue', label: 'Estimated value', kind: 'money' },
      { key: 'engagementScore', label: 'Engagement score', kind: 'number' },
      { key: 'aiScore', label: 'AI score', kind: 'number' },
      { key: 'convertedAt', label: 'Converted', kind: 'date', groupable: true },
      CREATED,
    ],
  },
  contacts: {
    key: 'contacts', label: 'Contacts', noun: 'contact', permission: 'contacts:read',
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'jobTitle', label: 'Job title', kind: 'text', groupable: true },
      { key: 'company', label: 'Company', kind: 'text', groupable: true },
      COUNTRY,
      OWNER,
      CONSENT,
      CREATED,
    ],
  },
  companies: {
    key: 'companies', label: 'Companies', noun: 'company', permission: 'companies:read',
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'industry', label: 'Industry', kind: 'text', groupable: true },
      COUNTRY,
      OWNER,
      CREATED,
    ],
  },
  activities: {
    key: 'activities', label: 'Activities', noun: 'activity', permission: 'activities:read',
    fields: [
      { key: 'subject', label: 'Subject', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'enum', options: ['CALL', 'EMAIL', 'MEETING', 'NOTE'], groupable: true },
      OWNER,
      { key: 'aiAssisted', label: 'AI assisted', kind: 'boolean', groupable: true },
      { key: 'occurredAt', label: 'Occurred', kind: 'date', groupable: true },
      CREATED,
    ],
  },
  tasks: {
    key: 'tasks', label: 'Tasks', noun: 'task', permission: 'activities:read',
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum', options: ['OPEN', 'DONE', 'CANCELED'], groupable: true },
      { key: 'assignee', label: 'Assignee', kind: 'user', groupable: true },
      { key: 'dueAt', label: 'Due', kind: 'date', groupable: true },
      { key: 'completedAt', label: 'Completed', kind: 'date', groupable: true },
      CREATED,
    ],
  },
  quotes: {
    key: 'quotes', label: 'Quotes (latest versions)', noun: 'quote', permission: 'quotes:read',
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum', options: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ACCEPTED', 'DECLINED'], groupable: true },
      { key: 'createdBy', label: 'Created by', kind: 'user', groupable: true },
      { key: 'total', label: 'Total', kind: 'money' },
      { key: 'discountTotal', label: 'Discount', kind: 'money' },
      { key: 'sentAt', label: 'Sent', kind: 'date', groupable: true },
      { key: 'decidedAt', label: 'Decided', kind: 'date', groupable: true },
      CREATED,
    ],
  },
  contracts: {
    key: 'contracts', label: 'Contracts', noun: 'contract', permission: 'contracts:read',
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum', options: ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED'], groupable: true },
      OWNER,
      { key: 'value', label: 'Value', kind: 'money' },
      { key: 'autoRenew', label: 'Auto-renews', kind: 'boolean', groupable: true },
      { key: 'startDate', label: 'Start', kind: 'date', groupable: true },
      { key: 'endDate', label: 'End', kind: 'date', groupable: true },
      CREATED,
    ],
  },
};

export function reportField(entity: ReportEntity, key: string): ReportField | undefined {
  return REPORT_CATALOG[entity].fields.find((f) => f.key === key);
}

export const REPORT_METRICS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];
export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];
export const REPORT_CHARTS = ['table', 'bar', 'line', 'pie', 'number'] as const;
export type ReportChart = (typeof REPORT_CHARTS)[number];
export const REPORT_SORTS = ['value_desc', 'value_asc', 'label_asc', 'label_desc'] as const;
export const FILTER_OPS = ['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty', 'last_n_days'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Which operators make sense for each kind of field. */
export const OPS_FOR_KIND: Record<ReportFieldKind, readonly FilterOp[]> = {
  text: ['eq', 'neq', 'contains', 'is_empty', 'not_empty'],
  enum: ['eq', 'neq', 'in'],
  date: ['gte', 'lte', 'last_n_days', 'is_empty', 'not_empty'],
  number: ['eq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty'],
  money: ['gt', 'gte', 'lt', 'lte'],
  boolean: ['eq'],
  user: ['eq', 'neq', 'is_empty', 'not_empty'],
  country: ['eq', 'neq', 'in', 'is_empty', 'not_empty'],
};

export const MAX_REPORT_FILTERS = 10;
export const MAX_REPORT_ROWS = 100;

const filterValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.array(z.string().max(100)).max(50)]);

export const reportFilterSchema = z.object({ field: z.string().max(40), op: z.enum(FILTER_OPS), value: filterValue.optional() });
export type ReportFilter = z.infer<typeof reportFilterSchema>;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const reportDefinitionSchema = z
  .object({
    entity: z.enum(REPORT_ENTITIES),
    metric: z.object({ fn: z.enum(REPORT_METRICS), field: z.string().max(40).optional() }),
    groupBy: z.object({ field: z.string().max(40), bucket: z.enum(DATE_BUCKETS).optional() }).nullable().default(null),
    filters: z.array(reportFilterSchema).max(MAX_REPORT_FILTERS).default([]),
    chart: z.enum(REPORT_CHARTS).default('table'),
    sort: z.enum(REPORT_SORTS).default('value_desc'),
    limit: z.number().int().min(1).max(MAX_REPORT_ROWS).default(20),
  })
  .superRefine((d, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (d.metric.fn === 'count') {
      if (d.metric.field) issue(['metric', 'field'], 'a count does not take a field');
    } else {
      const f = d.metric.field ? reportField(d.entity, d.metric.field) : undefined;
      if (!f) issue(['metric', 'field'], 'choose a number or money field');
      else if (f.kind !== 'number' && f.kind !== 'money') issue(['metric', 'field'], `${f.label} is not a number`);
    }
    if (d.groupBy) {
      const g = reportField(d.entity, d.groupBy.field);
      if (!g?.groupable) issue(['groupBy', 'field'], 'cannot group by this field');
      else if (g.kind === 'date' && !d.groupBy.bucket) issue(['groupBy', 'bucket'], 'choose day, week, month, quarter or year');
      else if (g.kind !== 'date' && d.groupBy.bucket) issue(['groupBy', 'bucket'], 'only date fields take a bucket');
    }
    if (d.chart === 'number' && d.groupBy) issue(['chart'], 'a single number cannot be grouped');
    if ((d.chart === 'bar' || d.chart === 'line' || d.chart === 'pie') && !d.groupBy) issue(['chart'], 'charts need a grouping');
    if (d.chart === 'line' && d.groupBy && reportField(d.entity, d.groupBy.field)?.kind !== 'date') issue(['chart'], 'line charts need a date grouping');
    d.filters.forEach((flt, i) => {
      const f = reportField(d.entity, flt.field);
      if (!f) return issue(['filters', i, 'field'], 'unknown field');
      if (!OPS_FOR_KIND[f.kind].includes(flt.op)) return issue(['filters', i, 'op'], `not available for ${f.label}`);
      const v = flt.value;
      if (flt.op === 'is_empty' || flt.op === 'not_empty') return v === undefined ? undefined : issue(['filters', i, 'value'], 'takes no value');
      if (v === undefined || v === '') return issue(['filters', i, 'value'], 'is required');
      if (flt.op === 'in') {
        if (!Array.isArray(v) || v.length === 0) return issue(['filters', i, 'value'], 'choose at least one value');
        if (f.kind === 'enum' && v.some((x) => !f.options?.includes(x))) issue(['filters', i, 'value'], 'contains an unknown value');
        return;
      }
      if (Array.isArray(v)) return issue(['filters', i, 'value'], 'takes one value');
      if (flt.op === 'last_n_days') return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3660 ? undefined : issue(['filters', i, 'value'], 'a whole number of days, 1 to 3660');
      switch (f.kind) {
        case 'number':
        case 'money':
          if (typeof v !== 'number') issue(['filters', i, 'value'], 'must be a number');
          break;
        case 'boolean':
          if (typeof v !== 'boolean') issue(['filters', i, 'value'], 'must be true or false');
          break;
        case 'date':
          if (typeof v !== 'string' || !isoDate.test(v)) issue(['filters', i, 'value'], 'must be a date (YYYY-MM-DD)');
          break;
        case 'enum':
          if (typeof v !== 'string' || !f.options?.includes(v)) issue(['filters', i, 'value'], 'is not one of the options');
          break;
        case 'user':
          if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) issue(['filters', i, 'value'], 'must be a member');
          break;
        case 'country':
          if (typeof v !== 'string' || !/^[A-Za-z]{2}$/.test(v)) issue(['filters', i, 'value'], 'must be a two-letter country code');
          break;
        default:
          if (typeof v !== 'string') issue(['filters', i, 'value'], 'must be text');
      }
    });
  });
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const REPORT_VISIBILITY = ['PRIVATE', 'WORKSPACE'] as const;
export type ReportVisibility = (typeof REPORT_VISIBILITY)[number];

export const reportInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  visibility: z.enum(REPORT_VISIBILITY).default('PRIVATE'),
  definition: reportDefinitionSchema,
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export interface ReportRow {
  id: string;
  name: string;
  description: string | null;
  visibility: ReportVisibility;
  definition: ReportDefinition;
  createdBy: { id: string; name: string } | null;
  /** True when the viewer may edit or delete it (its author, or anyone with reports:manage). */
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportResultRow {
  /** Raw group key (enum value, user id, ISO date of the bucket start, country code) or null for "none". */
  key: string | null;
  label: string;
  value: number;
}

export interface ReportResult {
  entity: ReportEntity;
  metricLabel: string;
  groupLabel: string | null;
  rows: ReportResultRow[];
  /** Value across all matching records (not only the rows shown). */
  total: number;
  /** Number of matching records. */
  records: number;
  /** Currency of money metrics: the workspace currency. */
  currency: string | null;
  /** Records left out of a money metric because no exchange rate to the workspace currency exists. */
  excluded: { records: number; currencies: string[] } | null;
  /** More groups exist than the limit shows. */
  truncated: boolean;
  generatedAt: string;
}

export const DASHBOARD_WIDGET_SIZES = ['sm', 'md', 'lg'] as const;
export const MAX_DASHBOARD_WIDGETS = 12;

export const dashboardInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  visibility: z.enum(REPORT_VISIBILITY).default('PRIVATE'),
  widgets: z
    .array(z.object({ reportId: z.string().uuid(), size: z.enum(DASHBOARD_WIDGET_SIZES).default('md') }))
    .max(MAX_DASHBOARD_WIDGETS)
    .default([])
    .refine((ws) => new Set(ws.map((w) => w.reportId)).size === ws.length, 'a report can appear only once'),
});
export type DashboardInput = z.infer<typeof dashboardInputSchema>;

export interface DashboardRow {
  id: string;
  name: string;
  description: string | null;
  visibility: ReportVisibility;
  widgets: { reportId: string; size: (typeof DASHBOARD_WIDGET_SIZES)[number] }[];
  createdBy: { id: string; name: string } | null;
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Ready-made starting points shown in the builder; they are definitions, not stored data. */
export const REPORT_TEMPLATES: { name: string; definition: ReportDefinition }[] = [
  { name: 'Open pipeline by stage', definition: { entity: 'deals', metric: { fn: 'sum', field: 'amount' }, groupBy: { field: 'stage' }, filters: [{ field: 'status', op: 'eq', value: 'OPEN' }], chart: 'bar', sort: 'value_desc', limit: 20 } },
  { name: 'Won revenue by month', definition: { entity: 'deals', metric: { fn: 'sum', field: 'amount' }, groupBy: { field: 'closedAt', bucket: 'month' }, filters: [{ field: 'status', op: 'eq', value: 'WON' }, { field: 'closedAt', op: 'last_n_days', value: 365 }], chart: 'line', sort: 'label_asc', limit: 24 } },
  { name: 'Leads by source', definition: { entity: 'leads', metric: { fn: 'count' }, groupBy: { field: 'source' }, filters: [], chart: 'pie', sort: 'value_desc', limit: 10 } },
  { name: 'Activities by owner, last 30 days', definition: { entity: 'activities', metric: { fn: 'count' }, groupBy: { field: 'owner' }, filters: [{ field: 'occurredAt', op: 'last_n_days', value: 30 }], chart: 'bar', sort: 'value_desc', limit: 20 } },
  { name: 'Loss reasons', definition: { entity: 'deals', metric: { fn: 'count' }, groupBy: { field: 'lossReason' }, filters: [{ field: 'status', op: 'eq', value: 'LOST' }], chart: 'table', sort: 'value_desc', limit: 20 } },
];

// ───────────────────────── Immersive views (Phase 7) ─────────────────────────

/** Relationship Galaxy: companies with their contacts and deals, plus parent-company links. */
export interface GalaxyNode {
  id: string;
  kind: 'company' | 'contact' | 'deal';
  label: string;
  /** Company id the node belongs to (itself for companies; null for unattached contacts and deals). */
  companyId: string | null;
  status?: 'OPEN' | 'WON' | 'LOST';
  /** Deal amount in the workspace currency, when a rate exists. */
  value?: number | null;
  href: string;
}
export interface GalaxyEdge {
  source: string;
  target: string;
  kind: 'works_at' | 'deal_of' | 'contact_on' | 'parent';
}
export interface GalaxyGraph {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  currency: string;
  /** More companies matched than the view shows (largest first by open value). */
  truncated: boolean;
}

export interface GlobeCountry {
  country: string;
  companies: number;
  openDeals: number;
  openValue: number;
  wonValue: number;
}
export interface GlobeData {
  countries: GlobeCountry[];
  currency: string;
  /** Companies with no country set, and open deals without a company, which the globe cannot place. */
  unplaced: { companies: number; openDeals: number };
  /** Deals left out of value totals for want of an exchange rate. */
  excludedDeals: number;
}

export interface FlowStage {
  id: string;
  name: string;
  category: 'OPEN' | 'WON' | 'LOST';
  position: number;
  openDeals: number;
  openValue: number;
  /** Median days deals spent in this stage before leaving it, from recorded moves (null with no data). */
  medianDays: number | null;
}
export interface FlowTransition {
  from: string;
  to: string;
  deals: number;
}
export interface PipelineFlow {
  pipelineId: string;
  pipelineName: string;
  stages: FlowStage[];
  transitions: FlowTransition[];
  currency: string;
  /** Start of the window the transitions cover. */
  since: string;
}

/** One recorded stage change, for replays. `from` is null for the deal's first recorded stage. */
export interface ReplayEvent {
  dealId: string;
  at: string;
  fromStageId: string | null;
  toStageId: string;
}
export interface PipelineReplay {
  pipelineId: string;
  pipelineName: string;
  stages: { id: string; name: string; category: 'OPEN' | 'WON' | 'LOST'; position: number }[];
  deals: { id: string; name: string; value: number | null }[];
  events: ReplayEvent[];
  from: string;
  to: string;
  currency: string;
  /** Events before history was recorded (Phase 7) are reconstructed from the audit log; see docs. */
  reconstructed: boolean;
  truncated: boolean;
}

export const immersiveQuerySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(7).max(730).default(90),
});
