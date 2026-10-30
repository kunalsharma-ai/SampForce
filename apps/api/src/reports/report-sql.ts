import { Prisma } from '@dealflow/database';
import { type ReportDefinition, type ReportEntity, type ReportFilter, reportField } from '@dealflow/types';

/**
 * Turns a validated report definition into SQL. Every identifier comes from the constant specs below, keyed by
 * catalogue field keys; every value from the definition is a bound parameter. Nothing a user typed becomes SQL text.
 */
interface EntitySpec {
  from: string;
  where: string;
  columns: Record<string, string>;
  /** Currency column of each money field. */
  currency?: Record<string, string>;
  /** Columns of SQL type `date` (no time zone conversion when bucketing). */
  dateOnly?: string[];
}

const USER = (col: string) => `${col}::text`;

export const ENTITY_SPECS: Record<ReportEntity, EntitySpec> = {
  deals: {
    from: 'opportunities e JOIN pipeline_stages s ON s.id = e.stage_id JOIN pipelines p ON p.id = e.pipeline_id LEFT JOIN companies c ON c.id = e.company_id AND c.deleted_at IS NULL',
    where: 'e.deleted_at IS NULL',
    columns: {
      name: 'e.name', pipeline: 'p.name', stage: 's.name', status: 'e.status::text', owner: USER('e.owner_id'), company: 'c.name',
      country: 'c.country', amount: 'e.amount', probability: 'COALESCE(e.probability, s.probability)', lossReason: 'e.loss_reason',
      expectedCloseDate: 'e.expected_close_date', closedAt: 'e.closed_at', createdAt: 'e.created_at',
    },
    currency: { amount: 'e.currency' },
    dateOnly: ['expectedCloseDate'],
  },
  leads: {
    from: 'leads e',
    where: 'e.deleted_at IS NULL',
    columns: {
      name: 'e.full_name', status: 'e.status::text', source: 'e.source', industry: 'e.industry', country: 'e.country', owner: USER('e.owner_id'),
      marketingConsent: 'e.marketing_consent::text', estimatedValue: 'e.estimated_value', engagementScore: 'e.engagement_score',
      aiScore: 'e.ai_score', convertedAt: 'e.converted_at', createdAt: 'e.created_at',
    },
    currency: { estimatedValue: 'e.currency' },
  },
  contacts: {
    from: 'contacts e LEFT JOIN companies c ON c.id = e.company_id AND c.deleted_at IS NULL',
    where: 'e.deleted_at IS NULL',
    columns: {
      name: "concat_ws(' ', e.first_name, e.last_name)", jobTitle: 'e.job_title', company: 'c.name', country: 'e.country',
      owner: USER('e.owner_id'), marketingConsent: 'e.marketing_consent::text', createdAt: 'e.created_at',
    },
  },
  companies: {
    from: 'companies e',
    where: 'e.deleted_at IS NULL',
    columns: { name: 'e.name', industry: 'e.industry', country: 'e.country', owner: USER('e.owner_id'), createdAt: 'e.created_at' },
  },
  activities: {
    from: 'activities e',
    where: 'e.deleted_at IS NULL',
    columns: { subject: 'e.subject', type: 'e.type::text', owner: USER('e.owner_id'), aiAssisted: 'e.ai_assisted', occurredAt: 'e.occurred_at', createdAt: 'e.created_at' },
  },
  tasks: {
    from: 'tasks e',
    where: 'e.deleted_at IS NULL',
    columns: { title: 'e.title', status: 'e.status::text', assignee: USER('e.assignee_id'), dueAt: 'e.due_at', completedAt: 'e.completed_at', createdAt: 'e.created_at' },
  },
  quotes: {
    from: 'quotes e',
    where: 'e.is_latest',
    columns: {
      title: 'e.title', status: 'e.status::text', createdBy: USER('e.created_by_id'), total: 'e.total', discountTotal: 'e.discount_total',
      sentAt: 'e.sent_at', decidedAt: 'e.decided_at', createdAt: 'e.created_at',
    },
    currency: { total: 'e.currency', discountTotal: 'e.currency' },
  },
  contracts: {
    from: 'contracts e',
    where: 'true',
    columns: {
      name: 'e.name', status: 'e.status::text', owner: USER('e.owner_id'), value: 'e.value', autoRenew: 'e.auto_renew',
      startDate: 'e.start_date', endDate: 'e.end_date', createdAt: 'e.created_at',
    },
    currency: { value: 'e.currency' },
    dateOnly: ['startDate', 'endDate'],
  },
};

