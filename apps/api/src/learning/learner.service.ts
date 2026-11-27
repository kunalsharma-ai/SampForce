import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { transactionLock, type TenantTx } from '@dealflow/database';
import {
  type AnswerInput,
  type AttemptStatus,
  type AttemptView,
  type LearningCard,
  type LearningLevel,
  type LearningModuleStatus,
  type LearningNoteInput,
  type LearningNoteRow,
  type LearningStats,
  type LessonProgressInput,
  learningModuleNumber,
  type MarkAttemptInput,
  type MarkingDetail,
  type MarkingRow,
  type MyLearningQuery,
  type MyLearningView,
  type PlayerView,
  type VideoInfo,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { inScope, type LearningCaller, learningCaller, manageableModules, openModuleReaches, peopleById } from './access';
import { LearningCertificatesService } from './certificates.service';
import { fileRef } from './files.service';
import { answered, learnerQuestion, markAnswer, questionResults, type SnapQuestion, snapshot, type StoredResult, totals } from './scoring';
import {
  type AssignmentRec,
  assignmentRow,
  attemptsAllowed,
  avg,
  categoriesById,
  certificateRow,
  filesById,
  isOverdue,
  lessonView,
  materialType,
  type ModuleRec,
  moduleMinutes,
  questionView,
  r1,
} from './views';

type AttemptRec = NonNullable<Awaited<ReturnType<TenantTx['learningAttempt']['findFirst']>>>;
type LessonState = { percent?: number; positionSeconds?: number; doneAt?: string; seconds?: number };

const notFound = (what = 'Learning module') => new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });
const DAY = 86_400_000;
/** A few seconds of grace for an answer sent just as the time limit ends. */
const TIME_GRACE_MS = 30_000;

