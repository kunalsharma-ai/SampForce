import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  OPERATOR_NOTIFICATION_DEFS,
  OPERATOR_NOTIFICATION_TYPES,
  type OperatorNotificationPage,
  type OperatorNotificationPrefRow,
  type OperatorNotificationPrefsInput,
  type OperatorNotificationQuery,
  type OperatorNotificationRow,
  type OperatorNotificationType,
} from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { operatorContext } from './operator-auth';
import { PROVIDER_CHECK_PREFIX, readProviderCheck } from './provider-checks';

/** Where the sweep got to, so each event is looked at once (the dedupe key covers a second look). */
export const NOTIFICATION_CURSOR_KEY = 'console.notifications.cursor';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How long an offline invoice may stay open before it is overdue (until invoices carry a due date, C8). */
export const OVERDUE_DAYS = 14;
/** First-answer times for tickets that reach SampForce support. */
export const SLA_HOURS = { HIGH: 8, NORMAL: 24 } as const;
const OPEN_TICKET = ['SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS'] as const;
const BATCH = 200;

export interface ConsoleNotice {
  type: OperatorNotificationType;
  /** Same event, same key: an operator gets it once. */
  key: string;
  title: string;
  body?: string | null;
  link?: string | null;
  tenantId?: string | null;
}

type Pref = { inApp: boolean; email: boolean };

/**
 * Console notifications (ADR 0074, C3b): delivery to the operators whose role may act on each type, in the
 * Console and by email as each operator prefers, and the operator's own list, read marks and preferences.
 */
@Injectable()
export class ConsoleNotifier {
  private readonly log = new Logger('ConsoleNotifier');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private defaults(type: OperatorNotificationType): Pref {
    return { inApp: true, email: OPERATOR_NOTIFICATION_DEFS[type].emailByDefault };
  }

  /** Active operators whose role has the type's permission, with their choice for it. */
  private async recipients(type: OperatorNotificationType): Promise<{ id: string; email: string; pref: Pref }[]> {
    const def = OPERATOR_NOTIFICATION_DEFS[type];
    const ops = await this.prisma.platformOperator.findMany({ where: { status: 'ACTIVE' }, select: { id: true, email: true, name: true, role: true, consoleRole: true } });
    const prefs = await this.prisma.operatorNotificationPref.findMany({ where: { type, operatorId: { in: ops.map((o) => o.id) } } });
    const byOp = new Map(prefs.map((p) => [p.operatorId, { inApp: p.inApp, email: p.email }]));
    const out: { id: string; email: string; pref: Pref }[] = [];
    for (const op of ops) {
      const ctx = await operatorContext(this.prisma, op);
      if (!ctx.permissions.includes(def.permission)) continue;
      out.push({ id: op.id, email: op.email, pref: byOp.get(op.id) ?? this.defaults(type) });
    }
    return out;
  }

  /** Delivers one event; returns how many operators got something new. */
  async deliver(n: ConsoleNotice): Promise<number> {
    let delivered = 0;
    for (const r of await this.recipients(n.type)) {
      if (!r.pref.inApp && !r.pref.email) continue;
      let row: { id: string };
      try {
        row = await this.prisma.operatorNotification.create({
          data: { operatorId: r.id, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, targetTenantId: n.tenantId ?? null, dedupeKey: n.key, inApp: r.pref.inApp },
          select: { id: true },
        });
      } catch (err) {
        // Already delivered to this operator (another worker, or a second look at the same event).
        if ((err as { code?: string }).code === 'P2002') continue;
        throw err;
      }
      delivered++;
      if (r.pref.email) await this.email(r.email, row.id, n);
    }
    return delivered;
  }

  private async email(to: string, id: string, n: ConsoleNotice): Promise<void> {
    if (!(await this.mailer.configuredFor(null))) return;
    const origin = this.env.PUBLIC_WEB_URL.replace(/\/+$/, '');
    const text = [n.title, n.body ?? '', n.link ? `Open it in the Console: ${origin}${n.link}` : '', '', `Choose which notifications you get by email: ${origin}/operator/notifications?tab=preferences`]
      .filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
      .join('\n');
    try {
      await this.mailer.send({ to, subject: `SampForce Console: ${n.title}`, text });
      await this.prisma.operatorNotification.update({ where: { id }, data: { emailedAt: new Date() } });
    } catch (err) {
      // The notification stays in the Console; email is best effort.
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Console notification email failed');
    }
  }

