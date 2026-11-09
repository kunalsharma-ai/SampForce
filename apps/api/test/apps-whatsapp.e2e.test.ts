import type { INestApplication } from '@nestjs/common';
import type { WhatsappThread } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { startWhatsappFixture, WA, waInbound, waSignature, waStatus, type WhatsappFixture } from './fixtures/whatsapp-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

interface WaStatus {
  key: string;
  state: string;
  warnings: string[];
  connection: { accountName: string; lastError: string | null; settings: { webhookUrl: string; verifyToken: string; displayPhoneNumber: string; lastWebhookAt: string | null } } | null;
}

/** WhatsApp Business through the workspace's own Cloud API number, against a local stand-in of Meta's Graph API. */
describe('WhatsApp Business app (stand-in)', () => {
  let app: INestApplication;
  let wa: WhatsappFixture;
  let restore: () => void;
  let owner: TestUser;
  let worker: WorkerService;
  let status: WaStatus;
  const ids = { gia: '', local: '', gone: '', firstWamid: '' };
  const GIA = '447700900456';
  const pub = () => request(app.getHttpServer());
  const appStatus = async (u: TestUser) => ((await api(u).get('/apps').expect(200)).body as WaStatus[]).find((a) => a.key === 'whatsapp')!;
  const thread = async (contactId: string) => (await api(owner).get(`/apps/whatsapp/contacts/${contactId}`).expect(200)).body as WhatsappThread;
  let ip = 0;
  const keys = (u: TestUser, body: object) => u.agent.post('/api/v1/apps/whatsapp/keys').set('origin', ORIGIN).set('x-forwarded-for', `198.51.100.${++ip}`).send(body);
  const deliver = (body: string, secret = WA.appSecret, url = status.connection!.settings.webhookUrl) =>
    pub().post(new URL(url).pathname).set('content-type', 'application/json').set('x-hub-signature-256', waSignature(secret, body)).send(body);
  const good = { phoneNumberId: WA.phoneNumberId, wabaId: WA.wabaId, accessToken: WA.token, appSecret: WA.appSecret };

  beforeAll(async () => {
    wa = await startWhatsappFixture();
    restore = setEnv({ WHATSAPP_API_BASE_URL: wa.url });
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'WA Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'professional', seats: 10 } }));
    const o = api(owner);
    ids.gia = (await o.post('/contacts', { firstName: 'Gia', lastName: 'Buyer', email: 'gia@globex.test', phone: '+44 7700 900456' }).expect(201)).body.id;
    ids.local = (await o.post('/contacts', { firstName: 'Lou', lastName: 'Local', phone: '07700 900111' }).expect(201)).body.id;
    ids.gone = (await o.post('/contacts', { firstName: 'Nora', lastName: 'Notonwa', phone: `+${WA.undeliverable}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await wa.close();
    restore();
  });

  it('starts not connected with no operator secret, and saves credentials only after Meta accepts them', async () => {
    expect(await appStatus(owner)).toMatchObject({ key: 'whatsapp', state: 'not_connected', connection: null });
    expect((await api(owner).post('/apps/whatsapp/connect', {}).expect(400)).body.error.code).toBe('NOT_OAUTH');
    const member = await inviteMember(app, owner, 'member');
    await keys(member, good).expect(403);
    await keys(owner, { ...good, accessToken: 'not-a-token' }).expect(400);

    const revoked = await keys(owner, { ...good, accessToken: 'EAArevokedToken0123456789abcdef' }).expect(400);
    expect(revoked.body.error.message).toContain('Meta refused the access token');
    const wrongWaba = await keys(owner, { ...good, wabaId: '2000000999' }).expect(400);
    expect(wrongWaba.body.error.message).toContain('does not belong to that WhatsApp Business Account');
    expect((await appStatus(owner)).state).toBe('not_connected');

    status = (await keys(owner, good).expect(200)).body as WaStatus;
    expect(status).toMatchObject({ state: 'connected', connection: { accountName: 'Globex Sales (+44 7700 900123)', settings: { displayPhoneNumber: '+44 7700 900123', lastWebhookAt: null } } });
    expect(status.connection!.settings.webhookUrl).toMatch(/\/api\/v1\/apps\/whatsapp\/webhooks\/[a-f0-9]{24}$/);
    expect(status.warnings[0]).toContain('Pending Configuration until Meta sends the first signed webhook');
    expect(JSON.stringify(status)).not.toContain(WA.token);
    expect(JSON.stringify(status)).not.toContain(WA.appSecret);
    const row = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirstOrThrow({ where: { tenantId: owner.tenantId, provider: 'WHATSAPP' } }));
    expect(row.credentialsEncrypted).toMatch(/^v1\./);
    expect(row.credentialsEncrypted).not.toContain('EAA');
  });

  it('answers Meta’s verification only with this workspace’s token, and refuses unsigned deliveries', async () => {
    const path = new URL(status.connection!.settings.webhookUrl).pathname;
    const ok = await pub().get(`${path}?hub.mode=subscribe&hub.verify_token=${status.connection!.settings.verifyToken}&hub.challenge=1158201444`).expect(200);
    expect(ok.text).toBe('1158201444');
    await pub().get(`${path}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`).expect(403);
    await pub().get('/api/v1/apps/whatsapp/webhooks/000000000000000000000000?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1').expect(403);
    const body = waInbound(GIA, 'hello');
    await deliver(body, 'ffffffffffffffffffffffffffffffff').expect(401);
    await pub().post(path).set('content-type', 'application/json').send(body).expect(401);
    expect((await thread(ids.gia)).messages).toEqual([]);
  });

  it('lists only approved templates it can fill, and needs recorded consent before a template', async () => {
    const templates = (await api(owner).get('/apps/whatsapp/templates').expect(200)).body;
    expect(templates).toEqual([
      { name: 'hello_world', language: 'en_US', category: 'UTILITY', body: 'Welcome and congratulations!', params: 0 },
      { name: 'proposal_ready', language: 'en', category: 'UTILITY', body: 'Hi {{1}}, your proposal {{2}} is ready. Reply here with any questions.', params: 2 },
    ]);
    const send = { kind: 'template', contactId: ids.gia, templateName: 'proposal_ready', language: 'en', params: ['Gia', 'Q-0001'], confirm: true };
    expect((await api(owner).post('/apps/whatsapp/messages', send).expect(400)).body.error.message).toContain('Record this contact’s WhatsApp consent');
    expect(wa.sent).toHaveLength(0);

    // A number without its country code is never guessed.
    expect((await thread(ids.local)).phoneProblem).toContain('Add the country code');
    await api(owner).post('/apps/whatsapp/consents', { contactId: ids.local, source: 'Said yes on the phone', confirm: true }).expect(409);

    await api(owner).post('/apps/whatsapp/consents', { contactId: ids.gia, source: 'Ticked the WhatsApp box on the demo form' }).expect(400);
    const t = (await api(owner).post('/apps/whatsapp/consents', { contactId: ids.gia, source: 'Ticked the WhatsApp box on the demo form', confirm: true }).expect(200)).body as WhatsappThread;
    expect(t).toMatchObject({ phone: GIA, consent: { phone: GIA, source: 'Ticked the WhatsApp box on the demo form' }, windowOpenUntil: null });

    await api(owner).post('/apps/whatsapp/messages', { ...send, confirm: false }).expect(400);
    expect((await api(owner).post('/apps/whatsapp/messages', { ...send, params: ['Gia'] }).expect(400)).body.error.message).toContain('needs 2 values');
    expect((await api(owner).post('/apps/whatsapp/messages', { ...send, templateName: 'promo_image' }).expect(400)).body.error.message).toContain('no approved template');
    const m = (await api(owner).post('/apps/whatsapp/messages', send).expect(200)).body;
    expect(m).toMatchObject({ direction: 'out', kind: 'template', status: 'accepted', body: 'Hi Gia, your proposal Q-0001 is ready. Reply here with any questions.', templateName: 'proposal_ready' });
    expect(wa.sent.at(-1)).toMatchObject({ to: GIA, type: 'template', template: { name: 'proposal_ready', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Gia' }, { type: 'text', text: 'Q-0001' }] }] } });
    ids.firstWamid = wa.sent.at(-1)!.id;
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action: { in: ['whatsapp.consent_recorded', 'whatsapp.sent'] } } }));
    expect(audit.map((a) => a.action).sort()).toEqual(['whatsapp.consent_recorded', 'whatsapp.sent']);
  });

  it('refuses free-form text until they write, then records their reply and opens the 24-hour window', async () => {
    const reply = { kind: 'text', contactId: ids.gia, text: 'Thanks Gia!', confirm: true };
    expect((await api(owner).post('/apps/whatsapp/messages', reply).expect(400)).body.error.message).toContain('only an approved template');

    const inbound = waInbound(GIA, 'Looks good, can we talk Friday?', { id: 'wamid.inbound1' });
    await deliver(inbound).expect(200);
    await deliver(inbound).expect(200); // Meta retries; stored once.
    const t = await thread(ids.gia);
    expect(t.messages.map((x) => [x.direction, x.body])).toEqual([
      ['out', 'Hi Gia, your proposal Q-0001 is ready. Reply here with any questions.'],
      ['in', 'Looks good, can we talk Friday?'],
    ]);
    expect(new Date(t.windowOpenUntil!).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const notes = ((await api(owner).get('/notifications').expect(200)).body.items as { type: string; title: string }[]).filter((n) => n.type === 'whatsapp.received');
    expect(notes[0]?.title).toBe('WhatsApp message from Gia Buyer');
    expect((await appStatus(owner)).warnings).toEqual([]);

    await api(owner).post('/apps/whatsapp/messages', reply).expect(200);
    expect(wa.sent.at(-1)).toMatchObject({ to: GIA, type: 'text', text: { body: 'Thanks Gia!' } });

    // A message from an unknown number is kept, unlinked, and the admin is told.
    await deliver(waInbound('447700900777', 'Who is this?', { name: 'Stranger' })).expect(200);
    const rows = await asTenant(owner.tenantId, (tx) => tx.whatsappMessage.findMany({ where: { tenantId: owner.tenantId, phone: '447700900777' } }));
    expect(rows).toEqual([expect.objectContaining({ contactId: null, direction: 'in' })]);
  });

  it('moves delivery status forward only, from signed status updates', async () => {
    await deliver(waStatus(ids.firstWamid, 'delivered', GIA)).expect(200);
    await deliver(waStatus(ids.firstWamid, 'read', GIA)).expect(200);
    await deliver(waStatus(ids.firstWamid, 'sent', GIA)).expect(200); // late, out of order
    const first = (await thread(ids.gia)).messages[0]!;
    expect(first).toMatchObject({ status: 'read' });
    expect(first.statusAt).not.toBeNull();
  });

  it('a STOP reply withdraws consent, so templates stop', async () => {
    await deliver(waInbound(GIA, ' stop ')).expect(200);
    const t = await thread(ids.gia);
    expect(t.consent).toBeNull();
    const notes = ((await api(owner).get('/notifications').expect(200)).body.items as { title: string }[]).map((n) => n.title);
    expect(notes).toContain('Gia Buyer opted out of WhatsApp messages');
    const sentBefore = wa.sent.length;
    await api(owner).post('/apps/whatsapp/messages', { kind: 'template', contactId: ids.gia, templateName: 'hello_world', language: 'en_US', params: [], confirm: true }).expect(400);
    expect(wa.sent).toHaveLength(sentBefore);
  });

  it('a workflow step sends a template only after approval and only with consent', async () => {
    const http = api(owner);
    const wf = (
      await http
        .post('/workflows', {
          name: 'Welcome on WhatsApp',
          definition: {
            trigger: { event: 'contact.created' },
            start: 'wa',
            nodes: [{ id: 'wa', type: 'action', action: { type: 'send_whatsapp', templateName: 'proposal_ready', language: 'en', params: ['{{record.firstName}}', 'Q-0002'] }, next: null }],
          },
        })
        .expect(201)
    ).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);

    const approveAndRun = async () => {
      await worker.drain();
      const pending = (await http.get('/approvals').expect(200)).body.find((a: { workflow: { id: string } }) => a.workflow?.id === wf.id);
      expect(pending).toMatchObject({ kind: 'workflow.send_whatsapp' });
      await http.post(`/approvals/${pending.id}/decision`, { decision: 'approve' }).expect(200);
      await worker.drain();
      return (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    };

    // No consent yet: the approved step fails with the reason and nothing is sent.
    const before = wa.sent.length;
    const ada = (await http.post('/contacts', { firstName: 'Ada', lastName: 'Lovelace', phone: '+44 7700 900321' }).expect(201)).body.id;
    let run = await approveAndRun();
    expect(run.status).toBe('FAILED');
    expect(JSON.stringify(run)).toContain('Record this contact’s WhatsApp consent');
    expect(wa.sent).toHaveLength(before);

    // With consent recorded (for example from a form), a new contact's welcome goes out once approved.
    await http.post('/apps/whatsapp/consents', { contactId: ada, source: 'Opted in on the website form', confirm: true }).expect(200);
    const ben = (await http.post('/contacts', { firstName: 'Ben', lastName: 'Ng', phone: '+44 7700 900322' }).expect(201)).body.id;
    await http.post('/apps/whatsapp/consents', { contactId: ben, source: 'Opted in on the website form', confirm: true }).expect(200);
    run = await approveAndRun();
    expect(run.status).toBe('SUCCEEDED');
    expect(wa.sent.at(-1)).toMatchObject({ to: '447700900322', template: { components: [{ parameters: [{ text: 'Ben' }, { text: 'Q-0002' }] }] } });
    expect((await thread(ben)).messages[0]).toMatchObject({ source: 'workflow', body: 'Hi Ben, your proposal Q-0002 is ready. Reply here with any questions.' });
  });

  it('shows WhatsApp’s refusal in plain words, and a refused token marks the connection', async () => {
    await api(owner).post('/apps/whatsapp/consents', { contactId: ids.gone, source: 'Agreed at the trade show', confirm: true }).expect(200);
    const r = await api(owner).post('/apps/whatsapp/messages', { kind: 'template', contactId: ids.gone, templateName: 'hello_world', language: 'en_US', params: [], confirm: true }).expect(400);
    expect(r.body.error.message).toContain('could not deliver to this number');
    expect((await api(owner).get('/apps/whatsapp/events').expect(200)).body[0]).toMatchObject({ kind: 'message.failed', ok: false });

    // Simulate the token being revoked in Meta Business Manager.
    const { SECRET_BOX } = await import('../src/common/crypto');
    const box = app.get(SECRET_BOX) as { seal(s: string): string };
    await asTenant(owner.tenantId, (tx) => tx.appConnection.updateMany({ where: { tenantId: owner.tenantId, provider: 'WHATSAPP' }, data: { credentialsEncrypted: box.seal(JSON.stringify({ ...good, accessToken: 'EAArevokedToken0123456789abcdef' })) } }));
    await api(owner).get('/apps/whatsapp/templates').expect(400);
    expect(await appStatus(owner)).toMatchObject({ state: 'error', connection: { lastError: expect.stringContaining('Meta refused the access token') } });
    // Replacing the credentials keeps the callback URL and verify token, so Meta's configuration stays valid.
    const again = (await keys(owner, good).expect(200)).body as WaStatus;
    expect(again.state).toBe('connected');
    expect(again.connection!.settings.webhookUrl).toBe(status.connection!.settings.webhookUrl);
    expect(again.connection!.settings.verifyToken).toBe(status.connection!.settings.verifyToken);
  });

  it('another workspace’s webhook cannot write into this one, and disconnecting keeps history', async () => {
    const other = await registerUser(app, 'Other WA');
    await asTenant(other.tenantId, (tx) => tx.subscription.update({ where: { tenantId: other.tenantId }, data: { planCode: 'professional', seats: 10 } }));
    const so = (await keys(other, { ...good, appSecret: 'abcdefabcdefabcdefabcdefabcdefab' }).expect(200)).body as WaStatus;
    // Signed with this workspace's secret but sent to the other's URL: refused.
    await deliver(waInbound(GIA, 'cross'), WA.appSecret, so.connection!.settings.webhookUrl).expect(401);
    await deliver(waInbound(GIA, 'mine'), 'abcdefabcdefabcdefabcdefabcdefab', so.connection!.settings.webhookUrl).expect(200);
    expect((await thread(ids.gia)).messages.map((m) => m.body)).not.toContain('mine');

    await api(owner).del('/apps/whatsapp').expect(204);
    await deliver(waInbound(GIA, 'after disconnect')).expect(404);
    const kept = await asTenant(owner.tenantId, (tx) => tx.whatsappMessage.count({ where: { tenantId: owner.tenantId, phone: GIA } }));
    expect(kept).toBeGreaterThan(2);
  });
});
