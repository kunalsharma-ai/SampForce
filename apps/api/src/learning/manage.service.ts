import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createManySkipDuplicates, type TenantTx } from '@dealflow/database';
import {
  ASSIGNMENT_STATUS_LABEL,
  type AssigneeOption,
  type AssignModuleInput,
  type AssignmentRow,
  type AssignmentUpdateInput,
  type LearningAssignmentStatus,
  type LearningManageView,
  type LearningReportQuery,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { toXlsx } from '../crm/import-export.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertManager, inScope, type LearningCaller, learningCaller, manageableModules, moduleForManager, type Person, peopleById, peopleInScope } from './access';
import { type AssignmentRec, assignmentRow, avg, categoriesById, type ModuleRec, moduleRows } from './views';

const notFound = (what = 'Assignment') => new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });
const DAY = 86_400_000;

export interface ReportRow {
  assignment: AssignmentRow;
  employeeId: string;
  manager: string | null;
  category: string | null;
  startedAt: string | null;
  certificateNumber: string | null;
  certificateStatus: 'ISSUED' | 'REVOKED' | 'NOT_ELIGIBLE' | 'NOT_YET';
}

/**
 * Assigning modules and following everyone's learning (ADR 0097): the manager and Super dashboards, assigning by
 * person, workspace or level, deadlines and extra attempts, and the reports with their Excel export. A manager only
 * ever sees and assigns the people of their own branch; the server checks it for every person.
 */