  // ───────────── The operator's own notifications ─────────────

  async list(operatorId: string, q: OperatorNotificationQuery): Promise<OperatorNotificationPage> {
    const where: Prisma.OperatorNotificationWhereInput = { operatorId, inApp: true, ...(q.unread ? { readAt: null } : {}), ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) };
    const [rows, unread] = await Promise.all([
      this.prisma.operatorNotification.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit }),
      this.unread(operatorId),
    ]);
    const tenantIds = [...new Set(rows.map((r) => r.targetTenantId).filter((v): v is string => !!v))];
    const tenants = tenantIds.length ? await this.prisma.run({ operatorScan: true }, (tx) => tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })) : [];
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    const items: OperatorNotificationRow[] = rows.map((r) => ({
      id: r.id,
      type: r.type as OperatorNotificationType,
      title: r.title,
      body: r.body,
      link: r.link,
      client: r.targetTenantId ? { id: r.targetTenantId, name: names.get(r.targetTenantId) ?? 'Deleted client' } : null,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, unread, next: rows.length === q.limit ? items.at(-1)!.createdAt : null };
  }

  unread(operatorId: string): Promise<number> {
    return this.prisma.operatorNotification.count({ where: { operatorId, inApp: true, readAt: null } });
  }

  async markRead(operatorId: string, id: string): Promise<{ unread: number }> {
    const res = await this.prisma.operatorNotification.updateMany({ where: { id, operatorId }, data: { readAt: new Date() } });
    if (!res.count) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notification not found.' });
    return { unread: await this.unread(operatorId) };
  }

  /** Opening a Console page reads the notifications that point to it (ADR 0075): the bell and menu count clear. */
  async markPageRead(operatorId: string, path: string): Promise<{ updated: number; unread: number }> {
    const res = await this.prisma.operatorNotification.updateMany({
      where: { operatorId, inApp: true, readAt: null, OR: [{ link: path }, { link: { startsWith: `${path}?` } }, { link: { startsWith: `${path}#` } }] },
      data: { readAt: new Date() },
    });
    return { updated: res.count, unread: await this.unread(operatorId) };
  }

  async markAllRead(operatorId: string): Promise<{ unread: number }> {
    await this.prisma.operatorNotification.updateMany({ where: { operatorId, inApp: true, readAt: null }, data: { readAt: new Date() } });
    return { unread: 0 };
  }

  /** The types this operator's role receives, with their choice for each. */
  async prefs(operatorId: string, permissions: readonly string[]): Promise<OperatorNotificationPrefRow[]> {
    const saved = new Map((await this.prisma.operatorNotificationPref.findMany({ where: { operatorId } })).map((p) => [p.type, p]));
    return OPERATOR_NOTIFICATION_TYPES.filter((t) => permissions.includes(OPERATOR_NOTIFICATION_DEFS[t].permission)).map((t) => {
      const p = saved.get(t) ?? this.defaults(t);
      return { type: t, label: OPERATOR_NOTIFICATION_DEFS[t].label, description: OPERATOR_NOTIFICATION_DEFS[t].description, inApp: p.inApp, email: p.email };
    });
  }

  async setPrefs(operatorId: string, permissions: readonly string[], input: OperatorNotificationPrefsInput): Promise<OperatorNotificationPrefRow[]> {
    for (const p of input.prefs) {
      // Types the role does not receive are ignored rather than stored.
      if (!permissions.includes(OPERATOR_NOTIFICATION_DEFS[p.type].permission)) continue;
      await this.prisma.operatorNotificationPref.upsert({
        where: { operatorId_type: { operatorId, type: p.type } },
        create: { operatorId, type: p.type, inApp: p.inApp, email: p.email },
        update: { inApp: p.inApp, email: p.email },
      });
    }
    return this.prefs(operatorId, permissions);
  }
}

/**
 * The worker's pass that turns platform events into Console notifications (ADR 0074, C3b). New events since the last
 * pass (clients, workspaces, tickets, failed payments, unusual sign-ins, feature changes, failed provider checks) and
 * conditions that come due (subscriptions ending, invoices overdue, tickets past their response time). The first pass
 * on a deployment starts from now, so history is not sent out.
 */
