import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type PrismaClient } from '@prisma/client';
import { roundDecimals } from './money';

/**
 * Workspace isolation for MongoDB (ADR 0058).
 *
 * PostgreSQL enforced isolation with row-level security; MongoDB has nothing equivalent, so the same rules live
 * here, in one Prisma client extension that every query of the API passes through. The rules are a direct port of
 * the final PostgreSQL policies (see docs/adr/0058-mongodb.md for the table):
 *
 *  - Every model with a `tenantId` only sees and writes documents of the context's workspace. A query outside a
 *    context, or in a context without a workspace, sees no workspace documents and cannot write any, exactly as the
 *    runtime role without BYPASSRLS behaved.
 *  - Narrow exceptions mirror the old policies: the background worker's cross-workspace scan of the queue
 *    collections, the operator console's read-only scan, token lookups for public pages, a person's own memberships
 *    and the workspaces and roles they belong to, and personal collections (notifications, saved views, navigation,
 *    next-action decisions).
 *  - Append-only collections refuse updates or deletes, as the revoked grants did.
 *
 * The filter is added to the top-level `where`, to every to-many `include`/`select`, and every `tenantId` written
 * anywhere in `data` (nested writes included) must be the context's workspace.
 */

export interface DbContext {
  /** Workspace whose documents are visible. */
  tenantId?: string | null;
  /** Authenticated user, for the rules that let people see their own memberships and personal documents. */
  userId?: string | null;
  /** The background worker's cross-workspace scan of the queue collections (was `app.worker_scan`). */
  workerScan?: boolean;
  /** The operator console's read-only scan of workspaces and billing (was `app.operator_scan`). */
  operatorScan?: boolean;
  /**
   * Public-page lookups without a workspace (was `app.invitation_token_hash`, `app.form_token`...). Each entry makes
   * exactly the documents matching the given equality filter readable. Only the models in LOOKUP_FIELDS accept one.
   */
  lookup?: Partial<Record<LookupModel, Record<string, unknown>>>;
  /**
   * Owner access: no rules at all. Only for provisioning scripts, migrations, backups and test set-up, which used
   * the schema owner role on PostgreSQL. The API never sets it from a request.
   */
  system?: boolean;
}

export const dbContextStorage = new AsyncLocalStorage<DbContext>();

export function currentDbContext(): DbContext | undefined {
  return dbContextStorage.getStore();
}

/** Thrown when a write would land outside the context's workspace (PostgreSQL raised a WITH CHECK violation). */
export class TenantIsolationError extends Error {
  readonly code = 'TENANT_ISOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

type Op = 'read' | 'create' | 'update' | 'delete';

const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'findRaw',
  'aggregateRaw',
]);
const UNIQUE_WHERE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

/** Fields a public-page lookup may match on, and the extra conditions the old policy added. */
export const LOOKUP_FIELDS = {
  Invitation: { fields: ['tokenHash'], extra: {} },
  LeadForm: { fields: ['publicToken'], extra: {} },
  ApiKey: { fields: ['keyHash'], extra: {} },
  AppConnection: { fields: ['provider', 'externalAccountId'], extra: {} },
  PortalSettings: { fields: ['slug'], extra: { enabled: true } },
  ScimToken: { fields: ['tokenHash'], extra: { revokedAt: null } },
  SsoConnection: { fields: ['loginSlug'], extra: { enabled: true } },
  Subscription: { fields: ['providerCustomerId', 'providerSubscriptionId'], extra: {} },
  VisitorSettings: { fields: ['siteKey'], extra: {} },
} as const;
export type LookupModel = keyof typeof LOOKUP_FIELDS;

