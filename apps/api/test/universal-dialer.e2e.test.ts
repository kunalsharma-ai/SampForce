import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { CallDetails, CallOutcomeDef, CallRow, CallStarted, CallStats, DialerLogRow, DialerRow, DialerSettings, DialerTestResult, FollowUpRow, InteractionRow, RecordingRow } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

interface Seen {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const AUDIO = Buffer.from('ID3' + 'sampforce-test-audio-'.repeat(40));
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

/**
 * The universal dialer (ADR 0089): any cloud provider with a click-to-call API, tested against a stand-in provider that
 * behaves like Exotel (form request, Basic keys, status callbacks, recordings) and a generic OAuth 2 provider.
 */
describe('universal dialer', () => {
  let app: INestApplication;
  let provider: Server;
  let base = '';
  const seen: Seen[] = [];
  let busyOnce = 0;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let companyId: string;
  let priyaId: string;
  let exotel: DialerRow;
  let placed: CallRow;
  let recording: RecordingRow;

  beforeAll(async () => {
    provider = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const path = req.url ?? '/';
        seen.push({ method: req.method ?? 'GET', path, headers: req.headers, body });
        const json = (status: number, b: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(b));
        const exotelKeys = req.headers.authorization === basic('exo-key', 'exo-token');
        if (path === '/v1/Accounts/acme.json') return exotelKeys ? json(200, { Account: { Sid: 'acme' } }) : json(401, { RestException: { Message: 'Authentication failed' } });
        if (path === '/v1/Accounts/acme/Calls/connect.json') {
          if (!exotelKeys) return json(401, { RestException: { Message: 'Authentication failed' } });
          if (busyOnce > 0) {
            busyOnce--;
            return json(503, { message: 'Try later' });
          }
          return json(200, { Call: { Sid: `EX${seen.length}`, Status: 'in-progress' } });
        }
        if (path.startsWith('/rec/')) {
          if (!exotelKeys) return res.writeHead(401).end();
          return res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(AUDIO);
        }
        if (path === '/oauth/token') {
          if (req.headers.authorization !== basic('client-1', 'client-secret')) return json(401, { error: 'invalid_client' });
          return json(200, { access_token: 'oauth-token-1', expires_in: 3600 });
        }
        if (path === '/v2/calls' && req.method === 'POST') return req.headers.authorization === 'Bearer oauth-token-1' ? json(201, { data: { id: 'oa-1' } }) : json(401, { error: 'expired' });
        if (path.startsWith('/v2/calls/') && req.method === 'DELETE') return res.writeHead(204).end();
        json(404, { message: 'Not found' });
      });
    });
    await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Dialers');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'professional', seats: 10 } }));
    const http = api(owner);
    rep = await inviteMember(app, owner, 'member');
    manager = await inviteMember(app, owner, 'manager');
    other = await inviteMember(app, owner, 'member');
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    await http.patch(`/tenants/current/members/${mId(rep.userId)}/org`, { reportingManagerId: manager.userId }).expect(200);
    const res = (
      await http
        .post('/company-leads', {
          company: { name: 'Bharat Panels', country: 'IN', timezone: 'Asia/Kolkata', primaryPhone: '+91 22 4100 2000', ownerId: rep.userId },
          employees: [{ firstName: 'Priya', lastName: 'Menon', jobTitle: 'Head of Research', email: 'priya@bharatpanels.example', phone: '+91 98111 22334' }],
        })
        .expect(201)
    ).body;
    companyId = res.company.id;
    [priyaId] = res.employeeIds;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => provider.close(() => r()));
  });

  const exotelInput = (secret?: string | null) => ({
    name: 'Exotel',
    kind: 'API',
    provider: 'exotel',
    agentPhone: '+91 98200 00001',
    config: {
      apiBaseUrl: base,
      account: 'acme',
      apiUser: 'exo-key',
      callPath: '/v1/Accounts/{account}/Calls/connect.json',
      testPath: '/v1/Accounts/{account}.json',
      apiMethod: 'POST',
      apiContentType: 'FORM',
      apiAuth: 'BASIC',
      apiBody: 'From={agentPhone}&To={phoneE164}&CallerId={callerId}&CustomField={callId}&StatusCallback={eventsUrl}&Record={recordFlag}',
      responseCallIdPath: 'Call.Sid',
      callerIds: ['+91 80 4000 1000', '+91 80 4000 2000'],
      defaultCountryCode: '+91',
      regions: ['IN'],
      recording: 'ALWAYS',
      allowIncoming: true,
    },
    ...(secret === undefined ? {} : { secrets: { apiSecret: secret } }),
  });

  const event = (d: DialerRow, body: object, token?: string) => {
    const u = new URL(d.eventsUrl!);
    const path = token ? u.pathname.replace(/[^/]+$/, token) : u.pathname;
    return request(app.getHttpServer()).post(path).send(body);
  };

  it('adds a cloud dialer whose keys are sealed, tests it for real, and keeps an integration log', async () => {
    const r = api(rep);
    // The secret is write-only: the dialer only says it is saved.
    exotel = (await r.post('/calls/dialers', exotelInput('wrong-token')).expect(201)).body as DialerRow;
    expect(exotel).toMatchObject({ kind: 'API', provider: 'exotel', status: 'UNTESTED', active: true, isDefault: true, secretsSaved: { apiSecret: true, clientSecret: false } });
    expect(JSON.stringify(exotel)).not.toContain('wrong-token');
    expect(exotel.eventsUrl).toMatch(new RegExp(`^${ORIGIN}/api/v1/calls/events/[a-f0-9]{24}/[\\w-]{30,}$`));
    expect(exotel.capabilities).toMatchObject({ statusBack: true, recordings: true, callerIdChoice: true, endCalls: false });
    const stored = await asTenant(owner.tenantId, (tx) => tx.dialer.findUniqueOrThrow({ where: { id: exotel.id } }));
    expect(JSON.stringify(stored)).not.toContain('wrong-token');

    // Wrong keys: the provider refuses them, and the dialer says so. It is never marked connected without a real answer.
    const bad = (await r.post(`/calls/dialers/${exotel.id}/test`).expect(200)).body as DialerTestResult;
    expect(bad).toMatchObject({ ok: false, status: 'FAILED' });
    expect(bad.message).toContain('refused the keys (401)');
    expect(bad.sample.request!.headers.authorization).toBe('Basic exo-key:••••••');

    // Saving the right token (left out keys stay as they were) and testing again connects it.
    exotel = (await r.put(`/calls/dialers/${exotel.id}`, exotelInput('exo-token')).expect(200)).body as DialerRow;
    expect(exotel.status).toBe('UNTESTED');
    const good = (await r.post(`/calls/dialers/${exotel.id}/test`).expect(200)).body as DialerTestResult;
    expect(good).toMatchObject({ ok: true, status: 'CONNECTED' });
    expect(good.steps.map((s) => s.ok)).toEqual([true, true, true]);
    expect(seen.at(-1)).toMatchObject({ method: 'GET', path: '/v1/Accounts/acme.json' });
    const listed = (await r.get('/calls/dialers').expect(200)).body as DialerSettings;
    expect(listed.dialers[0]).toMatchObject({ id: exotel.id, status: 'CONNECTED' });
    // A later PUT without secrets keeps the token.
    await r.put(`/calls/dialers/${exotel.id}`, exotelInput()).expect(200);
    expect(((await r.post(`/calls/dialers/${exotel.id}/test`).expect(200)).body as DialerTestResult).status).toBe('CONNECTED');

    const logs = (await r.get(`/calls/dialers/${exotel.id}/logs`).expect(200)).body as DialerLogRow[];
    expect(logs.some((l) => l.action === 'TEST' && !l.ok && l.httpStatus === 401)).toBe(true);
    expect(logs.some((l) => l.action === 'TEST' && l.ok && l.httpStatus === 200)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('exo-token');

    // Someone else cannot test, read or change it.
    await api(other).post(`/calls/dialers/${exotel.id}/test`).expect(404);
    await api(other).get(`/calls/dialers/${exotel.id}/logs`).expect(404);
    // SIP and SIM dialers need the phone that runs them, which comes later: they are refused, never faked.
    await r.post('/calls/dialers', { name: 'SIM', kind: 'SIM', provider: 'sim' }).expect(400);
  });

  it('places the call with the provider’s request filled in, retrying once when the provider is briefly busy', async () => {
    busyOnce = 1;
    const started = (await api(rep).post('/calls', { companyId, contactId: priyaId, numberSource: 'EMPLOYEE', callerId: '+91 80 4000 2000', recordingConsent: true }).expect(201)).body as CallStarted;
    placed = started.call;
    expect(started.launchUrl).toBeNull();
    expect(placed).toMatchObject({ status: 'RINGING', direction: 'OUTGOING', callerId: '+91 80 4000 2000', dialer: { id: exotel.id, kind: 'API', provider: 'exotel' }, providerStatus: 'requested', recordingActive: true });
    const calls = seen.filter((s) => s.path === '/v1/Accounts/acme/Calls/connect.json');
    expect(calls).toHaveLength(2);
    const form = Object.fromEntries(new URLSearchParams(calls.at(-1)!.body));
    expect(form).toMatchObject({ From: '+919820000001', To: '+919811122334', CallerId: '+918040002000', CustomField: placed.id, Record: 'true', StatusCallback: exotel.eventsUrl });
    expect(calls.at(-1)!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const sid = (await asTenant(owner.tenantId, (tx) => tx.phoneCall.findUniqueOrThrow({ where: { id: placed.id } }))).providerCallId;
    expect(sid).toMatch(/^EX\d+$/);

    // Numbers outside the dialer's countries, and caller ids that are not its own, are refused before anything is sent.
    await api(rep).post('/calls', { numberSource: 'OTHER', number: '+44 20 7946 0018' }).expect(400);
    await api(rep).post('/calls', { numberSource: 'OTHER', number: '98111 22334', callerId: '+91 11 0000 0000' }).expect(400);
    // A typed number without its country code gets the dialer's.
    const typed = (await api(rep).post('/calls', { numberSource: 'OTHER', number: '098111 99999' }).expect(201)).body as CallStarted;
    expect(typed.call.number).toBe('+91 98111 99999');
    // The provider's own failure fails the call, recorded as such, and the dialer shows it.
    await api(rep).put(`/calls/dialers/${exotel.id}`, { ...exotelInput(), config: { ...exotelInput().config, apiUser: 'nobody' } }).expect(200);
    const refused = await api(rep).post('/calls', { companyId, contactId: priyaId, numberSource: 'EMPLOYEE' }).expect(400);
    expect(refused.body.error.message).toContain('refused the keys');
    const failed = ((await api(rep).get('/calls?status=FAILED').expect(200)).body as CallRow[])[0]!;
    expect(failed).toMatchObject({ status: 'FAILED', employee: { id: priyaId } });
    expect(((await api(rep).get('/calls/dialers').expect(200)).body as DialerSettings).dialers[0]!.status).toBe('FAILED');
    await api(rep).put(`/calls/dialers/${exotel.id}`, exotelInput()).expect(200);
    await api(rep).del(`/calls/${typed.call.id}`).expect(204);
    await api(rep).del(`/calls/${failed.id}`).expect(204);
  });

  it('follows the call from the provider’s events, keeps a recording once, and refuses a wrong events address', async () => {
    const sid = (await asTenant(owner.tenantId, (tx) => tx.phoneCall.findUniqueOrThrow({ where: { id: placed.id } }))).providerCallId!;
    await event(exotel, { CallSid: sid, Status: 'in-progress' }, 'x'.repeat(43)).expect(401);
    await event(exotel, { CallSid: sid, Status: 'in-progress' }).expect(200);
    expect(((await api(rep).get(`/calls/${placed.id}`).expect(200)).body as CallRow).status).toBe('IN_PROGRESS');
    const done = { CallSid: sid, Status: 'completed', ConversationDuration: '0', Duration: '187', RecordingUrl: `${base}/rec/${sid}.mp3` };
    await event(exotel, done).expect(200);
    await event(exotel, done).expect(200); // providers retry: the recording is kept once
    const ended = (await api(rep).get(`/calls/${placed.id}`).expect(200)).body as CallRow;
    expect(ended).toMatchObject({ status: 'ENDED', durationSec: 187, recordingActive: false, recording: { source: 'PROVIDER', durationSec: 187 } });

    const list = (await api(rep).get('/calls/recordings').expect(200)).body as RecordingRow[];
    expect(list).toHaveLength(1);
    recording = list[0]!;
    expect(recording).toMatchObject({ callId: placed.id, source: 'PROVIDER', playable: true, canDownload: false, company: { id: companyId }, employee: { id: priyaId, name: 'Priya Menon' }, call: { dialer: { name: 'Exotel', provider: 'exotel' } } });
    expect(recording.expiresAt).toBeTruthy();

    // Playing fetches it from the provider with the dialer's keys once, then serves it in parts for seeking.
    const audio = await api(rep).get(`/calls/recordings/${recording.id}/audio`).buffer(true).expect(200);
    expect(audio.headers['content-type']).toContain('audio/mpeg');
    expect(Buffer.from(audio.body as Buffer).equals(AUDIO)).toBe(true);
    const part = await api(rep).get(`/calls/recordings/${recording.id}/audio`).set('range', 'bytes=0-9').buffer(true).expect(206);
    expect(part.headers['content-range']).toBe(`bytes 0-9/${AUDIO.length}`);
    expect(seen.filter((s) => s.path.startsWith('/rec/'))).toHaveLength(1);

    // Download follows the workspace's policy: managers by default, so the member cannot and their manager can.
    await api(rep).get(`/calls/recordings/${recording.id}/audio?download=1`).expect(403);
    const dl = await api(manager).get(`/calls/recordings/${recording.id}/audio?download=1`).buffer(true).expect(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    await api(other).get(`/calls/recordings/${recording.id}/audio`).expect(404);
    const noted = (await api(rep).patch(`/calls/recordings/${recording.id}`, { notes: 'Asked about B2B panel in Pune.' }).expect(200)).body as RecordingRow;
    expect(noted.notes).toBe('Asked about B2B panel in Pune.');
    expect(((await api(rep).get('/calls/recordings?q=priya').expect(200)).body as RecordingRow[]).map((x) => x.id)).toEqual([recording.id]);
    expect(((await api(rep).get('/calls?hasRecording=true').expect(200)).body as CallRow[]).map((c) => c.id)).toEqual([placed.id]);

    // An incoming call the provider reports is matched to the employee by number.
    await event(exotel, { CallSid: 'EXin1', Direction: 'inbound', From: '09811122334', To: '+918040001000', Status: 'ringing' }).expect(200);
    const ringing = (await api(rep).get('/calls/stats?tz=Asia/Kolkata').expect(200)).body as CallStats;
    expect(ringing.ringing).toEqual([expect.objectContaining({ direction: 'INCOMING', employee: expect.objectContaining({ id: priyaId }), company: expect.objectContaining({ id: companyId }) })]);
    await event(exotel, { CallSid: 'EXin1', Status: 'no-answer' }).expect(200);
    const missed = ((await api(rep).get('/calls?direction=INCOMING').expect(200)).body as CallRow[])[0]!;
    expect(missed).toMatchObject({ status: 'MISSED', number: '09811122334' });
    // Events that match no call are logged, not invented.
    expect((await event(exotel, { CallSid: 'nobody', Status: 'completed' }).expect(200)).body).toEqual({ ok: true, callId: null });
  });

  it('logs the outcome with its follow-up, creates the deal, and updates the employee and company', async () => {
    const outcomes = (await api(rep).get('/calls/outcomes').expect(200)).body as CallOutcomeDef[];
    expect(outcomes.length).toBeGreaterThanOrEqual(17);
    expect(outcomes.find((o) => o.key === 'SEND_DETAILS')).toMatchObject({ action: 'EMAIL_TASK', reached: true });
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const logged = (
      await api(rep)
        .post(`/calls/${placed.id}/log`, { outcome: 'RFQ_EXPECTED', remarks: 'RFQ for 400 completes next week.', followUp: { type: 'EMAIL', at, note: 'Send the rate card' }, createDeal: { name: 'Bharat Panels B2B study', amount: 12000, currency: 'USD' } })
        .expect(200)
    ).body as CallRow;
    expect(logged).toMatchObject({ status: 'LOGGED', outcome: 'RFQ_EXPECTED', durationSec: 187, deal: { name: 'Bharat Panels B2B study' }, nextCall: { title: 'Send the rate card', type: 'EMAIL' } });
    const deal = await asTenant(owner.tenantId, (tx) => tx.opportunity.findFirstOrThrow({ where: { companyId, name: 'Bharat Panels B2B study' } }));
    expect(deal.contactId).toBe(priyaId);
    expect(logged.deal?.id).toBe(deal.id);
    const emails = (await api(rep).get(`/follow-ups?type=EMAIL&bucket=upcoming&contactId=${priyaId}`).expect(200)).body as FollowUpRow[];
    expect(emails.map((f) => f.title)).toEqual(['Send the rate card']);
    const timeline = (await api(rep).get(`/companies/${companyId}/interactions?kind=CALL_OUTGOING`).expect(200)).body as InteractionRow[];
    expect(timeline[0]).toMatchObject({ outcome: 'RFQ expected', remarks: 'RFQ for 400 completes next week.', contact: { id: priyaId } });
    const contact = await asTenant(owner.tenantId, (tx) => tx.contact.findUniqueOrThrow({ where: { id: priyaId } }));
    expect(contact).toMatchObject({ lastCallOutcome: 'RFQ_EXPECTED', callCount: 1 });
    const company = await asTenant(owner.tenantId, (tx) => tx.company.findUniqueOrThrow({ where: { id: companyId } }));
    expect(company).toMatchObject({ lastCallOutcome: 'RFQ_EXPECTED', callCount: 1 });

    // A member without the deals permission cannot create one from a call.
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).post(`/calls/${placed.id}/log`, { outcome: 'INTERESTED' }).expect(403);
  });

  it('flags a wrong number and marks not interested on the employee only; nobody answering never closes the company', async () => {
    const r = api(rep);
    const before = await asTenant(owner.tenantId, (tx) => tx.company.findUniqueOrThrow({ where: { id: companyId } }));
    const one = ((await r.post('/calls', { companyId, contactId: priyaId, numberSource: 'EMPLOYEE' }).expect(201)).body as CallStarted).call;
    await r.post(`/calls/${one.id}/log`, { outcome: 'WRONG_NUMBER' }).expect(200);
    let d = (await r.get(`/calls/details?contactId=${priyaId}`).expect(200)).body as CallDetails;
    expect(d.employee).toMatchObject({ phoneFlagged: true, notInterested: false });
    expect(d.company!.phoneFlagged).toBe(false);
    await r.post('/calls/number-flag/clear', { contactId: priyaId }).expect(204);

    const two = ((await r.post('/calls', { companyId, contactId: priyaId, numberSource: 'EMPLOYEE' }).expect(201)).body as CallStarted).call;
    await r.post(`/calls/${two.id}/log`, { outcome: 'NOT_INTERESTED', markNotInterested: true }).expect(200);
    for (let i = 0; i < 3; i++) {
      const c = ((await r.post('/calls', { companyId, numberSource: 'COMPANY' }).expect(201)).body as CallStarted).call;
      await r.post(`/calls/${c.id}/log`, { outcome: 'NOT_PICKED' }).expect(200);
    }
    d = (await r.get(`/calls/details?contactId=${priyaId}`).expect(200)).body as CallDetails;
    expect(d.employee).toMatchObject({ phoneFlagged: false, notInterested: true });
    const company = await asTenant(owner.tenantId, (tx) => tx.company.findUniqueOrThrow({ where: { id: companyId } }));
    expect(company).toMatchObject({ lastCallOutcome: 'NOT_PICKED', callCount: 6 });
    // The company's status is untouched: unanswered calls never mark it lost.
    expect(company.statusId).toBe(before.statusId);
    // RFQ expected and Not interested reached her; the wrong number and three unanswered calls did not.
    expect(d.reachedCount).toBe(2);
  });

  it('lets workspace admins add their own outcomes and set the recording policy', async () => {
    await api(rep).post('/calls/outcomes', { label: 'Gatekeeper' }).expect(403);
    const all = (await api(owner).post('/calls/outcomes', { label: 'Gatekeeper', icon: 'UserX', color: '#0ea5e9', action: 'NEXT_CALL', followUpInMinutes: 1440 }).expect(201)).body as CallOutcomeDef[];
    const added = all.at(-1)!;
    expect(added).toMatchObject({ key: expect.stringMatching(/^CUSTOM_/), label: 'Gatekeeper', custom: true, reached: false });
    const c = ((await api(rep).post('/calls', { companyId, numberSource: 'COMPANY' }).expect(201)).body as CallStarted).call;
    expect(((await api(rep).post(`/calls/${c.id}/log`, { outcome: added.key }).expect(200)).body as CallRow).outcome).toBe(added.key);
    // A built-in outcome can be renamed for the workspace.
    await api(owner).put('/calls/outcomes/BUSY', { label: 'Line engaged', icon: 'PhoneOff', color: '#f59e0b', tone: 'missed', action: 'CALLBACK', followUpInMinutes: 60 }).expect(200);
    expect(((await api(rep).get('/calls/outcomes').expect(200)).body as CallOutcomeDef[]).find((o) => o.key === 'BUSY')!.label).toBe('Line engaged');
    await api(owner).del(`/calls/outcomes/${added.key}`).expect(200);

    // With download for everyone, the member can download; with recording switched off, uploads are refused.
    await api(rep).put('/calls/recording-policy', { enabled: true }).expect(403);
    await api(owner).put('/calls/recording-policy', { enabled: true, requireConsent: true, download: 'ALL', retentionDays: 30 }).expect(200);
    await api(rep).get(`/calls/recordings/${recording.id}/audio?download=1`).expect(200);
  });

  it('keeps a browser recording only after the caller confirms consent', async () => {
    const r = api(rep);
    const c = ((await r.post('/calls', { companyId, numberSource: 'COMPANY' }).expect(201)).body as CallStarted).call;
    const upload = () => rep.agent.post(`/api/v1/calls/${c.id}/recordings?source=BROWSER&durationSec=12`).set('origin', ORIGIN).set('content-type', 'audio/webm').send(AUDIO);
    expect((await upload().expect(400)).body.error.message).toContain('agreed to be recorded');
    await r.post(`/calls/${c.id}/consent`).expect(200);
    const rec = (await upload().expect(201)).body as RecordingRow;
    expect(rec).toMatchObject({ source: 'BROWSER', durationSec: 12, sizeBytes: AUDIO.length, contentType: 'audio/webm' });
    await rep.agent.post(`/api/v1/calls/${c.id}/recordings`).set('origin', ORIGIN).set('content-type', 'text/plain').send('hello').expect(400);
    await api(owner).put('/calls/recording-policy', { enabled: false }).expect(200);
    await upload().expect(400);
    await api(owner).put('/calls/recording-policy', { enabled: true }).expect(200);
    await r.del(`/calls/recordings/${rec.id}`).expect(204);
    await r.post(`/calls/${c.id}/log`, { outcome: 'OTHER' }).expect(200);
  });

  it('offers only the controls a dialer really has', async () => {
    const r = api(rep);
    const link = (await r.post('/calls/dialers', { name: 'Zoiper', kind: 'LINK', provider: 'callto', urlTemplate: 'callto:{phoneE164}' }).expect(201)).body as DialerRow;
    const c = ((await r.post('/calls', { companyId, numberSource: 'COMPANY', dialerId: link.id }).expect(201)).body as CallStarted).call;
    expect((await r.post(`/calls/${c.id}/control`, { action: 'MUTE' }).expect(400)).body.error.message).toContain('not available');
    expect(((await r.post(`/calls/${c.id}/control`, { action: 'HANGUP' }).expect(200)).body as CallRow).status).toBe('ENDED');

    // Switched off, a dialer cannot place calls until it is switched on again.
    await r.post(`/calls/dialers/${link.id}/active`, { active: false }).expect(200);
    expect((await r.post('/calls', { companyId, numberSource: 'COMPANY', dialerId: link.id }).expect(400)).body.error.message).toContain('switched off');
    await r.post(`/calls/dialers/${link.id}/active`, { active: true }).expect(200);
    await r.del(`/calls/dialers/${link.id}`).expect(204);
    await r.post(`/calls/${c.id}/log`, { outcome: 'CONNECTED' }).expect(200);
  });

  it('signs in with OAuth 2, places and ends the call through the provider', async () => {
    const r = api(manager);
    const input = {
      name: 'Cloud PBX',
      kind: 'API',
      provider: 'api',
      agentPhone: '+44 7700 900300',
      config: { apiBaseUrl: base, callPath: '/v2/calls', hangupPath: '/v2/calls/{providerCallId}', apiAuth: 'OAUTH2', clientId: 'client-1', tokenUrl: `${base}/oauth/token`, apiBody: '{"from":"{agentPhone}","to":"{phoneE164}","ref":"{callId}"}', responseCallIdPath: 'data.id' },
      secrets: { clientSecret: 'client-secret' },
    };
    const d = (await r.post('/calls/dialers', input).expect(201)).body as DialerRow;
    expect(d.capabilities.endCalls).toBe(true);
    expect(((await r.post(`/calls/dialers/${d.id}/test`).expect(200)).body as DialerTestResult).status).toBe('CONNECTED');
    const c = ((await r.post('/calls', { numberSource: 'OTHER', number: '+44 20 7946 0018' }).expect(201)).body as CallStarted).call;
    expect(c).toMatchObject({ status: 'RINGING', dialer: { id: d.id } });
    const sent = seen.filter((s) => s.path === '/v2/calls').at(-1)!;
    expect(JSON.parse(sent.body)).toEqual({ from: '+447700900300', to: '+442079460018', ref: c.id });
    expect(((await r.post(`/calls/${c.id}/control`, { action: 'HANGUP' }).expect(200)).body as CallRow).status).toBe('ENDED');
    expect(seen.at(-1)).toMatchObject({ method: 'DELETE', path: '/v2/calls/oa-1' });
    await r.post(`/calls/${c.id}/control`, { action: 'MUTE' }).expect(400);
    await r.post(`/calls/${c.id}/log`, { outcome: 'VOICEMAIL' }).expect(200);
  });

  it('keeps favourites and filters, sorts and pages the history', async () => {
    const r = api(rep);
    await r.post('/calls/favorites', { contactId: priyaId, on: true }).expect(204);
    expect(((await r.get(`/calls/details?contactId=${priyaId}`).expect(200)).body as CallDetails).favorite).toBe(true);
    const favs = (await r.get('/calls/favorites').expect(200)).body as Array<{ contactId: string | null }>;
    expect(favs.map((f) => f.contactId)).toEqual([priyaId]);
    await r.post('/calls/favorites', { contactId: priyaId, on: false }).expect(204);

    const all = (await r.get('/calls').expect(200)).body as CallRow[];
    const longest = (await r.get('/calls?sort=longest').expect(200)).body as CallRow[];
    expect(longest[0]!.id).toBe(placed.id);
    const oldest = (await r.get('/calls?sort=oldest').expect(200)).body as CallRow[];
    expect(oldest.map((c) => c.id)).toEqual([...all].reverse().map((c) => c.id));
    expect(((await r.get(`/calls?dialerId=${exotel.id}&outcome=RFQ_EXPECTED`).expect(200)).body as CallRow[]).map((c) => c.id)).toEqual([placed.id]);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await r.get(`/calls?from=${encodeURIComponent(future)}`).expect(200)).body).toEqual([]);
    const team = (await api(manager).get(`/calls?scope=team&userId=${rep.userId}`).expect(200)).body as CallRow[];
    expect(team.length).toBe(all.length);
    expect(team.every((c) => c.by?.id === rep.userId)).toBe(true);
    // Removing a dialer clears its keys and its events address.
    await r.del(`/calls/dialers/${exotel.id}`).expect(204);
    const gone = await asTenant(owner.tenantId, (tx) => tx.dialer.findUniqueOrThrow({ where: { id: exotel.id } }));
    expect(gone).toMatchObject({ secretsEncrypted: null, eventsHookId: null });
    await event(exotel, { CallSid: 'x', Status: 'completed' }).expect(404);
  });
});
