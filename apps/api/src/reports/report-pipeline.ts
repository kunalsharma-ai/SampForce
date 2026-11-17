import { escapeRegex, rawDate } from '@dealflow/database';
import { CUSTOM_REPORT_PREFIX, type ReportDefinition, type ReportEntity, type ReportField, type ReportFilter, reportField } from '@dealflow/types';

/**
 * Turns a validated report definition into a MongoDB aggregation pipeline (ADR 0058; was report-sql.ts). Every field
 * path comes from the constant specs below, keyed by catalogue field keys. Values from the definition only ever appear
 * as literals inside `$literal` or as the right-hand side of a comparison, so nothing a user typed becomes an
 * operator or a field path. The workspace guard puts the workspace `$match` in front of the pipeline, and every
 * `$lookup` here also matches the workspace.
 */
type Expr = unknown;

interface EntitySpec {
  /** Prisma model the pipeline runs on. */
  model: 'opportunity' | 'lead' | 'contact' | 'company' | 'activity' | 'task' | 'quote' | 'contract';
  match: Record<string, unknown>;
  /** Related documents joined in, as `{ as: [collection, localField] }`. */
  joins?: Record<string, [string, string]>;
  columns: Record<string, Expr>;
  /** Currency of each money field. */
  currency?: Record<string, Expr>;
  /** Calendar dates (stored at UTC midnight, so never shifted into the workspace time zone). */
  dateOnly?: string[];
}

const f = (path: string) => `$${path}`;
const joined = (as: string, field: string) => ({ $first: `$${as}.${field}` });

export const ENTITY_SPECS: Record<ReportEntity, EntitySpec> = {
  deals: {
    model: 'opportunity',
    match: { deleted_at: null },
    joins: { s: ['pipeline_stages', 'stage_id'], p: ['pipelines', 'pipeline_id'], c: ['companies', 'company_id'] },
    columns: {
      name: f('name'), pipeline: joined('p', 'name'), stage: joined('s', 'name'), status: f('status'), owner: f('owner_id'), company: joined('c', 'name'),
      country: joined('c', 'country'), amount: f('amount'), probability: { $ifNull: [f('probability'), joined('s', 'probability')] }, lossReason: f('loss_reason'),
      expectedCloseDate: f('expected_close_date'), closedAt: f('closed_at'), createdAt: f('created_at'),
    },
    currency: { amount: f('currency') },
    dateOnly: ['expectedCloseDate'],
  },
  leads: {
    model: 'lead',
    match: { deleted_at: null },
    columns: {
      name: f('full_name'), status: f('status'), source: f('source'), industry: f('industry'), country: f('country'), owner: f('owner_id'),
      marketingConsent: f('marketing_consent'), estimatedValue: f('estimated_value'), engagementScore: f('engagement_score'),
      aiScore: f('ai_score'), convertedAt: f('converted_at'), createdAt: f('created_at'),
    },
    currency: { estimatedValue: f('currency') },
  },
  contacts: {
    model: 'contact',
    match: { deleted_at: null },
    joins: { c: ['companies', 'company_id'] },
    columns: {
      name: { $trim: { input: { $concat: [{ $ifNull: [f('first_name'), ''] }, ' ', { $ifNull: [f('last_name'), ''] }] } } }, jobTitle: f('job_title'), company: joined('c', 'name'),
      country: f('country'), owner: f('owner_id'), marketingConsent: f('marketing_consent'), createdAt: f('created_at'),
    },
  },
  companies: {
    model: 'company',
    match: { deleted_at: null },
    columns: { name: f('name'), industry: f('industry'), country: f('country'), owner: f('owner_id'), createdAt: f('created_at') },
  },
  activities: {
    model: 'activity',
    match: { deleted_at: null },
    columns: { subject: f('subject'), type: f('type'), owner: f('owner_id'), aiAssisted: f('ai_assisted'), occurredAt: f('occurred_at'), createdAt: f('created_at') },
  },
  tasks: {
    model: 'task',
    match: { deleted_at: null },
    columns: { title: f('title'), status: f('status'), assignee: f('assignee_id'), dueAt: f('due_at'), completedAt: f('completed_at'), createdAt: f('created_at') },
  },
  quotes: {
    model: 'quote',
    match: { is_latest: true },
    columns: {
      title: f('title'), status: f('status'), createdBy: f('created_by_id'), total: f('total'), discountTotal: f('discount_total'),
      sentAt: f('sent_at'), decidedAt: f('decided_at'), createdAt: f('created_at'),
    },
    currency: { total: f('currency'), discountTotal: f('currency') },
  },
  contracts: {
    model: 'contract',
    match: {},
    columns: {
      name: f('name'), status: f('status'), owner: f('owner_id'), value: f('value'), autoRenew: f('auto_renew'),
      startDate: f('start_date'), endDate: f('end_date'), createdAt: f('created_at'),
    },
    currency: { value: f('currency') },
    dateOnly: ['startDate', 'endDate'],
  },
};