/** Queue collections the worker may read and write across workspaces (`worker_scan` FOR ALL). */
const WORKER_ALL = new Set([
  'AiRun',
  'ApprovalRequest',
  'DomainEvent',
  'GamificationSettings',
  'IntegrationConnection',
  'SequenceEnrollment',
  'WebhookDelivery',
  'WorkflowExecution',
]);
/** Collections the worker may only read across workspaces (`worker_scan` FOR SELECT). */
const WORKER_READ = new Set(['Contract', 'ProspectImport', 'Subscription', 'VisitorSettings', 'ZoomMeeting']);
/** Collections the operator console may read across workspaces (`operator_scan`). */
const OPERATOR_READ = new Set(['Tenant', 'Subscription', 'Membership', 'Invoice', 'SupportGrant', 'TenantFeatureOverride']);

/** Revoked grants: the application may not rewrite these records. */
const NO_UPDATE = new Set(['AuditLog', 'AiUsage', 'PlatformAuditLog', 'DealStageEvent', 'ForecastSnapshot', 'FormSubmission']);
const NO_DELETE = new Set(['AuditLog', 'AiUsage', 'PlatformAuditLog', 'DomainEvent', 'Tenant']);

const NONE = '__no_workspace__';

interface ModelMeta {
  tenantScoped: boolean;
  /** relation field name -> target model, for list relations only */
  lists: Map<string, string>;
  /** relation field name -> target model, for all relations */
  relations: Map<string, string>;
}

const META = new Map<string, ModelMeta>();
for (const model of Prisma.dmmf.datamodel.models) {
  const lists = new Map<string, string>();
  const relations = new Map<string, string>();
  for (const f of model.fields) {
    if (f.kind === 'object') {
      relations.set(f.name, f.type);
      if (f.isList) lists.set(f.name, f.type);
    }
  }
  META.set(model.name, { tenantScoped: model.fields.some((f) => f.name === 'tenantId'), lists, relations });
}

/** Models the guard treats as workspace-owned (every model with tenantId, plus Tenant itself). */
export function isWorkspaceModel(model: string): boolean {
  return model === 'Tenant' || META.get(model)?.tenantScoped === true;
}

type Where = Record<string, unknown>;

interface Lookups {
  membershipTenants(userId: string): Promise<string[]>;
  membershipRoles(userId: string): Promise<string[]>;
}

/**
 * The filter a context may see (op = read) or change (update/delete) for one model, or `null` for no restriction.
 */
async function filterFor(model: string, op: Op, ctx: DbContext | undefined, lookups: Lookups): Promise<Where | null> {
  if (ctx?.system) return null;
  if (!isWorkspaceModel(model)) return null;
  const tenantId = ctx?.tenantId || NONE;
  const userId = ctx?.userId || NONE;
  const read = op === 'read';

  if (ctx?.workerScan && (WORKER_ALL.has(model) || (read && WORKER_READ.has(model)))) return null;
  if (ctx?.operatorScan && read && OPERATOR_READ.has(model)) return null;

  const or: Where[] = [];
  if (model === 'Tenant') {
    or.push({ id: tenantId });
    if (read && ctx?.userId) {
      const ids = await lookups.membershipTenants(ctx.userId);
      if (ids.length) or.push({ id: { in: ids } });
    }
  } else {
    let own: Where = { tenantId };
    if (model === 'WorkspaceNavigation' || model === 'NextActionDecision') own = { tenantId, userId };
    else if (model === 'SavedView') own = read ? { tenantId, OR: [{ userId }, { shared: true }] } : { tenantId, userId };
    else if (model === 'Notification' && read && !ctx?.workerScan) own = { tenantId, userId };
    or.push(own);
    if (read && model === 'Membership' && ctx?.userId) or.push({ userId: ctx.userId });
    if (read && model === 'Role' && ctx?.userId) {
      const ids = await lookups.membershipRoles(ctx.userId);
      if (ids.length) or.push({ id: { in: ids } });
    }
  }
  if (read && ctx?.lookup) {
    const spec = (LOOKUP_FIELDS as Record<string, { fields: readonly string[]; extra: Where }>)[model];
    const given = (ctx.lookup as Record<string, Where | undefined>)[model];
    if (spec && given) {
      const keys = Object.keys(given);
      if (keys.length === 0 || keys.some((k) => !spec.fields.includes(k))) {
        throw new TenantIsolationError(`lookup on ${model} may only match ${spec.fields.join(', ')}`);
      }
      if (keys.every((k) => typeof given[k] === 'string' && given[k] !== '')) or.push({ ...given, ...spec.extra });
    }
  }
  return or.length === 1 ? or[0]! : { OR: or };
}

