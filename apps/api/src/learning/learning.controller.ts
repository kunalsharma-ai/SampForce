import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  type AssignModuleInput,
  assignModuleSchema,
  type AssignmentUpdateInput,
  assignmentUpdateSchema,
  type BankCopyInput,
  bankCopySchema,
  type GenerateQuestionsInput,
  generateQuestionsSchema,
  LEARNING_UPLOAD_PART_BYTES,
  type LearningCategoryInput,
  learningCategoryInputSchema,
  type LearningModuleInput,
  learningModuleInputSchema,
  type LearningModuleUpdate,
  learningModuleUpdateSchema,
  type LearningNoteInput,
  learningNoteSchema,
  type LearningReorderInput,
  learningReorderSchema,
  type LearningReportQuery,
  learningReportQuerySchema,
  type LearningSettingsInput,
  learningSettingsSchema,
  type LessonInput,
  lessonInputSchema,
  type LessonProgressInput,
  lessonProgressSchema,
  type LessonUpdate,
  lessonUpdateSchema,
  type MarkAttemptInput,
  markAttemptSchema,
  type MyLearningQuery,
  myLearningQuerySchema,
  type QuestionInput,
  questionInputSchema,
  type QuestionReviewInput,
  questionReviewSchema,
  saveAnswersSchema,
  type SaveAnswersInput,
  type VideoInspectInput,
  videoInspectSchema,
} from '@dealflow/types';
import { PayloadTooLargeException } from '@nestjs/common';
import { z } from 'zod';
import { Auth, type AuthContext, Meta, OwnHierarchyRules, Public, type RequestMeta, RequireFeature } from '../common/auth-context';
import { ConfirmPassword, NoPasswordConfirmation } from '../common/password-confirmation/password-confirmation.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { contentDisposition } from '../portal/portal-documents';
import { LearningCertificatesService } from './certificates.service';
import { type FileCreateInput, fileCreateSchema, LearningFilesService, parseRange } from './files.service';
import { LearningLearnerService } from './learner.service';
import { LearningManageService } from './manage.service';
import { LearningModulesService } from './modules.service';

const uuid = new ParseUUIDPipe();
const submitSchema = z.object({ answers: saveAnswersSchema.shape.answers.optional() }).strict();
const revokeSchema = z.object({ revoked: z.boolean() }).strict();