export interface QueryContext {
  tenantId: string;
  baseCurrency: string;
  timezone: string;
}

const raw = Prisma.raw;

function column(entity: ReportEntity, key: string): string {
  const col = ENTITY_SPECS[entity].columns[key];
  // The schema already rejects unknown keys; this guards the SQL builder on its own.
  if (!col) throw new Error(`Unknown report field ${entity}.${key}`);
  return col;
}

/** Value of a money field in the workspace currency, or NULL when no rate exists. */
function moneyExpr(entity: ReportEntity, key: string, ctx: QueryContext): Prisma.Sql {
  const col = column(entity, key);
  const cur = ENTITY_SPECS[entity].currency?.[key];
  if (!cur) throw new Error(`No currency column for ${entity}.${key}`);
  return Prisma.sql`(${raw(col)} * CASE WHEN COALESCE(${raw(cur)}, ${ctx.baseCurrency}) = ${ctx.baseCurrency} THEN 1 ELSE (SELECT r.rate FROM rates r WHERE r.currency = ${raw(cur)}) END)`;
}

/** Escapes LIKE wildcards so a "contains" filter matches the text literally. */
export function likePattern(v: string): string {
  return `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

function localDate(entity: ReportEntity, key: string, ctx: QueryContext): Prisma.Sql {
  const col = column(entity, key);
  return ENTITY_SPECS[entity].dateOnly?.includes(key) ? raw(col) : Prisma.sql`(${raw(col)} AT TIME ZONE ${ctx.timezone})::date`;
}

export function filterSql(entity: ReportEntity, f: ReportFilter, ctx: QueryContext): Prisma.Sql {
  const field = reportField(entity, f.field);
  if (!field) throw new Error(`Unknown report field ${entity}.${f.field}`);
  const col = raw(column(entity, f.field));
  const v = f.value;
  if (f.op === 'is_empty') return Prisma.sql`NULLIF(${col}::text, '') IS NULL`;
  if (f.op === 'not_empty') return Prisma.sql`NULLIF(${col}::text, '') IS NOT NULL`;
  if (f.op === 'last_n_days') return Prisma.sql`${col} >= now() - make_interval(days => ${Number(v)}::int)`;
  if (f.op === 'in') return field.kind === 'country' ? Prisma.sql`upper(${col}) = ANY(${(v as string[]).map((x) => x.toUpperCase())}::text[])` : Prisma.sql`${col} = ANY(${v as string[]}::text[])`;
  switch (field.kind) {
    case 'money': {
      const m = moneyExpr(entity, f.field, ctx);
      return compare(m, f.op, Prisma.sql`${Number(v)}::numeric`);
    }
    case 'number':
      return compare(Prisma.sql`${col}::numeric`, f.op, Prisma.sql`${Number(v)}::numeric`);
    case 'date':
      return compare(localDate(entity, f.field, ctx), f.op, Prisma.sql`${String(v)}::date`);
    case 'boolean':
      return Prisma.sql`${col} = ${Boolean(v)}`;
    case 'text':
      if (f.op === 'contains') return Prisma.sql`${col} ILIKE ${likePattern(String(v))}`;
      return f.op === 'eq' ? Prisma.sql`lower(${col}) = lower(${String(v)})` : Prisma.sql`lower(${col}) IS DISTINCT FROM lower(${String(v)})`;
    case 'country':
      return f.op === 'eq' ? Prisma.sql`upper(${col}) = upper(${String(v)})` : Prisma.sql`upper(${col}) IS DISTINCT FROM upper(${String(v)})`;
    default:
      return f.op === 'eq' ? Prisma.sql`${col} = ${String(v)}` : Prisma.sql`${col} IS DISTINCT FROM ${String(v)}`;
  }
}

function compare(left: Prisma.Sql, op: ReportFilter['op'], right: Prisma.Sql): Prisma.Sql {
  const sym = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op as 'eq' | 'gt' | 'gte' | 'lt' | 'lte'];
  if (!sym) throw new Error(`Operator ${op} is not a comparison`);
  return Prisma.sql`${left} ${raw(sym)} ${right}`;
}

function groupSql(def: ReportDefinition, ctx: QueryContext): Prisma.Sql {
  if (!def.groupBy) return Prisma.sql`NULL::text`;
  const field = reportField(def.entity, def.groupBy.field)!;
  if (field.kind === 'date') {
    const bucket = def.groupBy.bucket!;
    return Prisma.sql`date_trunc(${bucket}, ${localDate(def.entity, def.groupBy.field, ctx)}::timestamp)::date::text`;
  }
  if (field.kind === 'country') return Prisma.sql`upper(${raw(column(def.entity, def.groupBy.field))})`;
  return Prisma.sql`NULLIF(${raw(column(def.entity, def.groupBy.field))}::text, '')`;
}

/** The `base` CTE: one row per matching record with its group key, metric input and (for money) raw amount and currency. */
function baseSql(def: ReportDefinition, ctx: QueryContext): Prisma.Sql {
  const spec = ENTITY_SPECS[def.entity];
  const fn = def.metric.fn;
  const field = def.metric.field ? reportField(def.entity, def.metric.field) : undefined;
  let m: Prisma.Sql = Prisma.sql`1::numeric`;
  let rawAmount: Prisma.Sql = Prisma.sql`NULL::numeric`;
  let cur: Prisma.Sql = Prisma.sql`NULL::text`;
  if (fn !== 'count' && field) {
    if (field.kind === 'money') {
      m = moneyExpr(def.entity, field.key, ctx);
      rawAmount = raw(column(def.entity, field.key));
      cur = raw(spec.currency![field.key]!);
    } else {
      m = Prisma.sql`${raw(column(def.entity, field.key))}::numeric`;
    }
  }
  const conditions = [Prisma.sql`e.tenant_id = ${ctx.tenantId}::uuid`, raw(spec.where), ...def.filters.map((f) => filterSql(def.entity, f, ctx))];
  return Prisma.sql`
    rates AS (
      SELECT DISTINCT ON (currency) currency, rate FROM exchange_rates
      WHERE tenant_id = ${ctx.tenantId}::uuid AND effective_date <= current_date ORDER BY currency, effective_date DESC
    ),
    base AS (
      SELECT ${groupSql(def, ctx)} AS g, ${m} AS m, ${rawAmount} AS amt, ${cur} AS cur
      FROM ${raw(spec.from)}
      WHERE ${Prisma.join(conditions, ' AND ')}
    )`;
}

function agg(fn: ReportDefinition['metric']['fn']): Prisma.Sql {
  return raw({ count: 'count(*)', sum: 'sum(m)', avg: 'avg(m)', min: 'min(m)', max: 'max(m)' }[fn]);
}

const ORDER: Record<ReportDefinition['sort'], string> = {
  value_desc: 'v DESC NULLS LAST, g ASC NULLS LAST',
  value_asc: 'v ASC NULLS LAST, g ASC NULLS LAST',
  label_asc: 'g ASC NULLS LAST',
  label_desc: 'g DESC NULLS LAST',
};

/** Grouped rows, one more than the limit so the caller can tell whether the list was cut. */
export function groupedQuery(def: ReportDefinition, ctx: QueryContext): Prisma.Sql {
  const money = isMoney(def);
  return Prisma.sql`WITH ${baseSql(def, ctx)}
    SELECT g, ${agg(def.metric.fn)}::float8 AS v
    FROM base ${money ? Prisma.sql`WHERE m IS NOT NULL` : Prisma.empty}
    GROUP BY g ORDER BY ${raw(ORDER[def.sort])} LIMIT ${def.limit + 1}`;
}

/** Totals across all matching records, plus how many money rows had no exchange rate. */
export function totalsQuery(def: ReportDefinition, ctx: QueryContext): Prisma.Sql {
  const money = isMoney(def);
  return Prisma.sql`WITH ${baseSql(def, ctx)}
    SELECT ${money ? Prisma.sql`${agg(def.metric.fn)} FILTER (WHERE m IS NOT NULL)` : agg(def.metric.fn)}::float8 AS v,
           count(*)::int AS n,
           count(*) FILTER (WHERE amt IS NOT NULL AND m IS NULL)::int AS ex,
           COALESCE(array_agg(DISTINCT cur) FILTER (WHERE amt IS NOT NULL AND m IS NULL), '{}') AS excur
    FROM base`;
}

export function isMoney(def: ReportDefinition): boolean {
  return def.metric.fn !== 'count' && !!def.metric.field && reportField(def.entity, def.metric.field)?.kind === 'money';
}
