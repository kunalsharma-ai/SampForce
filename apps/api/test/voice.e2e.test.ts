import type { INestApplication } from '@nestjs/common';
import type { VoiceNote } from '@dealflow/types';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { API_ENV, type ApiEnv } from '../src/common/env';
import { checkAction } from '../src/voice/voice-notes.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const SAID = 'Create a follow-up task for this lead tomorrow at 3 pm. Add a note that the client requested a revised quotation.';

async function startDeepgram() {
  const requests: { query: string; bytes: number }[] = [];
  const server: Server = createServer((req, res) => {
    let bytes = 0;
    req.on('data', (c: Buffer) => (bytes += c.length));
    req.on('end', () => {
      requests.push({ query: req.url ?? '', bytes });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ metadata: { duration: 7.2 }, results: { channels: [{ detected_language: 'en', alternatives: [{ transcript: SAID }] }] } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Enhancement feature 12: voice notes turned into CRM actions the person confirms. */
describe('voice to CRM', () => {
  let app: INestApplication;
  let ai: AiFixture;
  let dg: Awaited<ReturnType<typeof startDeepgram>>;
  let u: TestUser;
  let env: ApiEnv;
  const ids = {} as Record<'lead' | 'company' | 'deal' | 'contact', string>;
  const h = () => api(u);
  const today = new Date().toISOString().slice(0, 10);
  const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const note = async (transcript: string | undefined, record: { type: string; id: string } | null, language = 'auto') =>
    (await h().post('/voice-notes', { transcript, record, language }).expect(201)).body as VoiceNote;
  const interpret = async (id: string) => (await h().post(`/voice-notes/${id}/interpret`, { today }).expect(200)).body as VoiceNote;

  beforeAll(async () => {
    ai = await createAiFixture();
    dg = await startDeepgram();
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_API_BASE_URL = ai.url;
    process.env.DEEPGRAM_API_BASE_URL = dg.url;
    delete process.env.DEEPGRAM_API_KEY;
    app = await startApp();
    env = app.get<ApiEnv>(API_ENV);
    u = await registerUser(app, 'Voice Co');
    await asTenant(u.tenantId, (tx) => tx.subscription.update({ where: { tenantId: u.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    ids.lead = (await h().post('/leads', { fullName: 'Arjun Mehta', companyName: 'Zenith Foods' }).expect(201)).body.lead.id;
    ids.company = (await h().post('/companies', { name: 'Brightline' }).expect(201)).body.id;
    ids.contact = (await h().post('/contacts', { firstName: 'Priya', lastName: 'Rao', companyId: ids.company }).expect(201)).body.id;
    const stage = (await h().get('/pipelines').expect(200)).body[0].stages[0];
    ids.deal = (await h().post('/deals', { name: 'Brightline SSO', amount: 20000, stageId: stage.id, companyId: ids.company, contactId: ids.contact }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
    await ai.close();
    await dg.close();
    for (const k of ['ANTHROPIC_API_KEY', 'AI_API_BASE_URL', 'DEEPGRAM_API_BASE_URL', 'DEEPGRAM_API_KEY']) delete process.env[k];
  });

  it('turns a typed note on a lead into proposals, and creates nothing until confirmed', async () => {
    const n = await note(SAID, { type: 'lead', id: ids.lead });
    expect(n).toMatchObject({ source: 'typed', record: { type: 'lead', id: ids.lead, name: 'Arjun Mehta' }, actions: [] });
    const before = (await h().get(`/tasks?leadId=${ids.lead}`).expect(200)).body.length;
    const r = await interpret(n.id);
    expect(r.actions.map((a) => [a.action.type, a.status])).toEqual([['create_task', 'proposed'], ['add_note', 'proposed']]);
    expect(r.actions[0]!.action).toMatchObject({ title: 'Follow up', dueDate: plus(1), dueTime: '15:00', meeting: false });
    expect((await h().get(`/tasks?leadId=${ids.lead}`).expect(200)).body.length).toBe(before);

    // Confirm the task with an edit, at the person's time zone (UTC+5:30 sends -330), then the note.
    const edited = { ...r.actions[0]!.action, title: 'Call Arjun about the revised quote' };
    const a1 = (await h().post(`/voice-notes/${n.id}/apply`, { items: [{ index: 0, action: edited }], timezoneOffsetMinutes: -330 }).expect(200)).body as VoiceNote;
    expect(a1.actions.map((a) => a.status)).toEqual(['applied', 'proposed']);
    const task = (await h().get(`/tasks?leadId=${ids.lead}`).expect(200)).body.find((t: { title: string }) => t.title === 'Call Arjun about the revised quote');
    expect(task.dueAt).toBe(`${plus(1)}T09:30:00.000Z`);
    await h().post(`/voice-notes/${n.id}/apply`, { items: [{ index: 0, action: edited }] }).expect(409);
    await h().post(`/voice-notes/${n.id}/apply`, { items: [{ index: 1, action: { type: 'create_task', title: 'x', dueDate: null, dueTime: null, meeting: false } }] }).expect(400);
    const a2 = (await h().post(`/voice-notes/${n.id}/apply`, { items: [{ index: 1, action: r.actions[1]!.action }] }).expect(200)).body as VoiceNote;
    expect(a2.actions[1]).toMatchObject({ status: 'applied', result: { type: 'activity', link: `/app/leads/${ids.lead}` } });
    const acts = (await h().get(`/activities?leadId=${ids.lead}`).expect(200)).body.items as { type: string; body: string; aiAssisted: boolean }[];
    expect(acts.find((x) => x.type === 'NOTE')).toMatchObject({ body: 'The client requested a revised quotation.', aiAssisted: true });
    // Words cannot change after something was saved from them.
    expect((await h().patch(`/voice-notes/${n.id}`, { transcript: 'something else' }).expect(409)).body.error.code).toBe('ALREADY_APPLIED');
    const audit = (await h().get('/audit-logs?limit=10').expect(200)).body.items as { action: string }[];
    expect(audit.map((x) => x.action)).toContain('voice_note.applied');
  });

  it('schedules a meeting as a task, refuses what it cannot do, and creates leads only with what was said', async () => {
    const n = await note('Schedule a follow-up meeting next Monday. Delete the old deal. Add a lead, Ravi Kumar from Zenith Foods, email ravi@zenith.test.', null);
    const r = await interpret(n.id);
    expect(r.unsupported).toEqual(['Delete the old deal']);
    expect(r.actions.map((a) => a.action.type)).toEqual(['create_task', 'create_lead']);
    expect(r.actions[0]!.action).toMatchObject({ meeting: true });
    expect(r.actions[1]!.action).toMatchObject({ name: 'Ravi Kumar', company: 'Zenith Foods', email: 'ravi@zenith.test' });
    const done = (await h().post(`/voice-notes/${n.id}/apply`, { items: [{ index: 0, action: r.actions[0]!.action }, { index: 1, action: r.actions[1]!.action }] }).expect(200)).body as VoiceNote;
    expect(done.actions.map((a) => a.result?.type)).toEqual(['task', 'lead']);
    const lead = (await h().get(`/leads/${done.actions[1]!.result!.id}`).expect(200)).body;
    expect(lead).toMatchObject({ fullName: 'Ravi Kumar', email: 'ravi@zenith.test', source: 'Voice note' });
  });

  it('removes emails, phone numbers and odd dates that were not in the note', () => {
    const a = checkAction({ type: 'create_lead', name: 'Ravi', company: null, email: 'ravi@invented.test', phone: '+91 98765 43210' }, 'Add a lead Ravi', '2026-11-01', null);
    expect(a.action).toMatchObject({ email: null, phone: null });
    expect(a.warnings).toHaveLength(2);
    const ok = checkAction({ type: 'create_contact', firstName: 'Ana', lastName: null, jobTitle: null, email: null, phone: '98765 43210' }, 'Add contact Ana, phone 98765-43210', '2026-11-01', { type: 'company' });
    expect(ok.action).toMatchObject({ phone: '98765 43210' });
    const d = checkAction({ type: 'create_task', title: 'x', dueDate: '2031-01-01', dueTime: '10:00', meeting: false }, 'x', '2026-11-01', null);
    expect(d.action).toMatchObject({ dueDate: null, dueTime: null });
    expect(checkAction({ type: 'add_note', body: 'x' }, 'x', '2026-11-01', null).warnings[0]).toMatch(/needs a record/);
  });

  it('adds a contact at the deal company, and summarises the last call from what is on file', async () => {
    await h().post('/activities', { type: 'CALL', subject: 'Pricing call with Priya', body: 'Priya wants SSO for 200 staff and a revised quote by Friday.', opportunityId: ids.deal, occurredAt: new Date(Date.now() - 3_600_000).toISOString() }).expect(201);
    const n = await note('Summarize my last customer call. Add a new contact, Meera Shah.', { type: 'deal', id: ids.deal });
    const r = await interpret(n.id);
    expect(r.lastCall).toMatchObject({ title: 'Pricing call with Priya', summary: 'Priya wants SSO for 200 staff and a revised quote by Friday.', source: 'activity', link: `/app/deals/${ids.deal}` });
    const done = (await h().post(`/voice-notes/${n.id}/apply`, { items: [{ index: 0, action: r.actions[0]!.action }] }).expect(200)).body as VoiceNote;
    const c = (await h().get(`/contacts/${done.actions[0]!.result!.id}`).expect(200)).body;
    expect(c).toMatchObject({ firstName: 'Meera', lastName: 'Shah', company: { id: ids.company } });
    const none = await note('Summarize my last customer call.', { type: 'lead', id: ids.lead });
    expect((await interpret(none.id)).lastCallMissing).toBe(true);
  });

  it('transcribes a recording with the chosen language once configured, without keeping the audio', async () => {
    const n = await note(undefined, { type: 'contact', id: ids.contact }, 'hi');
    const send = (consent = true, type = 'audio/webm') => u.agent.post(`/api/v1/voice-notes/${n.id}/recording${consent ? '?consent=true' : ''}`).set('origin', 'http://localhost:3000').set('content-type', type).send(Buffer.alloc(2048, 1));
    const status = (await h().get('/voice-notes/transcription-status').expect(200)).body;
    expect(status).toMatchObject({ state: 'pending_configuration', maxUploadMb: 25 });
    expect((await send().expect(409)).body.error.code).toBe('PENDING_CONFIGURATION');
    env.DEEPGRAM_API_KEY = 'dg-test-key';
    expect((await send(false).expect(400)).body.error.code).toBe('CONSENT_REQUIRED');
    await send(true, 'text/plain').expect(400);
    const r = (await send().expect(200)).body as VoiceNote;
    expect(r).toMatchObject({ source: 'recording', transcriptionStatus: 'done', transcript: SAID, detectedLanguage: 'en', durationSeconds: 7.2 });
    expect(dg.requests.at(-1)!.query).toContain('language=hi');
    expect(dg.requests.at(-1)!.query).toContain('diarize=false');
    expect((await h().get('/voice-notes/transcription-status').expect(200)).body.state).toBe('verified');
    const auto = await note(undefined, null);
    await u.agent.post(`/api/v1/voice-notes/${auto.id}/recording?consent=true`).set('origin', 'http://localhost:3000').set('content-type', 'audio/webm').send(Buffer.alloc(100, 1)).expect(200);
    expect(dg.requests.at(-1)!.query).toContain('detect_language=true');
    const cols = await asTenant(u.tenantId, (tx) => tx.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'voice_notes'`);
    expect(cols.map((c) => c.column_name).some((c) => /audio|blob|data/.test(c))).toBe(false);
  });

  it('keeps voice notes personal and checks each permission', async () => {
    const mine = await note('Note that they liked the demo.', { type: 'contact', id: ids.contact });
    const viewer = await inviteMember(app, u, 'viewer');
    await viewer.agent.get(`/api/v1/voice-notes/${mine.id}`).expect(403);
    const rep = await inviteMember(app, u, 'member');
    await rep.agent.get(`/api/v1/voice-notes/${mine.id}`).expect(404);
    expect((await rep.agent.get('/api/v1/voice-notes').expect(200)).body).toEqual([]);
    const other = await registerUser(app, 'Elsewhere');
    await api(other).post('/voice-notes', { transcript: 'x', record: { type: 'contact', id: ids.contact } }).expect(404);
  });
});