/** Every `tenantId` written anywhere in `data`, nested writes included, must be the context's workspace. */
function checkWrittenTenants(model: string, data: unknown, ctx: DbContext | undefined, allowAny: boolean): void {
  if (allowAny || ctx?.system) return;
  const tenantId = ctx?.tenantId || null;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 12 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    if (value instanceof Date || Buffer.isBuffer(value)) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'tenantId' && typeof v === 'string' && v !== tenantId) {
        throw new TenantIsolationError(`write to ${model} outside the current workspace`);
      }
      if (key === 'tenant' && v && typeof v === 'object') {
        const connectId = (v as { connect?: { id?: unknown } }).connect?.id;
        if (connectId !== undefined && connectId !== tenantId) {
          throw new TenantIsolationError(`write to ${model} outside the current workspace`);
        }
      }
      visit(v, depth + 1);
    }
  };
  visit(data, 0);
}

function checkCreate(model: string, row: unknown, ctx: DbContext | undefined): void {
  if (ctx?.system || !isWorkspaceModel(model)) return;
  if (ctx?.workerScan && WORKER_ALL.has(model)) return;
  const r = (row ?? {}) as Record<string, unknown>;
  const tenantId = ctx?.tenantId || null;
  if (!tenantId) throw new TenantIsolationError(`create on ${model} needs a workspace context`);
  if (model === 'Tenant') {
    if (r.id !== tenantId) throw new TenantIsolationError('a workspace can only be created in its own context');
    return;
  }
  const given = r.tenantId ?? (r.tenant as { connect?: { id?: unknown } } | undefined)?.connect?.id;
  if (given !== tenantId) throw new TenantIsolationError(`create on ${model} outside the current workspace`);
  if (model === 'WorkspaceNavigation' || model === 'NextActionDecision' || model === 'SavedView') {
    const uid = r.userId ?? (r.user as { connect?: { id?: unknown } } | undefined)?.connect?.id;
    if (!ctx?.userId || uid !== ctx.userId) throw new TenantIsolationError(`${model} documents are personal`);
  }
}

function readWithOrdering(operation: string, a: Record<string, unknown>, query: (args: unknown) => Promise<unknown>): Promise<unknown> {
  if (!a.orderBy) return query(a);
  const { orderBy, split } = splitNullOrdering(a.orderBy);
  a.orderBy = orderBy;
  if (split && operation === 'findMany' && !a.cursor && !a.distinct) return findManyWithNullOrdering(a, split, query);
  return query(a);
}

function and(where: unknown, filter: Where): Where {
  if (!where || (typeof where === 'object' && Object.keys(where as object).length === 0)) return filter;
  return { AND: [where as Where, filter] };
}

/** Adds the filter to a unique `where` without losing its unique fields (Prisma accepts extra filters there). */
function andUnique(where: unknown, filter: Where): Where {
  const w = { ...((where as Where) ?? {}) };
  const existing = w.AND === undefined ? [] : Array.isArray(w.AND) ? w.AND : [w.AND];
  w.AND = [...existing, filter];
  return w;
}

/** Restricts every to-many relation read through `include`/`select` to what the context may see. */
async function scopeNested(
  model: string,
  selection: unknown,
  ctx: DbContext | undefined,
  lookups: Lookups,
  depth = 0,
): Promise<unknown> {
  if (!selection || typeof selection !== 'object' || depth > 8) return selection;
  const meta = META.get(model);
  if (!meta) return selection;
  const out: Record<string, unknown> = { ...(selection as Record<string, unknown>) };
  for (const [field, value] of Object.entries(out)) {
    if (field === '_count' || !value) continue;
    const target = meta.relations.get(field);
    if (!target) continue;
    const isList = meta.lists.has(field);
    const filter = isList ? await filterFor(target, 'read', ctx, lookups) : null;
    const node: Record<string, unknown> = value === true ? {} : { ...(value as Record<string, unknown>) };
    if (node.include) node.include = await scopeNested(target, node.include, ctx, lookups, depth + 1);
    if (node.select) node.select = await scopeNested(target, node.select, ctx, lookups, depth + 1);
    if (filter) node.where = and(node.where, filter);
    out[field] = value === true && !filter ? true : node;
  }
  return out;
}

