import type { INestApplication } from '@nestjs/common';
import type { SampbidxRfqReadiness, SampbidxTransferRow } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SBX, sbxSign, startSampbidxFixture, type SampbidxFixture } from './fixtures/sampbidx-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const EML = [
  'From: Priya Nair <priya@acmepanels.example>',
  'To: bids@frequentresearch.example',
  'Subject: =?UTF-8?B?UkZROiBJbmRpYSBCMkIg4oCTIDQwMCBJVCBkZWNpc2lvbiBtYWtlcnM=?=',
  'Date: Mon, 16 Nov 2026 10:15:00 +0530',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please quote 400 completes, LOI 15, IR 20%.',
  '--b1',
  'Content-Type: application/pdf; name="questionnaire.pdf"',
  'Content-Disposition: attachment; filename="questionnaire.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 questionnaire').toString('base64'),
  '--b1--',
  '',
].join('\r\n');

/** SampBidx (ADR 0061) against the local stand-in that follows docs/integrations/sampbidx-api.md. */
describe('SampBidx (stand-in)', () => {
  let app: INestApplication;
  let sbx: SampbidxFixture;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let outsider: TestUser & { userId: string };
  let companyId: string;
  let priyaId: string;
  let rfqId: string;
  let emailId: string;
  let ip = 0;
  const pub = () => request(app.getHttpServer());
  const keys = (u: TestUser, body: object) => u.agent.post('/api/v1/apps/sampbidx/keys').set('origin', ORIGIN).set('x-forwarded-for', `198.51.100.${++ip}`).send(body);
  const base = () => `${sbx.url}/api`;

  beforeAll(async () => {
    sbx = await startSampbidxFixture();
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    rep = await inviteMember(app, owner, 'member');
    outsider = await inviteMember(app, owner, 'member');
    const res = (
      await api(owner)
        .post('/company-leads', { company: { name: 'Acme Panels', country: 'IN', ownerId: rep.userId }, employees: [{ firstName: 'Priya', lastName: 'Nair', emails: [{ value: 'priya@acmepanels.example' }] }] })
        .expect(201)
    ).body;
    companyId = res.company.id;
    priyaId = res.employeeIds[0];
    rfqId = (await api(rep).post('/rfqs', { companyId, contactId: priyaId, projectName: 'India B2B IT decision makers' }).expect(201)).body.id;
    emailId = await asTenant(owner.tenantId, async (tx) => {
      const conn = await tx.integrationConnection.create({ data: { tenantId: owner.tenantId, userId: rep.userId, provider: 'GOOGLE', accountEmail: 'rep@sampforce.test', scopes: [], credentialsEncrypted: 'x' } });
      const m = await tx.emailMessage.create({
        data: { tenantId: owner.tenantId, connectionId: conn.id, providerMessageId: 'rfq-1', direction: 'INBOUND', fromAddress: 'priya@acmepanels.example', toAddresses: ['rep@sampforce.test'], ccAddresses: [], subject: 'RFQ: Germany healthcare study', snippet: 'Need 200 HCPs', bodyText: 'Need 200 HCPs, LOI 20.', sentAt: new Date(), contactId: priyaId },
      });
      return m.id;
    });
  });
  afterAll(async () => {
    await app.close();
    await sbx.close();
  });

  it('connects only after SampBidx accepts the key, and only for admins', async () => {
    const status = async () => ((await api(owner).get('/apps').expect(200)).body as Array<{ key: string; state: string; warnings: string[]; connection: { settings: { callbackUrl: string; accountName: string } } | null }>).find((a) => a.key === 'sampbidx')!;
    expect(await status()).toMatchObject({ state: 'not_connected', connection: null });
    expect((await api(owner).post('/apps/sampbidx/connect', {}).expect(400)).body.error.code).toBe('NOT_OAUTH');
    await keys(rep, { baseUrl: base(), apiKey: SBX.key }).expect(403);
    await keys(owner, { baseUrl: 'not a url', apiKey: SBX.key }).expect(400);
    expect((await keys(owner, { baseUrl: base(), apiKey: 'wrong-key-1234' }).expect(400)).body.error.message).toContain('SampBidx refused the API key');
    expect((await keys(owner, { baseUrl: sbx.url, apiKey: SBX.key }).expect(400)).body.error.message).toContain('has no API at that address');
    // Sending before connecting says so.
    expect((await api(rep).post('/apps/sampbidx/transfers/rfq', { rfqId }).expect(400)).body.error.message).toContain('SampBidx is not connected');

    await keys(owner, { baseUrl: `${base()}/`, apiKey: SBX.key }).expect(200);
    const s = await status();
    expect(s).toMatchObject({ state: 'connected', connection: { settings: { accountName: SBX.account } } });
    expect(s.connection!.settings.callbackUrl).toMatch(/\/api\/v1\/apps\/sampbidx\/callbacks\/[a-f0-9]{24}$/);
    expect(s.warnings[0]).toContain('Status updates from SampBidx are Pending Configuration');
    // The key never comes back; the callback secret is for admins only.
    expect(JSON.stringify(s)).not.toContain(SBX.key);
    await api(rep).get('/apps/sampbidx/callback-secret').expect(403);
    expect((await api(owner).get('/apps/sampbidx/callback-secret').expect(200)).body.secret).toMatch(/^sbxcb_/);
  });

  it('sends a filled-in RFQ with its attachments only once the required details are there', async () => {
    const r = api(rep);
    let ready = (await r.get(`/apps/sampbidx/rfqs/${rfqId}`).expect(200)).body as SampbidxRfqReadiness;
    expect(ready).toMatchObject({ connected: true, missing: ['methodology', 'market', 'sampleSize', 'deadlineAt'], files: [], transfers: [] });
    const incomplete = await r.post('/apps/sampbidx/transfers/rfq', { rfqId }).expect(400);
    expect(incomplete.body.error.code).toBe('SAMPBIDX_INCOMPLETE');
    expect(incomplete.body.error.details.map((d: { path: string }) => d.path)).toEqual(['methodology', 'market', 'sampleSize', 'deadlineAt']);
    expect(sbx.received).toHaveLength(0);

    await r.patch(`/rfqs/${rfqId}`, { methodology: 'Online survey', market: 'IN', sampleSize: 400, loi: 15, ir: 20, cpi: 12.5, deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }).expect(200);
    for (const [name, body] of [['questionnaire.pdf', '%PDF-1.4 q'], ['quota-grid.xlsx', 'PK quota']] as const) {
      await rep.agent.post(`/api/v1/companies/${companyId}/files?name=${name}&rfqId=${rfqId}`).set('origin', ORIGIN).set('content-type', name.endsWith('pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(body)).expect(201);
    }
    ready = (await r.get(`/apps/sampbidx/rfqs/${rfqId}`).expect(200)).body;
    expect(ready.missing).toEqual([]);
    expect(ready.files.map((f) => f.name)).toEqual(['questionnaire.pdf', 'quota-grid.xlsx']);

    // A colleague who cannot see the company cannot send its RFQ.
    await api(outsider).post('/apps/sampbidx/transfers/rfq', { rfqId }).expect(404);
    // Files of another RFQ are refused.
    await r.post('/apps/sampbidx/transfers/rfq', { rfqId, fileIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);

    const sent = (await r.post('/apps/sampbidx/transfers/rfq', { rfqId, fileIds: [ready.files[0]!.id], note: 'Urgent, client wants it Friday' }).expect(200)).body as SampbidxTransferRow;
    expect(sent).toMatchObject({ kind: 'RFQ', delivery: 'SENT', attempts: 1, remoteStatus: 'RECEIVED', rfq: { id: rfqId }, company: { id: companyId }, files: [{ name: 'questionnaire.pdf' }], note: 'Urgent, client wants it Friday' });
    expect(sent.remoteId).toMatch(/^SBX-/);
    const got = sbx.received.at(-1)!;
    expect(got).toMatchObject({ path: '/v1/rfqs', idempotencyKey: sent.id, transferId: sent.id });
    expect(got.json).toMatchObject({
      system: 'SampForce',
      workspace: 'Frequent Research Fieldwork Solutions',
      note: 'Urgent, client wants it Friday',
      rfq: { number: 'RFQ-0001', projectName: 'India B2B IT decision makers', methodology: 'Online survey', market: 'IN', sampleSize: 400, loiMinutes: 15, incidenceRatePercent: 20, cpi: 12.5, totalQuotation: 5000, currency: 'USD', company: { name: 'Acme Panels' }, contact: { name: 'Priya Nair' } },
      attachments: [{ name: 'questionnaire.pdf', sizeBytes: 10 }],
    });
    expect(got.parts.filter((p) => p.name === 'files').map((p) => [p.filename, p.contentType, p.size])).toEqual([['questionnaire.pdf', 'application/pdf', 10]]);

    // Sending again needs saying so.
    expect((await r.post('/apps/sampbidx/transfers/rfq', { rfqId }).expect(409)).body.error.code).toBe('ALREADY_SENT');
  });

  it('keeps a failed send and retries it with the same idempotency key', async () => {
    const r = api(rep);
    sbx.failNext(1);
    const failed = (await r.post('/apps/sampbidx/transfers/rfq', { rfqId, resend: true }).expect(200)).body as SampbidxTransferRow;
    expect(failed).toMatchObject({ delivery: 'FAILED', attempts: 1, remoteId: null });
    expect(failed.lastError).toContain('SampBidx answered with an error (503)');
    const retried = (await r.post(`/apps/sampbidx/transfers/${failed.id}/retry`).expect(200)).body as SampbidxTransferRow;
    expect(retried).toMatchObject({ id: failed.id, delivery: 'SENT', attempts: 2, lastError: null, files: [{ name: 'questionnaire.pdf' }, { name: 'quota-grid.xlsx' }] });
    expect(sbx.received.at(-1)!.idempotencyKey).toBe(failed.id);
    await r.post(`/apps/sampbidx/transfers/${failed.id}/retry`).expect(409);

    // SampBidx's refusal is shown in its own words.
    const refuse = (await r.post('/rfqs', { companyId, projectName: 'REFUSE this one', methodology: 'CATI', market: 'DE', sampleSize: 50, deadlineAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body;
    const no = (await r.post('/apps/sampbidx/transfers/rfq', { rfqId: refuse.id }).expect(200)).body as SampbidxTransferRow;
    expect(no).toMatchObject({ delivery: 'FAILED' });
    expect(no.lastError).toBe('SampBidx refused the RFQ: Target audience is required for this market');
  });

  it('transfers an RFQ email from the mailbox, or as an uploaded .eml file', async () => {
    const r = api(rep);
    const box = (await r.get('/apps/sampbidx/mailbox?q=germany').expect(200)).body;
    expect(box).toEqual([expect.objectContaining({ id: emailId, subject: 'RFQ: Germany healthcare study', transferredAt: null, contact: expect.objectContaining({ name: 'Priya Nair', companyId }) })]);
    // Someone else's mailbox is not theirs to send.
    expect((await api(outsider).get('/apps/sampbidx/mailbox').expect(200)).body).toEqual([]);
    await api(outsider).post('/apps/sampbidx/transfers/mailbox-email', { emailMessageId: emailId }).expect(404);

    const fromBox = (await r.post('/apps/sampbidx/transfers/mailbox-email', { emailMessageId: emailId }).expect(200)).body as SampbidxTransferRow;
    expect(fromBox).toMatchObject({ kind: 'MAILBOX_EMAIL', delivery: 'SENT', title: 'RFQ: Germany healthcare study', emailFrom: 'priya@acmepanels.example', company: { id: companyId } });
    expect(sbx.received.at(-1)!).toMatchObject({ path: '/v1/rfq-emails', json: { source: 'mailbox', company: { name: 'Acme Panels' }, email: { subject: 'RFQ: Germany healthcare study', text: 'Need 200 HCPs, LOI 20.', attachmentsIncluded: false } } });
    expect((await r.get('/apps/sampbidx/mailbox').expect(200)).body[0].transferredAt).not.toBeNull();
    await r.post('/apps/sampbidx/transfers/mailbox-email', { emailMessageId: emailId }).expect(409);

    const upload = (name: string, type: string, body: string | Buffer, extra = '') =>
      rep.agent.post(`/api/v1/apps/sampbidx/transfers/email-file?name=${encodeURIComponent(name)}${extra}`).set('origin', ORIGIN).set('content-type', type).send(Buffer.from(body));
    expect((await upload('notes.txt', 'text/plain', 'hello').expect(400)).body.error.code).toBe('UNSUPPORTED_TYPE');
    const file = (await upload('rfq.eml', 'message/rfc822', EML, `&rfqId=${rfqId}`).expect(200)).body as SampbidxTransferRow;
    expect(file).toMatchObject({ kind: 'EMAIL_FILE', delivery: 'SENT', title: 'RFQ: India B2B – 400 IT decision makers', emailFrom: 'Priya Nair <priya@acmepanels.example>', rfq: { id: rfqId }, company: { id: companyId }, files: [{ name: 'rfq.eml' }] });
    expect(file.emailDate).toBe('2026-11-16T04:45:00.000Z');
    const got = sbx.received.at(-1)!;
    expect(got.json).toMatchObject({ source: 'file', rfq: { number: 'RFQ-0001' }, email: { fileName: 'rfq.eml', attachmentsIncluded: true } });
    expect(got.parts.find((p) => p.name === 'message')).toMatchObject({ filename: 'rfq.eml', contentType: 'message/rfc822', size: Buffer.byteLength(EML) });
    expect(got.parts.find((p) => p.name === 'message')!.text).toContain('questionnaire.pdf');
    // An Outlook .msg goes as it is.
    const msg = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from('outlook body')]);
    expect((await upload('RFQ from Acme.msg', 'application/vnd.ms-outlook', msg).expect(200)).body).toMatchObject({ kind: 'EMAIL_FILE', title: 'RFQ from Acme.msg', company: null });
    // Linking to a company the person cannot change is refused.
    await api(outsider).post(`/apps/sampbidx/transfers/email-file?name=x.eml&companyId=${companyId}`).expect(400);
  });

  it('takes signed status updates from SampBidx and refuses unsigned or stale ones', async () => {
    const { callbackUrl, secret } = (await api(owner).get('/apps/sampbidx/callback-secret').expect(200)).body as { callbackUrl: string; secret: string };
    const path = new URL(callbackUrl).pathname;
    const list = (await api(rep).get(`/apps/sampbidx/transfers?rfqId=${rfqId}`).expect(200)).body as SampbidxTransferRow[];
    const first = list.find((t) => t.kind === 'RFQ' && t.files.length === 1)!;
    const post = (body: object, sign = secret, ts?: string) => {
      const raw = JSON.stringify(body);
      const s = sbxSign(sign, raw, ts);
      return pub().post(path).set('content-type', 'application/json').set('x-sampbidx-timestamp', s.timestamp).set('x-sampbidx-signature', s.signature).send(raw);
    };
    await post({ transferId: first.id, status: 'quoted' }, 'wrong-secret').expect(401);
    await post({ transferId: first.id, status: 'quoted' }, secret, String(Math.floor(Date.now() / 1000) - 3600)).expect(401);
    await pub().post(path).set('content-type', 'application/json').send({ transferId: first.id, status: 'quoted' }).expect(401);
    await post({ transferId: first.id, status: 'not-a-status' }).expect(400);

    expect((await post({ sampbidxId: first.remoteId, status: 'quoted', note: 'Quoted at $11.50 CPI', url: 'https://sampbidx.example/bids/1' }).expect(200)).body).toEqual({ ok: true, matched: true });
    const after = (await api(rep).get(`/apps/sampbidx/transfers?rfqId=${rfqId}`).expect(200)).body as SampbidxTransferRow[];
    expect(after.find((t) => t.id === first.id)).toMatchObject({ remoteStatus: 'QUOTED', remoteNote: 'Quoted at $11.50 CPI', remoteUrl: 'https://sampbidx.example/bids/1' });
    expect((await post({ transferId: '00000000-0000-4000-8000-000000000000', status: 'won' }).expect(200)).body.matched).toBe(false);
    // The sender hears about it.
    const notes = (await api(rep).get('/notifications').expect(200)).body as { items?: Array<{ type: string; title: string }> } | Array<{ type: string; title: string }>;
    const items = Array.isArray(notes) ? notes : (notes.items ?? []);
    expect(items.some((n) => n.type === 'sampbidx.status' && n.title.includes('quoted'))).toBe(true);
    const app2 = ((await api(owner).get('/apps').expect(200)).body as Array<{ key: string; warnings: string[] }>).find((a) => a.key === 'sampbidx')!;
    expect(app2.warnings).toEqual([]);

    // A rotated secret replaces the old one at once.
    const rotated = (await api(owner).post('/apps/sampbidx/callback-secret/rotate', {}).expect(200)).body.secret;
    expect(rotated).not.toBe(secret);
    await post({ transferId: first.id, status: 'won' }, secret).expect(401);
    await post({ transferId: first.id, status: 'won' }, rotated).expect(200);
  });

  it('is withheld when the super admin takes SampBidx off the workspace', async () => {
    await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.create({ data: { tenantId: owner.tenantId, feature: 'sampbidx', enabled: false, reason: 'test', updatedBy: 'test' } }));
    try {
      expect((await api(rep).get(`/apps/sampbidx/rfqs/${rfqId}`).expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
      expect((await api(rep).post('/apps/sampbidx/transfers/rfq', { rfqId, resend: true }).expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    } finally {
      await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.deleteMany({ where: { tenantId: owner.tenantId, feature: 'sampbidx' } }));
    }
  });
});
