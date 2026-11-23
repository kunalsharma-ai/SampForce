import type { Prisma } from '@dealflow/database';
import { auditContext } from '../common/audit-context';

/**
 * The one way to write the platform audit log (ADR 0074, C3). Every entry gets a target (what it is about), the
 * changed values before and after with secrets removed, and the Console session and browser it came from. Entries
 * are append-only: the database guard refuses updates and deletes of platform_audit_logs (packages/database scope.ts).
 */
export interface PlatformAuditTarget {
  type: string;
  id?: string | null;
  label?: string | null;
}

export interface PlatformAuditEntry {
  operatorId: string | null;
  action: string;
  tenantId?: string | null;
  /** Inferred from the action and metadata when left out (see targetOf). */
  target?: PlatformAuditTarget | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** The platform audit collection of a client or a transaction. */
type Db = { platformAuditLog: { create(args: { data: Prisma.PlatformAuditLogUncheckedCreateInput }): Promise<unknown> } };

/** Keys whose values never reach the log, at any depth. Fingerprints and hints are kept: they tell keys apart safely. */
const SECRET_KEY = /(password|passwd|secret|token|hash|cookie|authorization|otp|recovery|apikey|api_key|privatekey|private_key|credential)/i;
const SEALED_KEY = /Enc$/;
const MAX_JSON = 20_000;

export const REMOVED = '[removed]';

/** A copy of `value` with every secret-looking key's value replaced by "[removed]". */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 8) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'fingerprint' || k === 'hint') out[k] = v;
      else out[k] = SECRET_KEY.test(k) || SEALED_KEY.test(k) ? (v === null || v === undefined ? null : REMOVED) : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Large values are cut so one entry cannot grow without bound. */
function bounded(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text && text.length > MAX_JSON ? { truncated: true, size: text.length } : value;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null);

/** What an entry is about, from its action and the facts it records, for the entries that do not say. */
export function targetOf(e: PlatformAuditEntry): PlatformAuditTarget | null {
  const m = e.metadata ?? {};
  const [area] = e.action.split('.');
  if (area === 'operator_role') return { type: 'role', id: str(m.roleId), label: str(m.name) };
  if (area === 'operator') return { type: 'operator', id: str(m.operatorId) ?? e.operatorId, label: str(m.email) };
  if (area === 'plan') return { type: 'plan', id: str(m.plan) ?? str(m.code), label: str(m.name) ?? str(m.plan) };
  if (area === 'provider_key' || area === 'provider') return { type: 'provider', id: str(m.provider), label: str(m.name) ?? str(m.provider) };
  if (area === 'help_article') return { type: 'help_article', id: str(m.articleId), label: str(m.title) };
  if (area === 'help_category') return { type: 'help_category', id: str(m.categoryId), label: null };
  if (area === 'help_media') return { type: 'help_media', id: str(m.mediaId), label: str(m.name) };
  if (area === 'help_feedback') return { type: 'help_feedback', id: str(m.feedbackId), label: null };
  if (area === 'support_ticket') return { type: 'ticket', id: str(m.ticketId), label: str(m.number) };
  if (area === 'settings' || area === 'console' || (area === 'help_settings' && !e.tenantId)) return { type: 'setting', id: e.action, label: null };
  if (area === 'audit') return { type: 'audit_log', id: null, label: null };
  if (e.tenantId) return { type: 'client', id: e.tenantId, label: null };
  return null;
}

/** Writes one platform audit entry. */
export async function writePlatformAudit(db: Db, e: PlatformAuditEntry): Promise<void> {
  const ctx = auditContext();
  const target = e.target === undefined ? targetOf(e) : e.target;
  const m = e.metadata ?? {};
  // Entries that record "from" and "to" keep them as before/after as well, so the page can show a diff.
  const before = e.before !== undefined ? e.before : 'from' in m && 'to' in m ? m.from : undefined;
  const after = e.after !== undefined ? e.after : 'from' in m && 'to' in m ? m.to : undefined;
  await db.platformAuditLog.create({
    data: {
      operatorId: e.operatorId,
      action: e.action,
      targetTenantId: e.tenantId ?? null,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      targetLabel: target?.label ?? null,
      ...(before !== undefined ? { before: bounded(redact(before)) as Prisma.InputJsonValue } : {}),
      ...(after !== undefined ? { after: bounded(redact(after)) as Prisma.InputJsonValue } : {}),
      metadata: bounded(redact(m)) as Prisma.InputJsonValue,
      ip: e.ip ?? null,
      sessionId: ctx?.sessionId ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });
  if (ctx) ctx.platformWrites++;
}

/** The fields of `before` that `after` changes, as two small objects for the log ({} when nothing changed). */
export function changedFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    const old = before?.[k] ?? null;
    if (v === undefined) continue;
    if (JSON.stringify(redact(old)) !== JSON.stringify(redact(v))) {
      b[k] = old;
      a[k] = v;
    }
  }
  return { before: b, after: a };
}