/**
 * Optional scalars a create leaves out, per model. MongoDB leaves such fields unset, and Prisma's `field: null`
 * filter does not match an unset field, so `where: { deletedAt: null }` would miss every new document. Creates
 * therefore write an explicit null for every optional field they leave out (fields with a default excepted), which
 * keeps the PostgreSQL meaning of "null" for the whole code base.
 */
interface NullableMeta {
  scalars: Array<{ name: string }>;
  /** foreign-key scalar -> relation field that can set it instead */
  fkRelation: Map<string, string>;
}
const NULLABLE = new Map<string, NullableMeta>();
for (const model of Prisma.dmmf.datamodel.models) {
  const scalars = model.fields
    .filter((f) => f.kind !== 'object' && !f.isRequired && !f.isList && !f.hasDefaultValue && !f.isUpdatedAt)
    .map((f) => ({ name: f.name }));
  const fkRelation = new Map<string, string>();
  for (const f of model.fields) for (const fk of f.relationFromFields ?? []) fkRelation.set(fk, f.name);
  NULLABLE.set(model.name, { scalars, fkRelation });
}

const NESTED_CREATE_KEYS = ['create', 'connectOrCreate', 'upsert', 'createMany'] as const;

/** Nested creates inside an update (`lines: { create: [...] }`) need the same treatment. */
function fillNestedUpdates(model: string, data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const rels = META.get(model)?.relations;
  if (!rels) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const [field, value] of Object.entries(out)) {
    const target = rels.get(field);
    if (!target || !value || typeof value !== 'object') continue;
    const nested: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if (nested.create !== undefined) nested.create = fillNulls(target, nested.create);
    if (nested.createMany !== undefined) {
      const cm = nested.createMany as { data?: unknown };
      nested.createMany = { ...cm, data: fillNulls(target, cm.data) };
    }
    out[field] = nested;
  }
  return out;
}

export function fillNulls(model: string, data: unknown, depth = 0): unknown {
  if (!data || typeof data !== 'object' || depth > 10) return data;
  if (Array.isArray(data)) return data.map((d) => fillNulls(model, d, depth + 1));
  const meta = NULLABLE.get(model);
  const rels = META.get(model)?.relations;
  if (!meta || !rels) return data;
  const out: Record<string, unknown> = { ...(roundDecimals(model, data) as Record<string, unknown>) };
  for (const { name } of meta.scalars) {
    if (name in out) continue;
    const rel = meta.fkRelation.get(name);
    if (rel && rel in out) continue;
    out[name] = null;
  }
  for (const [field, value] of Object.entries(out)) {
    const target = rels.get(field);
    if (!target || !value || typeof value !== 'object') continue;
    const nested: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of NESTED_CREATE_KEYS) {
      const v = nested[key];
      if (v === undefined) continue;
      if (key === 'create') nested.create = fillNulls(target, v, depth + 1);
      else if (key === 'createMany') {
        const cm = v as { data?: unknown };
        nested.createMany = { ...cm, data: fillNulls(target, cm.data, depth + 1) };
      } else {
        const list = Array.isArray(v) ? v : [v];
        const mapped = list.map((x) => ({ ...(x as object), create: fillNulls(target, (x as { create?: unknown }).create, depth + 1) }));
        nested[key] = Array.isArray(v) ? mapped : mapped[0];
      }
    }
    out[field] = nested;
  }
  return out;
}

