import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type AssignmentRow,
  type CertificateRow,
  type CertificateTemplate,
  isManualQuestion,
  type LearningAssignmentStatus,
  type LearningLevel,
  type LearningMaterialType,
  type LearningModuleRow,
  type LearningModuleStatus,
  type LearningVisibility,
  type LessonKind,
  type LessonTextSource,
  type LessonTextStatus,
  type LessonView,
  learningModuleNumber,
  type QuestionDifficulty,
  type QuestionSource,
  type QuestionType,
  type QuestionView,
  type VideoInfo,
} from '@dealflow/types';
import { type LearningCaller, canEdit, type Person } from './access';
import { fileRef } from './files.service';

export type ModuleRec = Prisma.LearningModuleGetPayload<object>;
export type LessonRec = Prisma.LearningLessonGetPayload<object>;
export type QuestionRec = Prisma.LearningQuestionGetPayload<object>;
export type AssignmentRec = Prisma.LearningAssignmentGetPayload<object>;
export type CertificateRec = Prisma.LearningCertificateGetPayload<object>;
type FileRec = { id: string; name: string; contentType: string; sizeBytes: number };
type CategoryRec = { id: string; name: string; color: string };

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const avg = (list: number[]) => (list.length ? r1(list.reduce((a, b) => a + b, 0) / list.length) : null);

/** Reading speed and lesson lengths for the estimate, when the author gives none. */
const WORDS_PER_MINUTE = 200;

export function lessonMinutes(l: Pick<LessonRec, 'minutes' | 'kind' | 'video' | 'text' | 'body'>): number {
  if (l.minutes) return l.minutes;
  const video = l.video as VideoInfo | null;
  if (video?.durationSeconds) return Math.max(1, Math.round(video.durationSeconds / 60));
  const words = (l.text ?? l.body ?? '').split(/\s+/).filter(Boolean).length;
  if (words) return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return l.kind === 'VIDEO' || l.kind === 'AUDIO' ? 10 : 5;
}

export function materialType(lessons: Pick<LessonRec, 'kind'>[]): LearningMaterialType {
  if (!lessons.length) return 'NONE';
  const kinds = new Set(lessons.map((l) => (l.kind === 'SPREADSHEET' || l.kind === 'FILE' || l.kind === 'IMAGE' ? 'DOCUMENT' : l.kind)));
  if (kinds.size > 1) return 'MIXED';
  const only = [...kinds][0]!;
  return only === 'VIDEO' ? 'VIDEO' : only === 'AUDIO' ? 'AUDIO' : only === 'PRESENTATION' ? 'PRESENTATION' : only === 'TEXT' ? 'TEXT' : 'DOCUMENT';
}

/** Minutes to take the module: the author's figure, or the lessons plus about a minute a question. */
export function moduleMinutes(m: Pick<ModuleRec, 'estimatedMinutes'>, lessons: LessonRec[], questions: number): number {
  if (m.estimatedMinutes) return m.estimatedMinutes;
  return lessons.reduce((s, l) => s + lessonMinutes(l), 0) + Math.ceil(questions * 1.2);
}

export function lessonView(l: LessonRec, files: Map<string, FileRec>): LessonView {
  const file = l.fileId ? files.get(l.fileId) : undefined;
  const captions = l.captionsFileId ? files.get(l.captionsFileId) : undefined;
  return {
    id: l.id,
    position: l.position,
    title: l.title,
    kind: l.kind as LessonKind,
    body: l.body ?? null,
    video: (l.video as VideoInfo | null) ?? null,
    file: file ? fileRef(file) : null,
    captionsFile: captions ? fileRef(captions) : null,
    objectives: l.objectives,
    minutes: lessonMinutes(l),
    required: l.required,
    allowDownload: l.allowDownload,
    text: { status: l.textStatus as LessonTextStatus, source: (l.textSource as LessonTextSource | null) ?? null, chars: l.text?.length ?? 0, parts: l.textParts ?? null, note: l.textNote ?? null },
  };
}

export function questionView(q: QuestionRec): QuestionView {
  const options = (Array.isArray(q.options) ? q.options : []) as { id: string; text: string }[];
  return {
    id: q.id,
    position: q.position,
    type: q.type as QuestionType,
    text: q.text,
    instructions: q.instructions ?? null,
    options,
    correctOptionIds: q.correctOptionIds,
    correctBoolean: q.correctBoolean ?? null,
    blanks: (Array.isArray(q.blanks) ? q.blanks : []) as string[][],
    pairs: (Array.isArray(q.pairs) ? q.pairs : []) as { id: string; left: string; right: string }[],
    acceptedAnswers: q.acceptedAnswers,
    rubric: q.rubric ?? null,
    marks: q.marks,
    difficulty: q.difficulty as QuestionDifficulty,
    explanation: q.explanation ?? null,
    required: q.required,
    lessonId: q.lessonId ?? null,
    source: q.source as QuestionSource,
    sourceExcerpt: q.sourceExcerpt ?? null,
    approved: q.approved,
    manual: isManualQuestion({ type: q.type as QuestionType, acceptedAnswers: q.acceptedAnswers, options }),
  };
}

export function isOverdue(a: Pick<AssignmentRec, 'dueAt' | 'status'>, now = new Date()): boolean {
  return !!a.dueAt && a.dueAt < now && a.status !== 'COMPLETED';
}

export function attemptsAllowed(m: Pick<ModuleRec, 'maxAttempts'>, a: Pick<AssignmentRec, 'extraAttempts'>): number {
  return m.maxAttempts + a.extraAttempts;
}

