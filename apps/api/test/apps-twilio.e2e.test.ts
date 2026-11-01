import type { INestApplication } from '@nestjs/common';
import type { SmsThread } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { startTwilioFixture, TW, twInbound, twSignature, twStatus, type TwilioFixture } from './fixtures/twilio-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

interface TwStatus {
  key: string;
  state: string;
  warnings: string[];
  connection: { accountName: string; lastError: string | null; settings: { inboundUrl: string; fromNumber: string; trial: boolean; lastWebhookAt: string | null } } | null;
}

/** SMS through the workspace's own Twilio account and number, against a local stand-in of Twilio's REST API. */
describe('SMS through Twilio (stand-in)', () => {
  let app: INestApplication;
  let tw: TwilioFixture;
  let restore: () => void;
  let owner: TestUser;
  let worker: WorkerService;
  let status: TwStatus;
  const ids = { gia: '', local: '', landline: '' };
  const GIA = '+447700900456';
  const pub = () => request(app.getHttpServer());
  const appStatus = async (u: TestUser) => ((await api(u).get('/apps').expect(200)).body as TwStatus[]).find((a) => a.key === 'twilio')!;
  const thread = async (contactId: string) => (await api(owner).get(`/apps/twilio/contacts/${contactId}`).expect(200)).body as SmsThread;
  let ip = 0;
  const keys = (u: TestUser, body: object) => u.agent.post('/api/v1/apps/twilio/keys').set('origin', ORIGIN).set('x-forwarded-for', `198.51.100.${++ip}`).send(body);
  /** Posts as Twilio does: form-encoded, signed over the exact URL Twilio was configured with. */
  const twilioPost = (url: string, params: Record<string, string>, token = TW.token) =>
    pub().post(new URL(url).pathname).set('content-type', 'application/x-www-form-urlencoded').set('x-twilio-signature', twSignature(token, url, params)).send(new URLSearchParams(params).toString());
  const good = { accountSid: TW.sid, authToken: TW.token, fromNumber: TW.number };

  beforeAll(async () => {
    tw = await startTwilioFixture();
    restore = setEnv({ TWILIO_API_BASE_URL: tw.url });
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'SMS Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    const o = api(owner);
    ids.gia = (await o.post('/contacts', { firstName: 'Gia', lastName: 'Buyer', email: 'gia@globex.test', phone: '+44 7700 900456' }).expect(201)).body.id;
    ids.local = (await o.post('/contacts', { firstName: 'Lou', lastName: 'Local', phone: '07700 900111' }).expect(201)).body.id;
    ids.landline = (await o.post('/contacts', { firstName: 'Lena', lastName: 'Landline', phone: TW.landline }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await tw.close();
    restore();
  });

  it('starts not connected with no operator secret, and saves credentials only after Twilio accepts them and the number', async () => {
    expect(await appStatus(owner)).toMatchObject({ key: 'twilio', state: 'not_connected', connection: null });
    expect((await api(owner).post('/apps/twilio/connect', {}).expect(400)).body.error.code).toBe('NOT_OAUTH');
    const member = await inviteMember(app, owner, 'member');
    await keys(member, good).expect(403);
    await keys(owner, { ...good, accountSid: 'not-a-sid' }).expect(400);
    await keys(owner, { ...good, fromNumber: '07700 900100' }).expect(400);

    const wrongToken = await keys(owner, { ...good, authToken: '0'.repeat(32) }).expect(400);
    expect(wrongToken.body.error.message).toContain('Twilio refused the Account SID and Auth Token');
    const notOurs = await keys(owner, { ...good, fromNumber: '+447700900199' }).expect(400);
    expect(notOurs.body.error.message).toContain('is not a phone number on this Twilio account');
    const noSms = await keys(owner, { ...good, fromNumber: TW.voiceOnly }).expect(400);
    expect(noSms.body.error.message).toContain('cannot send SMS');
    expect((await appStatus(owner)).state).toBe('not_connected');
    expect(tw.sent).toHaveLength(0);

    status = (await keys(owner, good).expect(200)).body as TwStatus;
    expect(status).toMatchObject({ state: 'connected', connection: { accountName: `Globex Sales (${TW.number})`, settings: { fromNumber: TW.number, trial: false, lastWebhookAt: null } } });
    expect(status.connection!.settings.inboundUrl).toMatch(/\/api\/v1\/apps\/twilio\/webhooks\/[a-f0-9]{24}\/inbound$/);
    expect(status.warnings[0]).toContain('Pending Configuration until Twilio sends the first signed request');
    expect(JSON.stringify(status)).not.toContain(TW.token);
    const stored = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirst({ where: { tenantId: owner.tenantId, provider: 'TWILIO' } }));
    expect(stored!.credentialsEncrypted).not.toContain(TW.token);
  });

  it('refuses unsigned or wrongly signed requests from "Twilio"', async () => {
    const url = status.connection!.settings.inboundUrl;
    await pub().post(new URL(url).pathname).set('content-type', 'application/x-www-form-urlencoded').send(new URLSearchParams(twInbound(GIA, 'hi')).toString()).expect(401);
    await twilioPost(url, twInbound(GIA, 'hi'), 'f'.repeat(32)).expect(401);
    // Signed over a different URL (for example a replayed request for another endpoint): refused.
    const p = twInbound(GIA, 'hi');
    await pub().post(new URL(url).pathname).set('content-type', 'application/x-www-form-urlencoded').set('x-twilio-signature', twSignature(TW.token, `${url}x`, p)).send(new URLSearchParams(p).toString()).expect(401);
    await twilioPost(url.replace(/[a-f0-9]{24}/, 'b'.repeat(24)), twInbound(GIA, 'hi')).expect(404);
    expect((await thread(ids.gia)).messages).toHaveLength(0);
  });

  it('needs a usable international number and recorded consent before any text', async () => {
    expect(await thread(ids.local)).toMatchObject({ phone: null, phoneProblem: expect.stringContaining('country code') });
    expect(await thread(ids.gia)).toMatchObject({ phone: GIA, consent: null, optedOutAt: null });
    const r = await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: 'Hello', confirm: true }).expect(400);
    expect(r.body.error.message).toContain('Record this contact’s SMS consent');
    await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: 'Hello' }).expect(400);
    await api(owner).post('/apps/twilio/consents', { contactId: ids.gia, source: 'Ticked SMS updates on the demo form', confirm: false }).expect(400);
    const t = (await api(owner).post('/apps/twilio/consents', { contactId: ids.gia, source: 'Ticked SMS updates on the demo form', confirm: true }).expect(200)).body as SmsThread;
    expect(t.consent).toMatchObject({ phone: GIA, source: 'Ticked SMS updates on the demo form', recordedBy: expect.any(String) });
    expect(tw.sent).toHaveLength(0);
  });

  it('sends one text with a status callback, then records the reply and delivery status, moving forward only', async () => {
    const text = 'Hi Gia, your proposal Q-0007 is ready. Reply here with any questions.';
    const m = (await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text, confirm: true }).expect(200)).body;
    expect(m).toMatchObject({ direction: 'out', status: 'accepted', segments: 1, body: text });
    const sent = tw.sent.at(-1)!;
    expect(sent).toMatchObject({ to: GIA, from: TW.number, body: text });
    expect(sent.statusCallback).toMatch(/\/api\/v1\/apps\/twilio\/webhooks\/[a-f0-9]{24}\/status$/);

    await twilioPost(sent.statusCallback!, twStatus(sent.sid, 'sent', GIA)).expect(204);
    await twilioPost(sent.statusCallback!, twStatus(sent.sid, 'delivered', GIA)).expect(204);
    await twilioPost(sent.statusCallback!, twStatus(sent.sid, 'sent', GIA)).expect(204);
    expect((await thread(ids.gia)).messages[0]).toMatchObject({ status: 'delivered', error: null });

    const reply = twInbound(GIA, 'Can we talk on Friday?', { sid: `SM${'a'.repeat(32)}` });
    const res = await twilioPost(status.connection!.settings.inboundUrl, reply).expect(200);
    expect(res.headers['content-type']).toContain('text/xml');
    expect(res.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    await twilioPost(status.connection!.settings.inboundUrl, reply).expect(200); // Twilio retries: stored once.
    const t = await thread(ids.gia);
    expect(t.messages.map((x) => [x.direction, x.body])).toEqual([['out', text], ['in', 'Can we talk on Friday?']]);
    expect((await appStatus(owner)).warnings).toEqual([]);

    const notes = (await api(owner).get('/notifications').expect(200)).body.items as { title: string }[];
    expect(notes.some((n) => n.title === 'Text from Gia Buyer')).toBe(true);
  });

  it('counts segments: long and non-GSM texts are billed as several', async () => {
    const long = 'a'.repeat(200);
    expect((await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: long, confirm: true }).expect(200)).body.segments).toBe(2);
    expect((await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: 'Thanks 😊'.repeat(10), confirm: true }).expect(200)).body.segments).toBe(2);
    await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: 'x'.repeat(1601), confirm: true }).expect(400);
  });

  it('a STOP reply withdraws consent and blocks texts and new consent until they reply START', async () => {
    const before = tw.sent.length;
    await twilioPost(status.connection!.settings.inboundUrl, twInbound(GIA, 'STOP', { optOutType: 'STOP' })).expect(200);
    let t = await thread(ids.gia);
    expect(t.consent).toBeNull();
    expect(t.optedOutAt).not.toBeNull();
    const r = await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: 'Still there?', confirm: true }).expect(400);
    expect(r.body.error.message).toContain('replied STOP');
    const c = await api(owner).post('/apps/twilio/consents', { contactId: ids.gia, source: 'Colleague says they agreed again', confirm: true }).expect(409);
    expect(c.body.error.code).toBe('SMS_OPTED_OUT');
    expect(tw.sent).toHaveLength(before);
    const notes = (await api(owner).get('/notifications').expect(200)).body.items as { title: string }[];
    expect(notes.some((n) => n.title === 'Gia Buyer opted out of text messages')).toBe(true);

    await twilioPost(status.connection!.settings.inboundUrl, twInbound(GIA, 'START', { optOutType: 'START' })).expect(200);
    t = await thread(ids.gia);
    expect(t).toMatchObject({ optedOutAt: null, consent: null });
    await api(owner).post('/apps/twilio/consents', { contactId: ids.gia, source: 'Texted START and confirmed on the phone', confirm: true }).expect(200);
  });

  it('a workflow step texts only after approval and only with consent', async () => {
    const http = api(owner);
    const wf = (
      await http
        .post('/workflows', {
          name: 'Welcome by SMS',
          definition: { trigger: { event: 'contact.created' }, start: 'sms', nodes: [{ id: 'sms', type: 'action', action: { type: 'send_sms', text: 'Welcome {{record.firstName}}!' }, next: null }] },
        })
        .expect(201)
    ).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    const approveAndRun = async () => {
      await worker.drain();
      const pending = (await http.get('/approvals').expect(200)).body.find((a: { workflow: { id: string } }) => a.workflow?.id === wf.id);
      expect(pending).toMatchObject({ kind: 'workflow.send_sms' });
      await http.post(`/approvals/${pending.id}/decision`, { decision: 'approve' }).expect(200);
      await worker.drain();
      return (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    };

    const before = tw.sent.length;
    await http.post('/contacts', { firstName: 'Ada', lastName: 'Lovelace', phone: '+44 7700 900321' }).expect(201);
    let run = await approveAndRun();
    expect(run.status).toBe('FAILED');
    expect(JSON.stringify(run)).toContain('Record this contact’s SMS consent');
    expect(tw.sent).toHaveLength(before);

    // Consent recorded before the approval is given counts: the step checks consent when it runs, not when it was queued.
    const ben = (await http.post('/contacts', { firstName: 'Ben', lastName: 'Ng', phone: '+44 7700 900322' }).expect(201)).body.id;
    await http.post('/apps/twilio/consents', { contactId: ben, source: 'Opted in on the website form', confirm: true }).expect(200);
    run = await approveAndRun();
    expect(run.status).toBe('SUCCEEDED');
    expect(tw.sent.at(-1)).toMatchObject({ to: '+447700900322', body: 'Welcome Ben!' });
    expect((await thread(ben)).messages[0]).toMatchObject({ source: 'workflow', body: 'Welcome Ben!' });
  });

  it('shows Twilio’s refusal in plain words, a failed delivery notifies the sender, and a rotated token marks the connection', async () => {
    await api(owner).post('/apps/twilio/consents', { contactId: ids.landline, source: 'Agreed at the trade show', confirm: true }).expect(200);
    const r = await api(owner).post('/apps/twilio/messages', { contactId: ids.landline, text: 'Hello', confirm: true }).expect(400);
    expect(r.body.error.message).toContain('cannot receive SMS');
    expect((await api(owner).get('/apps/twilio/events').expect(200)).body[0]).toMatchObject({ kind: 'message.failed', ok: false });

    await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: 'One more thing', confirm: true }).expect(200);
    const sent = tw.sent.at(-1)!;
    await twilioPost(sent.statusCallback!, twStatus(sent.sid, 'undelivered', GIA, 30007)).expect(204);
    await twilioPost(sent.statusCallback!, twStatus(sent.sid, 'delivered', GIA)).expect(204); // final stays final
    expect((await thread(ids.gia)).messages.at(-1)).toMatchObject({ status: 'undelivered', error: expect.stringContaining('filtered the message as spam') });
    const notes = (await api(owner).get('/notifications').expect(200)).body.items as { title: string }[];
    expect(notes.some((n) => n.title === `Text to ${GIA} was not delivered`)).toBe(true);

    // The Auth Token is rotated in the Twilio console.
    const { SECRET_BOX } = await import('../src/common/crypto');
    const box = app.get(SECRET_BOX) as { seal(s: string): string };
    await asTenant(owner.tenantId, (tx) => tx.appConnection.updateMany({ where: { tenantId: owner.tenantId, provider: 'TWILIO' }, data: { credentialsEncrypted: box.seal(JSON.stringify({ ...good, authToken: '1'.repeat(32) })) } }));
    await api(owner).post('/apps/twilio/messages', { contactId: ids.gia, text: 'Hello again', confirm: true }).expect(400);
    expect(await appStatus(owner)).toMatchObject({ state: 'error', connection: { lastError: expect.stringContaining('Twilio refused') } });
    const again = (await keys(owner, good).expect(200)).body as TwStatus;
    expect(again.state).toBe('connected');
    expect(again.connection!.settings.inboundUrl).toBe(status.connection!.settings.inboundUrl);
  });

  it('another workspace’s endpoint cannot write into this one, and disconnecting keeps history', async () => {
    const other = await registerUser(app, 'Other SMS');
    await asTenant(other.tenantId, (tx) => tx.subscription.update({ where: { tenantId: other.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    const so = (await keys(other, good).expect(200)).body as TwStatus;
    expect(so.connection!.settings.inboundUrl).not.toBe(status.connection!.settings.inboundUrl);
    await twilioPost(so.connection!.settings.inboundUrl, twInbound(GIA, 'for the other workspace')).expect(200);
    expect((await thread(ids.gia)).messages.map((m) => m.body)).not.toContain('for the other workspace');

    await api(owner).del('/apps/twilio').expect(204);
    await twilioPost(status.connection!.settings.inboundUrl, twInbound(GIA, 'after disconnect')).expect(404);
    const kept = await asTenant(owner.tenantId, (tx) => tx.smsMessage.count({ where: { tenantId: owner.tenantId, phone: GIA } }));
    expect(kept).toBeGreaterThan(4);
  });
});
