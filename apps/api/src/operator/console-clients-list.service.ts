import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  BULK_PERMISSION,
  type ConsoleClientBulkInput,
  type ConsoleClientBulkResult,
  type ConsoleClientListQuery,
  type ConsoleClientPage,
  type ConsoleClientRow,
  type ConsoleClientSort,
  geoCountry,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { cell } from './console-audit.service';
import { ConsoleService } from './console.service';
import { FORBIDDEN_FOR_ROLE, type OperatorContext } from './operator-auth';
import { OperatorService } from './operator.service';
import { writePlatformAudit } from './platform-audit';

/** More clients than this are not listed at once; the filters narrow it. */
const LIST_MAX = 5000;
const DAY = 86_400_000;


const SORT_KEY: Record<ConsoleClientSort, (r: ConsoleClientRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  customerId: (r) => r.customerId ?? '',
  country: (r) => (r.countryCode ? (geoCountry(r.countryCode)?.name ?? r.countryCode) : ''),
  plan: (r) => r.subscription?.planName ?? '',
  payment: (r) => r.subscription?.paymentStatus ?? '',
  state: (r) => r.state,
  people: (r) => r.people,
  managers: (r) => r.usage.managers,
  executives: (r) => r.usage.executives,
  created: (r) => r.createdAt,
  renews: (r) => r.subscription?.renewsOn ?? '',
  // Clients not measured yet sort below every measured one.
  health: (r) => r.health?.score ?? -1,
};

/**
 * The Console clients list (ADR 0074, C4b): filters that combine, sort on every column, pages of 25, 50 or 100, a CSV
 * of what the filters show, and bulk actions over the selected clients. A bulk action changes each client the same
 * way the client page would, so each one is audited on its own, plus one entry for the run.
 */
