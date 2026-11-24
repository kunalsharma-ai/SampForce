import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  CONSOLE_ACTIVITY_CATEGORIES,
  CONSOLE_ACTIVITY_PERMISSION,
  type ConsoleActivityCategory,
  type ConsoleActivityItem,
  type ConsoleActivityPage,
  type ConsoleActivityQuery,
  type PlatformAuditQuery,
  type PlatformAuditRow,
} from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import type { OperatorContext } from './operator-auth';
import { writePlatformAudit } from './platform-audit';

/** The most rows one CSV export holds; narrow the filters for more. */
export const AUDIT_EXPORT_MAX = 10_000;
const EXPORT_PAGE = 500;

/** Operator entries the activity feed leaves out: looking, searching and signing in are in the audit log only. */
const QUIET_ACTIONS = /(\.viewed|\.listed|\.searched|_viewed|viewed_with_support_access|^operator\.login|^audit\.|^console\.searched|reset_requested|^provider\.checked$)/;

type AuditRow = Prisma.PlatformAuditLogGetPayload<{ include: { operator: { select: { id: true; email: true; name: true } } } }>;

const DAY = 86_400_000;

/** A feed item before its client's name is looked up. */
type Pending = Omit<ConsoleActivityItem, 'client'> & { tenantId: string | null };

/**
 * The platform audit log page and the Console activity feed (ADR 0074, C3). The log is read-only here: filters only
 * narrow what is shown. The feed merges operator actions with the platform's own records (clients joining, new
 * workspaces, invoices, failed payments, tickets reaching SampForce, unusual sign-ins) and never reads CRM records.
 */
