import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import type { ActivityInput, ActivityRow, Page } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, notFound, ownerRefs } from './crm-helpers';

export interface ActivityListQuery {
  leadId?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  page: number;
  pageSize: number;
}

type ActivityModel = Prisma.ActivityGetPayload<object>;

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, q: ActivityListQuery): Promise<Page<ActivityRow>> {
    return this.prisma.run(auth, async (tx) => {
      const where: Prisma.ActivityWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        ...(q.leadId ? { leadId: q.leadId } : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.opportunityId ? { opportunityId: q.opportunityId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.activity.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.activity.count({ where }),
      ]);
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return { items: rows.map((r) => toActivityRow(r, owners)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Logs an activity. The actor is always the owner; AI-assisted activities are created by the agent layer, not here. */
  create(auth: AuthContext, input: ActivityInput, meta: RequestMeta): Promise<ActivityRow> {
    if (!input.leadId && !input.contactId && !input.companyId && !input.opportunityId) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Link the activity to a lead, contact, company or deal.',
        details: [{ path: 'leadId', message: 'at least one related record is required' }],
      });
    }
    return this.prisma.run(auth, async (tx) => {
      await assertRefs(tx, auth.tenantId, {
        leadId: input.leadId,
        contactId: input.contactId,
        companyId: input.companyId,
        opportunityId: input.opportunityId,
      });
      const row = await tx.activity.create({
        data: {
          tenantId: auth.tenantId,
          type: input.type,
          subject: input.subject,
          body: input.body ?? null,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          ownerId: auth.userId,
          leadId: input.leadId ?? null,
          contactId: input.contactId ?? null,
          companyId: input.companyId ?? null,
          opportunityId: input.opportunityId ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'activity.logged', entityType: 'activity', entityId: row.id,
        metadata: { type: row.type }, meta,
      });
      return toActivityRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.activity.updateMany({
        where: { id, tenantId: auth.tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw notFound('Activity');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'activity.deleted', entityType: 'activity', entityId: id, meta });
    });
  }
}

export function toActivityRow(r: ActivityModel, owners: Map<string, { id: string; name: string }>): ActivityRow {
  return {
    id: r.id,
    type: r.type,
    subject: r.subject,
    body: r.body,
    occurredAt: r.occurredAt.toISOString(),
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    aiAssisted: r.aiAssisted,
    leadId: r.leadId,
    contactId: r.contactId,
    companyId: r.companyId,
    opportunityId: r.opportunityId,
  };
}