@Injectable()
export class LearningManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  overview(auth: AuthContext): Promise<LearningManageView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      if (!c.manager && !c.author) assertManager(c);
      const modules = await tx.learningModule.findMany({ where: manageableModules(c), orderBy: { updatedAt: 'desc' }, take: 1000 });
      const people = await peopleInScope(tx, c);
      const extra = await peopleById(tx, c, modules.flatMap((m) => [m.createdById, m.responsibleUserId ?? '']));
      const rows = await moduleRows(tx, c, modules, extra);
      const inScopeIds = new Set(people.map((p) => p.userId));
      const assignments = (await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, removedAt: null }, take: 20000 })).filter(
        (a) => inScopeIds.has(a.userId) && a.userId !== auth.userId,
      );
      const now = new Date();
      const overdue = (a: AssignmentRec) => !!a.dueAt && a.dueAt < now && a.status !== 'COMPLETED';
      const certs = await tx.learningCertificate.findMany({ where: { tenantId: auth.tenantId, assignmentId: { in: assignments.map((a) => a.id) }, revokedAt: null }, select: { assignmentId: true, userId: true } });
      const scores = assignments.map((a) => a.bestScore).filter((s): s is number => typeof s === 'number');
      const completed = assignments.filter((a) => a.status === 'COMPLETED').length;
      const awaiting = await tx.learningAttempt.findMany({ where: { tenantId: auth.tenantId, status: 'AWAITING_MARKING', assignmentId: { in: assignments.map((a) => a.id) } }, select: { id: true } });
      const categories = await categoriesById(tx, auth.tenantId);
      const mById = new Map(modules.map((m) => [m.id, m]));
      const byCat = new Map<string, { category: string; color: string; modules: Set<string>; total: number; done: number; scores: number[] }>();
      for (const m of modules) {
        const cat = m.categoryId ? categories.get(m.categoryId) : undefined;
        const key = cat?.id ?? 'none';
        const row = byCat.get(key) ?? { category: cat?.name ?? 'Uncategorised', color: cat?.color ?? '#64748b', modules: new Set(), total: 0, done: 0, scores: [] };
        row.modules.add(m.id);
        byCat.set(key, row);
      }
      for (const a of assignments) {
        const m = mById.get(a.moduleId);
        const cat = m?.categoryId ? categories.get(m.categoryId) : undefined;
        const row = byCat.get(cat?.id ?? 'none');
        if (!row) continue;
        row.total++;
        if (a.status === 'COMPLETED') row.done++;
        if (typeof a.bestScore === 'number') row.scores.push(a.bestScore);
      }
      const byNode = new Map<string, { workspace: string; level: Person['level']; people: Set<string>; total: number; done: number; scores: number[]; overdue: number }>();
      for (const p of people) {
        const key = p.nodeId ?? 'root';
        const row = byNode.get(key) ?? { workspace: p.workspace, level: p.level, people: new Set(), total: 0, done: 0, scores: [], overdue: 0 };
        row.people.add(p.userId);
        byNode.set(key, row);
      }
      const personOf = new Map(people.map((p) => [p.userId, p]));
      for (const a of assignments) {
        const row = byNode.get(personOf.get(a.userId)?.nodeId ?? 'root');
        if (!row) continue;
        row.total++;
        if (a.status === 'COMPLETED') row.done++;
        if (overdue(a)) row.overdue++;
        if (typeof a.bestScore === 'number') row.scores.push(a.bestScore);
      }
      const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
      return {
        stats: {
          modules: modules.length,
          published: modules.filter((m) => m.status === 'PUBLISHED').length,
          drafts: modules.filter((m) => m.status === 'DRAFT').length,
          archived: modules.filter((m) => m.status === 'ARCHIVED').length,
          assignedPeople: new Set(assignments.map((a) => a.userId)).size,
          started: assignments.filter((a) => a.status !== 'NOT_STARTED').length,
          completed,
          pending: assignments.filter((a) => a.status === 'NOT_STARTED').length,
          failed: assignments.filter((a) => a.status === 'FAILED').length,
          passed: assignments.filter((a) => a.passed === true).length,
          overdue: assignments.filter(overdue).length,
          awaitingMarking: awaiting.length,
          averageScore: avg(scores),
          completionPercent: pct(completed, assignments.length),
          certificates: certs.length,
        },
        modules: rows,
        people: people
          .filter((p) => p.userId !== auth.userId)
          .map((p) => {
            const mine = assignments.filter((a) => a.userId === p.userId);
            return {
              user: { id: p.userId, name: p.name, workspace: p.workspace, level: p.level },
              assigned: mine.length,
              completed: mine.filter((a) => a.status === 'COMPLETED').length,
              overdue: mine.filter(overdue).length,
              failed: mine.filter((a) => a.status === 'FAILED').length,
              averageScore: avg(mine.map((a) => a.bestScore).filter((s): s is number => typeof s === 'number')),
              certificates: certs.filter((x) => x.userId === p.userId).length,
              minutes: Math.round(mine.reduce((s, a) => s + a.secondsSpent, 0) / 60),
            };
          }),
        byCategory: [...byCat.values()].map((r) => ({ category: r.category, color: r.color, modules: r.modules.size, completionPercent: pct(r.done, r.total), averageScore: avg(r.scores) })),
        byWorkspace: [...byNode.values()].map((r) => ({ workspace: r.workspace, level: r.level, people: r.people.size, completionPercent: pct(r.done, r.total), averageScore: avg(r.scores), overdue: r.overdue })),
        marking: awaiting.length,
        level: c.level === 'SUPER' ? 'SUPER' : 'MANAGER',
        canCreate: c.author,
        canConfigure: c.configure,
      };
    });
  }

  assignees(auth: AuthContext): Promise<AssigneeOption[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertManager(c);
      return (await peopleInScope(tx, c))
        .filter((p) => p.userId !== auth.userId)
        .map((p) => ({ id: p.userId, name: p.name, workspaceId: p.nodeId ?? 'root', workspace: p.workspace, level: p.level }));
    });
  }

  assignments(auth: AuthContext, moduleId: string): Promise<AssignmentRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertManager(c);
      const m = await moduleForManager(tx, c, moduleId);
      const rows = (await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, moduleId, removedAt: null }, orderBy: { assignedAt: 'desc' }, take: 5000 })).filter((a) => inScope(c, a.workspaceNodeId));
      const people = await peopleById(tx, c, rows.flatMap((a) => [a.userId, a.assignedById]));
      return rows.map((a) => assignmentRow(a, m, people));
    });
  }

  assign(auth: AuthContext, moduleId: string, input: AssignModuleInput, meta: RequestMeta): Promise<{ assigned: number; already: number; rows: AssignmentRow[] }> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertManager(c);
      const m = await moduleForManager(tx, c, moduleId);
      if (m.status !== 'PUBLISHED') throw new BadRequestException({ code: 'LEARNING_NOT_PUBLISHED', message: 'Publish the module before assigning it.' });
      const people = (await peopleInScope(tx, c)).filter((p) => p.userId !== auth.userId);
      const byId = new Map(people.map((p) => [p.userId, p]));
      const chosen = new Map<string, Person>();
      for (const id of input.userIds ?? []) {
        const p = byId.get(id);
        if (!p) throw new BadRequestException({ code: 'LEARNING_ASSIGNEE_OUT_OF_SCOPE', message: 'You can only assign modules to people in your own part of the organisation.' });
        chosen.set(id, p);
      }
      for (const ws of input.workspaceIds ?? []) {
        const inWs = people.filter((p) => (p.nodeId ?? 'root') === ws);
        if (!inWs.length && !people.some((p) => (p.nodeId ?? 'root') === ws)) {
          const known = ws === 'root' ? c.org.root : c.org.byId.get(ws);
          if (!known || !inScope(c, ws === 'root' ? null : ws)) throw new BadRequestException({ code: 'LEARNING_ASSIGNEE_OUT_OF_SCOPE', message: 'You can only assign modules to people in your own part of the organisation.' });
        }
        for (const p of inWs) chosen.set(p.userId, p);
      }
      for (const level of input.levels ?? []) for (const p of people.filter((x) => x.level === level)) chosen.set(p.userId, p);
      if (!chosen.size) throw new BadRequestException({ code: 'LEARNING_NOBODY_TO_ASSIGN', message: 'Nobody matches who you chose.' });
      const now = new Date();
      const dueAt = input.dueAt !== undefined ? (input.dueAt ? new Date(input.dueAt) : null) : m.dueAt ?? (m.dueInDays ? new Date(now.getTime() + m.dueInDays * DAY) : null);
      if (dueAt && dueAt < now) throw new BadRequestException({ code: 'LEARNING_DUE_IN_PAST', message: 'Choose a deadline in the future.' });
      const existing = await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, moduleId, userId: { in: [...chosen.keys()] } } });
      const had = new Map(existing.map((a) => [a.userId, a]));
      const fresh: string[] = [];
      let already = 0;
      for (const p of chosen.values()) {
        const prev = had.get(p.userId);
        if (prev && !prev.removedAt) {
          already++;
          continue;
        }
        if (prev) {
          // Assigned again after being taken off: their earlier progress and results are kept.
          await tx.learningAssignment.update({ where: { id: prev.id }, data: { removedAt: null, dueAt, mandatory: input.mandatory ?? m.mandatory, note: input.note || null, assignedById: auth.userId, assignedAt: now, remindersSent: [] } });
        } else {
          fresh.push(p.userId);
        }
      }
      if (fresh.length) {
        await createManySkipDuplicates(
          tx.learningAssignment,
          'LearningAssignment',
          fresh.map((userId) => ({ tenantId: auth.tenantId, moduleId, userId, workspaceNodeId: chosen.get(userId)!.nodeId, assignedById: auth.userId, assignedAt: now, dueAt, mandatory: input.mandatory ?? m.mandatory, note: input.note || null, remindersSent: [], activeDays: [], lessonProgress: {} })),
        );
      }
      const notify = [...chosen.keys()].filter((id) => !had.get(id) || had.get(id)!.removedAt);
      const mandatory = input.mandatory ?? m.mandatory;
      await this.notifications.send(tx, auth.tenantId, notify, {
        type: mandatory ? 'learning.assigned_mandatory' : 'learning.assigned',
        title: mandatory ? 'Mandatory training assigned to you' : 'Learning module assigned to you',
        body: `${m.title}${dueAt ? ` · due ${dueAt.toISOString().slice(0, 10)}` : ''}`,
        link: `/app/learning/${moduleId}`,
        eventId: `learning.assigned:${moduleId}:${now.getTime()}`,
        senderId: auth.userId,
        priority: mandatory ? 'HIGH' : 'NORMAL',
        actionRequired: mandatory,
      });
      await tx.learningModuleEvent.create({ data: { tenantId: auth.tenantId, moduleId, actorId: auth.userId, kind: 'assigned', summary: `Assigned to ${notify.length} ${notify.length === 1 ? 'person' : 'people'}${dueAt ? `, due ${dueAt.toISOString().slice(0, 10)}` : ''}.` } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.module_assigned', entityType: 'learning_module', entityId: moduleId, metadata: { people: notify.length, dueAt: dueAt?.toISOString() ?? null }, meta });
      const rows = await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, moduleId, userId: { in: [...chosen.keys()] } } });
      const names = await peopleById(tx, c, rows.flatMap((a) => [a.userId, a.assignedById]));
      return { assigned: notify.length, already, rows: rows.map((a) => assignmentRow(a, m, names)) };
    });
  }

  private async assignmentFor(tx: TenantTx, c: LearningCaller, id: string): Promise<{ a: AssignmentRec; m: ModuleRec }> {
    assertManager(c);
    const a = await tx.learningAssignment.findFirst({ where: { id, tenantId: c.auth.tenantId } });
    if (!a || !inScope(c, a.workspaceNodeId) || a.userId === c.auth.userId) throw notFound();
    const m = await moduleForManager(tx, c, a.moduleId);
    return { a, m };
  }

  /** Changes the deadline, mandatory flag or extra attempts (a reassignment after a fail). */
  updateAssignment(auth: AuthContext, id: string, input: AssignmentUpdateInput, meta: RequestMeta): Promise<AssignmentRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const { a, m } = await this.assignmentFor(tx, c, id);
      const data: Record<string, unknown> = {};
      const notes: string[] = [];
      if (input.dueAt !== undefined) {
        const due = input.dueAt ? new Date(input.dueAt) : null;
        data.dueAt = due;
        data.remindersSent = [];
        notes.push(due ? `deadline ${due.toISOString().slice(0, 10)}` : 'no deadline');
      }
      if (input.mandatory !== undefined) data.mandatory = input.mandatory;
      if (input.note !== undefined) data.note = input.note || null;
      if (input.extraAttempts !== undefined) {
        data.extraAttempts = input.extraAttempts;
        notes.push(`${m.maxAttempts + input.extraAttempts} attempts in all`);
      }
      const updated = await tx.learningAssignment.update({ where: { id }, data });
      if (notes.length) {
        await this.notifications.send(tx, auth.tenantId, [a.userId], {
          type: 'learning.assignment_updated',
          title: 'Your learning assignment was updated',
          body: `${m.title}: ${notes.join(', ')}`,
          link: `/app/learning/${m.id}`,
          eventId: `learning.updated:${id}:${Date.now()}`,
          senderId: auth.userId,
        });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.assignment_updated', entityType: 'learning_assignment', entityId: id, metadata: { changed: Object.keys(input) }, meta });
      const people = await peopleById(tx, c, [a.userId, a.assignedById]);
      return assignmentRow(updated, m, people);
    });
  }

  /** Takes the module off a person. Their attempts, results and any certificate stay on record. */
  removeAssignment(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const { a, m } = await this.assignmentFor(tx, c, id);
      await tx.learningAssignment.update({ where: { id }, data: { removedAt: new Date() } });
      await tx.learningModuleEvent.create({ data: { tenantId: auth.tenantId, moduleId: m.id, actorId: auth.userId, kind: 'unassigned', summary: 'Took the module off one person; their results are kept.' } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.assignment_removed', entityType: 'learning_assignment', entityId: id, metadata: { moduleId: m.id, userId: a.userId }, meta });
    });
  }

  // ───────────── Reports ─────────────

  report(auth: AuthContext, q: LearningReportQuery): Promise<ReportRow[]> {
    return this.prisma.run(auth, async (tx) => this.reportRows(tx, auth, q), { timeoutMs: 60_000 });
  }

  private async reportRows(tx: TenantTx, auth: AuthContext, q: LearningReportQuery): Promise<ReportRow[]> {
    const c = await learningCaller(tx, auth);
    assertManager(c);
    const modules = await tx.learningModule.findMany({ where: { AND: [manageableModules(c), ...(q.moduleId ? [{ id: q.moduleId }] : []), ...(q.categoryId ? [{ categoryId: q.categoryId }] : [])] } });
    const mById = new Map(modules.map((m) => [m.id, m]));
    const people = await peopleInScope(tx, c);
    const pById = new Map(people.map((p) => [p.userId, p]));
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    const now = new Date();
    let rows = (await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, removedAt: null, moduleId: { in: [...mById.keys()] }, ...(q.userId ? { userId: q.userId } : {}) }, orderBy: { assignedAt: 'desc' }, take: 20000 })).filter(
      (a) => pById.has(a.userId) && a.userId !== auth.userId,
    );
    if (q.workspaceId) rows = rows.filter((a) => (pById.get(a.userId)?.nodeId ?? 'root') === q.workspaceId);
    if (q.managerId) {
      // The people below the chosen manager's workspace.
      const mgr = pById.get(q.managerId);
      rows = rows.filter((a) => {
        const node = pById.get(a.userId)?.nodeId;
        const access = node ? c.org.byId.get(node) : null;
        return !!access && !!mgr && access.node.parentId === (mgr.nodeId ?? null);
      });
    }
    if (q.status === 'OVERDUE') rows = rows.filter((a) => a.dueAt && a.dueAt < now && a.status !== 'COMPLETED');
    else if (q.status) rows = rows.filter((a) => a.status === q.status);
    if (q.result === 'PASSED') rows = rows.filter((a) => a.passed === true);
    else if (q.result === 'FAILED') rows = rows.filter((a) => a.status === 'FAILED');
    else if (q.result === 'PENDING') rows = rows.filter((a) => a.passed !== true && a.status !== 'FAILED');
    if (from || to) rows = rows.filter((a) => [a.assignedAt, a.completedAt].some((d) => d && (!from || d >= from) && (!to || d <= to)));
    const names = await peopleById(tx, c, rows.flatMap((a) => [a.userId, a.assignedById]));
    const certs = await tx.learningCertificate.findMany({ where: { tenantId: auth.tenantId, assignmentId: { in: rows.map((a) => a.id) } } });
    const certOf = new Map(certs.map((x) => [x.assignmentId, x]));
    const categories = await categoriesById(tx, auth.tenantId);
    return rows.map((a) => {
      const m = mById.get(a.moduleId)!;
      const p = pById.get(a.userId);
      const node = p?.nodeId ? c.org.byId.get(p.nodeId) : null;
      const parent = node?.node.parentId ? c.org.byId.get(node.node.parentId) : node ? c.org.root : null;
      const cert = certOf.get(a.id);
      return {
        assignment: assignmentRow(a, m, names),
        employeeId: a.userId.slice(0, 8).toUpperCase(),
        manager: parent ? (parent === c.org.root ? 'Super Workspace' : parent.node.name) : null,
        category: m.categoryId ? (categories.get(m.categoryId)?.name ?? null) : null,
        startedAt: a.startedAt?.toISOString() ?? null,
        certificateNumber: cert?.number ?? null,
        certificateStatus: cert ? (cert.revokedAt ? 'REVOKED' : 'ISSUED') : m.certificate ? 'NOT_YET' : 'NOT_ELIGIBLE',
      };
    });
  }

  async exportXlsx(auth: AuthContext, q: LearningReportQuery, meta: RequestMeta): Promise<Buffer> {
    const rows = await this.prisma.run(
      auth,
      async (tx) => {
        const out = await this.reportRows(tx, auth, q);
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.report_exported', entityType: 'learning_report', entityId: auth.tenantId, metadata: { rows: out.length, filters: q }, meta });
        return out;
      },
      { timeoutMs: 60_000 },
    );
    const certLabel = { ISSUED: 'Issued', REVOKED: 'Revoked', NOT_ELIGIBLE: 'No certificate', NOT_YET: 'Not yet earned' } as const;
    const d = (s: string | null) => (s ? new Date(s) : null);
    return toXlsx(
      'Learning report',
      ['Employee name', 'Employee ID', 'Workspace', 'Level', 'Manager', 'Module ID', 'Module', 'Category', 'Mandatory', 'Assigned', 'Due', 'Started', 'Completed', 'Status', 'Overdue', 'Progress %', 'Minutes spent', 'Best score %', 'Last score %', 'Result', 'Attempts used', 'Attempts allowed', 'Certificate', 'Certificate ID', 'Assigned by'],
      rows.map((r) => {
        const a = r.assignment;
        return [
          a.user.name, r.employeeId, a.user.workspace, a.user.level, r.manager, a.moduleNumber, a.moduleTitle, r.category, a.mandatory ? 'Mandatory' : 'Optional',
          d(a.assignedAt), d(a.dueAt), d(r.startedAt), d(a.completedAt), ASSIGNMENT_STATUS_LABEL[a.status as LearningAssignmentStatus], a.overdue ? 'Yes' : 'No', a.progress, a.minutesSpent,
          a.bestScore, a.lastScore, a.passed ? 'Passed' : a.status === 'FAILED' ? 'Failed' : 'Pending', a.attemptsUsed, a.attemptsAllowed, certLabel[r.certificateStatus], r.certificateNumber, a.assignedBy?.name ?? null,
        ];
      }),
    );
  }
}