export function assignmentRow(a: AssignmentRec, m: Pick<ModuleRec, 'id' | 'number' | 'title' | 'maxAttempts'>, people: Map<string, Person>): AssignmentRow {
  const p = people.get(a.userId);
  const by = people.get(a.assignedById);
  return {
    id: a.id,
    moduleId: m.id,
    moduleNumber: learningModuleNumber(m.number),
    moduleTitle: m.title,
    user: { id: a.userId, name: p?.name ?? 'Former member', workspace: p?.workspace ?? null, level: p?.level ?? 'EXECUTIVE' },
    assignedBy: by ? { id: by.userId, name: by.name } : null,
    assignedAt: a.assignedAt.toISOString(),
    dueAt: iso(a.dueAt),
    mandatory: a.mandatory,
    status: a.status as LearningAssignmentStatus,
    overdue: isOverdue(a),
    progress: a.progress,
    attemptsUsed: a.attemptsUsed,
    attemptsAllowed: attemptsAllowed(m, a),
    bestScore: a.bestScore ?? null,
    lastScore: a.lastScore ?? null,
    passed: a.passed ?? null,
    completedAt: iso(a.completedAt),
    certificateId: a.certificateId ?? null,
    minutesSpent: Math.round(a.secondsSpent / 60),
  };
}

export function certificateRow(c: CertificateRec): CertificateRow {
  return {
    id: c.id,
    number: c.number,
    code: c.code,
    recipientName: c.recipientName,
    userId: c.userId,
    moduleId: c.moduleId,
    moduleTitle: c.moduleTitle,
    category: c.category ?? null,
    score: c.score,
    completedAt: c.completedAt.toISOString(),
    issuedAt: c.issuedAt.toISOString(),
    issuerName: c.issuerName,
    signatoryName: c.signatoryName ?? null,
    signatoryTitle: c.signatoryTitle ?? null,
    template: c.template as CertificateTemplate,
    accentColor: c.accentColor,
    revoked: !!c.revokedAt,
  };
}

export async function categoriesById(tx: TenantTx, tenantId: string): Promise<Map<string, CategoryRec>> {
  const rows = await tx.learningCategory.findMany({ where: { tenantId }, select: { id: true, name: true, color: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Module rows with their lesson and question counts and the assignment figures. */
export async function moduleRows(tx: TenantTx, c: LearningCaller, modules: ModuleRec[], people: Map<string, Person>): Promise<LearningModuleRow[]> {
  if (!modules.length) return [];
  const ids = modules.map((m) => m.id);
  const [lessons, questions, assignments, categories] = await Promise.all([
    tx.learningLesson.findMany({ where: { tenantId: c.auth.tenantId, moduleId: { in: ids } } }),
    tx.learningQuestion.findMany({ where: { tenantId: c.auth.tenantId, moduleId: { in: ids } }, select: { moduleId: true, approved: true, marks: true } }),
    tx.learningAssignment.findMany({ where: { tenantId: c.auth.tenantId, moduleId: { in: ids }, removedAt: null }, select: { moduleId: true, status: true, dueAt: true, bestScore: true, workspaceNodeId: true, startedAt: true } }),
    categoriesById(tx, c.auth.tenantId),
  ]);
  const now = new Date();
  return modules.map((m) => {
    const ls = lessons.filter((l) => l.moduleId === m.id);
    const qs = questions.filter((q) => q.moduleId === m.id);
    const approved = qs.filter((q) => q.approved);
    // A manager sees the figures of their own people only.
    const as = assignments.filter((a) => a.moduleId === m.id && (c.scope === null || c.scope.has(a.workspaceNodeId ?? null)));
    const cat = m.categoryId ? categories.get(m.categoryId) : undefined;
    const creator = people.get(m.createdById);
    const responsible = m.responsibleUserId ? people.get(m.responsibleUserId) : undefined;
    const owner = m.ownerNodeId ? c.org.byId.get(m.ownerNodeId) : null;
    return {
      id: m.id,
      number: learningModuleNumber(m.number),
      title: m.title,
      category: cat ? { id: cat.id, name: cat.name, color: cat.color } : null,
      level: m.level as LearningLevel,
      materialType: materialType(ls),
      status: m.status as LearningModuleStatus,
      mandatory: m.mandatory,
      visibility: m.visibility as LearningVisibility,
      estimatedMinutes: moduleMinutes(m, ls, approved.length),
      lessons: ls.length,
      questions: approved.length,
      pendingQuestions: qs.length - approved.length,
      totalMarks: r1(approved.reduce((s, q) => s + q.marks, 0)),
      passingScore: m.passingScore,
      maxAttempts: m.maxAttempts,
      certificate: m.certificate,
      dueAt: iso(m.dueAt),
      dueInDays: m.dueInDays ?? null,
      createdBy: creator ? { id: creator.userId, name: creator.name } : null,
      responsible: responsible ? { id: responsible.userId, name: responsible.name } : null,
      ownerWorkspace: owner ? owner.node.name : 'Super Workspace',
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      publishedAt: iso(m.publishedAt),
      stats: {
        assigned: as.length,
        started: as.filter((a) => a.startedAt || a.status !== 'NOT_STARTED').length,
        completed: as.filter((a) => a.status === 'COMPLETED').length,
        failed: as.filter((a) => a.status === 'FAILED').length,
        overdue: as.filter((a) => isOverdue(a, now)).length,
        averageScore: avg(as.map((a) => a.bestScore).filter((s): s is number => typeof s === 'number')),
      },
      canEdit: canEdit(c, m),
    };
  });
}

export async function filesById(tx: TenantTx, tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, FileRec>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await tx.learningFile.findMany({ where: { tenantId, id: { in: list } }, select: { id: true, name: true, contentType: true, sizeBytes: true } });
  return new Map(rows.map((r) => [r.id, r]));
}