type SortSpec = { sort: 'asc' | 'desc'; nulls?: 'first' | 'last' };

/**
 * Null ordering. Prisma's MongoDB connector has no `nulls: 'first' | 'last'`; MongoDB puts nulls first when sorting
 * ascending and last when descending. Code written for PostgreSQL asks for nulls last on ascending sorts (open
 * tasks by due date, people by company), so the guard strips `nulls` and, when the first such key asks for the
 * opposite of MongoDB's default, runs the query in two parts (values, then nulls) with the page arithmetic done
 * here. Use `nullsLast()` / `nullsFirst()` to write such a sort.
 */
export function nullsLast(sort: 'asc' | 'desc'): Prisma.SortOrder {
  return { sort, nulls: 'last' } as unknown as Prisma.SortOrder;
}
export function nullsFirst(sort: 'asc' | 'desc'): Prisma.SortOrder {
  return { sort, nulls: 'first' } as unknown as Prisma.SortOrder;
}

function splitNullOrdering(orderBy: unknown): { orderBy: unknown; split: { field: string; nullsFirst: boolean } | null } {
  if (!orderBy) return { orderBy, split: null };
  const list = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, unknown>[];
  let split: { field: string; nullsFirst: boolean } | null = null;
  const cleaned = list.map((entry) => {
    const out: Record<string, unknown> = {};
    for (const [field, v] of Object.entries(entry)) {
      if (v && typeof v === 'object' && 'sort' in (v as object)) {
        const spec = v as SortSpec;
        out[field] = spec.sort;
        const mongoNullsFirst = spec.sort === 'asc';
        if (!split && spec.nulls && (spec.nulls === 'first') !== mongoNullsFirst) split = { field, nullsFirst: spec.nulls === 'first' };
      } else out[field] = v;
    }
    return out;
  });
  return { orderBy: Array.isArray(orderBy) ? cleaned : cleaned[0], split };
}

async function findManyWithNullOrdering(
  a: Record<string, unknown>,
  split: { field: string; nullsFirst: boolean },
  query: (args: unknown) => Promise<unknown>,
): Promise<unknown[]> {
  const isNull = { [split.field]: null };
  const notNull = { [split.field]: { not: null } };
  const [firstPart, secondPart] = split.nullsFirst ? [isNull, notNull] : [notNull, isNull];
  const skip = typeof a.skip === 'number' ? a.skip : 0;
  const take = typeof a.take === 'number' ? a.take : undefined;
  const base = { ...a };
  delete base.skip;
  delete base.take;
  const first = (await query({ ...base, where: and(a.where, firstPart), skip, ...(take !== undefined ? { take } : {}) })) as unknown[];
  if (take !== undefined && first.length >= take) return first;
  let firstTotal = skip + first.length;
  if (first.length === 0 && skip > 0) {
    firstTotal = ((await query({ ...base, where: and(a.where, firstPart), select: { id: true }, include: undefined })) as unknown[]).length;
  }
  const rest = (await query({
    ...base,
    where: and(a.where, secondPart),
    skip: Math.max(0, skip - firstTotal),
    ...(take !== undefined ? { take: take - first.length } : {}),
  })) as unknown[];
  return [...first, ...rest];
}

/** Field name in the stored document for `tenantId` (the schema maps it to `tenant_id`). */
const RAW_TENANT_FIELD = 'tenant_id';

