import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { CallDetails, CallRow, CallStarted, CallStats, CallTarget, DialerRow, DialerSettings, FollowUpRow, InteractionRow } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTwilioFixture, TW, twSignature, type TwilioFixture } from './fixtures/twilio-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

interface Hook {
  headers: IncomingHttpHeaders;
  body: string;
}

/** The Calls section (ADR 0088): personal dialers, the call card, placing, logging and the history. */
describe('calls', () => {
  let app: INestApplication;
  let tw: TwilioFixture;
  let hookServer: Server;
  let hookUrl = '';
  const hooks: Hook[] = [];
  let hookStatus = 200;
  let restoreEnv: string | undefined;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let companyId: string;
  let priyaId: string;
  let raviId: string;
  let customDialer: DialerRow;
  let firstCall: CallRow;

  beforeAll(async () => {
    tw = await startTwilioFixture();
    restoreEnv = process.env.TWILIO_API_BASE_URL;
    process.env.TWILIO_API_BASE_URL = tw.url;
    hookServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        hooks.push({ headers: req.headers, body });
        res.writeHead(hookStatus).end('ok');
      });
    });
    await new Promise<void>((r) => hookServer.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/sampforce-call`;
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Calls');
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
          company: { name: 'Acme Panels', country: 'IN', timezone: 'Asia/Kolkata', primaryPhone: '+91 22 4000 1000', ownerId: rep.userId },
          employees: [
            { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead', email: 'priya@acmepanels.example', phone: '+91 98200 12345' },
            { firstName: 'Ravi', lastName: 'Kumar', jobTitle: 'Research Director', phone: '+91 98200 67890' },
          ],
        })
        .expect(201)
    ).body;
    companyId = res.company.id;
    [priyaId, raviId] = res.employeeIds;
  });

  afterAll(async () => {
    await app.close();
    await tw.close();
    await new Promise<void>((r) => hookServer.close(() => r()));
    if (restoreEnv === undefined) delete process.env.TWILIO_API_BASE_URL;
    else process.env.TWILIO_API_BASE_URL = restoreEnv;
  });

  it('starts with the phone app, and keeps each person’s own dialers with a webhook secret shown once', async () => {
    const r = api(rep);
    const start = (await r.get('/calls/dialers').expect(200)).body as DialerSettings;
    expect(start).toMatchObject({ dialers: [], builtIn: { name: 'Phone app', urlTemplate: 'tel:{phoneE164}' }, twilio: { connected: false } });

    // Links that would run code, or that have nowhere to put the number, are refused.
    for (const urlTemplate of ['javascript:alert({phone})', 'https://dialer.example.com/call', 'tel:{phone}?x={nope}']) {
      await r.post('/calls/dialers', { name: 'Bad', kind: 'LINK', urlTemplate }).expect(400);
    }
    // Twilio needs the workspace's Twilio connection.
    const noTwilio = await r.post('/calls/dialers', { name: 'Twilio', kind: 'TWILIO', agentPhone: '+44 7700 900200' }).expect(400);
    expect(noTwilio.body.error.message).toContain('Twilio is not connected');

    customDialer = (
      await r
        .post('/calls/dialers', { name: 'My dialer', kind: 'LINK', urlTemplate: 'https://dialer.example.com/call?to={phoneE164}&name={employeeName}&company={companyName}&title={designation}&email={email}&office={companyPhone}', webhookUrl: hookUrl })
        .expect(201)
    ).body as DialerRow;
    expect(customDialer).toMatchObject({ kind: 'LINK', isDefault: true, hasWebhookSecret: true });
    expect(customDialer.webhookSecret).toMatch(/^[\w-]{30,}$/);
    const softphone = (await r.post('/calls/dialers', { name: 'Zoiper', kind: 'LINK', urlTemplate: 'callto:{phoneE164}' }).expect(201)).body as DialerRow;
    expect(softphone.isDefault).toBe(false);

    const listed = (await r.get('/calls/dialers').expect(200)).body as DialerSettings;
    expect(listed.dialers.map((d) => d.name)).toEqual(['My dialer', 'Zoiper']);
    expect(listed.dialers.every((d) => d.webhookSecret === null)).toBe(true);
    // Another person sees none of them and cannot change them.
    expect(((await api(other).get('/calls/dialers').expect(200)).body as DialerSettings).dialers).toEqual([]);
    await api(other).put(`/calls/dialers/${softphone.id}`, { name: 'Mine now', kind: 'LINK', urlTemplate: 'tel:{phone}' }).expect(404);

    // Making the softphone the default moves the default; removing it hands it back.
    await r.put(`/calls/dialers/${softphone.id}`, { name: 'Zoiper', kind: 'LINK', urlTemplate: 'callto:{phoneE164}', isDefault: true }).expect(200);
    expect(((await r.get('/calls/dialers').expect(200)).body as DialerSettings).dialers.map((d) => [d.name, d.isDefault])).toEqual([['My dialer', false], ['Zoiper', true]]);
    await r.del(`/calls/dialers/${softphone.id}`).expect(204);
    expect(((await r.get('/calls/dialers').expect(200)).body as DialerSettings).dialers.map((d) => [d.name, d.isDefault])).toEqual([['My dialer', true]]);
  });

  it('finds companies and employees by name or number, and shows everything about who is being called', async () => {
    const r = api(rep);
    const byName = (await r.get('/calls/search?q=priya').expect(200)).body as CallTarget[];
    expect(byName).toEqual([expect.objectContaining({ kind: 'employee', contactId: priyaId, companyId, name: 'Priya Nair', subtitle: 'Procurement Lead · Acme Panels', phone: '+91 98200 12345', companyPhone: '+91 22 4000 1000', companyName: 'Acme Panels' })]);
    const byNumber = (await r.get('/calls/search?q=98200 67890').expect(200)).body as CallTarget[];
    expect(byNumber.map((t) => t.name)).toEqual(['Ravi Kumar']);
    const company = (await r.get('/calls/search?q=acme').expect(200)).body as CallTarget[];
    expect(company[0]).toMatchObject({ kind: 'company', companyId, name: 'Acme Panels', companyPhone: '+91 22 4000 1000' });

    const d = (await r.get(`/calls/details?contactId=${priyaId}`).expect(200)).body as CallDetails;
    expect(d.company).toMatchObject({ id: companyId, name: 'Acme Panels', phone: '+91 22 4000 1000', timezone: 'Asia/Kolkata' });
    expect(d.employee).toEqual({ id: priyaId, name: 'Priya Nair', designation: 'Procurement Lead', email: 'priya@acmepanels.example', phone: '+91 98200 12345', timezone: null });
    expect(d.colleagues.map((c) => c.name)).toEqual(['Priya Nair', 'Ravi Kumar']);
    expect(d.localTime).toMatchObject({ timeZone: 'Asia/Kolkata', offsetMinutes: 330 });
    expect(['GOOD', 'LUNCH', 'EARLY', 'LATE', 'WEEKEND']).toContain(d.localTime!.kind);
    expect(d.lastCall).toBeNull();
    // An employee of another company cannot be paired with this one; a company of another workspace is not found.
    await api(owner).get(`/calls/details?companyId=${companyId}&contactId=${(await api(owner).post('/company-leads', { company: { name: 'Elsewhere' }, employees: [{ firstName: 'Zed' }] }).expect(201)).body.employeeIds[0]}`).expect(400);
    const stranger = await registerUser(app, 'Another Workspace');
    await api(stranger).get(`/calls/details?companyId=${companyId}`).expect(404);
    expect((await api(stranger).get('/calls/search?q=acme').expect(200)).body).toEqual([]);
  });

  it('hands the company and employee details to the dialer, in its link and signed to its webhook', async () => {
    const started = (await api(rep).post('/calls', { companyId, contactId: priyaId, numberSource: 'EMPLOYEE' }).expect(201)).body as CallStarted;
    firstCall = started.call;
    expect(started.call).toMatchObject({
      status: 'OPEN',
      number: '+91 98200 12345',
      numberSource: 'EMPLOYEE',
      dialer: { id: customDialer.id, name: 'My dialer', kind: 'LINK' },
      company: { id: companyId, name: 'Acme Panels' },
      employee: { id: priyaId, name: 'Priya Nair', designation: 'Procurement Lead' },
      details: { companyName: 'Acme Panels', companyPhone: '+91 22 4000 1000', employeeName: 'Priya Nair', designation: 'Procurement Lead', email: 'priya@acmepanels.example', employeePhone: '+91 98200 12345' },
      webhook: { status: 'SENT', error: null },
      by: { id: rep.userId },
    });
    const link = new URL(started.launchUrl!);
    expect(Object.fromEntries(link.searchParams)).toEqual({ to: '+919820012345', name: 'Priya Nair', company: 'Acme Panels', title: 'Procurement Lead', email: 'priya@acmepanels.example', office: '+91 22 4000 1000' });

    const hook = hooks.at(-1)!;
    const [t, v1] = String(hook.headers['x-sampforce-signature']).split(',').map((p) => p.split('=')[1]);
    expect(createHmac('sha256', customDialer.webhookSecret!).update(`${t}.${hook.body}`).digest('hex')).toBe(v1);
    expect(JSON.parse(hook.body)).toMatchObject({
      event: 'call.started',
      callId: firstCall.id,
      number: '+91 98200 12345',
      numberE164: '+919820012345',
      company: { id: companyId, name: 'Acme Panels', phone: '+91 22 4000 1000', url: `${ORIGIN}/app/companies/${companyId}` },
      employee: { id: priyaId, name: 'Priya Nair', designation: 'Procurement Lead', email: 'priya@acmepanels.example', phone: '+91 98200 12345' },
    });

    // A dialer that refuses the webhook does not stop the call; the call shows why.
    hookStatus = 500;
    const company = (await api(rep).post('/calls', { companyId, numberSource: 'COMPANY' }).expect(201)).body as CallStarted;
    hookStatus = 200;
    expect(company.call).toMatchObject({ number: '+91 22 4000 1000', numberSource: 'COMPANY', employee: null, webhook: { status: 'FAILED', error: 'Your dialer answered 500.' } });
    await api(rep).del(`/calls/${company.call.id}`).expect(204);
  });

  it('logs the call with remarks as a call interaction, and schedules the next call as a follow-up', async () => {
    const r = api(rep);
    const next = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const logged = (await r.post(`/calls/${firstCall.id}/log`, { outcome: 'CONNECTED', remarks: 'Wants India B2B feasibility by Friday.', durationSec: 245, sentiment: 'POSITIVE', nextCallAt: next, nextCallNote: 'Share feasibility' }).expect(200)).body as CallRow;
    expect(logged).toMatchObject({ status: 'LOGGED', outcome: 'CONNECTED', durationSec: 245, remarks: 'Wants India B2B feasibility by Friday.', nextCall: { title: 'Share feasibility', status: 'OPEN', dueAt: next } });
    expect(logged.interactionId).toBeTruthy();
    await r.post(`/calls/${firstCall.id}/log`, { outcome: 'CONNECTED' }).expect(400);

    const interactions = (await r.get(`/companies/${companyId}/interactions?kind=CALL_OUTGOING`).expect(200)).body as InteractionRow[];
    expect(interactions[0]).toMatchObject({ id: logged.interactionId, kind: 'CALL_OUTGOING', subject: 'Call with Priya Nair: Connected', outcome: 'Connected', remarks: 'Wants India B2B feasibility by Friday.', recipient: '+91 98200 12345', sentiment: 'POSITIVE', contact: { id: priyaId } });
    const calls = (await r.get(`/follow-ups?type=CALL&bucket=upcoming&contactId=${priyaId}`).expect(200)).body as FollowUpRow[];
    expect(calls.map((f) => [f.type, f.title])).toEqual([['CALL', 'Share feasibility']]);
    // A reached employee moves to "call done".
    expect(await asTenant(owner.tenantId, (tx) => tx.contactStageChange.count({ where: { contactId: priyaId, source: 'INTERACTION' } }))).toBe(1);

    // The call card now shows the last call and the next one.
    const d = (await r.get(`/calls/details?contactId=${priyaId}`).expect(200)).body as CallDetails;
    expect(d.lastCall).toMatchObject({ outcome: 'CONNECTED', remarks: 'Wants India B2B feasibility by Friday.' });
    expect(d.nextCall).toMatchObject({ title: 'Share feasibility', dueAt: next });

    // Editing the remarks changes the interaction too.
    await r.patch(`/calls/${firstCall.id}`, { remarks: 'Feasibility due Friday; send panel book.', outcome: 'CALL_BACK' }).expect(200);
    const again = (await r.get(`/companies/${companyId}/interactions?kind=CALL_OUTGOING`).expect(200)).body as InteractionRow[];
    expect(again[0]).toMatchObject({ remarks: 'Feasibility due Friday; send panel book.', outcome: 'Asked to call back' });
    // Nobody else can log or edit someone's call.
    await api(other).patch(`/calls/${firstCall.id}`, { remarks: 'x' }).expect(404);
  });

  it('logs a call nobody answered without counting it as a conversation', async () => {
    const r = api(rep);
    const c = ((await r.post('/calls', { companyId, contactId: raviId, numberSource: 'EMPLOYEE' }).expect(201)).body as CallStarted).call;
    await r.post(`/calls/${c.id}/log`, { outcome: 'NO_ANSWER', nextCallAt: new Date(Date.now() - 3_600_000).toISOString() }).expect(400);
    const logged = (await r.post(`/calls/${c.id}/log`, { outcome: 'NO_ANSWER' }).expect(200)).body as CallRow;
    expect(logged).toMatchObject({ outcome: 'NO_ANSWER', nextCall: null });
    expect(await asTenant(owner.tenantId, (tx) => tx.contactStageChange.count({ where: { contactId: raviId, source: 'INTERACTION' } }))).toBe(0);
    const list = (await r.get(`/companies/${companyId}/interactions?contactId=${raviId}`).expect(200)).body as InteractionRow[];
    expect(list[0]).toMatchObject({ kind: 'CALL_OUTGOING', outcome: 'No answer' });
  });

  it('dials a typed number with the phone app, which cannot schedule a next call without a record', async () => {
    const r = api(manager);
    await r.post('/calls', { numberSource: 'OTHER' }).expect(400);
    await r.post('/calls', { numberSource: 'OTHER', number: '12' }).expect(400);
    const started = (await r.post('/calls', { numberSource: 'OTHER', number: '+44 (20) 7946-0018' }).expect(201)).body as CallStarted;
    expect(started.launchUrl).toBe('tel:+442079460018');
    expect(started.call).toMatchObject({ dialer: { id: null, name: 'Phone app' }, company: null, employee: null, webhook: null });
    await r.post(`/calls/${started.call.id}/log`, { outcome: 'VOICEMAIL', nextCallAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    await r.post(`/calls/${started.call.id}/log`, { outcome: 'VOICEMAIL', remarks: 'Left a message about the panel.' }).expect(200);
    const local = (await r.post('/calls', { numberSource: 'OTHER', number: '022 4000 1000' }).expect(201)).body as CallStarted;
    expect(local.launchUrl).toBe('tel:02240001000');
    await r.del(`/calls/${local.call.id}`).expect(204);
    await r.del(`/calls/${started.call.id}`).expect(400);
  });

  it('shows the history to the caller and their manager, with search and outcome filters', async () => {
    const mine = (await api(rep).get('/calls').expect(200)).body as CallRow[];
    expect(mine.map((c) => [c.employee?.name ?? c.number, c.outcome])).toEqual([['Ravi Kumar', 'NO_ANSWER'], ['Priya Nair', 'CALL_BACK']]);
    expect(((await api(rep).get('/calls?q=priya').expect(200)).body as CallRow[]).map((c) => c.id)).toEqual([firstCall.id]);
    expect(((await api(rep).get('/calls?outcome=NO_ANSWER').expect(200)).body as CallRow[]).map((c) => c.employee?.name)).toEqual(['Ravi Kumar']);
    const team = (await api(manager).get('/calls?scope=team').expect(200)).body as CallRow[];
    expect(team.map((c) => c.by?.id)).toEqual([manager.userId, rep.userId, rep.userId]);
    expect(((await api(other).get('/calls?scope=team').expect(200)).body as CallRow[]).length).toBe(0);
    expect(((await api(owner).get('/calls?scope=all').expect(200)).body as CallRow[]).length).toBe(3);
    await api(other).get(`/calls/${firstCall.id}`).expect(404);
    await api(manager).get(`/calls/${firstCall.id}`).expect(200);

    const stats = (await api(rep).get('/calls/stats?tz=Asia/Kolkata').expect(200)).body as CallStats;
    expect(stats.today).toMatchObject({ calls: 2, reached: 1, talkSec: 245, notLogged: 0 });
  });

  it('calls through the workspace’s Twilio number: rings the caller first, then follows both legs from signed callbacks', async () => {
    let ip = 0;
    await owner.agent.post('/api/v1/apps/twilio/keys').set('origin', ORIGIN).set('x-forwarded-for', `198.51.100.${++ip}`).send({ accountSid: TW.sid, authToken: TW.token, fromNumber: TW.number }).expect(200);
    const r = api(rep);
    expect(((await r.get('/calls/dialers').expect(200)).body as DialerSettings).twilio).toEqual({ connected: true, fromNumber: TW.number });
    await r.post('/calls/dialers', { name: 'Twilio', kind: 'TWILIO' }).expect(400);
    const dialer = (await r.post('/calls/dialers', { name: 'Twilio', kind: 'TWILIO', agentPhone: '+44 7700 900200' }).expect(201)).body as DialerRow;
    expect(dialer.agentPhone).toBe('+447700900200');

    const started = (await r.post('/calls', { companyId, contactId: raviId, numberSource: 'EMPLOYEE', dialerId: dialer.id }).expect(201)).body as CallStarted;
    expect(started.launchUrl).toBeNull();
    expect(started.call).toMatchObject({ status: 'RINGING', dialer: { kind: 'TWILIO' }, twilioStatus: 'queued' });
    const placed = tw.placed.at(-1)!;
    expect(placed).toMatchObject({ to: '+447700900200', from: TW.number, statusCallbackEvents: ['initiated', 'ringing', 'answered', 'completed'] });
    expect(placed.twiml).toContain('<Number statusCallbackEvent="answered completed"');
    expect(placed.twiml).toContain('>+919820067890</Number>');
    expect(placed.twiml).toContain(`callerId="${TW.number}"`);

    const base = placed.statusCallback!.replace(/\?leg=agent$/, '');
    const callback = (leg: 'agent' | 'party', params: Record<string, string>, token = TW.token) => {
      const url = `${base}?leg=${leg}`;
      const u = new URL(url);
      return request(app.getHttpServer()).post(`${u.pathname}${u.search}`).set('content-type', 'application/x-www-form-urlencoded').set('x-twilio-signature', twSignature(token, url, params)).send(new URLSearchParams(params).toString());
    };
    const sid = (await asTenant(owner.tenantId, (tx) => tx.phoneCall.findUniqueOrThrow({ where: { id: started.call.id } }))).twilioSid!;
    await callback('party', { AccountSid: TW.sid, CallSid: 'CAchild', ParentCallSid: sid, CallStatus: 'in-progress' }, '0'.repeat(32)).expect(401);
    await callback('agent', { AccountSid: TW.sid, CallSid: sid, CallStatus: 'in-progress' }).expect(204);
    await callback('party', { AccountSid: TW.sid, CallSid: 'CAchild', ParentCallSid: sid, CallStatus: 'in-progress' }).expect(204);
    expect(((await r.get(`/calls/${started.call.id}`).expect(200)).body as CallRow).status).toBe('IN_PROGRESS');
    await callback('party', { AccountSid: TW.sid, CallSid: 'CAchild', ParentCallSid: sid, CallStatus: 'completed', CallDuration: '95' }).expect(204);
    const ended = (await r.get(`/calls/${started.call.id}`).expect(200)).body as CallRow;
    expect(ended).toMatchObject({ status: 'ENDED', durationSec: 95 });
    expect(ended.answeredAt).toBeTruthy();
    const logged = (await r.post(`/calls/${started.call.id}/log`, { outcome: 'CONNECTED', remarks: 'Through Twilio' }).expect(200)).body as CallRow;
    expect(logged.durationSec).toBe(95);

    // A refused number is reported, and the call is kept as failed.
    await asTenant(owner.tenantId, (tx) => tx.contact.update({ where: { id: raviId }, data: { phone: TW.landline } }));
    const refused = await r.post('/calls', { companyId, contactId: raviId, numberSource: 'EMPLOYEE', dialerId: dialer.id }).expect(400);
    expect(refused.body.error.message).toContain('not allowed to call that country');
    const failed = ((await r.get('/calls').expect(200)).body as CallRow[])[0]!;
    expect(failed).toMatchObject({ status: 'FAILED' });
    // A number without its country code cannot go through Twilio.
    await asTenant(owner.tenantId, (tx) => tx.contact.update({ where: { id: raviId }, data: { phone: '098200 67890' } }));
    expect((await r.post('/calls', { companyId, contactId: raviId, numberSource: 'EMPLOYEE', dialerId: dialer.id }).expect(400)).body.error.message).toContain('country code');
  });
});
