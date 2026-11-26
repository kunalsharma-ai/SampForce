import { nullsLast } from '@dealflow/database';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import type { TaskInput, TaskRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, diff, iso, notFound, ownerRefs } from './crm-helpers';
import { FollowUpCadenceService } from './follow-up-cadence.service';

export interface TaskListQuery {
  scope: 'mine' | 'all';
  status: 'OPEN' | 'DONE' | 'CANCELED';
  leadId?: string;
  contactId?: string;
  opportunityId?: string;
}

type TaskModel = Prisma.TaskGetPayload<object>;
type TaskUpdate = Partial<TaskInput> & { status?: TaskModel['status'] };

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cadence: FollowUpCadenceService,
  ) {}

  /** Open tasks sort by due date (overdue first, undated last); finished tasks by completion time. */
  list(auth: AuthContext, q: TaskListQuery, opts: { withoutFollowUps?: boolean } = {}): Promise<TaskRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.task.findMany({
        where: {
          tenantId: auth.tenantId,
          deletedAt: null,
          // The phone lists follow-ups on their own (ADR 0072).
          ...(opts.withoutFollowUps ? { followUpType: null } : {}),
          status: q.status,
          ...(q.scope === 'mine' ? { assigneeId: auth.userId } : {}),
          ...(q.leadId ? { leadId: q.leadId } : {}),
          ...(q.contactId ? { contactId: q.contactId } : {}),
          ...(q.opportunityId ? { opportunityId: q.opportunityId } : {}),
        },
        orderBy:
          q.status === 'OPEN'
            ? [{ dueAt: nullsLast('asc') }, { createdAt: 'asc' }]
            : [{ completedAt: nullsLast('desc') }, { updatedAt: 'desc' }],
        take: 200,
      });
      const owners = await ownerRefs(tx, rows.map((r) => r.assigneeId));
      const now = new Date();
      return rows.map((r) => toTaskRow(r, owners, now));
    });
  }

  /** One task, as in the workspace's task list (which every member can read). */
  get(auth: AuthContext, id: string): Promise<TaskRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.task.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, followUpType: null } });
      if (!row) throw notFound('Task');
      return toTaskRow(row, await ownerRefs(tx, [row.assigneeId]), new Date());
    });
  }

  create(auth: AuthContext, input: TaskInput, meta: RequestMeta): Promise<TaskRow> {
    return this.prisma.run(auth, async (tx) => {
      const assigneeId = input.assigneeId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, {
        ownerId: assigneeId,
        leadId: input.leadId,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
      });
      const row = await tx.task.create({
        data: {
          tenantId: auth.tenantId,
          title: input.title,
          priority: input.priority ?? 'NORMAL',
          description: input.description ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          assigneeId,
          leadId: input.leadId ?? null,
          contactId: input.contactId ?? null,
          opportunityId: input.opportunityId ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.created', entityType: 'task', entityId: row.id,
        metadata: { assigneeId }, meta,
      });
      return toTaskRow(row, await ownerRefs(tx, [row.assigneeId]), new Date());
    });
  }

  update(auth: AuthContext, id: string, input: TaskUpdate, meta: RequestMeta): Promise<TaskRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.task.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!before) throw notFound('Task');
      await assertRefs(tx, auth.tenantId, {
        ownerId: input.assigneeId,
        leadId: input.leadId,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
      });
      const data: Prisma.TaskUncheckedUpdateInput = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        // Kept for My Work's "reassigned to me" (ADR 0063).
        ...(input.assigneeId !== undefined && input.assigneeId !== before.assigneeId ? { reassignedFromId: before.assigneeId, reassignedAt: new Date() } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
        ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
        ...(input.opportunityId !== undefined ? { opportunityId: input.opportunityId } : {}),
      };
      if (input.status && input.status !== before.status) {
        data.status = input.status;
        data.completedAt = input.status === 'DONE' ? new Date() : null;
      }
      const row = await tx.task.update({ where: { id }, data });
      // A cadence follow-up completed from the task list plans the next one too (ADR 0083).
      if (data.status === 'DONE') await this.cadence.followUpCompleted(tx, auth, row);
      const changes = diff(before, input);
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId,
        action: changes.status && input.status === 'DONE' ? 'task.completed' : 'task.updated',
        entityType: 'task', entityId: id, metadata: { changes }, meta,
      });
      return toTaskRow(row, await ownerRefs(tx, [row.assigneeId]), new Date());
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.task.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Task');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.deleted', entityType: 'task', entityId: id, meta });
    });
  }
}

export function toTaskRow(r: TaskModel, owners: Map<string, { id: string; name: string }>, now: Date): TaskRow {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    dueAt: iso(r.dueAt),
    completedAt: iso(r.completedAt),
    overdue: r.status === 'OPEN' && !!r.dueAt && r.dueAt < now,
    assignee: r.assigneeId ? (owners.get(r.assigneeId) ?? null) : null,
    leadId: r.leadId,
    contactId: r.contactId,
    opportunityId: r.opportunityId,
    createdAt: r.createdAt.toISOString(),
  };
}
