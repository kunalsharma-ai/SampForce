import { LEARNING_LOGO_URL, learningBrand } from './branding';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { nextSequenceValue, type TenantTx } from '@dealflow/database';
import {
  DEFAULT_LEARNING_CATEGORIES,
  type GenerateQuestionsInput,
  type GenerateResult,
  GENERATABLE_TYPES,
  type LearningCategoryInput,
  type LearningCategoryRow,
  type LearningModuleDetail,
  type LearningModuleInput,
  type LearningModuleUpdate,
  type LearningSettingsInput,
  type LearningSettingsView,
  type LessonInput,
  type LessonUpdate,
  LESSON_KIND_LABEL,
  LESSON_TEXT_MAX_CHARS,
  MIN_TEXT_FOR_QUESTIONS,
  parseVideoUrl,
  type QuestionInput,
  type QuestionView,
  type VideoInfo,
  type CertificateTemplate,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertAuthor, assertCanEdit, assertConfigure, type LearningCaller, learningCaller, moduleForManager, openModuleReaches, peopleById, peopleInScope } from './access';
import { captionsText, extractText, type Extracted } from './content/extract';
import { lookUpVideo, videoFetcher } from './content/video';
import { LearningFilesService } from './files.service';
import { generateQuestions, type SourceText, summarise } from './generator';
import { filesById, lessonView, type ModuleRec, moduleRows, questionView } from './views';

const notFound = (what = 'Learning module') => new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });

export async function settingsOf(tx: TenantTx, tenantId: string) {
  const s = await tx.learningSettings.findUnique({ where: { tenantId } });
  if (s) return s;
  return tx.learningSettings.upsert({ where: { tenantId }, create: { tenantId, reminderDaysBefore: [3, 1] }, update: {} });
}

export async function settingsView(tx: TenantTx, tenantId: string): Promise<LearningSettingsView> {
  const s = await settingsOf(tx, tenantId);
  const { brand } = await learningBrand(tx, tenantId, LEARNING_LOGO_URL);
  return {
    // The settings' issuer name, else My Organization's brand name, else the workspace name.
    issuerName: brand.name,
    signatoryName: s.signatoryName ?? null,
    signatoryTitle: s.signatoryTitle ?? null,
    template: s.template as CertificateTemplate,
    accentColor: s.accentColor,
    useBrandColors: s.useBrandColors !== false,
    brand,
    defaultPassingScore: s.defaultPassingScore,
    defaultMaxAttempts: s.defaultMaxAttempts,
    reminderDaysBefore: s.reminderDaysBefore,
    remindOnDueDay: s.remindOnDueDay,
    overdueEveryDays: s.overdueEveryDays ?? null,
    managersCreate: s.managersCreate,
  };
}

/** Readable text of a lesson, worked out before it is saved (reading files and video captions takes time). */
interface TextOutcome {
  textStatus: 'NONE' | 'READY' | 'UNREADABLE';
  textSource: string | null;
  text: string | null;
  textParts: number | null;
  textNote: string | null;
  video?: VideoInfo | null;
}

const NO_TEXT: TextOutcome = { textStatus: 'NONE', textSource: null, text: null, textParts: null, textNote: null };

function fromExtract(e: Extracted): TextOutcome {
  return { textStatus: e.status, textSource: e.source, text: e.text?.slice(0, LESSON_TEXT_MAX_CHARS) ?? null, textParts: e.parts, textNote: e.note };
}

function transcriptOutcome(t: string): TextOutcome {
  const text = t.trim().slice(0, LESSON_TEXT_MAX_CHARS);
  const words = text.split(/\s+/).filter(Boolean).length;
  return { textStatus: 'READY', textSource: 'TRANSCRIPT', text, textParts: null, textNote: `Questions are drafted from the transcript you pasted (${words} words).` };
}

/**
 * Learning modules, lessons and questions (ADR 0097): building, reading the material, drafting questions without AI,
 * reviewing them and publishing. Every change is recorded in the module's history.
 */
