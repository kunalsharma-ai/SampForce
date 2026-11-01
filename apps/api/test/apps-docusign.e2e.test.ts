import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMessage, DOCUSIGN_ACCOUNT, DOCUSIGN_APP, type DocusignFixture, startDocusignFixture } from './fixtures/docusign-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

type Status = { key: string; state: string; missingConfig: string[]; warnings: string[]; connection: { accountName: string; externalAccountId: string; lastError: string | null } | null };
const ymd = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('DocuSign without app credentials', () => {
  it('shows Pending Configuration and refuses to connect or accept Connect messages', async () => {
    const restore = setEnv({ DOCUSIGN_INTEGRATION_KEY: undefined, DOCUSIGN_SECRET_KEY: undefined, DOCUSIGN_CONNECT_HMAC_KEY: undefined });
    const app = await startApp();
    try {
      const owner = await registerUser(app, 'No DocuSign Ltd');
      const ds = ((await api(owner).get('/apps').expect(200)).body as Status[]).find((a) => a.key === 'docusign');
      expect(ds).toMatchObject({ state: 'pending_configuration', missingConfig: ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY'] });
      expect((await api(owner).post('/apps/docusign/connect', {}).expect(409)).body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
      const m = connectMessage('x', 'envelope-completed');
      await request(app.getHttpServer()).post('/api/v1/apps/docusign/events').set(m.headers).send(m.raw).expect(403);
    } finally {
      await app.close();
      restore();
    }
  });
});

describe('DocuSign app (stand-in)', () => {
  let app: INestApplication;
  let ds: DocusignFixture;
  let owner: TestUser;
  let restore: () => void;
  let contractId: string;
  let envelope: { id: string; envelopeId: string };

  const status = async (u: TestUser) => ((await api(u).get('/apps').expect(200)).body as Status[]).find((a) => a.key === 'docusign')!;
  const connect = async (u: TestUser) => {
    const { url } = (await api(u).post('/apps/docusign/connect', {}).expect(200)).body as { url: string };
    const q = new URL(url).searchParams;
    expect(q.get('scope')).toBe('signature extended');
    return api(u).get(`/apps/docusign/callback?code=good-code&state=${encodeURIComponent(q.get('state')!)}`).expect(302);
  };
  const deliver = (m: { raw: string; headers: Record<string, string> }) => request(app.getHttpServer()).post('/api/v1/apps/docusign/events').set(m.headers).send(m.raw);
  const contract = async (name: string) => (await api(owner).post('/contracts', { name, value: 12000, startDate: ymd(1), endDate: ymd(366), terms: 'Annual subscription, 40 seats.' }).expect(201)).body.id as string;
  const send = (id: string, extra: object = {}) => api(owner).post('/apps/docusign/envelopes', { contractId: id, signerName: 'Grace Hopper', signerEmail: 'Grace@Customer.test', confirm: true, ...extra });

  beforeAll(async () => {
    ds = await startDocusignFixture();
    restore = setEnv({ DOCUSIGN_INTEGRATION_KEY: DOCUSIGN_APP.key, DOCUSIGN_SECRET_KEY: DOCUSIGN_APP.secret, DOCUSIGN_CONNECT_HMAC_KEY: DOCUSIGN_APP.hmac, DOCUSIGN_AUTH_BASE_URL: ds.url });
    app = await startApp();
    owner = await registerUser(app, 'Signing Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    contractId = await contract('Globex annual');
  });

  afterAll(async () => {
    await app.close();
    await ds.close();
    restore();
  });

  it('only admins connect; the account and its API address come from userinfo; tokens are sealed', async () => {
    const member = await inviteMember(app, owner, 'member');
    await api(member).post('/apps/docusign/connect', {}).expect(403);
    const r = await connect(owner);
    expect(r.headers.location).toMatch(/app=docusign&app_connected=1$/);
    expect(await status(owner)).toMatchObject({ state: 'connected', warnings: [], connection: { accountName: 'Acme Legal', externalAccountId: DOCUSIGN_ACCOUNT } });
    const row = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirstOrThrow({ where: { tenantId: owner.tenantId, provider: 'DOCUSIGN' } }));
    expect(row.credentialsEncrypted).toMatch(/^v1\./);
    expect(row.credentialsEncrypted).not.toContain('dsat-');
  });

  it('sends a draft contract only with explicit confirmation, as a PDF with signature anchors', async () => {
    await api(owner).post('/apps/docusign/envelopes', { contractId, signerName: 'Grace Hopper', signerEmail: 'grace@customer.test' }).expect(400);
    const sent = (await send(contractId, { message: 'Here is the contract we discussed.' }).expect(201)).body;
    expect(sent).toMatchObject({ contractId, status: 'sent', signerName: 'Grace Hopper', signerEmail: 'grace@customer.test' });
    envelope = sent;
    const e = ds.envelopes.get(sent.envelopeId)!;
    expect(e.emailSubject).toBe('Please sign: Globex annual');
    expect(e.signer.tabs).toMatchObject({ signHereTabs: [expect.objectContaining({ anchorString: '/sn1/' })], dateSignedTabs: [expect.objectContaining({ anchorString: '/ds1/' })] });
    expect(e.pdfBytes).toBeGreaterThan(500);
    expect(e.eventUrl).toBe('http://localhost:3000/api/v1/apps/docusign/events');
    // One envelope at a time per contract.
    expect((await send(contractId).expect(409)).body.error.code).toBe('ALREADY_SENT');
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenantId, action: 'contract.sent_for_signature' } }));
    expect(audit.metadata).toMatchObject({ provider: 'docusign', envelopeId: sent.envelopeId, confirmed: true });
  });

  it('Connect messages move the envelope forward; a completed envelope signs the contract; bad signatures are refused', async () => {
    await deliver(connectMessage(envelope.envelopeId, 'envelope-completed', { key: 'wrong' })).expect(401);
    await deliver(connectMessage(envelope.envelopeId, 'envelope-delivered')).expect(200);
    expect((await api(owner).get(`/apps/docusign/envelopes?contractId=${contractId}`).expect(200)).body[0].status).toBe('delivered');
    // An envelope from another account, and an unknown envelope, are acknowledged and ignored.
    await deliver(connectMessage(envelope.envelopeId, 'envelope-completed', { accountId: 'other-account' })).expect(200);
    await deliver(connectMessage('00000000-0000-4000-8000-000000000000', 'envelope-completed')).expect(200);
    expect((await api(owner).get(`/contracts/${contractId}`).expect(200)).body.status).toBe('DRAFT');

    await deliver(connectMessage(envelope.envelopeId, 'envelope-completed', { signer: { name: 'Grace B. Hopper', email: 'grace@customer.test' } })).expect(200);
    const c = (await api(owner).get(`/contracts/${contractId}`).expect(200)).body;
    expect(c).toMatchObject({ status: 'ACTIVE', signatureMethod: 'docusign', signedBy: 'Grace B. Hopper', signedAt: '2026-11-02' });
    const env = (await api(owner).get(`/apps/docusign/envelopes?contractId=${contractId}`).expect(200)).body[0];
    expect(env).toMatchObject({ status: 'completed', completedAt: '2026-11-02T10:00:00.000Z' });
    // A late or repeated event never moves it back.
    await deliver(connectMessage(envelope.envelopeId, 'envelope-sent')).expect(200);
    expect((await api(owner).get(`/apps/docusign/envelopes?contractId=${contractId}`).expect(200)).body[0].status).toBe('completed');
    const signed = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenantId, action: 'contract.signed', entityId: contractId } }));
    expect(signed).toMatchObject({ actorUserId: null, metadata: expect.objectContaining({ method: 'docusign', source: 'DocuSign Connect' }) });
  });

  it('downloads the signed PDF from DocuSign', async () => {
    const res = await api(owner).get(`/apps/docusign/envelopes/${envelope.id}/document`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.toString()).toContain('%PDF-1.4');
  });

  it('declines and voids are recorded and leave the contract as a draft; Check status reads DocuSign', async () => {
    const id2 = await contract('Initech pilot');
    const e2 = (await send(id2).expect(201)).body;
    await deliver(connectMessage(e2.envelopeId, 'envelope-declined', { signer: { name: 'Grace Hopper', email: 'grace@customer.test', declinedReason: 'Need legal review first' } })).expect(200);
    expect((await api(owner).get(`/apps/docusign/envelopes?contractId=${id2}`).expect(200)).body[0]).toMatchObject({ status: 'declined', declinedReason: 'Need legal review first' });
    expect((await api(owner).get(`/contracts/${id2}`).expect(200)).body.status).toBe('DRAFT');

    // Send again (the declined envelope is closed), then void it.
    const e3 = (await send(id2).expect(201)).body;
    await api(owner).post(`/apps/docusign/envelopes/${e3.id}/void`, { reason: '' }).expect(400);
    const voided = (await api(owner).post(`/apps/docusign/envelopes/${e3.id}/void`, { reason: 'Wrong price' }).expect(200)).body;
    expect(voided).toMatchObject({ status: 'voided', voidedReason: 'Wrong price' });
    expect(ds.envelopes.get(e3.envelopeId)).toMatchObject({ status: 'voided', voidedReason: 'Wrong price' });

    // Without a Connect message, Check status picks up a signature made in DocuSign.
    const e4 = (await send(id2).expect(201)).body;
    ds.envelopes.get(e4.envelopeId)!.status = 'completed';
    const checked = (await api(owner).post(`/apps/docusign/envelopes/${e4.id}/check`, {}).expect(200)).body;
    expect(checked.status).toBe('completed');
    expect((await api(owner).get(`/contracts/${id2}`).expect(200)).body).toMatchObject({ status: 'ACTIVE', signedBy: 'Grace Hopper', signatureMethod: 'docusign' });
    expect((await api(owner).get('/apps/docusign/events').expect(200)).body.map((x: { kind: string }) => x.kind)).toEqual(expect.arrayContaining(['envelope.sent', 'envelope.declined', 'envelope.voided', 'envelope.completed']));
  });

  it('refreshes an expired token once, and a member without contracts:write cannot send', async () => {
    ds.expireAll();
    const id3 = await contract('Umbrella renewal');
    await send(id3).expect(201);
    expect(ds.calls.filter((c) => c === 'POST /oauth/token').length).toBe(2);
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).post('/apps/docusign/envelopes', { contractId: id3, signerName: 'x', signerEmail: 'x@y.test', confirm: true }).expect(403);
  });
});