export interface QueryContext {
  tenantId: string;
  baseCurrency: string;
  timezone: string;
  /** Latest exchange rate per currency (units of the workspace currency per unit). */
  rates: Map<string, number>;
  now?: Date;
  /** The caller's visible custom fields as report fields (`cf.<key>`, ADR 0062). */
  custom?: readonly ReportField[];
}

const fieldOf = (entity: ReportEntity, key: string, ctx: QueryContext) => reportField(entity, key, ctx.custom);

/**
 * A custom field's value. Paths are built only from keys of the workspace's own field definitions (checked against
 * `ctx.custom`), which are `[a-z][a-z0-9_]*`, so nothing typed into a report becomes a path.
 */
function customColumn(entity: ReportEntity, key: string, ctx: QueryContext, part: 'value' | 'currency' = 'value'): Expr {
  const field = ctx.custom?.find((x) => x.key === key);
  const name = key.slice(CUSTOM_REPORT_PREFIX.length);
  if (!field?.custom || !/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw new Error(`Unknown report field ${entity}.${key}`);
  const path = `$custom_fields.${name}`;
  switch (field.custom.type) {
    case 'CURRENCY':
      return part === 'currency' ? `${path}.currency` : `${path}.amount`;
    case 'DATE':
    case 'DATETIME':
      return { $dateFromString: { dateString: path, onError: null, onNull: null } };
    default:
      return path;
  }
}

function column(entity: ReportEntity, key: string, ctx: QueryContext): Expr {
  if (key.startsWith(CUSTOM_REPORT_PREFIX)) return customColumn(entity, key, ctx);
  const col = ENTITY_SPECS[entity].columns[key];
  // The schema already rejects unknown keys; this guards the builder on its own.
  if (!col) throw new Error(`Unknown report field ${entity}.${key}`);
  return col;
}

const currencyOf = (entity: ReportEntity, key: string, ctx: QueryContext): Expr | undefined =>
  key.startsWith(CUSTOM_REPORT_PREFIX) ? customColumn(entity, key, ctx, 'currency') : ENTITY_SPECS[entity].currency?.[key];
const isDateOnly = (entity: ReportEntity, key: string, ctx: QueryContext) =>
  key.startsWith(CUSTOM_REPORT_PREFIX) ? fieldOf(entity, key, ctx)?.custom?.type === 'DATE' : !!ENTITY_SPECS[entity].dateOnly?.includes(key);

const lit = (v: unknown) => ({ $literal: v });
const isNull = (e: Expr) => ({ $eq: [{ $ifNull: [e, null] }, null] });
const notNull = (e: Expr) => ({ $ne: [{ $ifNull: [e, null] }, null] });

/** Value of a money field in the workspace currency, or null when no rate exists. */
function moneyExpr(entity: ReportEntity, key: string, ctx: QueryContext): Expr {
  const col = column(entity, key, ctx);
  const cur = currencyOf(entity, key, ctx);
  if (!cur) throw new Error(`No currency for ${entity}.${key}`);
  const currency = { $ifNull: [cur, lit(ctx.baseCurrency)] };
  const branches = [{ case: { $eq: [currency, lit(ctx.baseCurrency)] }, then: 1 }, ...[...ctx.rates].map(([c, r]) => ({ case: { $eq: [currency, lit(c)] }, then: lit(r) }))];
  return { $multiply: [col, { $switch: { branches, default: null } }] };
}

/** The field as a calendar date string (YYYY-MM-DD) in the workspace time zone, for comparisons. */
function localDate(entity: ReportEntity, key: string, ctx: QueryContext): Expr {
  const tz = isDateOnly(entity, key, ctx) ? 'UTC' : ctx.timezone;
  return { $dateToString: { format: '%Y-%m-%d', date: column(entity, key, ctx), timezone: lit(tz) } };
}

/** Text of a value for "is empty" and grouping: null for missing, null and the empty string. */
function textOrNull(e: Expr): Expr {
  return { $let: { vars: { t: { $toString: { $ifNull: [e, null] } } }, in: { $cond: [{ $in: ['$$t', [null, '']] }, null, '$$t'] } } };
}

function compare(left: Expr, op: ReportFilter['op'], right: unknown): Expr {
  const sym = { eq: '$eq', gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte' }[op as 'eq' | 'gt' | 'gte' | 'lt' | 'lte'];
  if (!sym) throw new Error(`Operator ${op} is not a comparison`);
  // SQL comparisons with NULL are never true; MongoDB orders null below every number, so exclude it explicitly.
  return { $and: [notNull(left), { [sym]: [left, lit(right)] }] };
}

export function filterExpr(entity: ReportEntity, fl: ReportFilter, ctx: QueryContext): Expr {
  const field = fieldOf(entity, fl.field, ctx);
  if (!field) throw new Error(`Unknown report field ${entity}.${fl.field}`);
  const col = column(entity, fl.field, ctx);
  // A multi-select holds a list: "is" means it includes the value, "is any of" that it includes one of them.
  if (field.custom?.type === 'MULTISELECT' && (fl.op === 'eq' || fl.op === 'neq' || fl.op === 'in')) {
    const list = { $cond: [{ $isArray: col }, col, []] };
    if (fl.op === 'in') return { $gt: [{ $size: { $setIntersection: [list, lit(fl.value as string[])] } }, 0] };
    const has = { $in: [lit(String(fl.value)), list] };
    return fl.op === 'eq' ? has : { $not: [has] };
  }
  const v = fl.value;
  if (fl.op === 'is_empty') return { $eq: [textOrNull(col), null] };
  if (fl.op === 'not_empty') return { $ne: [textOrNull(col), null] };
  if (fl.op === 'last_n_days') return { $and: [notNull(col), { $gte: [col, rawDate(new Date((ctx.now ?? new Date()).getTime() - Number(v) * 86_400_000))] }] };
  if (fl.op === 'in') {
    return field.kind === 'country' ? { $in: [{ $toUpper: { $ifNull: [col, ''] } }, lit((v as string[]).map((x) => x.toUpperCase()))] } : { $in: [col, lit(v as string[])] };
  }
  switch (field.kind) {
    case 'money':
      return compare(moneyExpr(entity, fl.field, ctx), fl.op, Number(v));
    case 'number':
      return compare(col, fl.op, Number(v));
    case 'date':
      return compare(localDate(entity, fl.field, ctx), fl.op, String(v));
    case 'boolean':
      return { $eq: [col, lit(Boolean(v))] };
    case 'text':
      if (fl.op === 'contains') return { $and: [notNull(col), { $regexMatch: { input: { $toString: col }, regex: lit(escapeRegex(String(v))), options: 'i' } }] };
      return fl.op === 'eq' ? { $and: [notNull(col), { $eq: [{ $toLower: col }, lit(String(v).toLowerCase())] }] } : { $or: [isNull(col), { $ne: [{ $toLower: col }, lit(String(v).toLowerCase())] }] };
    case 'country':
      return fl.op === 'eq' ? { $and: [notNull(col), { $eq: [{ $toUpper: col }, lit(String(v).toUpperCase())] }] } : { $or: [isNull(col), { $ne: [{ $toUpper: col }, lit(String(v).toUpperCase())] }] };
    default:
      return fl.op === 'eq' ? { $eq: [col, lit(String(v))] } : { $ne: [{ $ifNull: [col, null] }, lit(String(v))] };
  }
}

function groupExpr(def: ReportDefinition, ctx: QueryContext): Expr {
  if (!def.groupBy) return null;
  const field = fieldOf(def.entity, def.groupBy.field, ctx)!;
  const col = column(def.entity, def.groupBy.field, ctx);
  if (field.kind === 'date') {
    const tz = isDateOnly(def.entity, def.groupBy.field, ctx) ? 'UTC' : ctx.timezone;
    const start = { $dateTrunc: { date: col, unit: def.groupBy.bucket!, timezone: lit(tz), startOfWeek: 'monday' } };
    return { $cond: [isNull(col), null, { $dateToString: { format: '%Y-%m-%d', date: start, timezone: lit(tz) } }] };
  }
  if (field.kind === 'country') return { $cond: [isNull(col), null, { $toUpper: col }] };
  return textOrNull(col);
}

/** The stages that yield one document per matching record: `{ g, m, amt, cur }` (like the old `base` CTE). */
function baseStages(def: ReportDefinition, ctx: QueryContext): object[] {
  const spec = ENTITY_SPECS[def.entity];
  const fn = def.metric.fn;
  const field = def.metric.field ? fieldOf(def.entity, def.metric.field, ctx) : undefined;
  let m: Expr = 1;
  let amt: Expr = null;
  let cur: Expr = null;
  if (fn !== 'count' && field) {
    if (field.kind === 'money') {
      m = moneyExpr(def.entity, field.key, ctx);
      amt = column(def.entity, field.key, ctx);
      cur = currencyOf(def.entity, field.key, ctx)!;
    } else {
      m = column(def.entity, field.key, ctx);
    }
  }
  const lookups = Object.entries(spec.joins ?? {}).map(([as, [from, local]]) => ({
    $lookup: {
      from,
      let: { ref: `$${local}` },
      pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$ref'] }, { $eq: ['$tenant_id', lit(ctx.tenantId)] }] }, ...(from === 'companies' ? { deleted_at: null } : {}) } }],
      as,
    },
  }));
  const filters = def.filters.map((x) => filterExpr(def.entity, x, ctx));
  return [
    { $match: { tenant_id: ctx.tenantId, ...spec.match } },
    ...lookups,
    ...(filters.length ? [{ $match: { $expr: { $and: filters } } }] : []),
    { $project: { _id: 0, g: groupExpr(def, ctx), m: { $ifNull: [m, null] }, amt: { $ifNull: [amt, null] }, cur: { $ifNull: [cur, null] } } },
  ];
}

const nn = { $cond: [{ $eq: ['$m', null] }, 0, 1] };

function accumulators(fn: ReportDefinition['metric']['fn']): Record<string, unknown> {
  // SQL sum over only NULLs is NULL; $sum would say 0, so the non-null count decides.
  return { count: { v: { $sum: 1 } }, sum: { v: { $sum: '$m' }, nn: { $sum: nn } }, avg: { v: { $avg: '$m' } }, min: { v: { $min: '$m' } }, max: { v: { $max: '$m' } } }[fn];
}

const value = (fn: ReportDefinition['metric']['fn']) => (fn === 'sum' ? { $cond: [{ $gt: ['$nn', 0] }, '$v', null] } : '$v');

const ORDER: Record<ReportDefinition['sort'], Record<string, 1 | -1>> = {
  value_desc: { vNull: 1, v: -1, gNull: 1, _id: 1 },
  value_asc: { vNull: 1, v: 1, gNull: 1, _id: 1 },
  label_asc: { gNull: 1, _id: 1 },
  label_desc: { gNull: 1, _id: -1 },
};

/** Grouped rows `{ _id: group, v }`, one more than the limit so the caller can tell whether the list was cut. */
export function groupedPipeline(def: ReportDefinition, ctx: QueryContext): object[] {
  return [
    ...baseStages(def, ctx),
    ...(isMoney(def, ctx) ? [{ $match: { m: { $ne: null } } }] : []),
    { $group: { _id: '$g', ...accumulators(def.metric.fn) } },
    { $project: { v: value(def.metric.fn), vNull: { $cond: [{ $eq: [value(def.metric.fn), null] }, 1, 0] }, gNull: { $cond: [{ $eq: ['$_id', null] }, 1, 0] } } },
    { $sort: ORDER[def.sort] },
    { $limit: def.limit + 1 },
  ];
}

/** Totals across all matching records `{ v, n, ex, excur }`, plus how many money rows had no exchange rate. */
export function totalsPipeline(def: ReportDefinition, ctx: QueryContext): object[] {
  const missingRate = { $and: [{ $ne: ['$amt', null] }, { $eq: ['$m', null] }] };
  return [
    ...baseStages(def, ctx),
    {
      $group: {
        _id: null,
        ...accumulators(def.metric.fn),
        n: { $sum: 1 },
        ex: { $sum: { $cond: [missingRate, 1, 0] } },
        excur: { $addToSet: { $cond: [missingRate, '$cur', null] } },
      },
    },
    { $project: { _id: 0, v: value(def.metric.fn), n: 1, ex: 1, excur: 1 } },
  ];
}

export function isMoney(def: ReportDefinition, ctx?: Pick<QueryContext, 'custom'>): boolean {
  return def.metric.fn !== 'count' && !!def.metric.field && reportField(def.entity, def.metric.field, ctx?.custom)?.kind === 'money';
}
