import type { INestApplication } from '@nestjs/common';
import type { MeetingRecord, MeetingRecordRow, MeetingRow, TranscriptionStatus } from '@dealflow/types';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { API_ENV, type ApiEnv } from '../src/common/env';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const TRANSCRIPT = [
  "Speaker 0: Hi, I'm Sam from SampForce. Thanks for joining.",
  "Speaker 1: Thanks. I'm Priya. We need single sign-on for 200 staff.",
  'Speaker 1: Honestly the annual price feels expensive for us.',
  "Speaker 0: Understood. I'll send a pricing comparison by Friday.",
  "Speaker 1: We'll check the security questionnaire internally.",
  "Speaker 0: Great, let's agree on a pilot in March.",
];

/** A stand-in for Deepgram's pre-recorded endpoint: records what arrived and answers with diarised utterances. */
async function startDeepgram(): Promise<{ url: string; requests: { auth: string; type: string; bytes: number; query: string }[]; status: { code: number }; close: () => Promise<void> }> {
  const requests: { auth: string; type: string; bytes: number; query: string }[] = [];
  const status = { code: 200 };
  const server: Server = createServer((req, res) => {
    let bytes = 0;
    req.on('data', (c: Buffer) => (bytes += c.length));
    req.on('end', () => {
      requests.push({ auth: String(req.headers.authorization), type: String(req.headers['content-type']), bytes, query: req.url ?? '' });
      res.writeHead(status.code, { 'content-type': 'application/json' });
      if (status.code !== 200) return res.end(JSON.stringify({ err_msg: 'Bad audio' }));
      res.end(
        JSON.stringify({
          metadata: { duration: 61.5 },
          results: {
            channels: [{ alternatives: [{ transcript: TRANSCRIPT.map((l) => l.replace(/^Speaker \d: /, '')).join(' ') }] }],
            utterances: TRANSCRIPT.map((l, i) => ({ start: i * 10, end: i * 10 + 9, speaker: Number(l[8]), transcript: l.replace(/^Speaker \d: /, '') })),
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, status, close: () => new Promise((r) => server.close(() => r())) };
}

/** Enhancement feature 7: meeting notes, transcripts and recordings turned into reviewed CRM information. */
describe('meeting intelligence', () => {
  let app: INestApplication;
  let ai: AiFixture;
  let dg: Awaited<ReturnType<typeof startDeepgram>>;
  let u: TestUser;
  let env: ApiEnv;
  const ids: Record<string, string> = {};
  const h = () => api(u);
  const upload = (id: string, opts: { consent?: boolean; type?: string; bytes?: number } = {}) =>
    u.agent
      .post(`/api/v1/meeting-records/${id}/recording${opts.consent === false ? '' : '?consent=true'}`)
      .set('origin', 'http://localhost:3000')
      .set('content-type', opts.type ?? 'audio/mpeg')
      .send(Buffer.alloc(opts.bytes ?? 4096, 1));

  beforeAll(async () => {
    ai = await createAiFixture();
    dg = await startDeepgram();
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_API_BASE_URL = ai.url;
    process.env.DEEPGRAM_API_BASE_URL = dg.url;
    delete process.env.DEEPGRAM_API_KEY;
    app = await startApp();
    env = app.get<ApiEnv>(API_ENV);
    u = await registerUser(app, 'Meeting Co');
    await asTenant(u.tenantId, (tx) => tx.subscription.update({ where: { tenantId: u.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    ids.company = (await h().post('/companies', { name: 'Brightline' }).expect(201)).body.id;
    ids.contact = (await h().post('/contacts', { firstName: 'Priya', lastName: 'Rao', email: 'priya@brightline.test', companyId: ids.company }).expect(201)).body.id;
    const stage = (await h().get('/pipelines').expect(200)).body[0].stages[0];
    ids.deal = (await h().post('/deals', { name: 'Brightline SSO', amount: 20000, stageId: stage.id, companyId: ids.company, contactId: ids.contact }).expect(201)).body.id;
    ids.meeting = await asTenant(u.tenantId, async (tx) => {
      const m = await tx.membership.findFirstOrThrow({ where: { tenantId: u.tenantId } });
      const c = await tx.integrationConnection.create({ data: { tenantId: u.tenantId, userId: m.userId, provider: 'GOOGLE', accountEmail: 'sam@seller.test', scopes: [], credentialsEncrypted: 'v1.x.y.z' } });
      return (
        await tx.meeting.create({
          data: {
            tenantId: u.tenantId, connectionId: c.id, providerEventId: 'ev-1', title: 'Brightline discovery', startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000),
            attendees: ['sam@seller.test', 'priya@brightline.test'], contactIds: [ids.contact!], joinUrl: 'https://meet.google.com/abc-defg-hij',
          },
        })
      ).id;
    });
  });
  afterAll(async () => {
    await app.close();
    await ai.close();
    await dg.close();
    for (const k of ['ANTHROPIC_API_KEY', 'AI_API_BASE_URL', 'DEEPGRAM_API_BASE_URL', 'DEEPGRAM_API_KEY']) delete process.env[k];
  });

  it('opens one record per calendar meeting, and shows the platform and record on the meeting list', async () => {
    const a = (await h().post('/meeting-records', { meetingId: ids.meeting }).expect(201)).body as MeetingRecord;
    expect(a).toMatchObject({ title: 'Brightline discovery', contact: { id: ids.contact, name: 'Priya Rao' }, attendees: ['sam@seller.test', 'priya@brightline.test'], joinUrl: 'https://meet.google.com/abc-defg-hij', transcriptionStatus: 'none', analysis: null });
    const again = (await h().post('/meeting-records', { meetingId: ids.meeting }).expect(201)).body as MeetingRecord;
    expect(again.id).toBe(a.id);
    ids.record = a.id;
    const meetings = (await h().get('/meetings').expect(200)).body as MeetingRow[];
    expect(meetings.find((m) => m.id === ids.meeting)).toMatchObject({ platform: 'google_meet', recordId: a.id });
    await h().post('/meeting-records', {}).expect(400);
  });

  it('says transcription is pending configuration without a key, and refuses uploads honestly', async () => {
    expect((await h().get('/meeting-records/transcription-status').expect(200)).body).toMatchObject<Partial<TranscriptionStatus>>({ provider: 'deepgram', state: 'pending_configuration', lastSuccessAt: null });
    const res = await upload(ids.record!).expect(409);
    expect(res.body.error.code).toBe('PENDING_CONFIGURATION');
    expect(dg.requests).toHaveLength(0);
  });

  it('transcribes an uploaded recording with speakers, only after consent, without storing the audio', async () => {
    env.DEEPGRAM_API_KEY = 'dg-test-key';
    expect((await h().get('/meeting-records/transcription-status').expect(200)).body.state).toBe('configured');
    expect((await upload(ids.record!, { consent: false }).expect(400)).body.error.code).toBe('CONSENT_REQUIRED');
    await upload(ids.record!, { type: 'text/plain' }).expect(400);
    env.MEETING_UPLOAD_MAX_MB = 1;
    expect((await upload(ids.record!, { bytes: 1024 * 1024 + 10 }).expect(413)).body.error.code).toBe('PAYLOAD_TOO_LARGE');
    env.MEETING_UPLOAD_MAX_MB = 100;
    expect(dg.requests).toHaveLength(0);

    const r = (await upload(ids.record!).expect(200)).body as MeetingRecord;
    expect(dg.requests.at(-1)).toMatchObject({ auth: 'Token dg-test-key', type: 'audio/mpeg', bytes: 4096 });
    expect(dg.requests.at(-1)!.query).toContain('diarize=true');
    expect(r).toMatchObject({ source: 'recording', transcriptionStatus: 'done', transcriptionProvider: 'deepgram', recordingConsent: { by: { name: 'User Meeting Co' } } });
    expect(r.segments).toHaveLength(6);
    expect(r.segments![1]).toMatchObject({ speaker: 1, text: "Thanks. I'm Priya. We need single sign-on for 200 staff." });
    expect(r.transcript).toContain('Speaker 0: Hi, I\'m Sam');
    expect((await h().get('/meeting-records/transcription-status').expect(200)).body.state).toBe('verified');
    const audit = (await h().get('/audit-logs?limit=5').expect(200)).body.items as { action: string; metadata: Record<string, unknown> }[];
    expect(audit.find((x) => x.action === 'meeting_record.transcribed')!.metadata).toMatchObject({ provider: 'deepgram', durationSeconds: 61.5, consentConfirmed: true });

    // A provider failure is reported, not hidden.
    const other = (await h().post('/meeting-records', { title: 'Bad audio call', contactId: ids.contact }).expect(201)).body as MeetingRecord;
    dg.status.code = 400;
    expect((await upload(other.id).expect(422)).body.error.message).toContain('Bad audio');
    dg.status.code = 200;
    expect((await h().get(`/meeting-records/${other.id}`).expect(200)).body).toMatchObject({ transcriptionStatus: 'failed', transcriptionError: expect.stringContaining('Bad audio') });
  });

  it('reads the transcript with AI into a structured proposal that is not yet reviewed', async () => {
    const r = (await h().post(`/meeting-records/${ids.record}/analyse`).expect(200)).body as MeetingRecord;
    expect(r.reviewed).toBe(false);
    expect(r.analysis).toMatchObject({
      requirements: ["Thanks. I'm Priya. We need single sign-on for 200 staff."],
      objections: ['Honestly the annual price feels expensive for us.'],
      decisions: ["Great, let's agree on a pilot in March."],
      participants: [
        { name: 'Sam', speaker: 0, side: 'us' },
        { name: 'Priya', speaker: 1, side: 'customer' },
      ],
    });
    expect(r.analysis!.actionItems).toEqual([
      { title: 'send a pricing comparison by Friday', owner: 'me', dueInDays: 3, taskId: null },
      { title: 'check the security questionnaire internally', owner: 'customer', dueInDays: null, taskId: null },
    ]);
    // The transcript reached the model as untrusted data, with the meeting's attendees.
    const sent = JSON.stringify(ai.requests.at(-1));
    expect(sent).toContain('untrusted_data');
    expect(sent).toContain('priya@brightline.test');

    // Tasks and the record note wait for a person's review.
    expect((await h().post(`/meeting-records/${ids.record}/tasks`, { indexes: [0] }).expect(409)).body.error.code).toBe('REVIEW_REQUIRED');
    expect((await h().post(`/meeting-records/${ids.record}/save`).expect(409)).body.error.code).toBe('REVIEW_REQUIRED');
  });

  it('saves the reviewed edits, creates tasks once per item, and logs the summary on the deal', async () => {
    const current = (await h().get(`/meeting-records/${ids.record}`).expect(200)).body as MeetingRecord;
    const edited = {
      ...current.analysis!,
      summary: 'Priya needs SSO for 200 staff; price is the concern. Pilot in March.',
      actionItems: [...current.analysis!.actionItems.map((a, i) => ({ ...a, taskId: i === 0 ? '00000000-0000-4000-8000-000000000000' : a.taskId })), { title: 'Book the pilot kickoff', owner: 'me' as const, dueInDays: 7, taskId: null }],
    };
    const reviewed = (await h().patch(`/meeting-records/${ids.record}`, { analysis: edited, dealId: ids.deal }).expect(200)).body as MeetingRecord;
    expect(reviewed).toMatchObject({ reviewed: true, reviewedBy: { name: 'User Meeting Co' }, deal: { id: ids.deal }, analysis: { summary: edited.summary } });
    // A made-up task id is not kept.
    expect(reviewed.analysis!.actionItems[0]!.taskId).toBeNull();
    await h().patch(`/meeting-records/${ids.record}`, { analysis: { ...edited, summary: '' } }).expect(400);

    const withTasks = (await h().post(`/meeting-records/${ids.record}/tasks`, { indexes: [0, 2, 2, 9] }).expect(200)).body as MeetingRecord;
    expect(withTasks.taskIds).toHaveLength(2);
    expect(withTasks.analysis!.actionItems.map((a) => !!a.taskId)).toEqual([true, false, true]);
    const again = (await h().post(`/meeting-records/${ids.record}/tasks`, { indexes: [0] }).expect(200)).body as MeetingRecord;
    expect(again.taskIds).toHaveLength(2);
    const tasks = (await h().get(`/tasks?opportunityId=${ids.deal}`).expect(200)).body;
    const titles = (tasks.items ?? tasks).map((t: { title: string }) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['send a pricing comparison by Friday', 'Book the pilot kickoff']));

    const saved = (await h().post(`/meeting-records/${ids.record}/save`).expect(200)).body as MeetingRecord;
    expect(saved.savedToRecord).toBe(true);
    await h().post(`/meeting-records/${ids.record}/save`).expect(409);
    const acts = (await h().get(`/activities?opportunityId=${ids.deal}`).expect(200)).body;
    const meeting = (acts.items ?? acts).find((a: { type: string }) => a.type === 'MEETING');
    expect(meeting.subject).toBe('Brightline discovery');
    expect(meeting.body).toContain('Requirements:');
    expect(meeting.body).toContain('Book the pilot kickoff (us)');

    const onDeal = (await h().get(`/meeting-records?dealId=${ids.deal}`).expect(200)).body as MeetingRecordRow[];
    expect(onDeal).toMatchObject([{ id: ids.record, reviewed: true, savedToRecord: true, taskCount: 2, hasAnalysis: true }]);
  });

  it('works from pasted notes, and editing a transcript drops the stale speaker turns', async () => {
    const r = (await h().post('/meeting-records', { title: 'Quick call with Priya', contactId: ids.contact }).expect(201)).body as MeetingRecord;
    await h().post(`/meeting-records/${r.id}/analyse`).expect(400);
    await h().patch(`/meeting-records/${r.id}`, { transcript: 'Priya said they need an audit log export. I will send the docs this week.' }).expect(200);
    const a = (await h().post(`/meeting-records/${r.id}/analyse`).expect(200)).body as MeetingRecord;
    expect(a.source).toBe('notes');
    expect(a.analysis!.requirements).toEqual(['Priya said they need an audit log export. I will send the docs this week.']);
    await h().post(`/meeting-records/${r.id}/save`).expect(409);

    const edited = (await h().patch(`/meeting-records/${ids.record}`, { transcript: 'Speaker 0: corrected text from Sam' }).expect(200)).body as MeetingRecord;
    expect(edited).toMatchObject({ segments: null, source: 'recording', transcript: 'Speaker 0: corrected text from Sam' });
  });

  it('respects permissions and keeps records inside the workspace', async () => {
    const viewer = await inviteMember(app, u, 'viewer');
    expect((await api(viewer).get(`/meeting-records/${ids.record}`).expect(200)).body.id).toBe(ids.record);
    await api(viewer).post(`/meeting-records/${ids.record}/analyse`).expect(403);
    await api(viewer).patch(`/meeting-records/${ids.record}`, { title: 'x' }).expect(403);
    const other = await registerUser(app, 'Snoop Meetings');
    const s = api(other);
    expect((await s.get('/meeting-records').expect(200)).body).toEqual([]);
    await s.get(`/meeting-records/${ids.record}`).expect(404);
    await s.post('/meeting-records', { meetingId: ids.meeting }).expect(404);
    await s.post(`/meeting-records/${ids.record}/analyse`).expect(404);
    await h().patch(`/meeting-records/${ids.record}`, { dealId: (await s.post('/deals', { name: 'x', stageId: (await s.get('/pipelines').expect(200)).body[0].stages[0].id }).expect(201)).body.id }).expect(400);
    await h().del(`/meeting-records/${ids.record}`).expect(204);
    await h().get(`/meeting-records/${ids.record}`).expect(404);
  });
});
