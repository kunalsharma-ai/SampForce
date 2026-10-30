import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { Citation, Permission } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { untrusted } from './redact';

export type RecordType = 'lead' | 'contact' | 'company' | 'deal';

export const READ_PERMISSION: Record<RecordType | 'task', Permission> = {
  lead: 'leads:read',
  contact: 'contacts:read',
  company: 'companies:read',
  deal: 'deals:read',
  task: 'activities:read',
};

export interface RecordContext {
  citation: Citation;
  /** Compact facts for a prompt. */
  facts: Record<string, unknown>;
  /** True when external content (email) is included. */
  untrusted: boolean;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Builds the read-only record snapshots that agents and Copilot tools send to the model. Reads run
 * under the caller's tenant context (RLS) and check the caller's read permission for each record type.
 * Email content is wrapped as untrusted data.
 */
@Injectable()
export class RecordContextBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async load(auth: AuthContext, type: RecordType, id: string, opts: { emails?: boolean } = {}): Promise<RecordContext> {
    if (!auth.permissions.includes(READ_PERMISSION[type])) throw new PermissionDenied(READ_PERMISSION[type]);
    return this.prisma.run(auth, (tx) => this.build(tx, auth, type, id, opts.emails ?? false));
  }

  private async build(tx: TenantTx, auth: AuthContext, type: RecordType, id: string, withEmails: boolean): Promise<RecordContext> {
    const t = auth.tenantId;
    const canActivities = auth.permissions.includes('activities:read');
    const activityWhere = { tenantId: t, deletedAt: null, ...(type === 'deal' ? { opportunityId: id } : { [`${type}Id`]: id }) };
    const recent = canActivities
      ? (await tx.activity.findMany({ where: activityWhere, orderBy: { occurredAt: 'desc' }, take: 8 })).map((a) => ({
          type: a.type, subject: a.subject, body: a.body?.slice(0, 400) ?? null, on: day(a.occurredAt),
        }))
      : 'not visible to your role';
    const taskWhere = type === 'deal' ? { opportunityId: id } : type === 'lead' ? { leadId: id } : type === 'contact' ? { contactId: id } : null;
    const tasks = canActivities && taskWhere
      ? (await tx.task.findMany({ where: { tenantId: t, deletedAt: null, status: 'OPEN', ...taskWhere }, orderBy: { dueAt: 'asc' }, take: 5 })).map((k) => ({
          title: k.title, due: day(k.dueAt), overdue: !!k.dueAt && k.dueAt < new Date(),
        }))
      : [];
    let emails: unknown[] = [];
    let hasUntrusted = false;
    if (withEmails && canActivities && (type === 'contact' || type === 'lead')) {
      const rows = await tx.emailMessage.findMany({ where: { tenantId: t, [`${type}Id`]: id }, orderBy: { sentAt: 'desc' }, take: 5 });
      emails = rows.map((e) => ({ direction: e.direction, subject: e.subject, on: day(e.sentAt), content: untrusted('email', (e.snippet ?? e.bodyText ?? '').slice(0, 500)) }));
      hasUntrusted = rows.length > 0;
    }
    const owner = async (ownerId: string | null) => (ownerId ? ((await tx.user.findUnique({ where: { id: ownerId }, select: { name: true } }))?.name ?? null) : null);

    switch (type) {
      case 'lead': {
        const l = await tx.lead.findFirst({ where: { id, tenantId: t, deletedAt: null } });
        if (!l) throw notFound('Lead');
        return {
          citation: { entity: 'lead', id, label: l.fullName },
          untrusted: hasUntrusted,
          facts: {
            id, type, name: l.fullName, company: l.companyName, jobTitle: l.jobTitle, industry: l.industry, email: l.email, phone: l.phone,
            country: l.country, source: l.source, status: l.status, estimatedValue: num(l.estimatedValue), currency: l.currency, tags: l.tags,
            owner: await owner(l.ownerId), created: day(l.createdAt), recentActivity: recent, openTasks: tasks, emails,
          },
        };
      }
      case 'contact': {
        const c = await tx.contact.findFirst({ where: { id, tenantId: t, deletedAt: null } });
        if (!c) throw notFound('Contact');
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
        const company = c.companyId ? await tx.company.findFirst({ where: { id: c.companyId, tenantId: t }, select: { name: true } }) : null;
        return {
          citation: { entity: 'contact', id, label: name },
          untrusted: hasUntrusted,
          facts: { id, type, name, email: c.email, jobTitle: c.jobTitle, company: company?.name ?? null, owner: await owner(c.ownerId), recentActivity: recent, openTasks: tasks, emails },
        };
      }
      case 'company': {
        const c = await tx.company.findFirst({ where: { id, tenantId: t, deletedAt: null } });
        if (!c) throw notFound('Company');
        const deals = auth.permissions.includes('deals:read')
          ? await tx.opportunity.findMany({ where: { tenantId: t, companyId: id, deletedAt: null }, select: { id: true, name: true, amount: true, currency: true, status: true }, take: 10 })
          : [];
        return {
          citation: { entity: 'company', id, label: c.name },
          untrusted: false,
          facts: {
            id, type, name: c.name, domain: c.domain, industry: c.industry, country: c.country, owner: await owner(c.ownerId), recentActivity: recent,
            deals: deals.map((d) => ({ id: d.id, name: d.name, amount: num(d.amount), currency: d.currency, status: d.status })),
          },
        };
      }
      case 'deal': {
        const d = await tx.opportunity.findFirst({
          where: { id, tenantId: t, deletedAt: null },
          include: { stage: true, pipeline: { select: { name: true } }, company: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
        });
        if (!d) throw notFound('Deal');
        const stageLog = await tx.auditLog.findFirst({ where: { tenantId: t, entityType: 'deal', entityId: id, action: 'deal.stage_changed' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
        return {
          citation: { entity: 'deal', id, label: d.name },
          untrusted: false,
          facts: {
            id, type, name: d.name, amount: num(d.amount), currency: d.currency, status: d.status, pipeline: d.pipeline.name, stage: d.stage.name,
            probability: d.probability ?? d.stage.probability, expectedCloseDate: day(d.expectedCloseDate), company: d.company?.name ?? null,
            contact: d.contact ? [d.contact.firstName, d.contact.lastName].filter(Boolean).join(' ') : null, owner: await owner(d.ownerId),
            created: day(d.createdAt), inStageSince: day(stageLog?.createdAt ?? d.createdAt), lossReason: d.lossReason, recentActivity: recent, openTasks: tasks,
          },
        };
      }
    }
  }
}

/** A tool or agent needed a permission the caller's role does not have. */
export class PermissionDenied extends Error {
  constructor(readonly permission: Permission) {
    super(`Your role does not allow this (${permission}).`);
  }
}