@Injectable()
export class ConsoleClientsListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly console: ConsoleService,
    private readonly ops: OperatorService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
  ) {}

  private async filtered(q: Omit<ConsoleClientListQuery, 'page' | 'perPage'>): Promise<ConsoleClientRow[]> {
    const and: Prisma.TenantWhereInput[] = [await this.console.searchWhere(q.search)];
    if (q.country) and.push({ countryCode: q.country });
    if (q.health) and.push(q.health === 'NONE' ? { healthBand: null } : { healthBand: q.health });
    if (q.plan) and.push({ subscription: { is: { planCode: q.plan } } });
    if (q.billing) and.push({ subscription: { is: { billingInterval: q.billing } } });
    if (q.createdFrom || q.createdTo) {
      and.push({
        createdAt: {
          ...(q.createdFrom ? { gte: new Date(`${q.createdFrom}T00:00:00Z`) } : {}),
          ...(q.createdTo ? { lt: new Date(new Date(`${q.createdTo}T00:00:00Z`).getTime() + DAY) } : {}),
        },
      });
    }
    // State and payment status are worked out from the subscription, so they are filtered after loading.
    const rows = (await this.console.rows({ AND: and }, LIST_MAX)).filter(
      (r) => (!q.state || r.state === q.state) && (!q.payment || (q.payment === 'NONE' ? !r.subscription?.paymentStatus : r.subscription?.paymentStatus === q.payment)),
    );
    const key = SORT_KEY[q.sort];
    const sign = q.dir === 'asc' ? 1 : -1;
    // Ties keep a stable order: newest first, then by id.
    return rows.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x < y) return -sign;
      if (x > y) return sign;
      return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    });
  }

  async page(op: OperatorContext, q: ConsoleClientListQuery, ip: string | null): Promise<ConsoleClientPage> {
    const rows = await this.filtered(q);
    const pages = Math.max(1, Math.ceil(rows.length / q.perPage));
    const page = Math.min(q.page, pages);
    await writePlatformAudit(this.prisma, {
      operatorId: op.id, action: 'clients.listed', target: null,
      metadata: { search: q.search ?? null, filters: filtersOf(q), results: rows.length }, ip,
    });
    return { items: rows.slice((page - 1) * q.perPage, page * q.perPage), total: rows.length, page, perPage: q.perPage };
  }

  /** Every client the filters show, in the list's order, as CSV. The export is an audit entry. */
  async exportCsv(op: OperatorContext, q: Omit<ConsoleClientListQuery, 'page' | 'perPage'>, ip: string | null): Promise<string> {
    const rows = await this.filtered(q);
    const lines = [CSV_HEADER.map(cell).join(',')];
    for (const r of rows) {
      const s = r.subscription;
      lines.push(
        [
          r.customerId, r.name, r.state, r.countryCode ? (geoCountry(r.countryCode)?.name ?? r.countryCode) : null, r.city, s?.planName ?? null, s?.billingFrequency ?? null,
          s?.paymentStatus ?? null, s?.renewsOn ?? null, r.usage.managers, s?.limits.managers ?? null, r.usage.executives, s?.limits.executives ?? null, r.people, s?.seats ?? null, r.createdAt.slice(0, 10), r.health?.score ?? null,
        ].map(cell).join(','),
      );
    }
    await writePlatformAudit(this.prisma, { operatorId: op.id, action: 'clients.exported', target: null, metadata: { filters: filtersOf(q), rows: rows.length }, ip });
    return `${lines.join('\r\n')}\r\n`;
  }

  async bulk(op: OperatorContext, input: ConsoleClientBulkInput, ip: string | null): Promise<ConsoleClientBulkResult> {
    if (!op.permissions.includes(BULK_PERMISSION[input.action])) throw new ForbiddenException(FORBIDDEN_FOR_ROLE);
    const ids = [...new Set(input.ids)];
    const rows = await this.console.rows({ id: { in: ids } }, ids.length);
    const result: ConsoleClientBulkResult = { action: input.action, done: [], skipped: [], failed: [] };
    // Clients that were deleted or never existed are reported, not silently dropped.
    for (const id of ids) if (!rows.some((r) => r.id === id)) result.failed.push({ id, name: id, reason: 'Client not found.' });

    for (const r of rows) {
      const who = { id: r.id, name: r.name };
      try {
        const skip = await this.one(op, input, r, ip);
        if (skip) result.skipped.push({ ...who, reason: skip });
        else result.done.push(who);
      } catch (e) {
        const reason = (e as { response?: { message?: string } }).response?.message ?? (e as Error).message ?? 'Failed.';
        result.failed.push({ ...who, reason });
        // Without an email service nothing else would be sent either.
        if (input.action === 'notify' && (e as { response?: { code?: string } }).response?.code === 'MAIL_NOT_CONFIGURED') {
          for (const rest of rows.slice(rows.indexOf(r) + 1)) result.failed.push({ id: rest.id, name: rest.name, reason });
          break;
        }
      }
    }

    // The run's entry keeps what was asked, not the typed CONFIRM or the email's text.
    const { ids: _ids, ...details } = input as ConsoleClientBulkInput & { confirm?: string; message?: string };
    delete details.confirm;
    delete details.message;
    await writePlatformAudit(this.prisma, {
      operatorId: op.id, action: 'clients.bulk', target: null,
      metadata: {
        ...details, ...(input.action === 'notify' ? { length: input.message.length } : {}),
        requested: ids.length, done: result.done.map((d) => d.id), skipped: result.skipped.map((d) => d.id), failed: result.failed.map((d) => d.id),
      },
      ip,
    });
    return result;
  }

  /** Applies the action to one client; returns why it was skipped, or null when it changed something. */
  private async one(op: OperatorContext, input: ConsoleClientBulkInput, r: ConsoleClientRow, ip: string | null): Promise<string | null> {
    switch (input.action) {
      case 'state':
        if (r.state === input.state) return `Already ${input.state.toLowerCase()}.`;
        await this.console.setState(op, r.id, input.state, input.reason, ip);
        return null;
      case 'extend': {
        const sub = await this.prisma.run({ tenantId: r.id }, (tx) => tx.subscription.findUnique({ where: { tenantId: r.id } }));
        if (!sub) return 'No subscription.';
        if (!sub.currentPeriodEnd) return 'No renewal date to extend.';
        const end = new Date(sub.currentPeriodEnd.getTime() + input.days * DAY);
        await this.prisma.run({ tenantId: r.id }, async (tx) => {
          await tx.subscription.update({ where: { tenantId: r.id }, data: { currentPeriodEnd: end } });
          await this.audit.record(tx, {
            tenantId: r.id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'billing.subscription_extended', entityType: 'subscription', entityId: sub.id,
            metadata: { operator: op.email, reason: input.reason, days: input.days },
          });
        });
        await writePlatformAudit(this.prisma, {
          operatorId: op.id, action: 'client.subscription_extended', tenantId: r.id, target: { type: 'client', id: r.id, label: r.name },
          before: { currentPeriodEnd: sub.currentPeriodEnd.toISOString() }, after: { currentPeriodEnd: end.toISOString() },
          metadata: { reason: input.reason, days: input.days, changes: [`Renewal moved ${input.days} days: ${sub.currentPeriodEnd.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`] },
          ip,
        });
        return null;
      }
      case 'feature': {
        const current = await this.prisma.run({ tenantId: r.id }, (tx) => tx.tenantFeatureOverride.findUnique({ where: { tenantId_feature: { tenantId: r.id, feature: input.feature } } }));
        if ((current?.enabled ?? null) === input.enabled) return input.enabled === null ? 'No override to remove.' : 'Already set that way.';
        await this.ops.setFeatureOverrides(op, r.id, { overrides: { [input.feature]: input.enabled }, reason: input.reason }, ip);
        return null;
      }
      case 'notify': {
        const admins = await this.prisma.run({ tenantId: r.id }, (tx) =>
          tx.membership.findMany({ where: { tenantId: r.id, status: 'ACTIVE', role: { key: 'owner' } }, include: { user: { select: { email: true } } }, take: 20 }),
        );
        if (!admins.length) return 'No administrator has joined yet.';
        for (const a of admins) await this.mailer.send({ to: a.user.email, subject: input.subject, text: input.message });
        await writePlatformAudit(this.prisma, {
          operatorId: op.id, action: 'client.administrators_emailed', tenantId: r.id, target: { type: 'client', id: r.id, label: r.name },
          metadata: { subject: input.subject, recipients: admins.length }, ip,
        });
        return null;
      }
    }
  }
}

const CSV_HEADER = ['Customer ID', 'Client', 'Status', 'Country', 'City', 'Plan', 'Billing', 'Payment', 'Renews', 'Managers', 'Manager limit', 'Executives', 'Executive limit', 'People', 'Seats', 'Created', 'Health'];

function filtersOf(q: Partial<ConsoleClientListQuery>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['state', 'plan', 'billing', 'country', 'payment', 'health', 'createdFrom', 'createdTo'] as const) if (q[k]) out[k] = String(q[k]);
  return out;
}