@Injectable()
export class ConsoleAuditService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── Audit log ─────────────

  private async where(q: Omit<PlatformAuditQuery, 'limit'>): Promise<Prisma.PlatformAuditLogWhereInput> {
    const and: Prisma.PlatformAuditLogWhereInput[] = [];
    if (q.tenantId) and.push({ targetTenantId: q.tenantId });
    if (q.operatorId) and.push({ operatorId: q.operatorId });
    if (q.action) and.push({ action: { contains: q.action, mode: 'insensitive' } });
    if (q.targetType) and.push({ targetType: q.targetType });
    if (q.targetId) and.push({ targetId: q.targetId });
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = new Date(`${q.from}T00:00:00Z`);
    const ends = [q.to ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + DAY) : null, q.before ? new Date(q.before) : null].filter((d): d is Date => !!d);
    if (ends.length) createdAt.lt = new Date(Math.min(...ends.map((d) => d.getTime())));
    if (createdAt.gte || createdAt.lt) and.push({ createdAt });
    if (q.q) {
      // Free text finds the action, the target's name or id, the operator (email or name) and the client (name).
      const text = { contains: q.q, mode: 'insensitive' as const };
      const [ops, tenants] = await Promise.all([
        this.prisma.platformOperator.findMany({ where: { OR: [{ email: text }, { name: text }] }, select: { id: true }, take: 50 }),
        this.prisma.run({ operatorScan: true }, (tx) => tx.tenant.findMany({ where: { name: text }, select: { id: true }, take: 200 })),
      ]);
      and.push({
        OR: [
          { action: text },
          { targetLabel: text },
          { targetId: q.q },
          ...(ops.length ? [{ operatorId: { in: ops.map((o) => o.id) } }] : []),
          ...(tenants.length ? [{ targetTenantId: { in: tenants.map((t) => t.id) } }] : []),
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  private async rows(where: Prisma.PlatformAuditLogWhereInput, take: number): Promise<PlatformAuditRow[]> {
    const rows: AuditRow[] = await this.prisma.platformAuditLog.findMany({ where, include: { operator: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: 'desc' }, take });
    const names = await this.tenantNames(rows.map((r) => r.targetTenantId));
    return rows.map((r) => toRow(r, names));
  }

  private async tenantNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.run({ operatorScan: true }, (tx) => tx.tenant.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }));
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  /** Newest first, a page at a time (pass the last row's createdAt as `before`). */
  async list(q: PlatformAuditQuery): Promise<PlatformAuditRow[]> {
    return this.rows(await this.where(q), q.limit);
  }

  async entry(id: string): Promise<PlatformAuditRow> {
    const row = await this.prisma.platformAuditLog.findUnique({ where: { id }, include: { operator: { select: { id: true, email: true, name: true } } } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That audit entry was not found.' });
    return toRow(row, await this.tenantNames([row.targetTenantId]));
  }

  /** The filtered log as CSV, newest first, up to AUDIT_EXPORT_MAX rows. The export itself is an audit entry. */
  async exportCsv(op: OperatorContext, q: Omit<PlatformAuditQuery, 'limit' | 'before'>, ip: string | null): Promise<{ csv: string; rows: number; capped: boolean }> {
    const where = await this.where(q);
    const lines = [CSV_HEADER.map(cell).join(',')];
    let before: Date | null = null;
    let count = 0;
    while (count < AUDIT_EXPORT_MAX) {
      const page = await this.rows(before ? { AND: [where, { createdAt: { lt: before } }] } : where, Math.min(EXPORT_PAGE, AUDIT_EXPORT_MAX - count));
      for (const r of page) lines.push(csvRow(r));
      count += page.length;
      if (page.length < EXPORT_PAGE) break;
      before = new Date(page.at(-1)!.createdAt);
    }
    const capped = count >= AUDIT_EXPORT_MAX;
    await writePlatformAudit(this.prisma, { operatorId: op.id, action: 'audit.exported', target: { type: 'audit_log', id: null, label: null }, metadata: { filters: { ...q }, rows: count, capped }, ip });
    return { csv: `${lines.join('\r\n')}\r\n`, rows: count, capped };
  }

  // ───────────── Activity feed ─────────────

  /** The categories this operator's role may see. */
  categoriesFor(op: OperatorContext): ConsoleActivityCategory[] {
    return CONSOLE_ACTIVITY_CATEGORIES.filter((c) => op.permissions.includes(CONSOLE_ACTIVITY_PERMISSION[c] as never));
  }

  async activity(op: OperatorContext, q: ConsoleActivityQuery): Promise<ConsoleActivityPage> {
    const allowed = this.categoriesFor(op);
    const cats = new Set(q.categories ? q.categories.filter((c) => allowed.includes(c)) : allowed);
    const lt = q.before ? new Date(q.before) : new Date(Date.now() + 1000);
    const take = q.limit;
    const t = q.tenantId;
    const scan = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => this.prisma.run({ operatorScan: true }, fn);
    const items: Pending[] = [];
    const push = (tenantId: string | null, item: Omit<ConsoleActivityItem, 'client'>) => items.push({ ...item, tenantId });
    const jobs: Promise<void>[] = [];

    if (cats.has('clients'))
      jobs.push(
        scan((tx) => tx.tenant.findMany({ where: { createdAt: { lt }, deletedAt: null, ...(t ? { id: t } : {}) }, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take })).then((rows) => {
          for (const r of rows) push(r.id, { id: `client.joined:${r.id}`, kind: 'client.joined', category: 'clients', at: r.createdAt.toISOString(), operator: null, data: { name: r.name }, link: `/operator/clients/${r.id}` });
        }),
      );
    if (cats.has('workspaces'))
      jobs.push(
        scan((tx) =>
          tx.workspaceNode.findMany({ where: { level: { in: ['MANAGER', 'EXECUTIVE'] }, createdAt: { lt }, ...(t ? { tenantId: t } : {}) }, select: { id: true, tenantId: true, name: true, level: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take }),
        ).then((rows) => {
          for (const r of rows) push(r.tenantId, { id: `workspace.created:${r.id}`, kind: 'workspace.created', category: 'workspaces', at: r.createdAt.toISOString(), operator: null, data: { name: r.name, level: r.level }, link: `/operator/clients/${r.tenantId}` });
        }),
      );
    if (cats.has('billing')) {
      const select = { id: true, tenantId: true, number: true, totalCents: true, amountPaidCents: true, currency: true, issuedAt: true, paidAt: true } as const;
      jobs.push(
        scan((tx) => tx.invoice.findMany({ where: { issuedAt: { lt }, status: { in: ['OPEN', 'PAID', 'UNCOLLECTIBLE'] }, ...(t ? { tenantId: t } : {}) }, select, orderBy: { issuedAt: 'desc' }, take })).then((rows) => {
          for (const r of rows) push(r.tenantId, { id: `invoice.issued:${r.id}`, kind: 'invoice.issued', category: 'billing', at: r.issuedAt.toISOString(), operator: null, data: { number: r.number, cents: r.totalCents, currency: r.currency }, link: `/operator/clients/${r.tenantId}` });
        }),
        scan((tx) => tx.invoice.findMany({ where: { paidAt: { lt, not: null }, ...(t ? { tenantId: t } : {}) }, select, orderBy: { paidAt: 'desc' }, take })).then((rows) => {
          for (const r of rows) push(r.tenantId, { id: `invoice.paid:${r.id}`, kind: 'invoice.paid', category: 'billing', at: r.paidAt!.toISOString(), operator: null, data: { number: r.number, cents: r.amountPaidCents || r.totalCents, currency: r.currency }, link: `/operator/clients/${r.tenantId}` });
        }),
        scan((tx) => tx.subscription.findMany({ where: { pastDueSince: { lt, not: null }, ...(t ? { tenantId: t } : {}) }, select: { id: true, tenantId: true, planCode: true, pastDueSince: true }, orderBy: { pastDueSince: 'desc' }, take })).then((rows) => {
          for (const r of rows) push(r.tenantId, { id: `subscription.past_due:${r.id}:${r.pastDueSince!.getTime()}`, kind: 'subscription.past_due', category: 'billing', at: r.pastDueSince!.toISOString(), operator: null, data: { plan: r.planCode }, link: `/operator/clients/${r.tenantId}` });
        }),
      );
    }
    if (cats.has('support')) {
      const select = { id: true, tenantId: true, number: true, subject: true, priority: true, createdAt: true, escalatedAt: true } as const;
      const ticket = (r: { id: string; tenantId: string; number: number; subject: string; priority: string }, at: Date, escalated: boolean) =>
        push(r.tenantId, { id: `ticket.submitted:${r.id}`, kind: 'ticket.submitted', category: 'support', at: at.toISOString(), operator: null, data: { number: r.number, subject: r.subject, priority: r.priority, escalated }, link: `/operator/support?ticket=${r.id}` });
      jobs.push(
        scan((tx) => tx.supportTicket.findMany({ where: { handlerLevel: 'CONSOLE', escalatedAt: null, createdAt: { lt }, ...(t ? { tenantId: t } : {}) }, select, orderBy: { createdAt: 'desc' }, take })).then((rows) => {
          for (const r of rows) ticket(r, r.createdAt, false);
        }),
        scan((tx) => tx.supportTicket.findMany({ where: { handlerLevel: 'CONSOLE', escalatedAt: { lt, not: null }, ...(t ? { tenantId: t } : {}) }, select, orderBy: { escalatedAt: 'desc' }, take })).then((rows) => {
          for (const r of rows) ticket(r, r.escalatedAt!, true);
        }),
      );
    }
    if (cats.has('security') && !t)
      jobs.push(
        this.prisma.operatorLoginEvent.findMany({ where: { suspicious: true, createdAt: { lt } }, orderBy: { createdAt: 'desc' }, take }).then((rows) => {
          for (const r of rows) push(null, { id: `signin.unusual:${r.id}`, kind: 'signin.unusual', category: 'security', at: r.createdAt.toISOString(), operator: null, data: { email: r.email, reason: r.reason, outcome: r.outcome }, link: '/operator/security' });
        }),
      );
    if (cats.has('console'))
      jobs.push(
        this.prisma.platformAuditLog
          .findMany({ where: { operatorId: { not: null }, createdAt: { lt }, ...(t ? { targetTenantId: t } : {}) }, include: { operator: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: take * 3 })
          .then((rows) => {
            for (const r of rows.filter((x) => !QUIET_ACTIONS.test(x.action)).slice(0, take))
              push(r.targetTenantId, {
                id: `operator.action:${r.id}`,
                kind: 'operator.action',
                category: 'console',
                at: r.createdAt.toISOString(),
                operator: r.operator ? { id: r.operator.id, name: r.operator.name } : null,
                data: { action: r.action, targetType: r.targetType, target: r.targetLabel, entry: r.id, reason: typeof (r.metadata as Record<string, unknown>)?.reason === 'string' ? ((r.metadata as Record<string, string>).reason ?? null) : null },
                link: linkFor(r.targetType, r.targetTenantId, r.id),
              });
          }),
      );
    await Promise.all(jobs);
    const page = items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1)).slice(0, take);
    const names = await this.tenantNames(page.map((i) => i.tenantId));
    return {
      items: page.map(({ tenantId, ...i }) => ({ ...i, client: tenantId ? { id: tenantId, name: names.get(tenantId) ?? 'Deleted client' } : null })),
      next: page.length === take ? page.at(-1)!.at : null,
    };
  }
}

function linkFor(type: string | null, tenantId: string | null, entry: string): string {
  if (tenantId) return `/operator/clients/${tenantId}`;
  switch (type) {
    case 'operator':
      return '/operator/operators';
    case 'role':
      return '/operator/roles';
    case 'plan':
      return '/operator/plans';
    case 'provider':
    case 'provider_key':
      return '/operator/providers';
    case 'help_article':
    case 'help_category':
    case 'help_media':
    case 'help_feedback':
      return '/operator/help/manage';
    default:
      return `/operator/audit?entry=${entry}`;
  }
}

function toRow(r: AuditRow, names: Map<string, string>): PlatformAuditRow {
  return {
    id: r.id,
    operator: r.operator,
    action: r.action,
    targetTenantId: r.targetTenantId,
    client: r.targetTenantId ? { id: r.targetTenantId, name: names.get(r.targetTenantId) ?? null } : null,
    target: r.targetType ? { type: r.targetType, id: r.targetId, label: r.targetLabel ?? (r.targetType === 'client' && r.targetId ? (names.get(r.targetId) ?? null) : null) } : null,
    before: r.before ?? null,
    after: r.after ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    ip: r.ip,
    sessionId: r.sessionId,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
  };
}

const CSV_HEADER = ['When (UTC)', 'Operator', 'Operator email', 'Action', 'Client', 'Target type', 'Target id', 'Target', 'Before', 'After', 'Details', 'IP address', 'Session', 'Browser'];

/** One CSV cell, quoted, with a leading apostrophe on text a spreadsheet would run as a formula. */
export function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(r: PlatformAuditRow): string {
  return [
    r.createdAt,
    r.operator?.name ?? 'SampForce (automatic)',
    r.operator?.email ?? '',
    r.action,
    r.client?.name ?? '',
    r.target?.type ?? '',
    r.target?.id ?? '',
    r.target?.label ?? '',
    r.before,
    r.after,
    Object.keys(r.metadata).length ? r.metadata : null,
    r.ip,
    r.sessionId,
    r.userAgent,
  ]
    .map(cell)
    .join(',');
}
