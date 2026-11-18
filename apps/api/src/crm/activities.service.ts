import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import type { ActivityInput, ActivityRow, ActivityUpdate, Page } from '@dealflow/types';
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
  /** `aiAssisted` marks activities an AI agent drafted and a person confirmed. */
  create(auth: AuthContext, input: ActivityInput, meta: RequestMeta, opts: { aiAssisted?: boolean } = {}): Promise<ActivityRow> {
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
          aiAssisted: opts.aiAssisted ?? false,
          leadId: input.leadId ?? null,
          contactId: input.contactId ?? null,
          companyId: input.companyId ?? null,
          opportunityId: input.opportunityId ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'activity.logged', entityType: 'activity', entityId: row.id,
        metadata: { type: row.type, aiAssisted: row.aiAssisted }, meta,
      });
      return toActivityRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  get(auth: AuthContext, id: string): Promise<ActivityRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.activity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!row) throw notFound('Activity');
      return toActivityRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  /**
   * Edits a logged activity: its type, subject, details or when it happened. Whoever may log and delete activities
   * may edit them (the same rule as delete); the audit log keeps who changed what. Interactions logged on a company
   * keep their interaction kind, so their type is changed through the interaction instead.
   */
  update(auth: AuthContext, id: string, input: ActivityUpdate, meta: RequestMeta): Promise<ActivityRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.activity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!before) throw notFound('Activity');
      if (input.type !== undefined && input.type !== before.type && before.interaction) {
        throw new BadRequestException({
          code: 'INTERACTION_TYPE',
          message: 'Change the type of a company interaction from the company page.',
          details: [{ path: 'type', message: 'set by the interaction kind' }],
        });
      }
      const data: Prisma.ActivityUpdateInput = {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {}),
      };
      const changed = changedFields(before, input);
      const row = changed.length ? await tx.activity.update({ where: { id }, data: { ...data, editedAt: new Date() } }) : before;
      if (changed.length) {
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'activity.updated', entityType: 'activity', entityId: id,
          metadata: { fields: changed }, meta,
        });
      }
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
    editedAt: r.editedAt?.toISOString() ?? null,
    interaction: r.interaction ?? null,
  };
}

/** The fields an edit actually changes, for the audit log (values are left out: notes can be personal). */
function changedFields(before: ActivityModel, input: ActivityUpdate): string[] {
  const out: string[] = [];
  if (input.type !== undefined && input.type !== before.type) out.push('type');
  if (input.subject !== undefined && input.subject !== before.subject) out.push('subject');
  if (input.body !== undefined && (input.body ?? null) !== before.body) out.push('body');
  if (input.occurredAt !== undefined && new Date(input.occurredAt).getTime() !== before.occurredAt.getTime()) out.push('occurredAt');
  return out;
}
