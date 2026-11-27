import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeCommit } from './client';

/*
 * Deleted items (ADR 0098). While a delete request runs inside `runInRecycleScope`, every record it removes is noted
 * before it goes: a soft delete (deletedAt set) by its id, a hard delete by a copy of the document, together with
 * the records Prisma removes with it (onDelete: Cascade). The API stores the notes as one batch, so the whole delete
 * can be put back later. Only requests inside a scope are noted, so housekeeping deletes elsewhere cost nothing.
 */

export interface RecycleCapture {
  model: string;
  recordId: string;
  kind: 'SOFT' | 'HARD';
  /** A HARD record's fields (see packRecord). */
  data?: unknown;
}

export interface RecycleScope {
  entries: RecycleCapture[];
  /** Stop keeping copies after this many records (the delete still happens; the batch is marked partial). */
  limit: number;
  overflow: boolean;
}

const storage = new AsyncLocalStorage<RecycleScope>();

export function newRecycleScope(limit = 20_000): RecycleScope {
  return { entries: [], limit, overflow: false };
}

/** Runs `fn` with deletes noted into `scope`. */
export function runInRecycleScope<T>(scope: RecycleScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentRecycleScope(): RecycleScope | undefined {
  return storage.getStore();
}

/**
 * Records that are never kept: sign-in and security data, platform records, queues, append-only logs and the bin
 * itself. Deleting those is either impossible for a workspace or meant to be final (a signed-out session).
 */
const NOT_KEPT = new Set([
  'Counter', 'User', 'UserPhoto', 'UserProfile', 'UserPreference', 'NotificationPreference', 'UserRegionalSetting', 'UserContactTimes', 'UserSavedTheme',
  'WorkspaceNavigation', 'PasswordResetToken', 'Session', 'MfaRecoveryCode', 'PasswordConfirmation', 'PasswordCheckFailure', 'Tenant', 'Subscription',
  'Role', 'Membership', 'WorkspaceNode', 'Invitation', 'AuditLog', 'DomainEvent', 'Notification', 'ApprovalRequest', 'Plan', 'PlanWorkspaceRules',
  'TenantFeatureOverride', 'SupportGrant', 'Invoice', 'BillingEvent', 'SsoConnection', 'SsoIdentity', 'ScimToken', 'ApiKey', 'IntegrationConnection',
  'AppConnection', 'Webhook', 'WebhookDelivery', 'MobileAccess', 'MobileDevice', 'MobilePush', 'ChatSignal', 'ChatPresence', 'AiUsage', 'ProviderUsage',
  'TeamApproval', 'TeamApprovalSettings', 'RecycleBatch', 'RecycleEntry', 'IntegrationSyncLog', 'WorkflowStep', 'AiRun',
]);

const isPlatformModel = (model: string) => /^(Platform|Operator|Client(Logo|HealthDaily)$)/.test(model);

export function keptInBin(model: string): boolean {
  return !NOT_KEPT.has(model) && !isPlatformModel(model);
}

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

/** Child models Prisma deletes with a parent (onDelete: Cascade), with the field that points at the parent. */
const CASCADES = new Map<string, { model: string; field: string; references: string }[]>();
for (const m of Prisma.dmmf.datamodel.models) {
  for (const f of m.fields) {
    if (f.kind !== 'object' || !f.relationFromFields?.length || f.relationOnDelete !== 'Cascade') continue;
    if (f.relationFromFields.length !== 1) continue;
    const list = CASCADES.get(f.type) ?? [];
    list.push({ model: m.name, field: f.relationFromFields[0]!, references: f.relationToFields?.[0] ?? 'id' });
    CASCADES.set(f.type, list);
  }
}

const delegateOf = (client: PrismaClient, model: string) =>
  (client as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, unknown>[]> }>)[model.charAt(0).toLowerCase() + model.slice(1)];

/** A record's fields as plain JSON, with dates, decimals, bytes and big numbers tagged so they come back as they were. */
export function packRecord(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return { $sfDate: value.toISOString() };
  if (typeof value === 'bigint') return { $sfBig: value.toString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { $sfBytes: Buffer.from(value).toString('base64') };
  if (Prisma.Decimal.isDecimal(value)) return { $sfDec: (value as Prisma.Decimal).toString() };
  if (Array.isArray(value)) return value.map(packRecord);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, packRecord(v)]));
  return value;
}

export function unpackRecord(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(unpackRecord);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.$sfDate === 'string') return new Date(o.$sfDate);
    if (typeof o.$sfBig === 'string') return BigInt(o.$sfBig);
    if (typeof o.$sfBytes === 'string') return Buffer.from(o.$sfBytes, 'base64');
    if (typeof o.$sfDec === 'string') return new Prisma.Decimal(o.$sfDec);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, unpackRecord(v)]));
  }
  return value;
}

/** True for an update that soft-deletes: it sets deletedAt to a time. */
function softDeletes(model: string, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const v = (data as Record<string, unknown>).deletedAt;
  if (!(v instanceof Date || (typeof v === 'string' && v))) return false;
  return !!MODELS.get(model)?.fields.some((f) => f.name === 'deletedAt');
}

function push(scope: RecycleScope, found: RecycleCapture[]): void {
  const commit = async () => {
    for (const e of found) {
      if (scope.entries.length >= scope.limit) {
        scope.overflow = true;
        return;
      }
      scope.entries.push(e);
    }
  };
  // Kept only if the transaction commits: a retried or failed transaction notes nothing.
  if (!beforeCommit(commit)) void commit();
}

/**
 * Called by the workspace guard just before a write runs, with its final (scoped) arguments. Notes what the write is
 * about to remove when a recycle scope is open.
 */
export async function noteRemoval(base: PrismaClient, model: string, operation: string, args: Record<string, unknown>): Promise<void> {
  const scope = storage.getStore();
  if (!scope || !keptInBin(model)) return;
  if (scope.entries.length >= scope.limit) {
    scope.overflow = true;
    return;
  }
  const delegate = delegateOf(base, model);
  if (!delegate) return;
  if ((operation === 'update' || operation === 'updateMany') && softDeletes(model, args.data)) {
    const rows = await delegate.findMany({ where: args.where, select: { id: true } });
    push(scope, rows.map((r) => ({ model, recordId: String(r.id), kind: 'SOFT' as const })));
    return;
  }
  if (operation !== 'delete' && operation !== 'deleteMany') return;
  const rows = await delegate.findMany({ where: args.where });
  const found: RecycleCapture[] = rows.map((r) => ({ model, recordId: String(r.id), kind: 'HARD' as const, data: packRecord(r) }));
  await withCascades(base, model, rows, found, 0, scope.limit - scope.entries.length);
  push(scope, found);
}

/** The records Prisma will remove with `rows` (onDelete: Cascade), depth first. */
async function withCascades(base: PrismaClient, model: string, rows: Record<string, unknown>[], out: RecycleCapture[], depth: number, room: number): Promise<void> {
  if (!rows.length || depth > 4) return;
  for (const child of CASCADES.get(model) ?? []) {
    if (!keptInBin(child.model) || out.length >= room) continue;
    const keys = [...new Set(rows.map((r) => r[child.references]).filter((v) => v !== null && v !== undefined))];
    if (!keys.length) continue;
    const delegate = delegateOf(base, child.model);
    if (!delegate) continue;
    const children = await delegate.findMany({ where: { [child.field]: { in: keys } } });
    for (const c of children) out.push({ model: child.model, recordId: String(c.id), kind: 'HARD', data: packRecord(c) });
    await withCascades(base, child.model, children, out, depth + 1, room);
  }
}
