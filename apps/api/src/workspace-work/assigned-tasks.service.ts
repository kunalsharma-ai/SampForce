import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type {
  AssignedTaskCreateInput,
  AssignedTaskDetail,
  AssignedTaskPriority,
  AssignedTaskRow,
  AssignedTasksView,
  AssignedTaskStatus,
  AssignedTaskUpdateInput,
  TaskCommentInput,
  TaskHistoryRow,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { assertAction, callerOf, handsDownTo, may, type Org, peopleIn, refOf, visibleNodeIds } from './hierarchy';

type Stored = Prisma.TaskGetPayload<object>;
const FEATURE = 'task_management' as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found.' });
const PRIORITY_RANK: Record<string, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };

/**
 * Tasks handed down the workspace hierarchy (ADR 0071, part 4): the Super Workspace assigns them to Manager and
 * Executive Workspaces, a manager to its own Executive Workspaces. They are ordinary tasks (so they also show in My
 * Work) with the workspace they went to, comments, and a history of every change. The assignee is told when a task is
 * created or changed, and the creator when the assignee finishes or reopens it.
 */
@Injectable()
export class AssignedTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(auth: AuthContext): Promise<AssignedTasksView> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'view');
      const base = { tenantId: auth.tenantId, deletedAt: null, workspaceNodeId: { not: null } } as const;
      const [forMe, byMe] = await Promise.all([
        tx.task.findMany({ where: { ...base, OR: [{ assigneeId: auth.userId }, { AND: [{ OR: [{ assigneeId: null }, { assigneeId: { isSet: false } }] }, { workspaceNodeId: me.node.id }] }] }, take: 200, orderBy: { createdAt: 'desc' } }),
        tx.task.findMany({ where: { ...base, createdById: auth.userId }, take: 200, orderBy: { createdAt: 'desc' } }),
      ]);
      const orgName = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } })).name;
      const targets = may(me, FEATURE, 'assign') ? [...org.byId.values()].filter((a) => handsDownTo(me, a, org)) : [];
      const assignable = [];
      for (const a of targets) assignable.push({ ...refOf(a, org, orgName), people: await peopleIn(tx, auth.tenantId, a, org) });
      return {
        forMe: sortTasks(await this.rows(tx, auth, org, me, forMe, orgName)),
        byMe: sortTasks(await this.rows(tx, auth, org, me, byMe, orgName)),
        assignable,
      };
    });
  }

  get(auth: AuthContext, id: string): Promise<AssignedTaskDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const task = await this.visible(tx, auth, org, me, id);
      return this.detail(tx, auth, org, me, task);
    });
  }

  create(auth: AuthContext, input: AssignedTaskCreateInput, meta: RequestMeta): Promise<AssignedTaskDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'assign');
      const node = org.byId.get(input.workspaceId);
      if (!node || !visibleNodeIds(me, org).has(input.workspaceId)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      if (!handsDownTo(me, node, org)) throw new ForbiddenException({ code: 'TASK_ASSIGN_FORBIDDEN', message: 'You can only assign tasks to the workspaces below yours.' });
      const people = await peopleIn(tx, auth.tenantId, node, org);
      if (input.assigneeUserId && !people.some((p) => p.id === input.assigneeUserId))
        throw new BadRequestException({ code: 'INVALID_ASSIGNEE', message: 'That person does not work in this workspace.' });
      const assigneeId = input.assigneeUserId ?? (people.length === 1 ? people[0]!.id : null);
      const task = await tx.task.create({
        data: {
          tenantId: auth.tenantId,
          title: input.title,
          description: input.description || null,
          priority: input.priority ?? 'NORMAL',
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          assigneeId,
          createdById: auth.userId,
          workspaceNodeId: node.node.id,
          assignedByNodeId: me.virtual ? null : me.node.id,
        },
      });
      await tx.taskEvent.create({ data: { tenantId: auth.tenantId, taskId: task.id, actorId: auth.userId, kind: 'created', changes: [] } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.assigned', entityType: 'task', entityId: task.id,
        metadata: { title: task.title, workspace: node.node.name, assigneeId, priority: task.priority, dueAt: task.dueAt?.toISOString() ?? null }, meta,
      });
      await this.notifications.send(tx, auth.tenantId, (assigneeId ? [assigneeId] : people.map((p) => p.id)).filter((u) => u !== auth.userId), {
        type: 'task.assigned',
        title: 'New task: {title}'.replace('{title}', task.title),
        body: task.dueAt ? `Due ${task.dueAt.toISOString().slice(0, 10)}.` : null,
        link: `/app/tasks?task=${task.id}`,
        eventId: `task:${task.id}:created`,
        senderId: auth.userId,
        priority: task.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
        actionRequired: true,
      });
      return this.detail(tx, auth, org, me, task);
    });
  }

  update(auth: AuthContext, id: string, input: AssignedTaskUpdateInput, meta: RequestMeta): Promise<AssignedTaskDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const task = await this.visible(tx, auth, org, me, id);
      const rights = this.rights(auth, org, me, task);
      const { status, ...rest } = input;
      if (Object.keys(rest).length && !rights.canEdit) throw new ForbiddenException({ code: 'TASK_EDIT_FORBIDDEN', message: 'Only the person who assigned this task, or a workspace above it, can change it.' });
      if (status !== undefined && !rights.canChangeStatus) throw new ForbiddenException({ code: 'TASK_EDIT_FORBIDDEN', message: 'Only the person who assigned this task, or a workspace above it, can change it.' });

      const data: Prisma.TaskUpdateInput = {};
      const changes: { field: string; from: string | null; to: string | null }[] = [];
      const set = (field: string, from: string | null, to: string | null, apply: () => void) => {
        if (from === to) return;
        changes.push({ field, from, to });
        apply();
      };
      if (rest.title !== undefined) set('title', task.title, rest.title, () => (data.title = rest.title));
      if (rest.description !== undefined) set('description', task.description, rest.description || null, () => (data.description = rest.description || null));
      if (rest.priority !== undefined) set('priority', task.priority, rest.priority, () => (data.priority = rest.priority));
      if (rest.dueAt !== undefined) {
        const to = rest.dueAt ? new Date(rest.dueAt).toISOString() : null;
        set('dueAt', task.dueAt?.toISOString() ?? null, to, () => (data.dueAt = to ? new Date(to) : null));
      }
      if (status !== undefined)
        set('status', task.status, status, () => {
          data.status = status;
          data.completedAt = status === 'DONE' ? new Date() : null;
        });
      if (!changes.length) return this.detail(tx, auth, org, me, task);

      const updated = await tx.task.update({ where: { id }, data });
      await tx.taskEvent.create({ data: { tenantId: auth.tenantId, taskId: id, actorId: auth.userId, kind: 'updated', changes } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.updated', entityType: 'task', entityId: id, metadata: { title: updated.title, changes }, meta });
      const node = org.byId.get(task.workspaceNodeId!);
      const workers = task.assigneeId ? [task.assigneeId] : node ? (await peopleIn(tx, auth.tenantId, node, org)).map((p) => p.id) : [];
      const onlyStatus = changes.every((c) => c.field === 'status');
      // The assignee hears about changes to their task; the creator hears when it is finished or reopened.
      const recipients = [...(onlyStatus ? [] : workers), ...(status !== undefined ? [task.createdById] : [])].filter((u): u is string => !!u && u !== auth.userId);
      await this.notifications.send(tx, auth.tenantId, recipients, {
        type: 'task.updated',
        title: (status === 'DONE' && onlyStatus ? 'Task completed: {title}' : 'Task changed: {title}').replace('{title}', updated.title),
        body: null,
        link: `/app/tasks?task=${id}`,
        eventId: `task:${id}:${Date.now()}`,
        senderId: auth.userId,
        priority: updated.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
      });
      return this.detail(tx, auth, org, me, updated);
    });
  }

  comment(auth: AuthContext, id: string, input: TaskCommentInput, meta: RequestMeta): Promise<AssignedTaskDetail> {
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const task = await this.visible(tx, auth, org, me, id);
      const c = await tx.taskComment.create({ data: { tenantId: auth.tenantId, taskId: id, authorId: auth.userId, body: input.body } });
      await tx.taskEvent.create({ data: { tenantId: auth.tenantId, taskId: id, actorId: auth.userId, kind: 'commented', changes: [] } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.commented', entityType: 'task', entityId: id, metadata: { commentId: c.id }, meta });
      await this.notifications.send(tx, auth.tenantId, [task.assigneeId, task.createdById].filter((u) => u !== auth.userId), {
        type: 'task.commented',
        title: 'New comment on {title}'.replace('{title}', task.title),
        body: input.body.slice(0, 300),
        link: `/app/tasks?task=${id}`,
        eventId: `task-comment:${c.id}`,
        senderId: auth.userId,
      });
      return this.detail(tx, auth, org, me, task);
    });
  }

  // ───────────── Helpers ─────────────

  private async visible(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, id: string): Promise<Stored> {
    assertAction(me, FEATURE, 'view');
    const task = await tx.task.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, workspaceNodeId: { not: null } } });
    if (!task) throw notFound();
    const seen = task.assigneeId === auth.userId || task.createdById === auth.userId || visibleNodeIds(me, org).has(task.workspaceNodeId!);
    if (!seen) throw notFound();
    return task;
  }

  private rights(auth: AuthContext, org: Org, me: NodeAccess, task: Stored): { canEdit: boolean; canChangeStatus: boolean } {
    const node = org.byId.get(task.workspaceNodeId!);
    const canEdit = task.createdById === auth.userId || (!!node && handsDownTo(me, node, org) && may(me, FEATURE, 'assign'));
    const mine = task.assigneeId ? task.assigneeId === auth.userId : task.workspaceNodeId === me.node.id;
    return { canEdit, canChangeStatus: canEdit || mine };
  }

  private async rows(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, tasks: Stored[], orgName: string): Promise<AssignedTaskRow[]> {
    if (!tasks.length) return [];
    const people = await this.names(tx, tasks.flatMap((t) => [t.assigneeId, t.createdById]));
    const comments = await tx.taskComment.findMany({ where: { tenantId: auth.tenantId, taskId: { in: tasks.map((t) => t.id) } }, select: { taskId: true } });
    const count = new Map<string, number>();
    for (const c of comments) count.set(c.taskId, (count.get(c.taskId) ?? 0) + 1);
    const now = Date.now();
    return tasks.flatMap((t) => {
      const node = org.byId.get(t.workspaceNodeId!);
      if (!node) return [];
      return [{
        id: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority as AssignedTaskPriority,
        status: t.status as AssignedTaskStatus,
        dueAt: t.dueAt?.toISOString() ?? null,
        overdue: t.status === 'OPEN' && !!t.dueAt && t.dueAt.getTime() < now,
        completedAt: t.completedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        workspace: refOf(node, org, orgName),
        assignee: t.assigneeId ? { id: t.assigneeId, name: people.get(t.assigneeId) ?? '' } : null,
        createdBy: t.createdById ? { id: t.createdById, name: people.get(t.createdById) ?? '' } : null,
        comments: count.get(t.id) ?? 0,
        ...this.rights(auth, org, me, t),
      }];
    });
  }

  private async detail(tx: TenantTx, auth: AuthContext, org: Org, me: NodeAccess, task: Stored): Promise<AssignedTaskDetail> {
    const orgName = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } })).name;
    const [row] = await this.rows(tx, auth, org, me, [task], orgName);
    if (!row) throw notFound();
    const [comments, events] = await Promise.all([
      tx.taskComment.findMany({ where: { tenantId: auth.tenantId, taskId: task.id }, orderBy: { createdAt: 'asc' }, take: 500 }),
      tx.taskEvent.findMany({ where: { tenantId: auth.tenantId, taskId: task.id }, orderBy: { createdAt: 'asc' }, take: 500 }),
    ]);
    const names = await this.names(tx, [...comments.map((c) => c.authorId), ...events.map((e) => e.actorId)]);
    const ref = (id: string | null) => (id ? { id, name: names.get(id) ?? '' } : null);
    return {
      ...row,
      commentList: comments.map((c) => ({ id: c.id, author: ref(c.authorId), body: c.body, createdAt: c.createdAt.toISOString() })),
      history: events.map((e) => ({ id: e.id, actor: ref(e.actorId), kind: e.kind as TaskHistoryRow['kind'], changes: Array.isArray(e.changes) ? (e.changes as TaskHistoryRow['changes']) : [], createdAt: e.createdAt.toISOString() })),
    };
  }

  private async names(tx: TenantTx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}

/** Open first; then overdue, high priority and soonest due; finished ones last, newest first. */
export function sortTasks(rows: AssignedTaskRow[]): AssignedTaskRow[] {
  const due = (r: AssignedTaskRow) => (r.dueAt ? Date.parse(r.dueAt) : Number.MAX_SAFE_INTEGER);
  return [...rows].sort((a, b) => {
    const open = (r: AssignedTaskRow) => (r.status === 'OPEN' ? 0 : 1);
    if (open(a) !== open(b)) return open(a) - open(b);
    if (a.status !== 'OPEN') return Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt);
    return Number(b.overdue) - Number(a.overdue) || PRIORITY_RANK[a.priority]! - PRIORITY_RANK[b.priority]! || due(a) - due(b);
  });
}