export function workspaceGuard(base: PrismaClient) {
  const lookups: Lookups = {
    async membershipTenants(userId) {
      const rows = await base.membership.findMany({ where: { userId }, select: { tenantId: true } });
      return rows.map((r) => r.tenantId);
    },
    async membershipRoles(userId) {
      const rows = await base.membership.findMany({ where: { userId }, select: { roleId: true } });
      return rows.map((r) => r.roleId).filter((id): id is string => !!id);
    },
  };

  return Prisma.defineExtension({
    name: 'workspace-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = currentDbContext();
          const a = { ...(args as Record<string, unknown>) };
          if (operation === 'create' || operation === 'createMany') a.data = roundDecimals(model, fillNulls(model, a.data));
          else if (operation === 'upsert') {
            a.create = roundDecimals(model, fillNulls(model, a.create));
            a.update = roundDecimals(model, a.update);
          } else if (operation === 'update' || operation === 'updateMany') a.data = roundDecimals(model, fillNestedUpdates(model, a.data));
          if (ctx?.system || !isWorkspaceModel(model)) return READ_OPS.has(operation) ? readWithOrdering(operation, a, query) : query(a);

          if (operation === 'update' || operation === 'updateMany' || operation === 'upsert') {
            if (NO_UPDATE.has(model)) throw new TenantIsolationError(`${model} records are append-only`);
          }
          if (operation === 'delete' || operation === 'deleteMany') {
            if (NO_DELETE.has(model)) throw new TenantIsolationError(`${model} records cannot be deleted`);
          }

          if (READ_OPS.has(operation)) {
            const filter = await filterFor(model, 'read', ctx, lookups);
            if (operation === 'findRaw') {
              if (filter) a.filter = rawAnd(a.filter, filter, model);
            } else if (operation === 'aggregateRaw') {
              if (filter) a.pipeline = [{ $match: rawFilter(filter, model) }, ...((a.pipeline as unknown[]) ?? [])];
            } else if (filter) {
              a.where = UNIQUE_WHERE_OPS.has(operation) ? andUnique(a.where, filter) : and(a.where, filter);
            }
            if (a.include) a.include = await scopeNested(model, a.include, ctx, lookups);
            if (a.select) a.select = await scopeNested(model, a.select, ctx, lookups);
            return readWithOrdering(operation, a, query);
          }

          const workerWrites = !!ctx?.workerScan && WORKER_ALL.has(model);
          if (operation === 'create') {
            checkCreate(model, a.data, ctx);
            checkWrittenTenants(model, a.data, ctx, workerWrites);
          } else if (operation === 'createMany') {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            for (const row of rows) checkCreate(model, row, ctx);
            checkWrittenTenants(model, rows, ctx, workerWrites);
          } else if (operation === 'upsert') {
            checkCreate(model, a.create, ctx);
            checkWrittenTenants(model, a.create, ctx, workerWrites);
            checkWrittenTenants(model, a.update, ctx, workerWrites);
          } else {
            checkWrittenTenants(model, a.data, ctx, workerWrites);
          }

          if (operation !== 'create' && operation !== 'createMany') {
            const op: Op = operation.startsWith('delete') ? 'delete' : 'update';
            const filter = await filterFor(model, op, ctx, lookups);
            if (filter) a.where = UNIQUE_WHERE_OPS.has(operation) ? andUnique(a.where, filter) : and(a.where, filter);
          }
          if (a.include) a.include = await scopeNested(model, a.include, ctx, lookups);
          if (a.select) a.select = await scopeNested(model, a.select, ctx, lookups);
          return query(a);
        },
      },
    },
  });
}

/** Turns a guard filter (Prisma field names, only equality, `in`, OR and AND) into a raw MongoDB filter. */
function rawFilter(filter: Where, model: string): Record<string, unknown> {
  const fieldName = (f: string) => {
    if (f === 'tenantId') return RAW_TENANT_FIELD;
    if (f === 'id') return '_id';
    const field = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields.find((x) => x.name === f);
    return field?.dbName ?? f;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k === 'OR' || k === 'AND') {
      out[`$${k.toLowerCase()}`] = (v as Where[]).map((x) => rawFilter(x, model));
    } else if (v && typeof v === 'object' && 'in' in (v as object)) {
      out[fieldName(k)] = { $in: (v as { in: unknown[] }).in };
    } else {
      out[fieldName(k)] = v;
    }
  }
  return out;
}

function rawAnd(filter: unknown, guard: Where, model: string): Record<string, unknown> {
  const g = rawFilter(guard, model);
  if (!filter || Object.keys(filter as object).length === 0) return g;
  return { $and: [filter, g] };
}