@Injectable()
export class LearningModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: LearningFilesService,
    private readonly notifications: NotificationsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private fetcher() {
    return videoFetcher(this.env.LEARNING_FIXTURE_URL);
  }

  async event(tx: TenantTx, c: LearningCaller, moduleId: string, kind: string, summary: string): Promise<void> {
    await tx.learningModuleEvent.create({ data: { tenantId: c.auth.tenantId, moduleId, actorId: c.auth.userId, kind, summary: summary.slice(0, 500) } });
  }

  // ───────────── Modules ─────────────

  async detail(tx: TenantTx, c: LearningCaller, m: ModuleRec): Promise<LearningModuleDetail> {
    const [lessons, questions, history] = await Promise.all([
      tx.learningLesson.findMany({ where: { tenantId: c.auth.tenantId, moduleId: m.id }, orderBy: { position: 'asc' } }),
      tx.learningQuestion.findMany({ where: { tenantId: c.auth.tenantId, moduleId: m.id }, orderBy: { position: 'asc' } }),
      tx.learningModuleEvent.findMany({ where: { tenantId: c.auth.tenantId, moduleId: m.id }, orderBy: { at: 'desc' }, take: 100 }),
    ]);
    const people = await peopleById(tx, c, [m.createdById, m.responsibleUserId ?? '', ...history.map((h) => h.actorId ?? '')]);
    const [row] = await moduleRows(tx, c, [m], people);
    const files = await filesById(tx, c.auth.tenantId, lessons.flatMap((l) => [l.fileId, l.captionsFileId]));
    const qs = questions.map(questionView);
    return {
      ...row!,
      description: m.description ?? null,
      objectives: m.objectives,
      keyPoints: m.keyPoints,
      instructions: m.instructions ?? null,
      timeLimitMinutes: m.timeLimitMinutes ?? null,
      showAnswers: m.showAnswers,
      shuffleQuestions: m.shuffleQuestions,
      reminderDaysBefore: m.reminderDaysBefore,
      remindOnDueDay: m.remindOnDueDay,
      overdueEveryDays: m.overdueEveryDays ?? null,
      lessonList: lessons.map((l) => lessonView(l, files)),
      questionList: qs,
      history: history.map((h) => {
        const p = h.actorId ? people.get(h.actorId) : undefined;
        return { id: h.id, at: h.at.toISOString(), actor: p ? { id: p.userId, name: p.name } : null, kind: h.kind, summary: h.summary };
      }),
      aiAvailable: false,
      publishProblems: publishProblems(m, lessons, qs),
    };
  }

  get(auth: AuthContext, id: string): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      if (!c.author && !c.manager) throw notFound();
      return this.detail(tx, c, await moduleForManager(tx, c, id));
    });
  }

  create(auth: AuthContext, input: LearningModuleInput, meta: RequestMeta): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertAuthor(c);
      const s = await settingsOf(tx, auth.tenantId);
      await this.checkRefs(tx, c, input);
      const number = await nextSequenceValue(tx, `learning-module:${auth.tenantId}`);
      const m = await tx.learningModule.create({
        data: {
          tenantId: auth.tenantId,
          number,
          title: input.title,
          categoryId: input.categoryId ?? null,
          description: input.description || null,
          objectives: input.objectives ?? [],
          keyPoints: input.keyPoints ?? [],
          instructions: input.instructions || null,
          level: input.level ?? 'BEGINNER',
          estimatedMinutes: input.estimatedMinutes ?? null,
          mandatory: input.mandatory ?? true,
          visibility: input.visibility ?? 'ASSIGNED',
          passingScore: input.passingScore ?? s.defaultPassingScore,
          maxAttempts: input.maxAttempts ?? s.defaultMaxAttempts,
          timeLimitMinutes: input.timeLimitMinutes ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          dueInDays: input.dueInDays ?? null,
          certificate: input.certificate ?? true,
          showAnswers: input.showAnswers ?? true,
          shuffleQuestions: input.shuffleQuestions ?? false,
          createdById: auth.userId,
          ownerNodeId: c.nodeId,
          responsibleUserId: input.responsibleUserId ?? auth.userId,
          reminderDaysBefore: input.reminderDaysBefore ?? s.reminderDaysBefore,
          remindOnDueDay: input.remindOnDueDay ?? s.remindOnDueDay,
          overdueEveryDays: input.overdueEveryDays !== undefined ? input.overdueEveryDays : (s.overdueEveryDays ?? null),
        },
      });
      await this.event(tx, c, m.id, 'created', `Created “${m.title}”.`);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.module_created', entityType: 'learning_module', entityId: m.id, metadata: { title: m.title }, meta });
      return this.detail(tx, c, m);
    });
  }

  private async checkRefs(tx: TenantTx, c: LearningCaller, input: Pick<LearningModuleInput, 'categoryId' | 'responsibleUserId'>): Promise<void> {
    if (input.categoryId) {
      const cat = await tx.learningCategory.findFirst({ where: { id: input.categoryId, tenantId: c.auth.tenantId, archivedAt: null } });
      if (!cat) throw new BadRequestException({ code: 'LEARNING_CATEGORY_UNKNOWN', message: 'That category does not exist.' });
    }
    if (input.responsibleUserId && input.responsibleUserId !== c.auth.userId) {
      const people = await peopleInScope(tx, c);
      const p = people.find((x) => x.userId === input.responsibleUserId);
      if (!p || p.level === 'EXECUTIVE') throw new BadRequestException({ code: 'LEARNING_RESPONSIBLE_INVALID', message: 'The responsible manager must be someone in a Super or Manager Workspace you manage.' });
    }
  }

  update(auth: AuthContext, id: string, input: LearningModuleUpdate, meta: RequestMeta): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, id);
      assertCanEdit(c, m);
      await this.checkRefs(tx, c, input);
      const data: Record<string, unknown> = {};
      const changed: string[] = [];
      const set = (key: string, value: unknown, label: string) => {
        data[key] = value;
        changed.push(label);
      };
      if (input.title !== undefined) set('title', input.title, 'title');
      if (input.categoryId !== undefined) set('categoryId', input.categoryId, 'category');
      if (input.description !== undefined) set('description', input.description || null, 'description');
      if (input.objectives !== undefined) set('objectives', input.objectives, 'objectives');
      if (input.keyPoints !== undefined) set('keyPoints', input.keyPoints, 'key learning points');
      if (input.instructions !== undefined) set('instructions', input.instructions || null, 'instructions');
      if (input.level !== undefined) set('level', input.level, 'level');
      if (input.estimatedMinutes !== undefined) set('estimatedMinutes', input.estimatedMinutes, 'estimated duration');
      if (input.mandatory !== undefined) set('mandatory', input.mandatory, 'mandatory');
      if (input.visibility !== undefined) set('visibility', input.visibility, 'who can find it');
      if (input.passingScore !== undefined) set('passingScore', input.passingScore, `passing score (${input.passingScore}%)`);
      if (input.maxAttempts !== undefined) set('maxAttempts', input.maxAttempts, `attempts (${input.maxAttempts})`);
      if (input.timeLimitMinutes !== undefined) set('timeLimitMinutes', input.timeLimitMinutes, 'time limit');
      if (input.dueAt !== undefined) set('dueAt', input.dueAt ? new Date(input.dueAt) : null, 'deadline');
      if (input.dueInDays !== undefined) set('dueInDays', input.dueInDays, 'deadline');
      if (input.certificate !== undefined) set('certificate', input.certificate, 'certificate');
      if (input.showAnswers !== undefined) set('showAnswers', input.showAnswers, 'answers on the result page');
      if (input.shuffleQuestions !== undefined) set('shuffleQuestions', input.shuffleQuestions, 'question order');
      if (input.responsibleUserId !== undefined) set('responsibleUserId', input.responsibleUserId, 'responsible manager');
      if (input.reminderDaysBefore !== undefined) set('reminderDaysBefore', input.reminderDaysBefore, 'reminders');
      if (input.remindOnDueDay !== undefined) set('remindOnDueDay', input.remindOnDueDay, 'reminders');
      if (input.overdueEveryDays !== undefined) set('overdueEveryDays', input.overdueEveryDays, 'reminders');
      const updated = await tx.learningModule.update({ where: { id }, data });
      await this.event(tx, c, id, 'edited', `Changed ${[...new Set(changed)].join(', ')}.`);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.module_updated', entityType: 'learning_module', entityId: id, metadata: { changed }, meta });
      return this.detail(tx, c, updated);
    });
  }

  publish(auth: AuthContext, id: string, meta: RequestMeta): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, id);
      assertCanEdit(c, m);
      if (m.status === 'PUBLISHED') return this.detail(tx, c, m);
      const current = await this.detail(tx, c, m);
      if (current.publishProblems.length) {
        throw new BadRequestException({ code: 'LEARNING_NOT_READY', message: `Not ready to publish: ${current.publishProblems.join(' ')}` });
      }
      const updated = await tx.learningModule.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: m.publishedAt ?? new Date() } });
      await this.event(tx, c, id, 'published', m.status === 'ARCHIVED' ? 'Brought back from the archive and published.' : 'Published.');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.module_published', entityType: 'learning_module', entityId: id, metadata: { title: m.title }, meta });
      if (updated.visibility === 'OPEN') {
        // Everyone the module reaches hears it is there to explore.
        const people = await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, select: { userId: true, workspaceNodeId: true }, take: 5000 });
        const reach = people.filter((p) => p.userId !== auth.userId && openModuleReaches(c.org, updated.ownerNodeId, p.workspaceNodeId ?? null)).map((p) => p.userId);
        await this.notifications.send(tx, auth.tenantId, reach, {
          type: 'learning.published',
          title: 'New learning module published',
          body: updated.title,
          link: `/app/learning/${id}`,
          eventId: `learning.published:${id}`,
          senderId: auth.userId,
        });
      }
      return this.detail(tx, c, updated);
    });
  }

  archive(auth: AuthContext, id: string, meta: RequestMeta): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, id);
      assertCanEdit(c, m);
      const updated = await tx.learningModule.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.event(tx, c, id, 'archived', 'Archived: no new assignments; past results and certificates stay.');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.module_archived', entityType: 'learning_module', entityId: id, metadata: { title: m.title }, meta });
      return this.detail(tx, c, updated);
    });
  }

  /** Deletes a draft nobody was ever assigned. Anything with learning history is archived instead. */
  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, id);
      assertCanEdit(c, m);
      const used = await tx.learningAssignment.count({ where: { tenantId: auth.tenantId, moduleId: id } });
      if (m.status !== 'DRAFT' || used > 0) throw new ConflictException({ code: 'LEARNING_MODULE_IN_USE', message: 'This module has learning history. Archive it instead, so results and certificates are kept.' });
      await tx.learningQuestion.deleteMany({ where: { tenantId: auth.tenantId, moduleId: id } });
      await tx.learningLesson.deleteMany({ where: { tenantId: auth.tenantId, moduleId: id } });
      await tx.learningModuleEvent.deleteMany({ where: { tenantId: auth.tenantId, moduleId: id } });
      await tx.learningModule.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.module_deleted', entityType: 'learning_module', entityId: id, metadata: { title: m.title }, meta });
    });
  }

  // ───────────── Video links ─────────────

  async inspectVideo(auth: AuthContext, url: string): Promise<VideoInfo> {
    await this.prisma.run(auth, async (tx) => assertAuthor(await learningCaller(tx, auth)));
    if (!parseVideoUrl(url)) {
      throw new BadRequestException({ code: 'LEARNING_VIDEO_UNSUPPORTED', message: 'That link is not a video SampForce can play. Use a YouTube, Vimeo, Loom, Wistia or Dailymotion link, or a link to an .mp4 or .webm file.' });
    }
    const found = await lookUpVideo(url, this.fetcher());
    return found!.info;
  }

  // ───────────── Lessons ─────────────

  /** Works out a lesson's readable text from what it will hold. Runs outside any transaction. */
  private async readText(auth: AuthContext, l: { kind: string; body: string | null; videoUrl: string | null; fileId: string | null; captionsFileId: string | null; transcript: string | null }, prior?: { videoUrl: string | null; video: unknown; fileId: string | null; captionsFileId: string | null; transcript: string | null; text: string | null; textSource: string | null; textStatus: string; textParts: number | null; textNote: string | null }): Promise<TextOutcome> {
    if (l.kind === 'TEXT') {
      const body = (l.body ?? '').trim();
      return body ? { textStatus: 'READY', textSource: 'WRITTEN', text: body.slice(0, LESSON_TEXT_MAX_CHARS), textParts: null, textNote: null } : NO_TEXT;
    }
    if (l.transcript?.trim()) {
      const out = transcriptOutcome(l.transcript);
      if (l.kind === 'VIDEO' && l.videoUrl) out.video = prior && prior.videoUrl === l.videoUrl ? (prior.video as VideoInfo) : (await lookUpVideo(l.videoUrl, this.fetcher()))?.info ?? null;
      return out;
    }
    const same = prior && prior.videoUrl === l.videoUrl && prior.fileId === l.fileId && prior.captionsFileId === l.captionsFileId && !prior.transcript;
    if (same && prior.textStatus !== 'NONE') {
      return { textStatus: prior.textStatus as TextOutcome['textStatus'], textSource: prior.textSource, text: prior.text, textParts: prior.textParts, textNote: prior.textNote, video: prior.video as VideoInfo | null };
    }
    if (l.kind === 'VIDEO' && l.videoUrl && !l.fileId) {
      const found = await lookUpVideo(l.videoUrl, this.fetcher());
      if (!found) throw new BadRequestException({ code: 'LEARNING_VIDEO_UNSUPPORTED', message: 'That link is not a video SampForce can play. Use a YouTube, Vimeo, Loom, Wistia or Dailymotion link, or a link to an .mp4 or .webm file.' });
      if (found.captions && found.captions.length >= 40) {
        const words = found.captions.split(/\s+/).length;
        return { textStatus: 'READY', textSource: 'CAPTIONS', text: found.captions.slice(0, LESSON_TEXT_MAX_CHARS), textParts: null, textNote: `Read the video’s captions (${words} words).`, video: found.info };
      }
      return { textStatus: 'UNREADABLE', textSource: null, text: null, textParts: null, textNote: found.info.note ?? 'SampForce could not read captions for this video, so no questions can be drafted from it yet. Paste the transcript or your notes, or write the questions yourself.', video: found.info };
    }
    if (l.captionsFileId) {
      const raw = await this.prisma.run(auth, (tx) => this.files.readWhole(tx, auth.tenantId, l.captionsFileId!));
      const text = captionsText(raw.toString('utf8'));
      if (text.length >= 40) return { textStatus: 'READY', textSource: 'CAPTIONS', text: text.slice(0, LESSON_TEXT_MAX_CHARS), textParts: null, textNote: `Read the captions file (${text.split(/\s+/).length} words).` };
    }
    if (l.fileId) {
      const meta = await this.prisma.run(auth, (tx) => tx.learningFile.findFirst({ where: { id: l.fileId!, tenantId: auth.tenantId } }));
      if (!meta) return NO_TEXT;
      if (/^(video|audio)\//.test(meta.contentType)) {
        return { textStatus: 'UNREADABLE', textSource: null, text: null, textParts: null, textNote: 'SampForce cannot hear what is said in a video or audio file. Upload its captions (.vtt or .srt), paste the transcript, or write the questions yourself.' };
      }
      const data = await this.prisma.run(auth, (tx) => this.files.readWhole(tx, auth.tenantId, l.fileId!));
      return fromExtract(await extractText(data, meta.contentType, meta.name));
    }
    return NO_TEXT;
  }

  private async lessonFiles(tx: TenantTx, c: LearningCaller, ids: (string | null | undefined)[]): Promise<void> {
    for (const id of ids) {
      if (!id) continue;
      const f = await tx.learningFile.findFirst({ where: { id, tenantId: c.auth.tenantId, completedAt: { not: null }, attemptId: null } });
      if (!f) throw new BadRequestException({ code: 'LEARNING_FILE_UNKNOWN', message: 'That file has not finished uploading.' });
    }
  }

  private checkLesson(l: { kind: string; videoUrl: string | null; fileId: string | null; body: string | null }): void {
    if (l.kind === 'VIDEO' && !l.videoUrl && !l.fileId) throw new BadRequestException({ code: 'LEARNING_LESSON_EMPTY', message: 'Paste the video link or upload the video.' });
    if (l.kind === 'TEXT' && !l.body?.trim()) throw new BadRequestException({ code: 'LEARNING_LESSON_EMPTY', message: 'Write the lesson text.' });
    if (l.kind !== 'VIDEO' && l.kind !== 'TEXT' && !l.fileId) throw new BadRequestException({ code: 'LEARNING_LESSON_EMPTY', message: 'Upload the file for this lesson.' });
  }

  async addLesson(auth: AuthContext, moduleId: string, input: LessonInput): Promise<LearningModuleDetail> {
    await this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertCanEdit(c, await moduleForManager(tx, c, moduleId));
      await this.lessonFiles(tx, c, [input.fileId, input.captionsFileId]);
    });
    const l = { kind: input.kind, body: input.body ?? null, videoUrl: input.videoUrl ?? null, fileId: input.fileId ?? null, captionsFileId: input.captionsFileId ?? null, transcript: input.transcript ?? null };
    this.checkLesson(l);
    const text = await this.readText(auth, l);
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const last = await tx.learningLesson.findFirst({ where: { tenantId: auth.tenantId, moduleId }, orderBy: { position: 'desc' }, select: { position: true } });
      const { video, ...t } = text;
      await tx.learningLesson.create({
        data: {
          tenantId: auth.tenantId,
          moduleId,
          position: (last?.position ?? 0) + 1,
          title: input.title,
          kind: input.kind,
          body: l.body,
          videoUrl: l.videoUrl,
          video: (video ?? undefined) as object | undefined,
          fileId: l.fileId,
          captionsFileId: l.captionsFileId,
          transcript: l.transcript,
          objectives: input.objectives ?? [],
          minutes: input.minutes ?? null,
          required: input.required ?? true,
          allowDownload: input.allowDownload ?? true,
          ...t,
        },
      });
      await this.event(tx, c, moduleId, 'lesson_added', `Added the ${LESSON_KIND_LABEL[input.kind].toLowerCase()} lesson “${input.title}”.`);
      await tx.learningModule.update({ where: { id: moduleId }, data: { updatedAt: new Date() } });
      return this.detail(tx, c, m);
    });
  }

  async updateLesson(auth: AuthContext, moduleId: string, lessonId: string, input: LessonUpdate): Promise<LearningModuleDetail> {
    const prior = await this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertCanEdit(c, await moduleForManager(tx, c, moduleId));
      await this.lessonFiles(tx, c, [input.fileId, input.captionsFileId]);
      const l = await tx.learningLesson.findFirst({ where: { id: lessonId, tenantId: auth.tenantId, moduleId } });
      if (!l) throw notFound('Lesson');
      return l;
    });
    const next = {
      kind: input.kind ?? prior.kind,
      body: input.body !== undefined ? input.body : prior.body,
      videoUrl: input.videoUrl !== undefined ? input.videoUrl : prior.videoUrl,
      fileId: input.fileId !== undefined ? input.fileId : prior.fileId,
      captionsFileId: input.captionsFileId !== undefined ? input.captionsFileId : prior.captionsFileId,
      transcript: input.transcript !== undefined ? input.transcript : prior.transcript,
    };
    this.checkLesson(next);
    const text = await this.readText(auth, next, prior);
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      const { video, ...t } = text;
      await tx.learningLesson.update({
        where: { id: lessonId },
        data: {
          ...next,
          video: (video ?? null) as object | undefined,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.objectives !== undefined ? { objectives: input.objectives } : {}),
          ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
          ...(input.required !== undefined ? { required: input.required } : {}),
          ...(input.allowDownload !== undefined ? { allowDownload: input.allowDownload } : {}),
          ...t,
        },
      });
      await this.event(tx, c, moduleId, 'lesson_edited', `Changed the lesson “${input.title ?? prior.title}”.`);
      await tx.learningModule.update({ where: { id: moduleId }, data: { updatedAt: new Date() } });
      return this.detail(tx, c, m);
    });
  }

  removeLesson(auth: AuthContext, moduleId: string, lessonId: string): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const l = await tx.learningLesson.findFirst({ where: { id: lessonId, tenantId: auth.tenantId, moduleId } });
      if (!l) throw notFound('Lesson');
      await tx.learningLesson.delete({ where: { id: lessonId } });
      await tx.learningQuestion.updateMany({ where: { tenantId: auth.tenantId, moduleId, lessonId }, data: { lessonId: null } });
      await this.renumber(tx, auth.tenantId, moduleId, 'lesson');
      await this.event(tx, c, moduleId, 'lesson_removed', `Removed the lesson “${l.title}”.`);
      return this.detail(tx, c, m);
    });
  }

  reorderLessons(auth: AuthContext, moduleId: string, ids: string[]): Promise<LearningModuleDetail> {
    return this.reorder(auth, moduleId, ids, 'lesson');
  }

  reorderQuestions(auth: AuthContext, moduleId: string, ids: string[]): Promise<LearningModuleDetail> {
    return this.reorder(auth, moduleId, ids, 'question');
  }

  private reorder(auth: AuthContext, moduleId: string, ids: string[], what: 'lesson' | 'question'): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const rows = what === 'lesson'
        ? await tx.learningLesson.findMany({ where: { tenantId: auth.tenantId, moduleId }, select: { id: true } })
        : await tx.learningQuestion.findMany({ where: { tenantId: auth.tenantId, moduleId }, select: { id: true } });
      const known = new Set(rows.map((r) => r.id));
      if (ids.length !== known.size || !ids.every((id) => known.has(id))) throw new BadRequestException({ code: 'LEARNING_REORDER_MISMATCH', message: 'The list changed while you were reordering. Reload and try again.' });
      for (const [i, id] of ids.entries()) {
        if (what === 'lesson') await tx.learningLesson.update({ where: { id }, data: { position: i + 1 } });
        else await tx.learningQuestion.update({ where: { id }, data: { position: i + 1 } });
      }
      await this.event(tx, c, moduleId, `${what}s_reordered`, what === 'lesson' ? 'Changed the order of the lessons.' : 'Changed the order of the questions.');
      return this.detail(tx, c, m);
    });
  }

  private async renumber(tx: TenantTx, tenantId: string, moduleId: string, what: 'lesson' | 'question'): Promise<void> {
    const rows = what === 'lesson'
      ? await tx.learningLesson.findMany({ where: { tenantId, moduleId }, orderBy: { position: 'asc' }, select: { id: true, position: true } })
      : await tx.learningQuestion.findMany({ where: { tenantId, moduleId }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
    for (const [i, r] of rows.entries()) {
      if (r.position === i + 1) continue;
      if (what === 'lesson') await tx.learningLesson.update({ where: { id: r.id }, data: { position: i + 1 } });
      else await tx.learningQuestion.update({ where: { id: r.id }, data: { position: i + 1 } });
    }
  }

  // ───────────── Questions ─────────────

  private questionData(input: QuestionInput) {
    const keepOptions = input.type === 'MCQ' || input.type === 'MULTI' || input.type === 'SCENARIO';
    return {
      type: input.type,
      text: input.text,
      instructions: input.instructions || null,
      options: keepOptions ? (input.options ?? []) : [],
      correctOptionIds: keepOptions ? (input.correctOptionIds ?? []).filter((id) => (input.options ?? []).some((o) => o.id === id)) : [],
      correctBoolean: input.type === 'TRUE_FALSE' ? (input.correctBoolean ?? null) : null,
      blanks: input.type === 'FILL_BLANK' ? (input.blanks ?? []) : [],
      pairs: input.type === 'MATCHING' ? (input.pairs ?? []) : [],
      acceptedAnswers: input.type === 'SHORT' ? (input.acceptedAnswers ?? []) : [],
      rubric: input.rubric || null,
      marks: input.marks ?? 1,
      difficulty: input.difficulty ?? 'MEDIUM',
      explanation: input.explanation || null,
      required: input.required ?? true,
      lessonId: input.lessonId ?? null,
    };
  }

  addQuestion(auth: AuthContext, moduleId: string, input: QuestionInput): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      await this.checkLessonRef(tx, auth.tenantId, moduleId, input.lessonId);
      const last = await tx.learningQuestion.findFirst({ where: { tenantId: auth.tenantId, moduleId }, orderBy: { position: 'desc' }, select: { position: true } });
      await tx.learningQuestion.create({ data: { tenantId: auth.tenantId, moduleId, position: (last?.position ?? 0) + 1, ...this.questionData(input), source: 'MANUAL', approved: true, createdById: auth.userId } });
      await this.event(tx, c, moduleId, 'question_added', `Added a question: “${input.text.slice(0, 80)}”.`);
      await tx.learningModule.update({ where: { id: moduleId }, data: { updatedAt: new Date() } });
      return this.detail(tx, c, m);
    });
  }

  updateQuestion(auth: AuthContext, moduleId: string, questionId: string, input: QuestionInput): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const q = await tx.learningQuestion.findFirst({ where: { id: questionId, tenantId: auth.tenantId, moduleId } });
      if (!q) throw notFound('Question');
      await this.checkLessonRef(tx, auth.tenantId, moduleId, input.lessonId);
      await tx.learningQuestion.update({ where: { id: questionId }, data: this.questionData(input) });
      await this.event(tx, c, moduleId, 'question_edited', `Changed question ${q.position}.`);
      return this.detail(tx, c, m);
    });
  }

  removeQuestion(auth: AuthContext, moduleId: string, questionId: string): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const q = await tx.learningQuestion.findFirst({ where: { id: questionId, tenantId: auth.tenantId, moduleId } });
      if (!q) throw notFound('Question');
      await tx.learningQuestion.delete({ where: { id: questionId } });
      await this.renumber(tx, auth.tenantId, moduleId, 'question');
      await this.event(tx, c, moduleId, 'question_removed', `Removed a question: “${q.text.slice(0, 80)}”.`);
      return this.detail(tx, c, m);
    });
  }

  /** Approves drafted questions into the assessment, or removes them. */
  review(auth: AuthContext, moduleId: string, ids: string[], approve: boolean): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const where = { tenantId: auth.tenantId, moduleId, id: { in: ids } };
      const n = approve ? (await tx.learningQuestion.updateMany({ where, data: { approved: true } })).count : (await tx.learningQuestion.deleteMany({ where })).count;
      if (!approve) await this.renumber(tx, auth.tenantId, moduleId, 'question');
      await this.event(tx, c, moduleId, approve ? 'questions_approved' : 'questions_rejected', approve ? `Approved ${n} drafted question${n === 1 ? '' : 's'}.` : `Removed ${n} drafted question${n === 1 ? '' : 's'}.`);
      return this.detail(tx, c, m);
    });
  }

  private async checkLessonRef(tx: TenantTx, tenantId: string, moduleId: string, lessonId: string | null | undefined): Promise<void> {
    if (!lessonId) return;
    const l = await tx.learningLesson.findFirst({ where: { id: lessonId, tenantId, moduleId }, select: { id: true } });
    if (!l) throw new BadRequestException({ code: 'LEARNING_LESSON_UNKNOWN', message: 'That lesson is not in this module.' });
  }

  /** Drafts questions from the lessons' readable text, without AI. They wait for review before they count. */
  generate(auth: AuthContext, moduleId: string, input: GenerateQuestionsInput): Promise<GenerateResult & { module: LearningModuleDetail }> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const lessons = await tx.learningLesson.findMany({ where: { tenantId: auth.tenantId, moduleId, ...(input.lessonIds?.length ? { id: { in: input.lessonIds } } : {}) }, orderBy: { position: 'asc' } });
      const skipped: GenerateResult['skipped'] = [];
      const sources: SourceText[] = [];
      for (const l of lessons) {
        if (l.textStatus === 'READY' && (l.text?.length ?? 0) >= MIN_TEXT_FOR_QUESTIONS) sources.push({ lessonId: l.id, title: l.title, text: l.text! });
        else if (l.textStatus === 'READY') skipped.push({ lessonId: l.id, title: l.title, reason: 'There is too little text in this lesson to draft questions from.' });
        else if (l.textStatus === 'UNREADABLE') skipped.push({ lessonId: l.id, title: l.title, reason: l.textNote ?? 'SampForce could not read this lesson.' });
        else skipped.push({ lessonId: l.id, title: l.title, reason: 'This lesson has no text SampForce can read.' });
      }
      if (!sources.length) {
        throw new BadRequestException({
          code: 'LEARNING_NOTHING_TO_READ',
          message: 'No lesson has text SampForce could read, so no questions were drafted. Add a written lesson, a document, a video with captions or a pasted transcript, or write the questions yourself.',
        });
      }
      const existing = await tx.learningQuestion.findMany({ where: { tenantId: auth.tenantId, moduleId }, select: { sourceExcerpt: true, text: true, position: true }, orderBy: { position: 'desc' } });
      const count = input.count ?? 10;
      const { questions, shortBy } = generateQuestions(sources, {
        types: input.types ?? GENERATABLE_TYPES,
        count,
        variant: input.variant ?? existing.length,
        difficulty: input.difficulty,
        existing: existing.map((q) => q.sourceExcerpt ?? q.text),
      });
      let position = existing[0]?.position ?? 0;
      const created: QuestionView[] = [];
      for (const q of questions) {
        const row = await tx.learningQuestion.create({
          data: {
            tenantId: auth.tenantId,
            moduleId,
            position: ++position,
            type: q.type,
            text: q.text,
            instructions: q.instructions,
            options: q.options,
            correctOptionIds: q.correctOptionIds,
            correctBoolean: q.correctBoolean,
            blanks: q.blanks,
            pairs: q.pairs,
            acceptedAnswers: [],
            marks: q.marks,
            difficulty: q.difficulty,
            explanation: q.explanation,
            required: true,
            lessonId: q.lessonId,
            source: 'GENERATED',
            sourceExcerpt: q.sourceExcerpt,
            approved: false,
            createdById: auth.userId,
          },
        });
        created.push(questionView(row));
      }
      let summaryFilled = false;
      if (input.fillSummary) {
        const s = summarise(sources);
        const data: Record<string, unknown> = {};
        if (!m.keyPoints.length && s.keyPoints.length) data.keyPoints = s.keyPoints;
        if (!m.objectives.length && s.objectives.length) data.objectives = s.objectives;
        if (Object.keys(data).length) {
          await tx.learningModule.update({ where: { id: moduleId }, data });
          summaryFilled = true;
        }
      }
      await this.event(tx, c, moduleId, 'questions_drafted', `Drafted ${created.length} question${created.length === 1 ? '' : 's'} from ${sources.length} lesson${sources.length === 1 ? '' : 's'} (no AI); waiting for review.`);
      const note = shortBy > 0 ? `${created.length} of ${count} questions were drafted: the material does not have enough distinct facts for more of the chosen types. Add more material, choose other types, or write the rest yourself.` : null;
      const fresh = await tx.learningModule.findUniqueOrThrow({ where: { id: moduleId } });
      return { created, skipped, note, summaryFilled, module: await this.detail(tx, c, fresh) };
    });
  }

  // ───────────── Question bank ─────────────

  bank(auth: AuthContext, categoryId?: string): Promise<QuestionView[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertAuthor(c);
      const rows = await tx.learningQuestion.findMany({ where: { tenantId: auth.tenantId, moduleId: null, ...(categoryId ? { categoryId } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
      return rows.map(questionView);
    });
  }

  /** Keeps copies of a module's questions in the organisation's question bank, to reuse in other modules. */
  saveToBank(auth: AuthContext, moduleId: string, ids: string[]): Promise<{ saved: number }> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertAuthor(c);
      const rows = await tx.learningQuestion.findMany({ where: { tenantId: auth.tenantId, moduleId, id: { in: ids }, approved: true } });
      for (const q of rows) {
        const { id: _id, createdAt: _c, updatedAt: _u, moduleId: _m, lessonId: _l, ...rest } = q;
        await tx.learningQuestion.create({ data: { ...rest, options: rest.options as object, blanks: rest.blanks as object, pairs: rest.pairs as object, moduleId: null, lessonId: null, position: 0, categoryId: m.categoryId, source: 'BANK', approved: true, createdById: auth.userId } });
      }
      return { saved: rows.length };
    });
  }

  copyFromBank(auth: AuthContext, moduleId: string, ids: string[]): Promise<LearningModuleDetail> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const m = await moduleForManager(tx, c, moduleId);
      assertCanEdit(c, m);
      const rows = await tx.learningQuestion.findMany({ where: { tenantId: auth.tenantId, moduleId: null, id: { in: ids } } });
      const last = await tx.learningQuestion.findFirst({ where: { tenantId: auth.tenantId, moduleId }, orderBy: { position: 'desc' }, select: { position: true } });
      let position = last?.position ?? 0;
      for (const q of rows) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = q;
        await tx.learningQuestion.create({ data: { ...rest, options: rest.options as object, blanks: rest.blanks as object, pairs: rest.pairs as object, moduleId, position: ++position, source: 'BANK', approved: true, createdById: auth.userId } });
      }
      await this.event(tx, c, moduleId, 'questions_from_bank', `Added ${rows.length} question${rows.length === 1 ? '' : 's'} from the question bank.`);
      return this.detail(tx, c, m);
    });
  }

  removeFromBank(auth: AuthContext, id: string): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertAuthor(c);
      const q = await tx.learningQuestion.findFirst({ where: { id, tenantId: auth.tenantId, moduleId: null } });
      if (!q) throw notFound('Question');
      if (c.level !== 'SUPER' && q.createdById !== auth.userId) throw notFound('Question');
      await tx.learningQuestion.delete({ where: { id } });
    });
  }

  // ───────────── Categories and settings ─────────────

  async ensureCategories(tx: TenantTx, tenantId: string): Promise<void> {
    const any = await tx.learningCategory.findFirst({ where: { tenantId }, select: { id: true } });
    if (any) return;
    const palette = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#db2777', '#ea580c', '#dc2626', '#ca8a04', '#4f46e5'];
    for (const [i, name] of DEFAULT_LEARNING_CATEGORIES.entries()) {
      await tx.learningCategory.upsert({ where: { tenantId_nameKey: { tenantId, nameKey: name.toLowerCase() } }, create: { tenantId, name, nameKey: name.toLowerCase(), color: palette[i % palette.length]! }, update: {} });
    }
  }

  categories(auth: AuthContext): Promise<LearningCategoryRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await learningCaller(tx, auth);
      await this.ensureCategories(tx, auth.tenantId);
      const [rows, modules] = await Promise.all([
        tx.learningCategory.findMany({ where: { tenantId: auth.tenantId, archivedAt: null }, orderBy: { name: 'asc' } }),
        tx.learningModule.findMany({ where: { tenantId: auth.tenantId }, select: { categoryId: true } }),
      ]);
      return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, modules: modules.filter((m) => m.categoryId === r.id).length }));
    });
  }

  addCategory(auth: AuthContext, input: LearningCategoryInput): Promise<LearningCategoryRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertConfigure(c);
      const nameKey = input.name.trim().toLowerCase();
      const existing = await tx.learningCategory.findFirst({ where: { tenantId: auth.tenantId, nameKey } });
      if (existing && !existing.archivedAt) throw new ConflictException({ code: 'LEARNING_CATEGORY_EXISTS', message: 'There is already a category with that name.' });
      if (existing) await tx.learningCategory.update({ where: { id: existing.id }, data: { archivedAt: null, name: input.name, ...(input.color ? { color: input.color } : {}) } });
      else await tx.learningCategory.create({ data: { tenantId: auth.tenantId, name: input.name, nameKey, color: input.color ?? '#2563eb' } });
      return this.categoriesIn(tx, auth.tenantId);
    });
  }

  updateCategory(auth: AuthContext, id: string, input: LearningCategoryInput): Promise<LearningCategoryRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertConfigure(c);
      const cat = await tx.learningCategory.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!cat) throw notFound('Category');
      const nameKey = input.name.trim().toLowerCase();
      const clash = await tx.learningCategory.findFirst({ where: { tenantId: auth.tenantId, nameKey, id: { not: id } } });
      if (clash) throw new ConflictException({ code: 'LEARNING_CATEGORY_EXISTS', message: 'There is already a category with that name.' });
      await tx.learningCategory.update({ where: { id }, data: { name: input.name, nameKey, ...(input.color ? { color: input.color } : {}) } });
      return this.categoriesIn(tx, auth.tenantId);
    });
  }

  removeCategory(auth: AuthContext, id: string): Promise<LearningCategoryRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertConfigure(c);
      const cat = await tx.learningCategory.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!cat) throw notFound('Category');
      // Kept for the modules and certificates that use it; it is only no longer offered.
      await tx.learningCategory.update({ where: { id }, data: { archivedAt: new Date() } });
      return this.categoriesIn(tx, auth.tenantId);
    });
  }

  private async categoriesIn(tx: TenantTx, tenantId: string): Promise<LearningCategoryRow[]> {
    const [rows, modules] = await Promise.all([
      tx.learningCategory.findMany({ where: { tenantId, archivedAt: null }, orderBy: { name: 'asc' } }),
      tx.learningModule.findMany({ where: { tenantId }, select: { categoryId: true } }),
    ]);
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, modules: modules.filter((m) => m.categoryId === r.id).length }));
  }

  settings(auth: AuthContext): Promise<LearningSettingsView> {
    return this.prisma.run(auth, async (tx) => {
      await learningCaller(tx, auth);
      return settingsView(tx, auth.tenantId);
    });
  }

  saveSettings(auth: AuthContext, input: LearningSettingsInput, meta: RequestMeta): Promise<LearningSettingsView> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertConfigure(c);
      await settingsOf(tx, auth.tenantId);
      await tx.learningSettings.update({
        where: { tenantId: auth.tenantId },
        data: {
          ...(input.issuerName !== undefined ? { issuerName: input.issuerName } : {}),
          ...(input.signatoryName !== undefined ? { signatoryName: input.signatoryName || null } : {}),
          ...(input.signatoryTitle !== undefined ? { signatoryTitle: input.signatoryTitle || null } : {}),
          ...(input.template !== undefined ? { template: input.template } : {}),
          ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
          ...(input.useBrandColors !== undefined ? { useBrandColors: input.useBrandColors } : {}),
          ...(input.defaultPassingScore !== undefined ? { defaultPassingScore: input.defaultPassingScore } : {}),
          ...(input.defaultMaxAttempts !== undefined ? { defaultMaxAttempts: input.defaultMaxAttempts } : {}),
          ...(input.reminderDaysBefore !== undefined ? { reminderDaysBefore: input.reminderDaysBefore } : {}),
          ...(input.remindOnDueDay !== undefined ? { remindOnDueDay: input.remindOnDueDay } : {}),
          ...(input.overdueEveryDays !== undefined ? { overdueEveryDays: input.overdueEveryDays } : {}),
          ...(input.managersCreate !== undefined ? { managersCreate: input.managersCreate } : {}),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'learning.settings_updated', entityType: 'learning_settings', entityId: auth.tenantId, metadata: { changed: Object.keys(input) }, meta });
      return settingsView(tx, auth.tenantId);
    });
  }
}

/** What is still missing before a module can be published. */
export function publishProblems(m: Pick<ModuleRec, 'title'>, lessons: { kind: string; videoUrl: string | null; fileId: string | null; body: string | null; title: string }[], questions: QuestionView[]): string[] {
  const out: string[] = [];
  if (!lessons.length) out.push('Add at least one lesson.');
  const approved = questions.filter((q) => q.approved);
  if (!approved.length) out.push('Add at least one question to the assessment (or approve drafted ones).');
  const waiting = questions.length - approved.length;
  if (waiting > 0) out.push(`Review the drafted questions (${waiting}): approve or remove each one.`);
  for (const l of lessons) {
    if (l.kind === 'VIDEO' && !l.videoUrl && !l.fileId) out.push(`The lesson “${l.title}” has no video.`);
    else if (l.kind === 'TEXT' && !l.body?.trim()) out.push(`The lesson “${l.title}” has no text.`);
    else if (l.kind !== 'VIDEO' && l.kind !== 'TEXT' && !l.fileId) out.push(`The lesson “${l.title}” has no file.`);
  }
  if (approved.length && approved.reduce((s, q) => s + q.marks, 0) <= 0) out.push('The questions need marks.');
  void m;
  return out;
}
