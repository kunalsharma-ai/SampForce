import { Injectable } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import type { TaskInput, TaskRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, diff, iso, notFound, ownerRefs } from './crm-helpers';

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
  ) {}

  /** Open tasks sort by due date (overdue first, undated last); finished tasks by completion time. */
  list(auth: AuthContext, q: TaskListQuery): Promise<TaskRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.task.findMany({
        where: {
          tenantId: auth.tenantId,
          deletedAt: null,
          status: q.status,
          ...(q.scope === 'mine' ? { assigneeId: auth.userId } : {}),
          ...(q.leadId ? { leadId: q.leadId } : {}),
          ...(q.contactId ? { contactId: q.contactId } : {}),
          ...(q.opportunityId ? { opportunityId: q.opportunityId } : {}),
        },
        orderBy:
          q.status === 'OPEN'
            ? [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
            : [{ completedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: 200,
      });
      const owners = await ownerRefs(tx, rows.map((r) => r.assigneeId));
      const now = new Date();
      return rows.map((r) => toTaskRow(r, owners, now));
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