@Injectable()
export class ConsoleNotificationSweep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ConsoleNotifier,
  ) {}

  private scan<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ operatorScan: true }, fn);
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.scan((tx) => tx.tenant.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }));
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  async sweep(now = new Date()): Promise<number> {
    const saved = await this.prisma.platformSetting.findUnique({ where: { key: NOTIFICATION_CURSOR_KEY } });
    if (!saved) {
      await this.prisma.platformSetting.upsert({ where: { key: NOTIFICATION_CURSOR_KEY }, create: { key: NOTIFICATION_CURSOR_KEY, value: now.toISOString() }, update: {} });
      return 0;
    }
    const since = new Date(saved.value);
    const window = { gt: since, lte: now };
    const notices: ConsoleNotice[] = [];

    const [tenants, nodes, direct, escalated, pastDue, logins, changes, checks] = await Promise.all([
      this.scan((tx) => tx.tenant.findMany({ where: { createdAt: window, deletedAt: null }, select: { id: true, name: true }, take: BATCH })),
      this.scan((tx) => tx.workspaceNode.findMany({ where: { level: { in: ['MANAGER', 'EXECUTIVE'] }, createdAt: window }, select: { id: true, tenantId: true, name: true, level: true }, take: BATCH })),
      this.scan((tx) => tx.supportTicket.findMany({ where: { handlerLevel: 'CONSOLE', escalatedAt: null, createdAt: window }, select: { id: true, tenantId: true, number: true, subject: true }, take: BATCH })),
      this.scan((tx) => tx.supportTicket.findMany({ where: { handlerLevel: 'CONSOLE', escalatedAt: { ...window, not: null } }, select: { id: true, tenantId: true, number: true, subject: true }, take: BATCH })),
      this.scan((tx) => tx.subscription.findMany({ where: { pastDueSince: { ...window, not: null } }, select: { id: true, tenantId: true, planCode: true, pastDueSince: true }, take: BATCH })),
      this.prisma.operatorLoginEvent.findMany({ where: { suspicious: true, createdAt: window }, select: { id: true, email: true, reason: true }, take: BATCH }),
      this.prisma.platformAuditLog.findMany({ where: { action: { in: ['tenant.features_overridden', 'plan.definition_changed', 'plan.created'] }, createdAt: window }, include: { operator: { select: { name: true } } }, take: BATCH }),
      this.prisma.platformSetting.findMany({ where: { key: { startsWith: PROVIDER_CHECK_PREFIX }, updatedAt: window } }),
    ]);
    const names = await this.names([...nodes.map((n) => n.tenantId), ...direct.map((t) => t.tenantId), ...escalated.map((t) => t.tenantId), ...pastDue.map((s) => s.tenantId), ...changes.flatMap((c) => (c.targetTenantId ? [c.targetTenantId] : []))]);
    const client = (id: string) => names.get(id) ?? 'A client';

    for (const t of tenants) notices.push({ type: 'client.created', key: `client:${t.id}`, title: `New client: ${t.name}`, link: `/operator/clients/${t.id}`, tenantId: t.id });
    for (const n of nodes)
      notices.push({ type: 'workspace.created', key: `workspace:${n.id}`, title: `${client(n.tenantId)} added a ${n.level === 'MANAGER' ? 'Manager' : 'Executive'} Workspace`, body: n.name, link: `/operator/clients/${n.tenantId}`, tenantId: n.tenantId });
    for (const t of [...direct, ...escalated])
      notices.push({ type: 'ticket.new', key: `ticket:${t.id}`, title: `New ticket #${t.number} from ${client(t.tenantId)}`, body: t.subject, link: `/operator/support?ticket=${t.id}`, tenantId: t.tenantId });
    for (const s of pastDue)
      notices.push({ type: 'payment.failed', key: `past-due:${s.id}:${s.pastDueSince!.getTime()}`, title: `Payment failed: ${client(s.tenantId)}`, body: `The ${s.planCode} subscription is past due.`, link: `/operator/clients/${s.tenantId}`, tenantId: s.tenantId });
    for (const e of logins) notices.push({ type: 'signin.unusual', key: `signin:${e.id}`, title: `Unusual sign-in: ${e.email}`, body: e.reason, link: '/operator/security' });
    for (const c of changes) {
      const who = c.operator?.name ?? 'An operator';
      const about = c.targetTenantId ? client(c.targetTenantId) : `the ${c.targetLabel ?? c.targetId ?? ''} plan`.replace('the  plan', 'a plan');
      const reason = (c.metadata as { reason?: unknown }).reason;
      notices.push({ type: 'feature.changed', key: `features:${c.id}`, title: `${who} changed features for ${about}`, body: typeof reason === 'string' ? `Reason: ${reason}` : null, link: c.targetTenantId ? `/operator/clients/${c.targetTenantId}` : '/operator/plans', tenantId: c.targetTenantId });
    }
    for (const row of checks) {
      const check = readProviderCheck(row.value);
      if (!check || check.ok) continue;
      const provider = row.key.slice(PROVIDER_CHECK_PREFIX.length);
      notices.push({ type: 'provider.check_failed', key: `provider:${provider}:${check.at}`, title: `Provider check failed: ${provider}`, body: check.message || null, link: '/operator/providers' });
    }

    notices.push(...(await this.due(now)));
    let delivered = 0;
    for (const n of notices) delivered += await this.notifier.deliver(n);
    await this.prisma.platformSetting.update({ where: { key: NOTIFICATION_CURSOR_KEY }, data: { value: now.toISOString() } });
    return delivered;
  }

  /** Conditions that come due with time; their keys make each one go out once. */
  private async due(now: Date): Promise<ConsoleNotice[]> {
    const out: ConsoleNotice[] = [];
    const [ending, overdue, tickets] = await Promise.all([
      this.scan((tx) =>
        tx.subscription.findMany({
          where: {
            status: { in: ['ACTIVE', 'TRIALING'] },
            currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 14 * DAY), not: null },
            OR: [{ autoRenew: false }, { cancelAtPeriodEnd: true }, { provider: { in: ['OFFLINE', 'NONE'] } }],
          },
          select: { id: true, tenantId: true, planCode: true, currentPeriodEnd: true },
          take: BATCH,
        }),
      ),
      this.scan((tx) => tx.invoice.findMany({ where: { status: 'OPEN', issuedAt: { lte: new Date(now.getTime() - OVERDUE_DAYS * DAY) } }, select: { id: true, tenantId: true, number: true, totalCents: true, currency: true }, take: BATCH })),
      this.scan((tx) =>
        tx.supportTicket.findMany({
          where: { handlerLevel: 'CONSOLE', status: { in: [...OPEN_TICKET] }, createdAt: { lte: new Date(now.getTime() - SLA_HOURS.HIGH * HOUR) } },
          select: { id: true, tenantId: true, number: true, subject: true, priority: true, createdAt: true, escalatedAt: true, answeredAt: true },
          take: BATCH * 2,
        }),
      ),
    ]);
    const names = await this.names([...ending.map((s) => s.tenantId), ...overdue.map((i) => i.tenantId), ...tickets.map((t) => t.tenantId)]);
    const client = (id: string) => names.get(id) ?? 'A client';
    for (const s of ending) {
      const end = s.currentPeriodEnd!;
      const days = Math.max(1, Math.round((end.getTime() - now.getTime()) / DAY));
      const mark = days <= 3 ? 3 : 14;
      out.push({ type: 'subscription.expiring', key: `ending:${s.id}:${end.getTime()}:${mark}`, title: `${client(s.tenantId)}: subscription ends in ${days} ${days === 1 ? 'day' : 'days'}`, body: `The ${s.planCode} subscription ends on ${end.toISOString().slice(0, 10)} and does not renew by itself.`, link: `/operator/clients/${s.tenantId}`, tenantId: s.tenantId });
    }
    for (const i of overdue)
      out.push({ type: 'payment.overdue', key: `overdue:${i.id}`, title: `Invoice overdue: ${client(i.tenantId)}`, body: `Invoice ${i.number ?? ''} is still open ${OVERDUE_DAYS} days after it was issued.`.replace('  ', ' '), link: `/operator/clients/${i.tenantId}`, tenantId: i.tenantId });
    for (const t of tickets) {
      const reached = t.escalatedAt ?? t.createdAt;
      const answered = t.answeredAt && t.answeredAt >= reached;
      const hours = t.priority === 'HIGH' ? SLA_HOURS.HIGH : SLA_HOURS.NORMAL;
      if (answered || now.getTime() - reached.getTime() < hours * HOUR) continue;
      out.push({ type: 'ticket.sla_breached', key: `sla:${t.id}:${reached.getTime()}`, title: `Ticket #${t.number} from ${client(t.tenantId)} has waited over ${hours} hours`, body: t.subject, link: `/operator/support?ticket=${t.id}`, tenantId: t.tenantId });
    }
    return out;
  }
}
