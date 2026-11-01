import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { signZoomEvent, startZoomFixture, transcriptEvent, ZOOM_ACCOUNT, ZOOM_APP, type ZoomFixture } from './fixtures/zoom-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

type Status = { key: string; state: string; missingConfig: string[]; connection: { accountName: string; externalAccountId: string; lastError: string | null } | null };

describe('Zoom without app credentials', () => {
  it('shows Pending Configuration, refuses to connect and refuses events', async () => {
    const restore = setEnv({ ZOOM_CLIENT_ID: undefined, ZOOM_CLIENT_SECRET: undefined, ZOOM_WEBHOOK_SECRET_TOKEN: undefined });
    const app = await startApp();
    try {
      const owner = await registerUser(app, 'No Zoom Ltd');
      const zoom = ((await api(owner).get('/apps').expect(200)).body as Status[]).find((a) => a.key === 'zoom');
      expect(zoom).toMatchObject({ state: 'pending_configuration', missingConfig: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'], connection: null });
      expect((await api(owner).post('/apps/zoom/connect', {}).expect(409)).body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
      const e = signZoomEvent({ event: 'endpoint.url_validation', payload: { plainToken: 'abc' } });
      await request(app.getHttpServer()).post('/api/v1/apps/zoom/events').set(e.headers).send(e.raw).expect(403);
    } finally {
      await app.close();
      restore();
    }
  });
});

describe('Zoom app (stand-in)', () => {
  let app: INestApplication;
  let zoom: ZoomFixture;
  let owner: TestUser;
  let worker: WorkerService;
  let restore: () => void;
  let leadId: string;
  let recordedMeetingId: string;

  const status = async (u: TestUser) => ((await api(u).get('/apps').expect(200)).body as Status[]).find((a) => a.key === 'zoom')!;
  const post = (body: object, opts: { secret?: string; ts?: number } = {}) => {
    const e = signZoomEvent(body, opts.secret, opts.ts);
    return request(app.getHttpServer()).post('/api/v1/apps/zoom/events').set(e.headers).send(e.raw);
  };
  const connect = async (u: TestUser) => {
    const { url } = (await api(u).post('/apps/zoom/connect', {}).expect(200)).body as { url: string };
    const state = new URL(url).searchParams.get('state')!;
    return api(u).get(`/apps/zoom/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
  };

  beforeAll(async () => {
    zoom = await startZoomFixture();
    restore = setEnv({ ZOOM_CLIENT_ID: ZOOM_APP.id, ZOOM_CLIENT_SECRET: ZOOM_APP.secret, ZOOM_WEBHOOK_SECRET_TOKEN: ZOOM_APP.webhookSecret, ZOOM_AUTH_BASE_URL: zoom.url, ZOOM_API_BASE_URL: `${zoom.url}/v2` });
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Zoom Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    leadId = (await api(owner).post('/leads', { fullName: 'Priya Raman', companyName: 'Kestrel Analytics' }).expect(201)).body.lead.id;
  });

  afterAll(async () => {
    await app.close();
    await zoom.close();
    restore();
  });

  it('answers Zoom’s URL validation and refuses unsigned, wrongly signed or stale events', async () => {
    const ok = await post({ event: 'endpoint.url_validation', payload: { plainToken: 'qgg8vlvZRS6UYooatFL8Aw' } }).expect(200);
    expect(ok.body.plainToken).toBe('qgg8vlvZRS6UYooatFL8Aw');
    expect(ok.body.encryptedToken).toMatch(/^[a-f0-9]{64}$/);
    await post({ event: 'endpoint.url_validation', payload: { plainToken: 'x' } }, { secret: 'wrong' }).expect(401);
    await post({ event: 'endpoint.url_validation', payload: { plainToken: 'x' } }, { ts: Math.floor(Date.now() / 1000) - 3600 }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/apps/zoom/events').set('content-type', 'application/json').send('{}').expect(401);
  });

  it('only admins connect; tokens are sealed; the account id routes events', async () => {
    const member = await inviteMember(app, owner, 'member');
    await api(member).post('/apps/zoom/connect', {}).expect(403);
    const res = await connect(owner);
    expect(res.headers.location).toMatch(/app=zoom&app_connected=1$/);
    expect(await status(owner)).toMatchObject({ state: 'connected', connection: { accountName: 'Zoom account of owner@zoom.test', externalAccountId: ZOOM_ACCOUNT } });
    const row = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirstOrThrow({ where: { tenantId: owner.tenantId, provider: 'ZOOM' } }));
    expect(row.credentialsEncrypted).toMatch(/^v1\./);
    expect(row.credentialsEncrypted).not.toContain('zat-');
    expect(JSON.stringify(await status(owner))).not.toContain('zat-');
  });

  it('schedules a meeting for the signed-in person, logs it on the lead, and checks the record and consent', async () => {
    const http = api(owner);
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    await http.post('/apps/zoom/meetings', { topic: 'No record', startsAt, durationMinutes: 30 }).expect(400);
    const noConsent = await http.post('/apps/zoom/meetings', { topic: 'Pricing call', startsAt, durationMinutes: 30, leadId, recordToCloud: true }).expect(400);
    expect(JSON.stringify(noConsent.body)).toContain('Confirm that participants agree to the recording');

    const plain = (await http.post('/apps/zoom/meetings', { topic: 'Intro call', startsAt, durationMinutes: 30, leadId }).expect(201)).body;
    expect(plain).toMatchObject({ topic: 'Intro call', hostEmail: owner.email, recordToCloud: false, transcriptStatus: 'none', leadId, joinUrl: expect.stringMatching(/^https:\/\/zoom\.test\/j\/\d+$/) });
    expect(zoom.meetings.at(-1)).toMatchObject({ host: owner.email, body: { topic: 'Intro call', type: 2, duration: 30, settings: { auto_recording: 'none', waiting_room: true } } });

    const recorded = (await http.post('/apps/zoom/meetings', { topic: 'Pricing call', startsAt, durationMinutes: 45, leadId, recordToCloud: true, recordingConsent: true }).expect(201)).body;
    expect(recorded).toMatchObject({ recordToCloud: true, transcriptStatus: 'waiting' });
    expect(zoom.meetings.at(-1)!.body).toMatchObject({ settings: { auto_recording: 'cloud' } });
    recordedMeetingId = recorded.zoomMeetingId;

    const listed = (await http.get(`/apps/zoom/meetings?leadId=${leadId}`).expect(200)).body;
    expect(listed.map((m: { topic: string }) => m.topic).sort()).toEqual(['Intro call', 'Pricing call']);
    const activities = await asTenant(owner.tenantId, (tx) => tx.activity.findMany({ where: { tenantId: owner.tenantId, leadId, type: 'MEETING' } }));
    expect(activities.map((a) => a.subject).sort()).toEqual(['Zoom: Intro call', 'Zoom: Pricing call']);
    expect(activities.find((a) => a.subject === 'Zoom: Intro call')!.body).toContain(plain.joinUrl);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenantId, action: 'zoom.meeting_scheduled', entityId: recorded.id } }));
    expect(audit.metadata).toMatchObject({ recordToCloud: true, recordingConsentConfirmed: true });
  });

  it('explains when the person is not a user in the Zoom account', async () => {
    const rep = await inviteMember(app, owner, 'member');
    zoom.notUsers.add(rep.email);
    const r = await api(rep).post('/apps/zoom/meetings', { topic: 'Rep call', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, leadId }).expect(400);
    expect(r.body.error.message).toContain(`${rep.email} is not a user in the connected Zoom account`);
    expect((await api(owner).get('/apps/zoom/events').expect(200)).body[0]).toMatchObject({ kind: 'meeting.failed', ok: false });
  });

  it('imports the transcript of a recorded DealFlow meeting into meeting notes, and ignores other meetings', async () => {
    // A meeting not scheduled from DealFlow, and another Zoom account: both ignored.
    await post(transcriptEvent(zoom.url, '99999999999')).expect(200);
    await post(transcriptEvent(zoom.url, recordedMeetingId, 'OTHERACCOUNT')).expect(200);
    await post(transcriptEvent(zoom.url, recordedMeetingId)).expect(200);
    await worker.drain();
    const m = (await api(owner).get(`/apps/zoom/meetings?leadId=${leadId}`).expect(200)).body.find((x: { zoomMeetingId: string }) => x.zoomMeetingId === recordedMeetingId);
    expect(m).toMatchObject({ transcriptStatus: 'imported', transcriptError: null, meetingRecordId: expect.any(String) });
    const notes = await asTenant(owner.tenantId, (tx) => tx.meetingRecord.findUniqueOrThrow({ where: { id: m.meetingRecordId } }));
    expect(notes).toMatchObject({ title: 'Pricing call', leadId, source: 'transcript', transcriptionStatus: 'done', transcriptionProvider: 'zoom' });
    expect(notes.transcript).toBe("Priya Raman: Thanks for joining. Can we go over pricing for 40 seats?\nOwen Price: Yes. We need SSO and an answer by Friday.\nPriya Raman: I'll send the proposal tomorrow.");
    expect(notes.segments).toEqual([
      { speaker: 0, start: 1.2, end: 4.5, text: 'Thanks for joining. Can we go over pricing for 40 seats?' },
      { speaker: 1, start: 5, end: 9.1, text: 'Yes. We need SSO and an answer by Friday.' },
      { speaker: 0, start: 9.5, end: 12, text: "I'll send the proposal tomorrow." },
    ]);
    const row = await asTenant(owner.tenantId, (tx) => tx.zoomMeeting.findFirstOrThrow({ where: { zoomMeetingId: recordedMeetingId } }));
    expect(row.transcriptSource).toBeNull();
    // Only one notes record, even if Zoom repeats the event.
    await post(transcriptEvent(zoom.url, recordedMeetingId)).expect(200);
    await worker.drain();
    expect(await asTenant(owner.tenantId, (tx) => tx.meetingRecord.count({ where: { tenantId: owner.tenantId, transcriptionProvider: 'zoom' } }))).toBe(1);
  });

  it('a transcript link that no longer works is reported, not retried forever', async () => {
    const http = api(owner);
    const m = (await http.post('/apps/zoom/meetings', { topic: 'Expired link', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, leadId, recordToCloud: true, recordingConsent: true }).expect(201)).body;
    const ev = transcriptEvent(zoom.url, m.zoomMeetingId) as { download_token: string };
    ev.download_token = 'expired-token';
    await post(ev).expect(200);
    await worker.drain();
    const after = (await http.get(`/apps/zoom/meetings?leadId=${leadId}`).expect(200)).body.find((x: { id: string }) => x.id === m.id);
    expect(after).toMatchObject({ transcriptStatus: 'failed', transcriptError: expect.stringContaining('link expired') });
  });

  it('refreshes an expired token once, and marks the app when Zoom refuses the refresh token', async () => {
    const http = api(owner);
    // Every access token issued so far stops working early; the next call refreshes once and succeeds.
    zoom.expireAll();
    const before = zoom.calls.filter((c) => c === 'POST /oauth/token').length;
    await http.post('/apps/zoom/meetings', { topic: 'After refresh', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, leadId }).expect(201);
    expect(zoom.calls.filter((c) => c === 'POST /oauth/token').length).toBe(before + 1);

    // The app is removed in Zoom: the refresh token stops working.
    for (const t of zoom.liveRefreshTokens()) zoom.deadRefresh.add(t);
    zoom.expireAll();
    const r = await http.post('/apps/zoom/meetings', { topic: 'Dead', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, leadId }).expect(400);
    expect(r.body.error.message).toContain('Reconnect Zoom');
    expect(await status(owner)).toMatchObject({ state: 'error', connection: { lastError: expect.stringContaining('Reconnect Zoom') } });
    await connect(owner);
    expect((await status(owner)).state).toBe('connected');
  });

  it('removing the app in Zoom disconnects it, and disconnect revokes the token', async () => {
    await post({ event: 'app_deauthorized', payload: { account_id: ZOOM_ACCOUNT, user_id: 'zu_owner', deauthorization_time: new Date().toISOString() } }).expect(200);
    expect(await status(owner)).toMatchObject({ state: 'not_connected', connection: null });
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenantId, action: 'app.disconnected' }, orderBy: { createdAt: 'desc' } }));
    expect(audit.metadata).toMatchObject({ app: 'zoom', reason: 'removed in Zoom Marketplace' });
    // Meeting history stays.
    expect((await api(owner).get(`/apps/zoom/meetings?leadId=${leadId}`).expect(200)).body.length).toBeGreaterThan(0);

    await connect(owner);
    await api(owner).del('/apps/zoom').expect(204);
    expect(zoom.calls.at(-1)).toBe('POST /oauth/revoke');
    const r = await api(owner).post('/apps/zoom/meetings', { topic: 'x', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, leadId }).expect(400);
    expect(r.body.error.message).toContain('Zoom is not connected');
  });
});