export function dayIn(timeZone: string, d = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Days in a row with learning, ending today or yesterday. */
export function streakOf(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  const back = (s: string) => new Date(Date.parse(`${s}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  let d = set.has(today) ? today : back(today);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = back(d);
  }
  return n;
}

/**
 * Taking modules (ADR 0097): the learner's dashboard, the lessons with progress saved as they go, notes and
 * bookmarks, the assessment with its marking, and the marking queue for written answers. The server keeps the answer
 * key, marks the answers, counts the attempts and decides pass or fail; the browser only ever sends answers.
 */
@Injectable()
export class LearningLearnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly certificates: LearningCertificatesService,
  ) {}

  private async timeZone(tx: TenantTx, tenantId: string): Promise<string> {
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { defaultTimezone: true } });
    return t?.defaultTimezone ?? 'UTC';
  }

  // ───────────── Dashboard ─────────────

  myLearning(auth: AuthContext, q: MyLearningQuery): Promise<MyLearningView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const from = q.from ? new Date(q.from) : null;
      const to = q.to ? new Date(q.to) : null;
      const assignments = await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId, removedAt: null }, orderBy: { assignedAt: 'desc' }, take: 1000 });
      const moduleIds = [...new Set(assignments.map((a) => a.moduleId))];
      const open = await tx.learningModule.findMany({ where: { tenantId: auth.tenantId, status: 'PUBLISHED', visibility: 'OPEN', id: { notIn: moduleIds } }, take: 200 });
      const reachable = open.filter((m) => openModuleReaches(c.org, m.ownerNodeId, c.nodeId));
      const modules = await tx.learningModule.findMany({ where: { tenantId: auth.tenantId, id: { in: moduleIds } } });
      const all = [...modules, ...reachable];
      const ids = all.map((m) => m.id);
      const [lessons, questions, categories, attempts, certs] = await Promise.all([
        tx.learningLesson.findMany({ where: { tenantId: auth.tenantId, moduleId: { in: ids } }, select: { moduleId: true, kind: true, minutes: true, video: true, text: true, body: true } }),
        tx.learningQuestion.findMany({ where: { tenantId: auth.tenantId, moduleId: { in: ids }, approved: true }, select: { moduleId: true, marks: true } }),
        categoriesById(tx, auth.tenantId),
        tx.learningAttempt.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId, status: { not: 'IN_PROGRESS' } }, orderBy: { submittedAt: 'desc' }, take: 500 }),
        tx.learningCertificate.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, orderBy: { issuedAt: 'desc' } }),
      ]);
      const now = new Date();
      const card = (m: ModuleRec, a: AssignmentRec | null): LearningCard => {
        const ls = lessons.filter((l) => l.moduleId === m.id) as Parameters<typeof moduleMinutes>[1];
        const qs = questions.filter((x) => x.moduleId === m.id);
        const cat = m.categoryId ? categories.get(m.categoryId) : undefined;
        const video = ls.map((l) => l.video as VideoInfo | null).find((v) => v?.thumbnailUrl);
        const since = a?.assignedAt ?? m.publishedAt ?? m.createdAt;
        return {
          moduleId: m.id,
          assignmentId: a?.id ?? null,
          number: learningModuleNumber(m.number),
          title: m.title,
          description: m.description ?? null,
          category: cat ? { id: cat.id, name: cat.name, color: cat.color } : null,
          level: m.level as LearningLevel,
          materialType: materialType(ls),
          estimatedMinutes: moduleMinutes(m, ls, qs.length),
          lessons: ls.length,
          questions: qs.length,
          mandatory: a ? a.mandatory : false,
          assignedAt: a?.assignedAt.toISOString() ?? null,
          dueAt: a?.dueAt?.toISOString() ?? null,
          status: (a?.status ?? 'NOT_STARTED') as LearningCard['status'],
          overdue: a ? isOverdue(a, now) : false,
          isNew: !a?.openedAt && now.getTime() - since.getTime() < 7 * DAY,
          progress: a?.progress ?? 0,
          bestScore: a?.bestScore ?? null,
          passingScore: m.passingScore,
          attemptsUsed: a?.attemptsUsed ?? 0,
          attemptsAllowed: a ? attemptsAllowed(m, a) : m.maxAttempts,
          certificate: m.certificate,
          certificateId: a?.certificateId ?? null,
          thumbnailUrl: video?.thumbnailUrl ?? null,
        };
      };
      const byId = new Map(modules.map((m) => [m.id, m]));
      const inRange = (d: Date | null | undefined) => !!d && (!from || d >= from) && (!to || d <= to);
      const filtered = assignments.filter((a) => {
        const m = byId.get(a.moduleId);
        if (!m) return false;
        if (q.categoryId && m.categoryId !== q.categoryId) return false;
        if ((from || to) && !inRange(a.assignedAt) && !inRange(a.completedAt)) return false;
        return true;
      });
      const cards = filtered.map((a) => card(byId.get(a.moduleId)!, a));
      const done = filtered.filter((a) => a.status === 'COMPLETED');
      const myAttempts = attempts.filter((t) => filtered.some((a) => a.id === t.assignmentId));
      const marked = myAttempts.filter((t) => t.status === 'MARKED' && typeof t.percent === 'number');
      const tz = await this.timeZone(tx, auth.tenantId);
      const days = assignments.flatMap((a) => a.activeDays);
      const myCerts = certs.filter((x) => filtered.some((a) => a.id === x.assignmentId));
      const stats: LearningStats = {
        assigned: filtered.length,
        completed: done.length,
        inProgress: filtered.filter((a) => a.status === 'IN_PROGRESS' || a.status === 'FAILED').length,
        pending: filtered.filter((a) => a.status === 'NOT_STARTED').length,
        overdue: filtered.filter((a) => isOverdue(a, now)).length,
        awaitingMarking: filtered.filter((a) => a.status === 'AWAITING_MARKING').length,
        assignmentsCompleted: marked.length,
        totalMarks: r1(marked.reduce((s, t) => s + (t.score ?? 0), 0)),
        maxMarks: r1(marked.reduce((s, t) => s + t.maxScore, 0)),
        averageScore: avg(done.map((a) => a.bestScore).filter((s): s is number => typeof s === 'number')),
        highestScore: marked.length ? Math.max(...marked.map((t) => t.percent!)) : null,
        certificates: myCerts.filter((x) => !x.revokedAt).length,
        learningMinutes: Math.round(filtered.reduce((s, a) => s + a.secondsSpent, 0) / 60),
        streakDays: streakOf(days, dayIn(tz)),
        completionPercent: filtered.length ? Math.round((done.length / filtered.length) * 100) : 0,
      };
      const byCat = new Map<string, { category: string; color: string; assigned: number; completed: number; scores: number[] }>();
      for (const a of filtered) {
        const m = byId.get(a.moduleId)!;
        const cat = m.categoryId ? categories.get(m.categoryId) : undefined;
        const key = cat?.id ?? 'none';
        const row = byCat.get(key) ?? { category: cat?.name ?? 'Uncategorised', color: cat?.color ?? '#64748b', assigned: 0, completed: 0, scores: [] };
        row.assigned++;
        if (a.status === 'COMPLETED') row.completed++;
        if (typeof a.bestScore === 'number') row.scores.push(a.bestScore);
        byCat.set(key, row);
      }
      return {
        stats,
        cards,
        explore: q.categoryId ? reachable.filter((m) => m.categoryId === q.categoryId).map((m) => card(m, null)) : reachable.map((m) => card(m, null)),
        upcoming: filtered
          .filter((a) => a.dueAt && a.status !== 'COMPLETED')
          .sort((x, y) => x.dueAt!.getTime() - y.dueAt!.getTime())
          .slice(0, 10)
          .map((a) => ({ moduleId: a.moduleId, title: byId.get(a.moduleId)!.title, dueAt: a.dueAt!.toISOString(), overdue: isOverdue(a, now) })),
        results: myAttempts.slice(0, 20).map((t) => ({ attemptId: t.id, moduleId: t.moduleId, title: byId.get(t.moduleId)?.title ?? '', percent: t.percent ?? null, passed: t.passed ?? null, status: t.status as AttemptStatus, submittedAt: (t.submittedAt ?? t.startedAt).toISOString() })),
        certificates: myCerts.map(certificateRow),
        scoreHistory: [...marked].reverse().map((t) => ({ at: (t.submittedAt ?? t.startedAt).toISOString(), percent: t.percent!, title: byId.get(t.moduleId)?.title ?? '' })),
        byCategory: [...byCat.values()].map((r) => ({ category: r.category, color: r.color, assigned: r.assigned, completed: r.completed, averageScore: avg(r.scores) })),
        canManage: c.manager || c.author,
      };
    });
  }

  // ───────────── Player ─────────────

  /** The module as a learner opens it. Throws when the module is not theirs to take. */
  private async reach(tx: TenantTx, c: LearningCaller, moduleId: string) {
    const m = await tx.learningModule.findFirst({ where: { id: moduleId, tenantId: c.auth.tenantId } });
    if (!m) throw notFound();
    const a = await tx.learningAssignment.findFirst({ where: { moduleId, userId: c.auth.userId, tenantId: c.auth.tenantId, removedAt: null } });
    if (a && m.status !== 'DRAFT') return { m, a, preview: false };
    if (m.status === 'PUBLISHED' && m.visibility === 'OPEN' && openModuleReaches(c.org, m.ownerNodeId, c.nodeId)) return { m, a: null, preview: true };
    // Authors and managers may look through what their people will take.
    if (c.author || c.manager) {
      const managed = await tx.learningModule.findFirst({ where: { AND: [{ id: moduleId }, manageableModules(c)] }, select: { id: true } });
      if (managed) return { m, a: null, preview: true };
    }
    throw notFound();
  }

  player(auth: AuthContext, moduleId: string): Promise<PlayerView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const { m, a, preview } = await this.reach(tx, c, moduleId);
      if (a && !a.openedAt) await tx.learningAssignment.update({ where: { id: a.id }, data: { openedAt: new Date() } });
      return this.playerView(tx, c, m, a, preview);
    });
  }

  private async playerView(tx: TenantTx, c: LearningCaller, m: ModuleRec, a: AssignmentRec | null, preview: boolean): Promise<PlayerView> {
    const tenantId = c.auth.tenantId;
    const [lessons, questions, attempts, notes, categories, cert] = await Promise.all([
      tx.learningLesson.findMany({ where: { tenantId, moduleId: m.id }, orderBy: { position: 'asc' } }),
      tx.learningQuestion.findMany({ where: { tenantId, moduleId: m.id, approved: true }, select: { marks: true } }),
      a ? tx.learningAttempt.findMany({ where: { tenantId, assignmentId: a.id }, orderBy: { number: 'asc' } }) : Promise.resolve([] as AttemptRec[]),
      tx.learningNote.findMany({ where: { tenantId, userId: c.auth.userId, moduleId: m.id }, orderBy: { createdAt: 'desc' }, take: 300 }),
      categoriesById(tx, tenantId),
      a?.certificateId ? tx.learningCertificate.findUnique({ where: { id: a.certificateId } }) : Promise.resolve(null),
    ]);
    const files = await filesById(tx, tenantId, lessons.flatMap((l) => [l.fileId, l.captionsFileId]));
    const progress = (a?.lessonProgress ?? {}) as Record<string, LessonState>;
    const people = a ? await peopleById(tx, c, [a.userId, a.assignedById]) : new Map();
    const cat = m.categoryId ? categories.get(m.categoryId) : undefined;
    const required = lessons.filter((l) => l.required);
    const lessonsDone = required.filter((l) => progress[l.id]?.doneAt).length;
    const open = attempts.find((t) => t.status === 'IN_PROGRESS') ?? null;
    const allowed = a ? attemptsAllowed(m, a) : m.maxAttempts;
    let blocked: string | null = null;
    if (!a) blocked = preview ? 'Start the module to take the assessment.' : 'This module is not assigned to you.';
    else if (m.status !== 'PUBLISHED') blocked = 'This module is archived: it can no longer be taken.';
    else if (a.status === 'COMPLETED') blocked = 'You have passed this module.';
    else if (a.status === 'AWAITING_MARKING') blocked = 'Your answers are waiting to be marked.';
    else if (!questions.length) blocked = 'This module has no assessment yet.';
    else if (!open && a.attemptsUsed >= allowed) blocked = 'You have used all your attempts. Ask your manager for another attempt.';
    else if (lessonsDone < required.length) blocked = `Finish the lessons first (${lessonsDone} of ${required.length} done).`;
    const nameOf = new Map(lessons.map((l) => [l.id, l.title]));
    return {
      module: {
        id: m.id,
        number: learningModuleNumber(m.number),
        title: m.title,
        description: m.description ?? null,
        objectives: m.objectives,
        keyPoints: m.keyPoints,
        instructions: m.instructions ?? null,
        category: cat ? { id: cat.id, name: cat.name, color: cat.color } : null,
        level: m.level as LearningLevel,
        estimatedMinutes: moduleMinutes(m, lessons, questions.length),
        passingScore: m.passingScore,
        maxAttempts: allowed,
        timeLimitMinutes: m.timeLimitMinutes ?? null,
        certificate: m.certificate,
        totalMarks: r1(questions.reduce((s, q) => s + q.marks, 0)),
        questions: questions.length,
        status: m.status as LearningModuleStatus,
      },
      lessons: lessons.map((l) => {
        const v = lessonView(l, files);
        // People who may not download a file still see it in the page.
        const st = progress[l.id] ?? {};
        return { ...v, done: !!st.doneAt, percent: Math.round(st.percent ?? 0), positionSeconds: st.positionSeconds ?? null };
      }),
      assignment: a ? assignmentRow(a, m, people) : null,
      canAttempt: !blocked,
      attemptBlockedReason: blocked,
      openAttemptId: open?.id ?? null,
      attempts: attempts.map((t) => ({ id: t.id, number: t.number, status: t.status as AttemptStatus, percent: t.percent ?? null, passed: t.passed ?? null, submittedAt: t.submittedAt?.toISOString() ?? null })),
      notes: notes.map((n) => ({ id: n.id, lessonId: n.lessonId ?? null, lessonTitle: n.lessonId ? (nameOf.get(n.lessonId) ?? null) : null, body: n.body ?? null, bookmark: n.bookmark, positionSeconds: n.positionSeconds ?? null, createdAt: n.createdAt.toISOString() })),
      certificate: cert ? certificateRow(cert) : null,
      lastLessonId: a?.lastLessonId ?? null,
      preview,
      requirements: { lessons: required.length, lessonsDone, assessment: questions.length > 0, passingScore: m.passingScore },
    };
  }

  /** A lesson's readable text, for the reading view of documents and presentations that cannot be shown as they are. */
  lessonText(auth: AuthContext, moduleId: string, lessonId: string): Promise<{ text: string | null; source: string | null; note: string | null }> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      await this.reach(tx, c, moduleId);
      const l = await tx.learningLesson.findFirst({ where: { id: lessonId, tenantId: auth.tenantId, moduleId }, select: { text: true, textSource: true, textNote: true, textStatus: true } });
      if (!l) throw notFound('Lesson');
      return { text: l.textStatus === 'READY' ? (l.text ?? null) : null, source: l.textSource ?? null, note: l.textNote ?? null };
    });
  }

  /** Starts an open module the person was not assigned: it becomes an optional assignment of their own. */
  enrol(auth: AuthContext, moduleId: string): Promise<PlayerView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await tx.learningModule.findFirst({ where: { id: moduleId, tenantId: auth.tenantId } });
      if (!m || m.status !== 'PUBLISHED' || m.visibility !== 'OPEN' || !openModuleReaches(c.org, m.ownerNodeId, c.nodeId)) throw notFound();
      let a = await tx.learningAssignment.findFirst({ where: { moduleId, userId: auth.userId, tenantId: auth.tenantId } });
      if (!a) {
        a = await tx.learningAssignment.create({ data: { tenantId: auth.tenantId, moduleId, userId: auth.userId, workspaceNodeId: c.nodeId, assignedById: auth.userId, mandatory: false, openedAt: new Date(), dueAt: null, remindersSent: [], activeDays: [], lessonProgress: {} } });
      } else if (a.removedAt) {
        a = await tx.learningAssignment.update({ where: { id: a.id }, data: { removedAt: null } });
      }
      return this.playerView(tx, c, m, a, false);
    });
  }

  private async mine(tx: TenantTx, auth: AuthContext, moduleId: string) {
    const a = await tx.learningAssignment.findFirst({ where: { moduleId, userId: auth.userId, tenantId: auth.tenantId, removedAt: null } });
    if (!a) throw notFound();
    const m = await tx.learningModule.findFirst({ where: { id: moduleId, tenantId: auth.tenantId } });
    if (!m || m.status === 'DRAFT') throw notFound();
    return { a, m };
  }

  /** Saves where the person is in a lesson; called as they read, watch and listen. */
  progress(auth: AuthContext, moduleId: string, lessonId: string, input: LessonProgressInput) {
    return this.prisma.run(auth, async (tx) => {
      const { a, m } = await this.mine(tx, auth, moduleId);
      const lessons = await tx.learningLesson.findMany({ where: { tenantId: auth.tenantId, moduleId }, select: { id: true, required: true } });
      if (!lessons.some((l) => l.id === lessonId)) throw notFound('Lesson');
      const map = { ...((a.lessonProgress ?? {}) as Record<string, LessonState>) };
      const st = { ...(map[lessonId] ?? {}) };
      if (input.percent !== undefined) st.percent = Math.max(st.percent ?? 0, input.percent);
      if (input.positionSeconds !== undefined) st.positionSeconds = input.positionSeconds;
      if (input.seconds) st.seconds = (st.seconds ?? 0) + input.seconds;
      if ((input.done || (st.percent ?? 0) >= 95) && !st.doneAt) {
        st.doneAt = new Date().toISOString();
        st.percent = 100;
      }
      map[lessonId] = st;
      const required = lessons.filter((l) => l.required);
      const counted = required.length ? required : lessons;
      const done = counted.filter((l) => map[l.id]?.doneAt).length;
      // Lessons are most of the way; passing the assessment is the last step.
      const lessonShare = counted.length ? done / counted.length : 1;
      const pct = a.status === 'COMPLETED' ? 100 : Math.min(95, Math.round(lessonShare * 90));
      const tz = await this.timeZone(tx, auth.tenantId);
      const today = dayIn(tz);
      const updated = await tx.learningAssignment.update({
        where: { id: a.id },
        data: {
          lessonProgress: map,
          lastLessonId: lessonId,
          progress: Math.max(a.progress, pct),
          secondsSpent: a.secondsSpent + (input.seconds ?? 0),
          ...(a.status === 'NOT_STARTED' ? { status: 'IN_PROGRESS', startedAt: new Date() } : {}),
          ...(!a.activeDays.includes(today) ? { activeDays: { push: today } } : {}),
        },
      });
      void m;
      return { progress: updated.progress, done: !!st.doneAt, lessonsDone: done, lessons: counted.length };
    });
  }

  // ───────────── Notes and bookmarks ─────────────

  addNote(auth: AuthContext, moduleId: string, input: LearningNoteInput): Promise<LearningNoteRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      await this.reach(tx, c, moduleId);
      let lessonTitle: string | null = null;
      if (input.lessonId) {
        const l = await tx.learningLesson.findFirst({ where: { id: input.lessonId, tenantId: auth.tenantId, moduleId } });
        if (!l) throw notFound('Lesson');
        lessonTitle = l.title;
      }
      const n = await tx.learningNote.create({ data: { tenantId: auth.tenantId, userId: auth.userId, moduleId, lessonId: input.lessonId ?? null, body: input.body || null, bookmark: input.bookmark ?? false, positionSeconds: input.positionSeconds ?? null } });
      return { id: n.id, lessonId: n.lessonId ?? null, lessonTitle, body: n.body ?? null, bookmark: n.bookmark, positionSeconds: n.positionSeconds ?? null, createdAt: n.createdAt.toISOString() };
    });
  }

  removeNote(auth: AuthContext, id: string): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const n = await tx.learningNote.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
      if (!n) throw notFound('Note');
      await tx.learningNote.delete({ where: { id } });
    });
  }

  // ───────────── Attempts ─────────────

  /** Starts an attempt, or returns the one already open. */
  startAttempt(auth: AuthContext, moduleId: string): Promise<AttemptView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const { a, m } = await this.mine(tx, auth, moduleId);
      // One start at a time per person and module, so two clicks never take two attempts.
      await transactionLock(tx, `learning-attempt:${a.id}`);
      const view = await this.playerView(tx, c, m, a, false);
      if (view.openAttemptId) return this.attemptView(tx, c, await this.attemptOf(tx, auth, view.openAttemptId), m, false);
      if (!view.canAttempt) throw new ForbiddenException({ code: 'LEARNING_ATTEMPT_BLOCKED', message: view.attemptBlockedReason ?? 'You cannot take this assessment now.' });
      const qs = await tx.learningQuestion.findMany({ where: { tenantId: auth.tenantId, moduleId, approved: true }, orderBy: { position: 'asc' } });
      const snap = snapshot(qs, m.shuffleQuestions);
      const number = a.attemptsUsed + 1;
      const now = new Date();
      const attempt = await tx.learningAttempt.create({
        data: {
          tenantId: auth.tenantId,
          assignmentId: a.id,
          moduleId,
          userId: auth.userId,
          number,
          questions: snap as unknown as object,
          answers: {},
          maxScore: snap.reduce((s, q) => s + q.marks, 0),
          startedAt: now,
          expiresAt: m.timeLimitMinutes ? new Date(now.getTime() + m.timeLimitMinutes * 60_000) : null,
        },
      });
      await tx.learningAssignment.update({ where: { id: a.id }, data: { attemptsUsed: number, ...(a.status === 'NOT_STARTED' ? { status: 'IN_PROGRESS', startedAt: now } : {}), ...(a.status === 'FAILED' ? { status: 'IN_PROGRESS' } : {}) } });
      return this.attemptView(tx, c, attempt, m, false);
    });
  }

  private async attemptOf(tx: TenantTx, auth: AuthContext, id: string): Promise<AttemptRec> {
    const t = await tx.learningAttempt.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
    if (!t) throw notFound('Attempt');
    return t;
  }

  getAttempt(auth: AuthContext, id: string): Promise<AttemptView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      let t = await this.attemptOf(tx, auth, id);
      const m = await tx.learningModule.findUniqueOrThrow({ where: { id: t.moduleId } });
      // An attempt left open past its time limit is handed in with what was saved.
      if (t.status === 'IN_PROGRESS' && t.expiresAt && t.expiresAt.getTime() + TIME_GRACE_MS < Date.now()) t = await this.handIn(tx, c, t, m, true);
      return this.attemptView(tx, c, t, m, false);
    });
  }

  saveAnswers(auth: AuthContext, id: string, answers: Record<string, AnswerInput>): Promise<{ saved: number; savedAt: string }> {
    return this.prisma.run(auth, async (tx) => {
      const t = await this.attemptOf(tx, auth, id);
      this.assertOpen(t);
      const snap = t.questions as unknown as SnapQuestion[];
      const known = new Set(snap.map((q) => q.id));
      const merged = { ...((t.answers ?? {}) as Record<string, AnswerInput>) };
      for (const [qid, ans] of Object.entries(answers)) {
        if (!known.has(qid)) throw new BadRequestException({ code: 'LEARNING_QUESTION_UNKNOWN', message: 'That question is not in this attempt.' });
        if (ans.fileId) {
          const f = await tx.learningFile.findFirst({ where: { id: ans.fileId, tenantId: auth.tenantId, uploadedById: auth.userId, attemptId: id, completedAt: { not: null } } });
          if (!f) throw new BadRequestException({ code: 'LEARNING_FILE_UNKNOWN', message: 'That file has not finished uploading.' });
        }
        merged[qid] = ans;
      }
      await tx.learningAttempt.update({ where: { id }, data: { answers: merged } });
      return { saved: Object.keys(merged).length, savedAt: new Date().toISOString() };
    });
  }

  private assertOpen(t: AttemptRec): void {
    if (t.status !== 'IN_PROGRESS') throw new ConflictException({ code: 'LEARNING_ATTEMPT_CLOSED', message: 'This attempt has been handed in already.' });
    if (t.expiresAt && t.expiresAt.getTime() + TIME_GRACE_MS < Date.now()) throw new ConflictException({ code: 'LEARNING_ATTEMPT_EXPIRED', message: 'The time for this attempt has run out. What you saved has been handed in.' });
  }

  submit(auth: AuthContext, id: string, answers: Record<string, AnswerInput> | undefined, meta: RequestMeta): Promise<AttemptView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      await transactionLock(tx, `learning-submit:${id}`);
      let t = await this.attemptOf(tx, auth, id);
      const m = await tx.learningModule.findUniqueOrThrow({ where: { id: t.moduleId } });
      if (t.status !== 'IN_PROGRESS') return this.attemptView(tx, c, t, m, false);
      const expired = !!t.expiresAt && t.expiresAt.getTime() + TIME_GRACE_MS < Date.now();
      if (answers && !expired) {
        const known = new Set((t.questions as unknown as SnapQuestion[]).map((q) => q.id));
        const merged = { ...((t.answers ?? {}) as Record<string, AnswerInput>) };
        for (const [qid, ans] of Object.entries(answers)) if (known.has(qid)) merged[qid] = ans;
        t = await tx.learningAttempt.update({ where: { id }, data: { answers: merged } });
      }
      if (!expired) {
        const snap = t.questions as unknown as SnapQuestion[];
        const given = (t.answers ?? {}) as Record<string, AnswerInput>;
        const missing = snap.filter((q) => q.required && !answered(q, given[q.id]));
        if (missing.length) {
          throw new BadRequestException({ code: 'LEARNING_ANSWERS_MISSING', message: `Answer every required question first (${missing.length} left: ${missing.map((q) => q.position).join(', ')}).`, questionIds: missing.map((q) => q.id) });
        }
      }
      t = await this.handIn(tx, c, t, m, expired);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.attempt_submitted', entityType: 'learning_attempt', entityId: id, metadata: { moduleId: m.id, number: t.number, percent: t.percent ?? null, passed: t.passed ?? null }, meta });
      return this.attemptView(tx, c, t, m, false);
    });
  }

  /** Marks what can be marked by the key; finishes the attempt, or leaves it waiting for a person. */
  private async handIn(tx: TenantTx, c: LearningCaller, t: AttemptRec, m: ModuleRec, expired: boolean): Promise<AttemptRec> {
    const snap = t.questions as unknown as SnapQuestion[];
    const given = (t.answers ?? {}) as Record<string, AnswerInput>;
    const results: Record<string, StoredResult> = {};
    for (const q of snap) {
      // A written answer left empty earns nothing; there is nothing for a person to mark.
      results[q.id] = q.manual && !answered(q, given[q.id]) ? { marks: 0, correct: false, feedback: null } : markAnswer(q, given[q.id]);
    }
    const tot = totals(snap, results);
    const a = await tx.learningAssignment.findUniqueOrThrow({ where: { id: t.assignmentId } });
    const now = new Date();
    if (tot.waiting > 0) {
      const updated = await tx.learningAttempt.update({ where: { id: t.id }, data: { status: 'AWAITING_MARKING', results: results as object, autoScore: tot.autoScore, submittedAt: now, feedback: expired ? 'Handed in automatically when the time ran out.' : null } });
      await tx.learningAssignment.update({ where: { id: a.id }, data: { status: 'AWAITING_MARKING' } });
      const markers = await this.markers(tx, c, m, a);
      const learner = (await peopleById(tx, c, [a.userId])).get(a.userId);
      await this.notifications.send(tx, c.auth.tenantId, markers, {
        type: 'learning.submitted',
        title: 'Learning answers to mark',
        body: `${learner?.name ?? 'Someone'} · ${m.title}`,
        link: `/app/learning/marking/${t.id}`,
        eventId: `learning.submitted:${t.id}`,
        senderId: a.userId,
        actionRequired: true,
      });
      return updated;
    }
    return this.finish(tx, c, t, m, a, results, expired ? 'Handed in automatically when the time ran out.' : null, null);
  }

  /** Who marks a person's written answers: the module's responsible manager, else whoever assigned it. */
  private async markers(tx: TenantTx, c: LearningCaller, m: ModuleRec, a: AssignmentRec): Promise<string[]> {
    const ids = [m.responsibleUserId, a.assignedById !== a.userId ? a.assignedById : null, m.createdById].filter((x): x is string => !!x && x !== a.userId);
    return [...new Set(ids)].slice(0, 2);
  }

  /** Final marks: pass or fail, the assignment's figures, the certificate, and the notifications. */
  private async finish(tx: TenantTx, c: LearningCaller, t: AttemptRec, m: ModuleRec, a: AssignmentRec, results: Record<string, StoredResult>, feedback: string | null, markedById: string | null): Promise<AttemptRec> {
    const snap = t.questions as unknown as SnapQuestion[];
    const tot = totals(snap, results);
    const percent = tot.percent ?? 0;
    const passed = percent >= m.passingScore;
    const now = new Date();
    const updated = await tx.learningAttempt.update({
      where: { id: t.id },
      data: { status: 'MARKED', results: results as object, autoScore: tot.autoScore, score: tot.score, percent, passed, submittedAt: t.submittedAt ?? now, feedback: feedback ?? t.feedback ?? null, ...(markedById ? { markedById, markedAt: now } : {}) },
    });
    const best = Math.max(a.bestScore ?? 0, percent);
    const allowed = attemptsAllowed(m, a);
    const fresh = await tx.learningAssignment.update({
      where: { id: a.id },
      data: {
        lastScore: percent,
        bestScore: best,
        passed: passed || a.passed === true,
        status: passed ? 'COMPLETED' : 'FAILED',
        ...(passed ? { completedAt: now, progress: 100 } : {}),
      },
    });
    const left = Math.max(0, allowed - fresh.attemptsUsed);
    const link = `/app/learning/${m.id}/attempts/${t.id}`;
    if (passed) {
      await this.notifications.send(tx, c.auth.tenantId, [a.userId], { type: 'learning.passed', title: 'You passed a learning module', body: `${m.title}: ${r1(percent)}%`, link, eventId: `learning.passed:${t.id}`, priority: 'HIGH' });
      const learner = (await peopleById(tx, c, [a.userId])).get(a.userId);
      await this.notifications.send(tx, c.auth.tenantId, (await this.markers(tx, c, m, a)).filter((u) => u !== markedById), {
        type: 'learning.completed',
        title: 'Learning module completed',
        body: `${learner?.name ?? 'Someone'} · ${m.title}: ${r1(percent)}%`,
        link: `/app/learning/manage/${m.id}?tab=people`,
        eventId: `learning.completed:${a.id}`,
        senderId: a.userId,
      });
      if (m.certificate) await this.certificates.issue(tx, fresh, m, t.id, percent);
    } else {
      await this.notifications.send(tx, c.auth.tenantId, [a.userId], {
        type: 'learning.failed',
        title: 'Learning result: not passed yet',
        body: `${m.title}: ${r1(percent)}% of ${m.passingScore}% needed. ${left > 0 ? `${left} attempt${left === 1 ? '' : 's'} left.` : 'No attempts left; ask your manager for another.'}`,
        link,
        eventId: `learning.failed:${t.id}`,
      });
    }
    if (markedById) {
      await this.notifications.send(tx, c.auth.tenantId, [a.userId], { type: 'learning.evaluated', title: 'Your answers have been marked', body: `${m.title}: ${r1(percent)}%${feedback ? ' · feedback from your manager' : ''}`, link, eventId: `learning.evaluated:${t.id}`, senderId: markedById });
    }
    return updated;
  }

  private async attemptView(tx: TenantTx, c: LearningCaller, t: AttemptRec, m: ModuleRec, marker: boolean): Promise<AttemptView> {
    const snap = t.questions as unknown as SnapQuestion[];
    const results = (t.results ?? null) as unknown as Record<string, StoredResult> | null;
    const finished = t.status === 'MARKED';
    const show = finished && (m.showAnswers || marker);
    const lessonTitles = new Map((await tx.learningLesson.findMany({ where: { tenantId: c.auth.tenantId, moduleId: m.id }, select: { id: true, title: true } })).map((l) => [l.id, l.title]));
    const improve = finished && results
      ? [...new Set(snap.filter((q) => results[q.id]?.correct === false && q.lessonId).map((q) => lessonTitles.get(q.lessonId!) ?? '').filter(Boolean))]
      : [];
    const marker2 = t.markedById ? (await peopleById(tx, c, [t.markedById])).get(t.markedById) : undefined;
    const tot = results ? totals(snap, results) : null;
    return {
      id: t.id,
      number: t.number,
      status: t.status as AttemptStatus,
      startedAt: t.startedAt.toISOString(),
      submittedAt: t.submittedAt?.toISOString() ?? null,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      answers: (t.answers ?? {}) as Record<string, AnswerInput>,
      questions: snap.map(learnerQuestion),
      score: t.score ?? null,
      autoScore: t.autoScore,
      maxScore: t.maxScore,
      percent: t.percent ?? null,
      passed: t.passed ?? null,
      results: results && t.status !== 'IN_PROGRESS' ? questionResults(snap, results, show || marker).map((r) => (finished || marker ? r : { ...r, correct: r.marks === null ? null : r.correct })) : null,
      feedback: t.feedback ?? null,
      markedBy: marker2 ? { id: marker2.userId, name: marker2.name } : null,
      markedAt: t.markedAt?.toISOString() ?? null,
      improve: tot && finished ? improve : [],
    };
  }

  // ───────────── Marking ─────────────

  marking(auth: AuthContext): Promise<MarkingRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      if (!c.manager) return [];
      const waiting = await tx.learningAttempt.findMany({ where: { tenantId: auth.tenantId, status: 'AWAITING_MARKING' }, orderBy: { submittedAt: 'asc' }, take: 500 });
      if (!waiting.length) return [];
      const modules = await tx.learningModule.findMany({ where: { AND: [{ id: { in: [...new Set(waiting.map((t) => t.moduleId))] } }, manageableModules(c)] } });
      const mById = new Map(modules.map((m) => [m.id, m]));
      const assignments = await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, id: { in: waiting.map((t) => t.assignmentId) } }, select: { id: true, workspaceNodeId: true } });
      const nodeOf = new Map(assignments.map((a) => [a.id, a.workspaceNodeId ?? null]));
      const people = await peopleById(tx, c, waiting.map((t) => t.userId));
      return waiting
        .filter((t) => mById.has(t.moduleId) && inScope(c, nodeOf.get(t.assignmentId)) && t.userId !== auth.userId)
        .map((t) => ({
          attemptId: t.id,
          moduleId: t.moduleId,
          moduleTitle: mById.get(t.moduleId)!.title,
          user: { id: t.userId, name: people.get(t.userId)?.name ?? 'Former member' },
          submittedAt: (t.submittedAt ?? t.startedAt).toISOString(),
          number: t.number,
          questions: (t.questions as unknown as SnapQuestion[]).filter((q) => q.manual).length,
          autoScore: t.autoScore,
          maxScore: t.maxScore,
        }));
    });
  }

  private async markable(tx: TenantTx, c: LearningCaller, id: string) {
    if (!c.manager) throw notFound('Attempt');
    const t = await tx.learningAttempt.findFirst({ where: { id, tenantId: c.auth.tenantId } });
    if (!t || t.userId === c.auth.userId) throw notFound('Attempt');
    const m = await tx.learningModule.findFirst({ where: { AND: [{ id: t.moduleId }, manageableModules(c)] } });
    const a = await tx.learningAssignment.findUnique({ where: { id: t.assignmentId } });
    if (!m || !a || !inScope(c, a.workspaceNodeId)) throw notFound('Attempt');
    return { t, m, a };
  }

  markingDetail(auth: AuthContext, id: string): Promise<MarkingDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const { t, m, a } = await this.markable(tx, c, id);
      const snap = t.questions as unknown as SnapQuestion[];
      const answers = (t.answers ?? {}) as Record<string, AnswerInput>;
      const fileIds = Object.values(answers).map((x) => x.fileId).filter((x): x is string => !!x);
      const files = await filesById(tx, auth.tenantId, fileIds);
      const person = (await peopleById(tx, c, [a.userId])).get(a.userId);
      return {
        attempt: await this.attemptView(tx, c, t, m, true),
        user: { id: a.userId, name: person?.name ?? 'Former member' },
        module: { id: m.id, title: m.title, passingScore: m.passingScore },
        questions: snap.map((q) =>
          questionView({
            id: q.id, tenantId: auth.tenantId, moduleId: m.id, position: q.position, type: q.type, text: q.text, instructions: q.instructions, options: q.options, correctOptionIds: q.correctOptionIds,
            correctBoolean: q.correctBoolean, blanks: q.blanks, pairs: q.pairs, acceptedAnswers: q.acceptedAnswers, rubric: q.rubric, marks: q.marks, difficulty: q.difficulty, explanation: q.explanation,
            required: q.required, lessonId: q.lessonId, source: 'MANUAL', sourceExcerpt: null, approved: true, categoryId: null, createdById: '', createdAt: new Date(), updatedAt: new Date(),
          }),
        ),
        files: Object.fromEntries([...files.values()].map((f) => [f.id, fileRef(f)])),
      };
    });
  }

  mark(auth: AuthContext, id: string, input: MarkAttemptInput, meta: RequestMeta): Promise<MarkingDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      await transactionLock(tx, `learning-submit:${id}`);
      const { t, m, a } = await this.markable(tx, c, id);
      if (t.status !== 'AWAITING_MARKING') throw new ConflictException({ code: 'LEARNING_ALREADY_MARKED', message: 'These answers have been marked already.' });
      const snap = t.questions as unknown as SnapQuestion[];
      const results = { ...((t.results ?? {}) as unknown as Record<string, StoredResult>) };
      for (const g of input.marks) {
        const q = snap.find((x) => x.id === g.questionId);
        if (!q) throw new BadRequestException({ code: 'LEARNING_QUESTION_UNKNOWN', message: 'That question is not in this attempt.' });
        if (!q.manual) continue;
        if (g.marks > q.marks) throw new BadRequestException({ code: 'LEARNING_MARKS_TOO_HIGH', message: `Question ${q.position} is worth at most ${q.marks} marks.` });
        results[q.id] = { marks: g.marks, correct: g.marks >= q.marks ? true : g.marks > 0 ? null : false, feedback: g.feedback || null };
      }
      const stillWaiting = snap.filter((q) => results[q.id]?.marks === null || results[q.id]?.marks === undefined);
      if (stillWaiting.length) throw new BadRequestException({ code: 'LEARNING_MARKS_MISSING', message: `Give marks for every written answer (${stillWaiting.map((q) => q.position).join(', ')}).` });
      // Partly right written answers count as not fully right for the improvement list.
      for (const q of snap) if (q.manual && results[q.id]!.correct === null) results[q.id] = { ...results[q.id]!, correct: false };
      await this.finish(tx, c, t, m, a, results, input.feedback || null, auth.userId);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.attempt_marked', entityType: 'learning_attempt', entityId: id, metadata: { moduleId: m.id, userId: a.userId }, meta });
      const fresh = await tx.learningAttempt.findUniqueOrThrow({ where: { id } });
      const person = (await peopleById(tx, c, [a.userId])).get(a.userId);
      return {
        attempt: await this.attemptView(tx, c, fresh, m, true),
        user: { id: a.userId, name: person?.name ?? 'Former member' },
        module: { id: m.id, title: m.title, passingScore: m.passingScore },
        questions: [],
        files: {},
      };
    });
  }

  /** An attempt of someone the caller manages, read only (results pages for managers). */
  teamAttempt(auth: AuthContext, id: string): Promise<AttemptView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const own = await tx.learningAttempt.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
      if (own) return this.attemptView(tx, c, own, await tx.learningModule.findUniqueOrThrow({ where: { id: own.moduleId } }), false);
      const { t, m } = await this.markable(tx, c, id);
      return this.attemptView(tx, c, t, m, true);
    });
  }
}