/** One part of an upload as the raw request body. */
async function readPart(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > LEARNING_UPLOAD_PART_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Each part of an upload can be at most 960 KB.' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Learning & Development (ADR 0097). Every workspace with the feature takes its own learning; who may build, assign,
 * mark and report is decided by the services from the caller's workspace (see access.ts), so the routes check only
 * the feature.
 */
@Controller('learning')
@RequireFeature('learning')
@OwnHierarchyRules()
export class LearningController {
  constructor(
    private readonly modules: LearningModulesService,
    private readonly files: LearningFilesService,
    private readonly learner: LearningLearnerService,
    private readonly manage: LearningManageService,
    private readonly certificates: LearningCertificatesService,
  ) {}

  // ───────────── Learner ─────────────

  @Get('me')
  me(@Auth() auth: AuthContext, @Query(new ZodPipe(myLearningQuerySchema)) q: MyLearningQuery) {
    return this.learner.myLearning(auth, q);
  }

  @Get('modules/:id/player')
  player(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.learner.player(auth, id);
  }

  @Post('modules/:id/enrol')
  @HttpCode(200)
  enrol(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.learner.enrol(auth, id);
  }

  @Put('modules/:id/lessons/:lessonId/progress')
  progress(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('lessonId', uuid) lessonId: string, @Body(new ZodPipe(lessonProgressSchema)) body: LessonProgressInput) {
    return this.learner.progress(auth, id, lessonId, body);
  }

  @Post('modules/:id/notes')
  addNote(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(learningNoteSchema)) body: LearningNoteInput) {
    return this.learner.addNote(auth, id, body);
  }

  @NoPasswordConfirmation('A person removing their own note or bookmark')
  @Delete('notes/:id')
  @HttpCode(204)
  removeNote(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.learner.removeNote(auth, id);
  }

  @Post('modules/:id/attempts')
  startAttempt(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.learner.startAttempt(auth, id);
  }

  @Get('attempts/:id')
  attempt(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.learner.getAttempt(auth, id);
  }

  @Put('attempts/:id/answers')
  saveAnswers(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(saveAnswersSchema)) body: SaveAnswersInput) {
    return this.learner.saveAnswers(auth, id, body.answers);
  }

  @Post('attempts/:id/submit')
  @HttpCode(200)
  submit(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(submitSchema)) body: z.infer<typeof submitSchema>, @Meta() meta: RequestMeta) {
    return this.learner.submit(auth, id, body.answers, meta);
  }

  /** An attempt of someone the caller manages (or their own), for the results page. */
  @Get('team-attempts/:id')
  teamAttempt(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.learner.teamAttempt(auth, id);
  }

  // ───────────── Certificates ─────────────

  @Get('certificates')
  teamCertificates(@Auth() auth: AuthContext) {
    return this.certificates.team(auth);
  }

  @Get('certificates/:id')
  certificate(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.certificates.get(auth, id);
  }

  @Get('certificates/:id/pdf')
  async certificatePdf(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('download') download: string | undefined, @Res() res: Response): Promise<void> {
    const file = await this.certificates.pdf(auth, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', download ? contentDisposition(file.name) : contentDisposition(file.name).replace(/^attachment/, 'inline'));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.send(file.data);
  }

  @Post('certificates/:id/revoke')
  @HttpCode(200)
  revoke(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(revokeSchema)) body: z.infer<typeof revokeSchema>, @Meta() meta: RequestMeta) {
    return this.certificates.revoke(auth, id, body.revoked, meta);
  }

  // ───────────── Files ─────────────

  @Post('files')
  createFile(@Auth() auth: AuthContext, @Body(new ZodPipe(fileCreateSchema)) body: FileCreateInput) {
    return this.files.create(auth, body);
  }

  @Put('files/:id/parts/:index')
  async putPart(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('index', ParseIntPipe) index: number, @Req() req: Request) {
    return this.files.putPart(auth, id, index, await readPart(req));
  }

  @Post('files/:id/complete')
  @HttpCode(200)
  complete(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.files.complete(auth, id);
  }

  /** The file itself, in ranges for video and audio; shown in the page for viewable kinds, else downloaded. */
  @Get('files/:id')
  async file(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('download') download: string | undefined, @Req() req: Request, @Res() res: Response): Promise<void> {
    const f = await this.files.access(auth, id, !!download);
    const range = parseRange(req.headers.range, f.sizeBytes);
    if (range === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${f.sizeBytes}`);
      res.end();
      return;
    }
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', f.inline ? contentDisposition(f.name).replace(/^attachment/, 'inline') : contentDisposition(f.name));
    if (f.inline && f.contentType === 'application/pdf') {
      // Shown in the lesson page's frame, and only there.
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    } else {
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }
    const r = range ?? { start: 0, end: f.sizeBytes - 1 };
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${r.start}-${r.end}/${f.sizeBytes}`);
    }
    res.setHeader('Content-Length', String(r.end - r.start + 1));
    let closed = false;
    req.on('close', () => (closed = true));
    await this.files.stream(auth, id, r, (chunk) =>
      closed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            if (res.write(chunk)) resolve();
            else res.once('drain', () => resolve());
          }),
    );
    res.end();
  }

  // ───────────── Building modules ─────────────

  @Get('manage')
  overview(@Auth() auth: AuthContext) {
    return this.manage.overview(auth);
  }

  @Get('assignees')
  assignees(@Auth() auth: AuthContext) {
    return this.manage.assignees(auth);
  }

  @Post('modules')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(learningModuleInputSchema)) body: LearningModuleInput, @Meta() meta: RequestMeta) {
    return this.modules.create(auth, body, meta);
  }

  @Get('modules/:id')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.modules.get(auth, id);
  }

  @Patch('modules/:id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(learningModuleUpdateSchema)) body: LearningModuleUpdate, @Meta() meta: RequestMeta) {
    return this.modules.update(auth, id, body, meta);
  }

  @Post('modules/:id/publish')
  @HttpCode(200)
  publish(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.modules.publish(auth, id, meta);
  }

  @Post('modules/:id/archive')
  @HttpCode(200)
  archive(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.modules.archive(auth, id, meta);
  }

  @ConfirmPassword()
  @Delete('modules/:id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.modules.remove(auth, id, meta);
  }

  @Post('video/inspect')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  inspectVideo(@Auth() auth: AuthContext, @Body(new ZodPipe(videoInspectSchema)) body: VideoInspectInput) {
    return this.modules.inspectVideo(auth, body.url);
  }

  @Post('modules/:id/lessons')
  addLesson(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(lessonInputSchema)) body: LessonInput) {
    return this.modules.addLesson(auth, id, body);
  }

  @Patch('modules/:id/lessons/:lessonId')
  updateLesson(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('lessonId', uuid) lessonId: string, @Body(new ZodPipe(lessonUpdateSchema)) body: LessonUpdate) {
    return this.modules.updateLesson(auth, id, lessonId, body);
  }

  @NoPasswordConfirmation('Editing a module: a lesson is taken out of it; people’s past results are kept')
  @Delete('modules/:id/lessons/:lessonId')
  removeLesson(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('lessonId', uuid) lessonId: string) {
    return this.modules.removeLesson(auth, id, lessonId);
  }

  @Put('modules/:id/lesson-order')
  reorderLessons(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(learningReorderSchema)) body: LearningReorderInput) {
    return this.modules.reorderLessons(auth, id, body.ids);
  }

  @Post('modules/:id/questions')
  addQuestion(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(questionInputSchema)) body: QuestionInput) {
    return this.modules.addQuestion(auth, id, body);
  }

  @Put('modules/:id/questions/:questionId')
  updateQuestion(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('questionId', uuid) questionId: string, @Body(new ZodPipe(questionInputSchema)) body: QuestionInput) {
    return this.modules.updateQuestion(auth, id, questionId, body);
  }

  @NoPasswordConfirmation('Editing a module: attempts already taken keep their own copy of the questions')
  @Delete('modules/:id/questions/:questionId')
  removeQuestion(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('questionId', uuid) questionId: string) {
    return this.modules.removeQuestion(auth, id, questionId);
  }

  @Put('modules/:id/question-order')
  reorderQuestions(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(learningReorderSchema)) body: LearningReorderInput) {
    return this.modules.reorderQuestions(auth, id, body.ids);
  }

  @NoPasswordConfirmation('Reviewing drafted questions: rejecting one removes a draft nobody has answered')
  @Post('modules/:id/questions/review')
  @HttpCode(200)
  review(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(questionReviewSchema)) body: QuestionReviewInput) {
    return this.modules.review(auth, id, body.ids, body.approve);
  }

  @Post('modules/:id/generate')
  @HttpCode(200)
  generate(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(generateQuestionsSchema)) body: GenerateQuestionsInput) {
    return this.modules.generate(auth, id, body);
  }

  @Get('bank')
  bank(@Auth() auth: AuthContext, @Query('categoryId') categoryId: string | undefined) {
    return this.modules.bank(auth, categoryId && /^[0-9a-f-]{36}$/i.test(categoryId) ? categoryId : undefined);
  }

  @Post('modules/:id/bank')
  @HttpCode(200)
  saveToBank(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(bankCopySchema)) body: BankCopyInput) {
    return this.modules.saveToBank(auth, id, body.questionIds);
  }

  @Post('modules/:id/questions/from-bank')
  @HttpCode(200)
  copyFromBank(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(bankCopySchema)) body: BankCopyInput) {
    return this.modules.copyFromBank(auth, id, body.questionIds);
  }

  @NoPasswordConfirmation('A copy in the question bank; the modules that use the question keep their own')
  @Delete('bank/:id')
  @HttpCode(204)
  removeFromBank(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.modules.removeFromBank(auth, id);
  }

  // ───────────── Assignments ─────────────

  @Get('modules/:id/assignments')
  assignments(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.manage.assignments(auth, id);
  }

  @Post('modules/:id/assign')
  @HttpCode(200)
  assign(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(assignModuleSchema)) body: AssignModuleInput, @Meta() meta: RequestMeta) {
    return this.manage.assign(auth, id, body, meta);
  }

  @Patch('assignments/:id')
  updateAssignment(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(assignmentUpdateSchema)) body: AssignmentUpdateInput, @Meta() meta: RequestMeta) {
    return this.manage.updateAssignment(auth, id, body, meta);
  }

  @NoPasswordConfirmation('Taking a module off a person keeps their attempts, results and certificate')
  @Delete('assignments/:id')
  @HttpCode(204)
  removeAssignment(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.manage.removeAssignment(auth, id, meta);
  }

  // ───────────── Marking and reports ─────────────

  @Get('marking')
  marking(@Auth() auth: AuthContext) {
    return this.learner.marking(auth);
  }

  @Get('marking/:id')
  markingDetail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.learner.markingDetail(auth, id);
  }

  @Post('marking/:id')
  @HttpCode(200)
  mark(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(markAttemptSchema)) body: MarkAttemptInput, @Meta() meta: RequestMeta) {
    return this.learner.mark(auth, id, body, meta);
  }

  @Get('reports')
  report(@Auth() auth: AuthContext, @Query(new ZodPipe(learningReportQuerySchema)) q: LearningReportQuery) {
    return this.manage.report(auth, q);
  }

  @Get('reports/export')
  async exportReport(@Auth() auth: AuthContext, @Query(new ZodPipe(learningReportQuerySchema)) q: LearningReportQuery, @Meta() meta: RequestMeta, @Res() res: Response): Promise<void> {
    const data = await this.manage.exportXlsx(auth, q, meta);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', contentDisposition(`learning-report-${new Date().toISOString().slice(0, 10)}.xlsx`));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }

  // ───────────── Categories and settings ─────────────

  @Get('categories')
  categories(@Auth() auth: AuthContext) {
    return this.modules.categories(auth);
  }

  @Post('categories')
  addCategory(@Auth() auth: AuthContext, @Body(new ZodPipe(learningCategoryInputSchema)) body: LearningCategoryInput) {
    return this.modules.addCategory(auth, body);
  }

  @Patch('categories/:id')
  updateCategory(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(learningCategoryInputSchema)) body: LearningCategoryInput) {
    return this.modules.updateCategory(auth, id, body);
  }

  @NoPasswordConfirmation('A category is only hidden from new modules; modules and certificates keep it')
  @Delete('categories/:id')
  removeCategory(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.modules.removeCategory(auth, id);
  }

  @Get('settings')
  settings(@Auth() auth: AuthContext) {
    return this.modules.settings(auth);
  }

  @Put('settings')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(learningSettingsSchema)) body: LearningSettingsInput, @Meta() meta: RequestMeta) {
    return this.modules.saveSettings(auth, body, meta);
  }
}

/** The public check of a certificate's code, for the QR code on it. No sign-in; it says only what the certificate says. */
@Controller('learning/verify')
@Public()
export class LearningVerifyController {
  constructor(private readonly certificates: LearningCertificatesService) {}

  @Get(':code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Param('code') code: string) {
    return this.certificates.verify(String(code).slice(0, 40));
  }
}
