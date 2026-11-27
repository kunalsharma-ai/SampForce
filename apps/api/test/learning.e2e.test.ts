import type { INestApplication } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Workbook } from 'exceljs';
import type { AttemptView, CertificateRow, CertificateVerification, GenerateResult, LearningManageView, LearningModuleDetail, MarkingDetail, MarkingRow, MyLearningView, PlayerView, QuestionView, VideoInfo } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { LearningRemindersService } from '../src/learning/reminders.service';
import { type LearningVideoFixture, SALES_TEXT, startLearningVideoFixture, VIDEO_WITH_CAPTIONS, VIDEO_WITHOUT_CAPTIONS } from './fixtures/learning-video-fixture';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

const PART = 960 * 1024;

function pdfOf(text: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  for (const para of text.split(/\n\s*\n/)) doc.fontSize(11).text(para.replace(/^#\s*/gm, '').trim()).moveDown();
  doc.end();
  return done;
}

/** Uploads a file the way the app does: create, send the parts, complete. */
async function upload(u: TestUser, name: string, data: Buffer, contentType: string, attemptId?: string): Promise<string> {
  const f = (await api(u).post('/learning/files', { name, contentType, sizeBytes: data.length, ...(attemptId ? { attemptId } : {}) }).expect(201)).body as { id: string; parts: number };
  for (let i = 0; i < f.parts; i++) {
    await u.agent.put(`/api/v1/learning/files/${f.id}/parts/${i}`).set('origin', ORIGIN).set('content-type', 'application/octet-stream').send(data.subarray(i * PART, (i + 1) * PART)).expect(200);
  }
  await api(u).post(`/learning/files/${f.id}/complete`, {}).expect(200);
  return f.id;
}

/** The right answer to each question, from the module's answer key, in the learner's ids. */
function rightAnswers(key: QuestionView[], attempt: AttemptView): Record<string, object> {
  const out: Record<string, object> = {};
  for (const q of attempt.questions) {
    const k = key.find((x) => x.id === q.id)!;
    if (k.type === 'MCQ' || k.type === 'MULTI') out[q.id] = { optionIds: k.correctOptionIds };
    else if (k.type === 'TRUE_FALSE') out[q.id] = { value: k.correctBoolean };
    else if (k.type === 'FILL_BLANK') out[q.id] = { blanks: k.blanks.map((b) => b[0]!.toUpperCase()) };
    else if (k.type === 'MATCHING') out[q.id] = { pairs: Object.fromEntries(k.pairs.map((p) => [p.id, q.right.find((r) => r.text === p.right)!.id])) };
    else if (k.type === 'SHORT') out[q.id] = { text: ` ${k.acceptedAnswers[0]!.toLowerCase()}. ` };
    else out[q.id] = { text: 'A thorough written answer covering the rubric.' };
  }
  return out;
}

function wrongAnswers(key: QuestionView[], attempt: AttemptView): Record<string, object> {
  const out: Record<string, object> = {};
  for (const q of attempt.questions) {
    const k = key.find((x) => x.id === q.id)!;
    if (k.type === 'MCQ') out[q.id] = { optionIds: [k.options.find((o) => !k.correctOptionIds.includes(o.id))!.id] };
    else if (k.type === 'TRUE_FALSE') out[q.id] = { value: !k.correctBoolean };
    else if (k.type === 'FILL_BLANK') out[q.id] = { blanks: k.blanks.map(() => 'no idea') };
    else if (k.type === 'SHORT') out[q.id] = { text: 'something else' };
    else out[q.id] = { text: 'x' };
  }
  return out;
}

/*
 * Learning & Development (ADR 0097), end to end: a manager builds a module from a video link, SampForce drafts the
 * assessment from the video's captions without AI, the manager reviews it, sets an 80% pass mark and assigns it to an
 * executive. The executive learns, fails, sees why, retries and passes; the answers are marked on the server, the
 * certificate is issued once and verifies publicly, notifications go out, and the Super Workspace sees the result.
 */
describe('learning & development', () => {
  let app: INestApplication;
  let fixture: LearningVideoFixture;
  let restore: () => void;
  let owner: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let exec: TestUser & { userId: string; workspaceId: string };
  let outsider: TestUser & { userId: string; workspaceId: string };
  let otherOrg: TestUser;
  const db = ownerClient();
  let moduleId: string;
  let assignmentId: string;
  let certificateId: string;
  let certificateCode: string;

  const notifications = async (userId: string, type: string) => db.notification.findMany({ where: { userId, type } });

  beforeAll(async () => {
    fixture = await startLearningVideoFixture();
    restore = setEnv({ LEARNING_FIXTURE_URL: fixture.url, LEARNING_OCR: 'false' });
    app = await startApp();
    owner = await registerUser(app, 'Learning Org');
    manager = await workspacePerson(app, owner, 'MANAGER', 'Meera Manager');
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { canCreateExecutives: true }).expect(200);
    exec = await workspacePerson(app, manager, 'EXECUTIVE', 'Ravi Executive');
    outsider = await workspacePerson(app, owner, 'EXECUTIVE', 'Olga Outside');
    otherOrg = await registerUser(app, 'Other Learning Org');
  });

  afterAll(async () => {
    restore();
    await db.$disconnect();
    await app.close();
    await fixture.close();
  });

  it('reads a pasted video link: provider, title, preview and whether captions can be read', async () => {
    const yes = (await api(manager).post('/learning/video/inspect', { url: VIDEO_WITH_CAPTIONS }).expect(200)).body as VideoInfo;
    expect(yes).toMatchObject({ provider: 'YOUTUBE', videoId: 'SalesTrain01', title: 'Sales Communication Essentials', durationSeconds: 754, captions: 'AVAILABLE' });
    expect(yes.embedUrl).toContain('youtube-nocookie.com/embed/SalesTrain01');
    const no = (await api(manager).post('/learning/video/inspect', { url: VIDEO_WITHOUT_CAPTIONS }).expect(200)).body as VideoInfo;
    expect(no.captions).toBe('NOT_AVAILABLE');
    expect(no.note).toMatch(/no captions/i);
    expect((await api(manager).post('/learning/video/inspect', { url: 'https://example.com/article' }).expect(400)).body.error.code).toBe('LEARNING_VIDEO_UNSUPPORTED');
    // Executives take modules; they do not build them.
    expect((await api(exec).post('/learning/video/inspect', { url: VIDEO_WITH_CAPTIONS }).expect(403)).body.error.code).toBe('LEARNING_AUTHOR_ONLY');
  });

  it('lets a manager build a module from a video, drafting questions from its captions without AI', async () => {
    const cats = (await api(manager).get('/learning/categories').expect(200)).body as { id: string; name: string }[];
    const sales = cats.find((c) => c.name === 'Sales')!;
    const created = (await api(manager).post('/learning/modules', { title: 'Sales communication essentials', categoryId: sales.id, level: 'BEGINNER', passingScore: 80, maxAttempts: 2, description: 'How to run a good sales conversation.' }).expect(201)).body as LearningModuleDetail;
    moduleId = created.id;
    expect(created).toMatchObject({ status: 'DRAFT', passingScore: 80, maxAttempts: 2, certificate: true, canEdit: true, ownerWorkspace: 'Meera Manager' });
    expect(created.number).toMatch(/^LRN-\d{4}$/);
    expect(created.publishProblems).toEqual(expect.arrayContaining(['Add at least one lesson.']));

    let m = (await api(manager).post(`/learning/modules/${moduleId}/lessons`, { title: 'Watch: the essentials', kind: 'VIDEO', videoUrl: VIDEO_WITH_CAPTIONS }).expect(201)).body as LearningModuleDetail;
    const video = m.lessonList[0]!;
    expect(video.video).toMatchObject({ provider: 'YOUTUBE', title: 'Sales Communication Essentials' });
    expect(video.text).toMatchObject({ status: 'READY', source: 'CAPTIONS' });
    expect(video.minutes).toBe(13);

    // A video without captions says so plainly; nothing is drafted from it until the transcript is pasted.
    m = (await api(manager).post(`/learning/modules/${moduleId}/lessons`, { title: 'Product walkthrough', kind: 'VIDEO', videoUrl: VIDEO_WITHOUT_CAPTIONS }).expect(201)).body;
    const silent = m.lessonList[1]!;
    expect(silent.text.status).toBe('UNREADABLE');
    expect(silent.text.note).toMatch(/no captions/i);

    // Drafting reads only the lessons with text and says which it skipped and why.
    const gen = (await api(manager).post(`/learning/modules/${moduleId}/generate`, { types: ['MCQ', 'TRUE_FALSE', 'FILL_BLANK'], count: 6, fillSummary: true }).expect(200)).body as GenerateResult & { module: LearningModuleDetail };
    expect(gen.created).toHaveLength(6);
    expect(gen.skipped).toEqual([expect.objectContaining({ lessonId: silent.id, reason: expect.stringMatching(/no captions/i) })]);
    expect(gen.summaryFilled).toBe(true);
    for (const q of gen.created) {
      expect(q).toMatchObject({ source: 'GENERATED', approved: false, lessonId: video.id });
      expect(q.sourceExcerpt!.length).toBeGreaterThan(10);
    }
    expect(gen.module.keyPoints.length).toBeGreaterThan(0);
    expect(gen.module.publishProblems.join(' ')).toMatch(/Review the 6 drafted questions/);
    // Drafted questions do not count until reviewed: publishing is refused.
    expect((await api(manager).post(`/learning/modules/${moduleId}/publish`, {}).expect(400)).body.error.code).toBe('LEARNING_NOT_READY');

    // The transcript makes the second video readable.
    m = (await api(manager).patch(`/learning/modules/${moduleId}/lessons/${silent.id}`, { transcript: 'The product dashboard shows every open deal. Filters narrow the list by owner, stage and close date. Saved views keep a filter for later and can be shared with the team. Export sends the current view to Excel with the same columns you see on the screen.' }).expect(200)).body;
    expect(m.lessonList[1]!.text).toMatchObject({ status: 'READY', source: 'TRANSCRIPT' });

    // Review: edit one, reject one, approve the rest, add a hand-written short answer.
    const [first, second, ...rest] = gen.created;
    const edited = { type: first!.type, text: first!.text, options: first!.options, correctOptionIds: first!.correctOptionIds, correctBoolean: first!.correctBoolean ?? undefined, blanks: first!.blanks.length ? first!.blanks : undefined, marks: 2, explanation: 'Checked by the manager.' };
    m = (await api(manager).put(`/learning/modules/${moduleId}/questions/${first!.id}`, edited).expect(200)).body;
    expect(m.questionList.find((q) => q.id === first!.id)).toMatchObject({ marks: 2, explanation: 'Checked by the manager.' });
    m = (await api(manager).post(`/learning/modules/${moduleId}/questions/review`, { ids: [second!.id], approve: false }).expect(200)).body;
    expect(m.questionList.some((q) => q.id === second!.id)).toBe(false);
    m = (await api(manager).post(`/learning/modules/${moduleId}/questions/review`, { ids: [first!.id, ...rest.map((q) => q.id)], approve: true }).expect(200)).body;
    m = (await api(manager).post(`/learning/modules/${moduleId}/questions`, { type: 'SHORT', text: 'What does the B in BANT stand for?', acceptedAnswers: ['Budget'], marks: 1 }).expect(201)).body;
    // A question the schema cannot mark is refused before it is saved.
    expect((await api(manager).post(`/learning/modules/${moduleId}/questions`, { type: 'MCQ', text: 'Pick one', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionIds: [] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect(m.questions).toBe(6);
    expect(m.pendingQuestions).toBe(0);
    expect(m.publishProblems).toEqual([]);

    m = (await api(manager).post(`/learning/modules/${moduleId}/publish`, {}).expect(200)).body;
    expect(m.status).toBe('PUBLISHED');
    expect(m.history.map((h) => h.kind)).toEqual(expect.arrayContaining(['created', 'lesson_added', 'questions_drafted', 'questions_approved', 'published']));
  });

  it('assigns only within the manager’s branch, with a deadline, and notifies the executive', async () => {
    const options = (await api(manager).get('/learning/assignees').expect(200)).body as { id: string }[];
    expect(options.map((o) => o.id)).toContain(exec.userId);
    expect(options.map((o) => o.id)).not.toContain(outsider.userId);
    expect((await api(manager).post(`/learning/modules/${moduleId}/assign`, { userIds: [outsider.userId] }).expect(400)).body.error.code).toBe('LEARNING_ASSIGNEE_OUT_OF_SCOPE');
    const due = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const res = (await api(manager).post(`/learning/modules/${moduleId}/assign`, { userIds: [exec.userId], dueAt: due, mandatory: true }).expect(200)).body as { assigned: number; rows: { id: string; user: { id: string } }[] };
    expect(res.assigned).toBe(1);
    assignmentId = res.rows[0]!.id;
    // Assigning again changes nothing and sends nothing twice.
    expect((await api(manager).post(`/learning/modules/${moduleId}/assign`, { userIds: [exec.userId] }).expect(200)).body).toMatchObject({ assigned: 0, already: 1 });
    expect(await notifications(exec.userId, 'learning.assigned_mandatory')).toHaveLength(1);
    // Executives never see the builder or other people's learning.
    await api(exec).get(`/learning/modules/${moduleId}`).expect(404);
    expect((await api(exec).get('/learning/manage').expect(403)).body.error.code).toBe('LEARNING_MANAGER_ONLY');
    expect((await api(exec).patch(`/learning/assignments/${assignmentId}`, { extraAttempts: 5 }).expect(403)).body.error.code).toBe('LEARNING_MANAGER_ONLY');
    // Another organisation sees nothing of it.
    await api(otherOrg).get(`/learning/modules/${moduleId}/player`).expect(404);
  });

  it('lets the executive learn, fail with feedback, retry and pass, with the answers marked by the server', async () => {
    const me = (await api(exec).get('/learning/me').expect(200)).body as MyLearningView;
    expect(me.cards).toEqual([expect.objectContaining({ moduleId, status: 'NOT_STARTED', mandatory: true, isNew: true, overdue: false, passingScore: 80, attemptsAllowed: 2 })]);
    expect(me.stats).toMatchObject({ assigned: 1, completed: 0, pending: 1 });
    expect(me.upcoming).toHaveLength(1);

    let player = (await api(exec).get(`/learning/modules/${moduleId}/player`).expect(200)).body as PlayerView;
    expect(player.canAttempt).toBe(false);
    expect(player.attemptBlockedReason).toMatch(/Finish the lessons first \(0 of 2/);
    expect((await api(exec).post(`/learning/modules/${moduleId}/attempts`, {}).expect(403)).body.error.code).toBe('LEARNING_ATTEMPT_BLOCKED');

    // Progress is saved as they watch; a bookmark and a note are kept.
    const [l1, l2] = player.lessons;
    await api(exec).put(`/learning/modules/${moduleId}/lessons/${l1!.id}/progress`, { percent: 40, positionSeconds: 300, seconds: 300 }).expect(200);
    player = (await api(exec).get(`/learning/modules/${moduleId}/player`).expect(200)).body;
    expect(player.lessons[0]).toMatchObject({ percent: 40, positionSeconds: 300, done: false });
    expect(player.assignment).toMatchObject({ status: 'IN_PROGRESS' });
    await api(exec).post(`/learning/modules/${moduleId}/notes`, { lessonId: l1!.id, bookmark: true, positionSeconds: 300, body: 'SPIN questions order' }).expect(201);
    await api(exec).put(`/learning/modules/${moduleId}/lessons/${l1!.id}/progress`, { percent: 100, seconds: 400 }).expect(200);
    await api(exec).put(`/learning/modules/${moduleId}/lessons/${l2!.id}/progress`, { done: true, seconds: 120 }).expect(200);
    player = (await api(exec).get(`/learning/modules/${moduleId}/player`).expect(200)).body;
    expect(player.canAttempt).toBe(true);
    expect(player.notes).toEqual([expect.objectContaining({ bookmark: true, lessonTitle: 'Watch: the essentials' })]);

    const key = ((await api(manager).get(`/learning/modules/${moduleId}`).expect(200)).body as LearningModuleDetail).questionList;

    // Attempt 1: wrong answers. The attempt the learner gets has no answer key in it.
    const a1 = (await api(exec).post(`/learning/modules/${moduleId}/attempts`, {}).expect(201)).body as AttemptView;
    const raw = JSON.stringify(a1);
    expect(raw).not.toContain('correctOptionIds');
    expect(raw).not.toContain('correctBoolean');
    expect(raw).not.toContain('acceptedAnswers');
    expect(a1.questions).toHaveLength(6);
    // Opening it again returns the same attempt: a refresh never uses up another.
    expect(((await api(exec).post(`/learning/modules/${moduleId}/attempts`, {}).expect(201)).body as AttemptView).id).toBe(a1.id);
    // Required questions must be answered before handing in.
    expect((await api(exec).post(`/learning/attempts/${a1.id}/submit`, {}).expect(400)).body.error.code).toBe('LEARNING_ANSWERS_MISSING');
    // Answers are saved as they go; nothing but answers is accepted.
    await api(exec).put(`/learning/attempts/${a1.id}/answers`, { answers: wrongAnswers(key, a1) }).expect(200);
    await api(exec).put(`/learning/attempts/${a1.id}/answers`, { answers: {}, score: 100 }).expect(400);
    const r1 = (await api(exec).post(`/learning/attempts/${a1.id}/submit`, {}).expect(200)).body as AttemptView;
    expect(r1).toMatchObject({ status: 'MARKED', passed: false, percent: 0 });
    expect(r1.results!.every((r) => r.correct === false && r.correctAnswer)).toBe(true);
    expect(r1.improve).toContain('Watch: the essentials');
    // A marked attempt can no longer be changed.
    expect((await api(exec).put(`/learning/attempts/${a1.id}/answers`, { answers: rightAnswers(key, a1) }).expect(409)).body.error.code).toBe('LEARNING_ATTEMPT_CLOSED');
    expect(await notifications(exec.userId, 'learning.failed')).toHaveLength(1);
    player = (await api(exec).get(`/learning/modules/${moduleId}/player`).expect(200)).body;
    expect(player.assignment).toMatchObject({ status: 'FAILED', attemptsUsed: 1, attemptsAllowed: 2, lastScore: 0 });
    expect(player.canAttempt).toBe(true);

    // Attempt 2: right answers (typed answers are compared without case and stray spaces).
    const a2 = (await api(exec).post(`/learning/modules/${moduleId}/attempts`, {}).expect(201)).body as AttemptView;
    expect(a2.number).toBe(2);
    const r2 = (await api(exec).post(`/learning/attempts/${a2.id}/submit`, { answers: rightAnswers(key, a2) }).expect(200)).body as AttemptView;
    expect(r2).toMatchObject({ status: 'MARKED', passed: true, percent: 100 });
    expect(r2.score).toBe(r2.maxScore);
    // Handing in twice changes nothing.
    expect(((await api(exec).post(`/learning/attempts/${a2.id}/submit`, {}).expect(200)).body as AttemptView).percent).toBe(100);

    player = (await api(exec).get(`/learning/modules/${moduleId}/player`).expect(200)).body;
    expect(player.assignment).toMatchObject({ status: 'COMPLETED', passed: true, bestScore: 100, progress: 100 });
    expect(player.canAttempt).toBe(false);
    expect(player.certificate).toMatchObject({ recipientName: 'Ravi Executive', moduleTitle: 'Sales communication essentials', score: 100, category: 'Sales' });
    certificateId = player.certificate!.id;
    certificateCode = player.certificate!.code;
    expect((await api(exec).post(`/learning/modules/${moduleId}/attempts`, {}).expect(403)).body.error.code).toBe('LEARNING_ATTEMPT_BLOCKED');

    expect(await notifications(exec.userId, 'learning.passed')).toHaveLength(1);
    expect(await notifications(exec.userId, 'learning.certificate_issued')).toHaveLength(1);
    expect(await notifications(manager.userId, 'learning.completed')).toHaveLength(1);

    const after = (await api(exec).get('/learning/me').expect(200)).body as MyLearningView;
    expect(after.stats).toMatchObject({ assigned: 1, completed: 1, certificates: 1, completionPercent: 100, highestScore: 100, assignmentsCompleted: 2, streakDays: 1 });
    expect(after.stats.learningMinutes).toBe(14);
    expect(after.scoreHistory.map((s) => s.percent)).toEqual([0, 100]);
  });

  it('issues one certificate, downloadable as a PDF and verifiable by its public code', async () => {
    expect(await db.learningCertificate.count({ where: { assignmentId } })).toBe(1);
    const cert = (await api(exec).get(`/learning/certificates/${certificateId}`).expect(200)).body as CertificateRow & { verifyUrl: string };
    expect(cert.number).toMatch(/^CERT-\d{4}-\d{5}$/);
    expect(cert.verifyUrl).toContain(`/verify/certificate/${certificateCode}`);
    const pdf = await api(exec).get(`/learning/certificates/${certificateId}/pdf?download=1`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    // The manager and the Super Workspace see it; another organisation and other executives do not.
    await api(manager).get(`/learning/certificates/${certificateId}`).expect(200);
    await api(owner).get(`/learning/certificates/${certificateId}`).expect(200);
    await api(outsider).get(`/learning/certificates/${certificateId}`).expect(404);
    await api(otherOrg).get(`/learning/certificates/${certificateId}`).expect(404);

    const anon = request(app.getHttpServer());
    const ok = (await anon.get(`/api/v1/learning/verify/${certificateCode}`).expect(200)).body as CertificateVerification;
    expect(ok).toMatchObject({ valid: true, recipientName: 'Ravi Executive', moduleTitle: 'Sales communication essentials', score: 100, issuerName: 'Learning Org' });
    expect((await anon.get('/api/v1/learning/verify/AAAA-BBBB-CCCC').expect(200)).body).toEqual({ valid: false });
    expect((await anon.get('/api/v1/learning/verify/not-a-code').expect(200)).body).toEqual({ valid: false });
  });

  it('shows the Super Workspace and the manager the results, with reports and an Excel export', async () => {
    const sup = (await api(owner).get('/learning/manage').expect(200)).body as LearningManageView;
    expect(sup.level).toBe('SUPER');
    expect(sup.stats).toMatchObject({ completed: 1, passed: 1, certificates: 1, assignedPeople: 1 });
    expect(sup.modules.find((m) => m.id === moduleId)).toMatchObject({ canEdit: true, stats: expect.objectContaining({ assigned: 1, completed: 1, averageScore: 100 }) });
    const mgr = (await api(manager).get('/learning/manage').expect(200)).body as LearningManageView;
    expect(mgr.level).toBe('MANAGER');
    expect(mgr.people.map((p) => p.user.id)).toEqual([exec.userId]);

    const rows = (await api(owner).get('/learning/reports?result=PASSED').expect(200)).body as { assignment: { user: { id: string }; bestScore: number }; certificateStatus: string; manager: string }[];
    expect(rows).toEqual([expect.objectContaining({ certificateStatus: 'ISSUED', manager: 'Meera Manager', assignment: expect.objectContaining({ bestScore: 100, user: expect.objectContaining({ id: exec.userId }) }) })]);
    expect((await api(owner).get('/learning/reports?result=FAILED').expect(200)).body).toEqual([]);
    const xlsx = await api(owner).get('/learning/reports/export').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new Workbook();
    await wb.xlsx.load(xlsx.body as Buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).values).toEqual(expect.arrayContaining(['Employee name', 'Module', 'Best score %', 'Result', 'Certificate ID']));
    expect(ws.getRow(2).getCell(1).value).toBe('Ravi Executive');
    // Executives cannot read reports.
    await api(exec).get('/learning/reports').expect(403);
  });

  it('waits for a manager to mark written answers, then passes with feedback', async () => {
    let m = (await api(manager).post('/learning/modules', { title: 'Objection handling practice', passingScore: 70, maxAttempts: 1 }).expect(201)).body as LearningModuleDetail;
    const id = m.id;
    m = (await api(manager).post(`/learning/modules/${id}/lessons`, { title: 'Read: objections', kind: 'TEXT', body: SALES_TEXT }).expect(201)).body;
    expect(m.lessonList[0]!.text).toMatchObject({ status: 'READY', source: 'WRITTEN' });
    m = (await api(manager).post(`/learning/modules/${id}/questions`, { type: 'TRUE_FALSE', text: 'You should argue with the customer.', correctBoolean: false, marks: 1 }).expect(201)).body;
    m = (await api(manager).post(`/learning/modules/${id}/questions`, { type: 'LONG', text: 'Describe how you would handle a price objection.', rubric: 'Acknowledge, clarify, respond with evidence.', marks: 4 }).expect(201)).body;
    await api(manager).post(`/learning/modules/${id}/publish`, {}).expect(200);
    await api(manager).post(`/learning/modules/${id}/assign`, { userIds: [exec.userId], mandatory: false }).expect(200);

    const lesson = ((await api(exec).get(`/learning/modules/${id}/player`).expect(200)).body as PlayerView).lessons[0]!;
    await api(exec).put(`/learning/modules/${id}/lessons/${lesson.id}/progress`, { percent: 100 }).expect(200);
    const a = (await api(exec).post(`/learning/modules/${id}/attempts`, {}).expect(201)).body as AttemptView;
    const tf = a.questions.find((q) => q.type === 'TRUE_FALSE')!;
    const long = a.questions.find((q) => q.type === 'LONG')!;
    expect(long.manual).toBe(true);
    const sent = (await api(exec).post(`/learning/attempts/${a.id}/submit`, { answers: { [tf.id]: { value: false }, [long.id]: { text: 'I would acknowledge it, ask what budget they had in mind, and show the ROI case study.' } } }).expect(200)).body as AttemptView;
    expect(sent).toMatchObject({ status: 'AWAITING_MARKING', autoScore: 1, percent: null, passed: null });

    expect(await notifications(manager.userId, 'learning.submitted')).toHaveLength(1);
    const queue = (await api(manager).get('/learning/marking').expect(200)).body as MarkingRow[];
    expect(queue).toEqual([expect.objectContaining({ attemptId: a.id, questions: 1, autoScore: 1, maxScore: 5 })]);
    expect((await api(exec).get('/learning/marking').expect(200)).body).toEqual([]);
    await api(exec).get(`/learning/marking/${a.id}`).expect(404);
    const detail = (await api(manager).get(`/learning/marking/${a.id}`).expect(200)).body as MarkingDetail;
    expect(detail.questions.find((q) => q.id === long.id)!.rubric).toMatch(/Acknowledge/);
    expect((await api(manager).post(`/learning/marking/${a.id}`, { marks: [{ questionId: long.id, marks: 9 }] }).expect(400)).body.error.code).toBe('LEARNING_MARKS_TOO_HIGH');
    const marked = (await api(manager).post(`/learning/marking/${a.id}`, { marks: [{ questionId: long.id, marks: 3, feedback: 'Good structure; quote a number next time.' }], feedback: 'Well done.' }).expect(200)).body as MarkingDetail;
    expect(marked.attempt).toMatchObject({ status: 'MARKED', percent: 80, passed: true, feedback: 'Well done.' });
    expect((await api(manager).post(`/learning/marking/${a.id}`, { marks: [{ questionId: long.id, marks: 4 }] }).expect(409)).body.error.code).toBe('LEARNING_ALREADY_MARKED');

    const mine = (await api(exec).get(`/learning/attempts/${a.id}`).expect(200)).body as AttemptView;
    expect(mine.results!.find((r) => r.questionId === long.id)).toMatchObject({ marks: 3, feedback: 'Good structure; quote a number next time.' });
    expect(mine.markedBy).toMatchObject({ id: manager.userId });
    expect(await notifications(exec.userId, 'learning.evaluated')).toHaveLength(1);
  });

  it('gives another attempt when the manager extends it after the attempts run out', async () => {
    let m = (await api(manager).post('/learning/modules', { title: 'Follow-up emails', passingScore: 100, maxAttempts: 1, certificate: false }).expect(201)).body as LearningModuleDetail;
    const id = m.id;
    m = (await api(manager).post(`/learning/modules/${id}/lessons`, { title: 'Read', kind: 'TEXT', body: 'A follow-up email should be short, specific and focused on one call to action.', required: false }).expect(201)).body;
    m = (await api(manager).post(`/learning/modules/${id}/questions`, { type: 'FILL_BLANK', text: 'A follow-up email should focus on one call to _____.', blanks: [['action']] }).expect(201)).body;
    await api(manager).post(`/learning/modules/${id}/publish`, {}).expect(200);
    const asg = ((await api(manager).post(`/learning/modules/${id}/assign`, { userIds: [exec.userId] }).expect(200)).body as { rows: { id: string }[] }).rows[0]!.id;
    const a = (await api(exec).post(`/learning/modules/${id}/attempts`, {}).expect(201)).body as AttemptView;
    await api(exec).post(`/learning/attempts/${a.id}/submit`, { answers: { [a.questions[0]!.id]: { blanks: ['reaction'] } } }).expect(200);
    let p = (await api(exec).get(`/learning/modules/${id}/player`).expect(200)).body as PlayerView;
    expect(p.attemptBlockedReason).toMatch(/used all your attempts/);
    await api(manager).patch(`/learning/assignments/${asg}`, { extraAttempts: 1 }).expect(200);
    expect(await notifications(exec.userId, 'learning.assignment_updated')).toHaveLength(1);
    p = (await api(exec).get(`/learning/modules/${id}/player`).expect(200)).body;
    expect(p.canAttempt).toBe(true);
    const b = (await api(exec).post(`/learning/modules/${id}/attempts`, {}).expect(201)).body as AttemptView;
    const r = (await api(exec).post(`/learning/attempts/${b.id}/submit`, { answers: { [b.questions[0]!.id]: { blanks: ['Action'] } } }).expect(200)).body as AttemptView;
    expect(r.passed).toBe(true);
    // No certificate for a module without one.
    expect(((await api(exec).get(`/learning/modules/${id}/player`).expect(200)).body as PlayerView).certificate).toBeNull();
  });

  it('sends deadline reminders once each, and tells the manager when it becomes overdue', async () => {
    let m = (await api(manager).post('/learning/modules', { title: 'Compliance basics', reminderDaysBefore: [3, 1], overdueEveryDays: 2 }).expect(201)).body as LearningModuleDetail;
    const id = m.id;
    m = (await api(manager).post(`/learning/modules/${id}/lessons`, { title: 'Read', kind: 'TEXT', body: 'Always record consent before you call.' }).expect(201)).body;
    await api(manager).post(`/learning/modules/${id}/questions`, { type: 'TRUE_FALSE', text: 'Consent is recorded before the call.', correctBoolean: true }).expect(201);
    await api(manager).post(`/learning/modules/${id}/publish`, {}).expect(200);
    const asg = ((await api(manager).post(`/learning/modules/${id}/assign`, { userIds: [exec.userId], dueAt: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString() }).expect(200)).body as { rows: { id: string }[] }).rows[0]!.id;
    const sweep = app.get(LearningRemindersService);
    const now = Date.now();
    await sweep.sweep(new Date(now));
    await sweep.sweep(new Date(now));
    const before = await db.notification.findMany({ where: { userId: exec.userId, type: 'learning.deadline_approaching' } });
    expect(before).toHaveLength(1);
    expect(before[0]!.body).toContain('Compliance basics');
    // Closer to the deadline, the next reminder: the one-day one, or "due today" when that day has come.
    await sweep.sweep(new Date(now + 1.5 * 86_400_000));
    await sweep.sweep(new Date(now + 1.5 * 86_400_000));
    expect(await db.notification.count({ where: { userId: exec.userId, type: { in: ['learning.deadline_approaching', 'learning.due_today'] } } })).toBe(2);
    // Past the deadline: overdue to the executive, and once to the manager.
    await sweep.sweep(new Date(now + 3 * 86_400_000));
    await sweep.sweep(new Date(now + 3 * 86_400_000));
    expect(await db.notification.count({ where: { userId: exec.userId, type: 'learning.overdue' } })).toBe(1);
    expect(await db.notification.count({ where: { userId: manager.userId, type: 'learning.overdue_team' } })).toBe(1);
    const card = ((await api(exec).get('/learning/me').expect(200)).body as MyLearningView).cards.find((c) => c.moduleId === id);
    expect(card).toBeDefined();
    void asg;
  });

  it('reads uploaded documents, streams files in ranges and says plainly when a file cannot be read', async () => {
    let m = (await api(owner).post('/learning/modules', { title: 'Sales playbook' }).expect(201)).body as LearningModuleDetail;
    const id = m.id;
    const pdf = await pdfOf(SALES_TEXT);
    const fileId = await upload(owner, 'Sales playbook.pdf', pdf, 'application/pdf');
    m = (await api(owner).post(`/learning/modules/${id}/lessons`, { title: 'Playbook', kind: 'DOCUMENT', fileId, allowDownload: false }).expect(201)).body;
    expect(m.lessonList[0]!.text).toMatchObject({ status: 'READY', source: 'DOCUMENT', parts: 1 });
    expect(m.lessonList[0]!.file).toMatchObject({ name: 'Sales playbook.pdf', contentType: 'application/pdf', viewable: true });
    const gen = (await api(owner).post(`/learning/modules/${id}/generate`, { types: ['FILL_BLANK', 'MCQ'], count: 4 }).expect(200)).body as GenerateResult;
    expect(gen.created.length).toBe(4);

    const ranged = await owner.agent.get(`/api/v1/learning/files/${fileId}`).set('range', 'bytes=0-99').expect(206);
    expect(ranged.headers['content-range']).toBe(`bytes 0-99/${pdf.length}`);
    expect(ranged.headers['x-frame-options']).toBe('SAMEORIGIN');
    const whole = await owner.agent.get(`/api/v1/learning/files/${fileId}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Buffer.compare(whole.body as Buffer, pdf)).toBe(0);
    // Not part of anything the executive takes: not found.
    await exec.agent.get(`/api/v1/learning/files/${fileId}`).expect(404);

    // A file of an unknown kind is kept as a download, and says it cannot be read.
    const blob = Buffer.alloc(PART + 1000, 7);
    const blobId = await upload(owner, 'training.bin', blob, 'application/octet-stream');
    m = (await api(owner).post(`/learning/modules/${id}/lessons`, { title: 'Extra file', kind: 'FILE', fileId: blobId }).expect(201)).body;
    expect(m.lessonList[1]!.text.status).toBe('UNREADABLE');
    expect(m.lessonList[1]!.text.note).toBeTruthy();
    // An unfinished upload cannot be used.
    const half = (await api(owner).post('/learning/files', { name: 'half.pdf', sizeBytes: 2 * PART }).expect(201)).body as { id: string };
    expect((await api(owner).post(`/learning/modules/${id}/lessons`, { title: 'Half', kind: 'DOCUMENT', fileId: half.id }).expect(400)).body.error.code).toBe('LEARNING_FILE_UNKNOWN');
    expect((await api(owner).post(`/learning/files/${half.id}/complete`, {}).expect(400)).body.error.code).toBe('LEARNING_FILE_INCOMPLETE');
    // A draft with no learning history can be deleted; one with history cannot.
    await api(owner).del(`/learning/modules/${id}`).expect(204);
    expect((await api(manager).del(`/learning/modules/${moduleId}`).expect(409)).body.error.code).toBe('LEARNING_MODULE_IN_USE');
  });
});
