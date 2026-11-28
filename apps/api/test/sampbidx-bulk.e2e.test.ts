import { createServer, type AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { SampbidxBatchRow, SampbidxBulkPreview, SampbidxDiagnosis, SampbidxOverview } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SBX, sbxSign, startSampbidxFixture, type SampbidxFixture } from './fixtures/sampbidx-fixture';
import { SECRET_BOX, type SecretBox } from '../src/common/crypto';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/** The SampBidx settings page, Test connection and bulk sends of deals and won companies (ADR 0099), against the stand-in. */
describe('SampBidx settings and bulk sends (stand-in)', () => {
  let app: INestApplication;
  let sbx: SampbidxFixture;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let openStageId: string;
  let acme: { companyId: string; priyaId: string };
  let ip = 0;
  const base = () => `${sbx.url}/api`;
  const diagnose = (u: TestUser, body: object) => u.agent.post('/api/v1/apps/sampbidx/diagnose').set('origin', ORIGIN).set('x-forwarded-for', `198.51.100.${++ip}`).send(body);
  const step = (d: SampbidxDiagnosis, key: string) => d.steps.find((s) => s.key === key)!;
  const preview = async (body: object) => (await api(rep).post('/apps/sampbidx/batches/preview', body).expect(200)).body as SampbidxBulkPreview;
  const finished = async (id: string): Promise<SampbidxBatchRow> => {
    for (let i = 0; i < 100; i++) {
      const b = (await api(rep).get(`/apps/sampbidx/batches/${id}`).expect(200)).body as SampbidxBatchRow;
      if (b.status === 'DONE') return b;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('batch did not finish');
  };
  const send = async (body: object) => finished(((await api(rep).post('/apps/sampbidx/batches', body).expect(200)).body as SampbidxBatchRow).id);
  const deal = async (body: Record<string, unknown>) => (await api(rep).post('/deals', { currency: 'USD', stageId: openStageId, customFields: {}, ownerId: rep.userId, ...body }).expect(201)).body as { id: string };
  const lead = async (name: string, employee: Record<string, unknown>) => {
    const res = (await api(owner).post('/company-leads', { company: { name, country: 'IN', ownerId: rep.userId }, employees: [employee] }).expect(201)).body;
    return { companyId: res.company.id as string, priyaId: res.employeeIds[0] as string };
  };

  beforeAll(async () => {
    sbx = await startSampbidxFixture();
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Bulk');
    rep = await inviteMember(app, owner, 'member');
    const pipeline = ((await api(owner).get('/pipelines').expect(200)).body as { isDefault: boolean; stages: { id: string; category: string }[] }[]).find((p) => p.isDefault)!;
    openStageId = pipeline.stages.find((s) => s.category === 'OPEN')!.id;
    acme = await lead('Acme Panels', { firstName: 'Priya', lastName: 'Nair', emails: [{ value: 'priya@acmepanels.example' }], timezone: 'Asia/Kolkata' });
  });
  afterAll(async () => {
    await app.close();
    await sbx.close();
  });

  it('tests the connection step by step with the real reason, and never saves typed-in values', async () => {
    let o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body as SampbidxOverview;
    expect(o).toMatchObject({ state: 'NOT_CONNECTED', baseUrl: null, keyHint: null, sync: [], errors: [], batches: [], canManage: true });
    await api(rep).get('/apps/sampbidx/overview').expect(403);
    await diagnose(rep, {}).expect(403);

    let d = (await diagnose(owner, {}).expect(200)).body as SampbidxDiagnosis;
    expect(d).toMatchObject({ ok: false, saved: false });
    expect(step(d, 'address')).toMatchObject({ ok: false, message: 'No SampBidx address is saved or typed in.' });
    expect(step(d, 'network').ok).toBeNull();

    d = (await diagnose(owner, { baseUrl: 'ftp://sampbidx.example', apiKey: SBX.key }).expect(200)).body;
    expect(step(d, 'address').ok).toBe(false);

    // Nothing listens on that port: the reachability step fails and says why.
    const closed = await new Promise<number>((resolve) => {
      const srv = createServer().listen(0, '127.0.0.1', () => {
        const port = (srv.address() as AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });
    d = (await diagnose(owner, { baseUrl: `http://127.0.0.1:${closed}/api`, apiKey: SBX.key }).expect(200)).body;
    expect(d.steps.map((s) => s.ok)).toEqual([true, true, false, null, null, null]);
    expect(step(d, 'reachable').message).toContain('refused');

    // Something answers, but not the API: the usual cause when SampBidx has not built it, or the address misses /api.
    d = (await diagnose(owner, { baseUrl: sbx.url, apiKey: SBX.key }).expect(200)).body;
    expect(d.steps.map((s) => s.ok)).toEqual([true, true, true, false, null, null]);
    expect(step(d, 'api').hint).toContain('sampbidx-api.md');

    d = (await diagnose(owner, { baseUrl: base(), apiKey: 'wrong-key-1234' }).expect(200)).body;
    expect(d.steps.map((s) => s.ok)).toEqual([true, true, true, true, false, null]);
    expect(step(d, 'key').message).toContain('refused the API key');

    d = (await diagnose(owner, { baseUrl: base(), apiKey: SBX.key }).expect(200)).body;
    expect(d).toMatchObject({ ok: true, saved: false, accountName: SBX.account });
    expect(d.steps.slice(0, 5).every((s) => s.ok)).toBe(true);
    expect(typeof d.latencyMs).toBe('number');
    // Typed-in values were only tried.
    o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body;
    expect(o.state).toBe('NOT_CONNECTED');

    // Bulk sends say plainly that nothing can go yet.
    const p = await preview({ kind: 'DEALS', ids: [(await deal({ name: 'Early deal', amount: 100, companyId: acme.companyId })).id] });
    expect(p.connectionProblem).toContain('SampBidx is not connected');
    expect((await api(rep).post('/apps/sampbidx/batches', { kind: 'DEALS', ids: [acme.companyId] }).expect(400)).body.error.message).toContain('SampBidx is not connected');
  });

  it('gives the callback URL and signing secret before there is a key, and keeps them when the key is saved', async () => {
    const setup = (u: TestUser) => api(u).post('/apps/sampbidx/callback-setup', {});
    await setup(rep).expect(403);
    const first = (await setup(owner).expect(200)).body as { callbackUrl: string; secret: string };
    expect(first.callbackUrl).toMatch(/\/api\/v1\/apps\/sampbidx\/callbacks\/[a-f0-9]{24}$/);
    expect(first.secret.length).toBeGreaterThanOrEqual(16);
    expect((await setup(owner).expect(200)).body).toEqual(first);
    expect((await api(owner).get('/apps/sampbidx/callback-secret').expect(200)).body).toEqual(first);

    // Still "not connected": nothing can be sent, nothing claims an account, and a test does not mark it broken.
    const o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body as SampbidxOverview;
    expect(o).toMatchObject({ state: 'NOT_CONNECTED', baseUrl: null, accountName: null, keyHint: null, connectedAt: null, connectedBy: null, callbackUrl: first.callbackUrl });
    const d = (await diagnose(owner, {}).expect(200)).body as SampbidxDiagnosis;
    expect(d).toMatchObject({ ok: false, saved: false });
    expect((await api(owner).get('/apps/sampbidx/overview').expect(200)).body.state).toBe('NOT_CONNECTED');
    const apps = (await api(owner).get('/apps').expect(200)).body as { key: string; state: string }[];
    expect(apps.find((a) => a.key === 'sampbidx')!.state).toBe('not_connected');
    expect((await preview({ kind: 'WON_COMPANIES', ids: [acme.companyId] })).connectionProblem).toBeTruthy();

    // SampBidx's signed status updates are refused until the key is saved.
    const body = JSON.stringify({ event: 'transfer.status', transferId: '00000000-0000-4000-8000-000000000000', status: 'RECEIVED' });
    const { timestamp, signature } = sbxSign(first.secret, body);
    await owner.agent.post(new URL(first.callbackUrl).pathname).set('content-type', 'application/json').set('x-sampbidx-timestamp', timestamp).set('x-sampbidx-signature', signature).send(body).expect(401);

    // Saving the key keeps the same URL and secret, so what was typed into SampBidx stays right.
    await owner.agent.post('/api/v1/apps/sampbidx/keys').set('origin', ORIGIN).set('x-forwarded-for', `198.51.100.${++ip}`).send({ baseUrl: base(), apiKey: SBX.key }).expect(200);
    expect((await api(owner).get('/apps/sampbidx/callback-secret').expect(200)).body).toEqual(first);
    expect((await setup(owner).expect(200)).body).toEqual(first);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { action: { in: ['app.callback_prepared', 'app.connected', 'app.keys_replaced'] } }, orderBy: { createdAt: 'asc' } }));
    expect(audit.map((a) => a.action)).toEqual(['app.callback_prepared', 'app.connected']);
  });

  it('shows the saved connection as it really is: connected after a passing test, an error after a failing one', async () => {
    await owner.agent.post('/api/v1/apps/sampbidx/keys').set('origin', ORIGIN).set('x-forwarded-for', `198.51.100.${++ip}`).send({ baseUrl: base(), apiKey: SBX.key }).expect(200);
    let d = (await diagnose(owner, {}).expect(200)).body as SampbidxDiagnosis;
    expect(d).toMatchObject({ ok: true, saved: true });
    expect(step(d, 'callback')).toMatchObject({ ok: null });
    let o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body as SampbidxOverview;
    expect(o).toMatchObject({ state: 'CONNECTED', baseUrl: base(), accountName: SBX.account, keyHint: '…6789', lastError: null });
    expect(o.lastCheckedAt).toBeTruthy();
    expect(o.callbackUrl).toMatch(/\/callbacks\/[a-f0-9]{24}$/);
    expect(JSON.stringify(o)).not.toContain(SBX.key);

    // SampBidx starts refusing the key: the saved connection shows the error, and sends say why they cannot go.
    const conn = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirstOrThrow({ where: { provider: 'SAMPBIDX' } }));
    const original = conn.credentialsEncrypted;
    const box = app.get<SecretBox>(SECRET_BOX);
    {
      const keys = JSON.parse(box.open(original));
      await asTenant(owner.tenantId, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { credentialsEncrypted: box.seal(JSON.stringify({ ...keys, apiKey: 'revoked-key-0000' })) } }));
      d = (await diagnose(owner, {}).expect(200)).body;
      expect(step(d, 'key').ok).toBe(false);
      o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body;
      expect(o).toMatchObject({ state: 'ERROR', keyHint: '…0000' });
      expect(o.lastError).toContain('refused the API key');
      const p = await preview({ kind: 'WON_COMPANIES', ids: [acme.companyId] });
      expect(p.connectionProblem).toContain('SampBidx cannot be used right now');
      await asTenant(owner.tenantId, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { credentialsEncrypted: original } }));
      d = (await diagnose(owner, {}).expect(200)).body;
      expect(d.ok).toBe(true);
    }
    o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body;
    expect(o.state).toBe('CONNECTED');
  });

  it('checks deals first, sends the client then the deal, and skips what needs correction until it is typed in', async () => {
    const ready = await deal({ name: 'India B2B tracker', amount: 5000, companyId: acme.companyId, contactId: acme.priyaId });
    const beta = await lead('Beta Insights', { firstName: 'Omar', lastName: 'Haddad', timezone: 'Asia/Dubai' });
    const gaps = await deal({ name: 'Beta wave 2', amount: 0, companyId: beta.companyId, contactId: beta.priyaId });
    const orphan = await deal({ name: 'No company deal', amount: 900 });

    const p = await preview({ kind: 'DEALS', ids: [ready.id, gaps.id, orphan.id] });
    expect(p.connectionProblem).toBeNull();
    expect(p.counts).toEqual({ ready: 1, needsFix: 1, skip: 1 });
    expect(p.items.map((i) => i.status)).toEqual(['READY', 'NEEDS_FIX', 'SKIP']);
    expect(p.items[1]!.fixes.map((f) => `${f.record}.${f.field}`).sort()).toEqual(['contact.email', 'deal.amount']);
    expect(p.items[1]!.reason).toContain('Omar Haddad’s email');
    expect(p.items[2]!.reason).toContain('no company');
    expect(sbx.deals.size).toBe(0);

    // Sending without the corrections: the ready deal goes, the other is skipped and says why.
    let b = await send({ kind: 'DEALS', ids: [ready.id, gaps.id, orphan.id] });
    expect(b.counts).toEqual({ pending: 0, sent: 1, failed: 0, skipped: 2 });
    expect(b.items[0]).toMatchObject({ outcome: 'SENT', remoteId: expect.stringMatching(/^DL-/) });
    expect(b.items[0]!.transferIds).toHaveLength(2);
    expect(b.items[1]!.reason).toMatch(/^Needs correction: /);
    const client = sbx.clients.get(acme.companyId)!;
    const sent = sbx.deals.get(ready.id)!;
    expect(sent).toMatchObject({ clientId: client.id, puts: 1 });
    expect(sent.json).toMatchObject({ externalId: ready.id, client: { id: client.id, externalId: acme.companyId }, contact: { externalId: acme.priyaId }, deal: { name: 'India B2B tracker', amount: 5000, currency: 'USD', status: 'OPEN' } });
    expect(JSON.stringify(sent.json)).not.toMatch(/tax|discount|prepay/i);

    // The corrections are saved to the records and the deal goes.
    b = await send({ kind: 'DEALS', ids: [gaps.id], completion: { contacts: { [beta.priyaId]: { email: 'omar@beta.example' } }, deals: { [gaps.id]: { amount: 1200 } } } });
    expect(b.counts).toMatchObject({ sent: 1, skipped: 0 });
    const saved = await asTenant(owner.tenantId, (tx) => Promise.all([tx.contact.findUniqueOrThrow({ where: { id: beta.priyaId } }), tx.opportunity.findUniqueOrThrow({ where: { id: gaps.id } })]));
    expect(saved[0].email).toBe('omar@beta.example');
    expect(saved[1].amount).toBe(1200);
    expect(sbx.deals.get(gaps.id)!.json).toMatchObject({ deal: { amount: 1200 }, contact: { email: 'omar@beta.example' } });

    // Unchanged since: skipped unless sent again, which updates the same SampBidx deal (its externalId).
    expect((await preview({ kind: 'DEALS', ids: [ready.id] })).items[0]).toMatchObject({ status: 'SKIP', inSampbidx: true });
    b = await send({ kind: 'DEALS', ids: [ready.id], resend: true });
    expect(b.counts.sent).toBe(1);
    expect(sbx.deals.get(ready.id)).toMatchObject({ id: sent.id, puts: 2 });
    // The client was not changed, so only the deal went this time.
    expect(b.items[0]!.transferIds).toHaveLength(1);
  });

  it('keeps a failed item and retries it with the same idempotency key', async () => {
    const d = await deal({ name: 'Acme wave 3', amount: 2500, companyId: acme.companyId, contactId: acme.priyaId });
    sbx.failNext(1);
    let b = await send({ kind: 'DEALS', ids: [d.id] });
    expect(b.counts).toMatchObject({ sent: 0, failed: 1 });
    expect(b.items[0]!.reason).toContain('SampBidx answered with an error (503)');
    expect(sbx.deals.has(d.id)).toBe(false);
    // The person who started it is told, with the real outcome.
    const list = (await api(rep).get('/notifications').expect(200)).body as { items?: { type: string; title: string }[] } | { type: string; title: string }[];
    const told = (Array.isArray(list) ? list : (list.items ?? [])).filter((n) => n.type.startsWith('sampbidx.transfer'));
    expect(told[0]).toMatchObject({ type: 'sampbidx.transfer_failed', title: 'SampBidx send finished with 1 failed' });
    expect(told.some((n) => n.type === 'sampbidx.transfer_completed')).toBe(true);
    const o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body as SampbidxOverview;
    expect(o.errors[0]).toMatchObject({ kind: 'DEAL', delivery: 'FAILED' });

    b = (await api(rep).post(`/apps/sampbidx/batches/${b.id}/retry`).expect(200)).body;
    b = await finished(b.id);
    expect(b.counts).toMatchObject({ sent: 1, failed: 0 });
    const got = sbx.deals.get(d.id)!;
    expect(got.puts).toBe(1);
    // Retried as the same transfer: the same Idempotency-Key reached SampBidx.
    expect(got.idempotencyKeys).toEqual([b.items[0]!.transferIds.at(-1)]);
    expect((await api(rep).post(`/apps/sampbidx/batches/${b.id}/retry`).expect(409)).body.error.code).toBe('NOTHING_FAILED');
  });

  it('sends won companies as SampBidx clients with their win, the won deal’s contact and the RFQ contributors', async () => {
    const won = await lead('Northwind Research', { firstName: 'Lena', lastName: 'Fischer', emails: [{ value: 'lena@northwind.example' }], timezone: 'Europe/Berlin' });
    await asTenant(owner.tenantId, (tx) => tx.company.update({ where: { id: won.companyId }, data: { country: 'DE' } }));
    await deal({ name: 'Northwind tracker', amount: 8000, companyId: won.companyId, contactId: won.priyaId });
    await api(rep).post(`/companies/${won.companyId}/won`).expect(200);
    const notWon = await lead('Gamma Panels', { firstName: 'Ravi', lastName: 'Kumar', emails: [{ value: 'ravi@gamma.example' }], timezone: 'Asia/Kolkata' });

    const p = await preview({ kind: 'WON_COMPANIES', ids: [won.companyId, notWon.companyId] });
    expect(p.items.map((i) => i.status)).toEqual(['READY', 'SKIP']);
    expect(p.items[1]!.reason).toContain('Not a won company');
    const all = await preview({ kind: 'WON_COMPANIES', allWon: true });
    expect(all.items.map((i) => i.label)).toEqual(['Northwind Research']);

    const b = await send({ kind: 'WON_COMPANIES', allWon: true });
    expect(b.counts).toMatchObject({ sent: 1 });
    const c = sbx.clients.get(won.companyId)!;
    expect(c.json).toMatchObject({ externalId: won.companyId, company: { name: 'Northwind Research' }, relationship: { status: 'WON', wonDeal: { name: 'Northwind tracker', amount: 8000 } } });
    expect(c.contacts.map((x) => x.email)).toEqual(['lena@northwind.example']);
    expect(b.items[0]!.remoteId).toBe(c.id);
    expect((await preview({ kind: 'WON_COMPANIES', ids: [won.companyId] })).items[0]!.status).toBe('SKIP');

    const o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body as SampbidxOverview;
    expect(o.sync.find((s) => s.kind === 'DEAL')).toMatchObject({ sent: 4, failed: 0 });
    expect(o.sync.find((s) => s.kind === 'CLIENT')!.sent).toBeGreaterThanOrEqual(3);
    expect(o.batches[0]).toMatchObject({ kind: 'WON_COMPANIES', status: 'DONE' });
    expect(o.errors).toEqual([]);
  });

  it('tells a refused path from a refused key, and keeps the connection usable', async () => {
    // A SampBidx that takes the key at /v1/ping but has not allowed (or built) client sends.
    const won = await lead('Brandscapes Test', { firstName: 'Asha', lastName: 'Rao', emails: [{ value: 'asha@brandscapes.example' }], timezone: 'Asia/Kolkata' });
    await asTenant(owner.tenantId, (tx) => tx.company.update({ where: { id: won.companyId }, data: { country: 'IN' } }));
    await deal({ name: 'Brandscapes tracker', amount: 5000, companyId: won.companyId, contactId: won.priyaId });
    await api(rep).post(`/companies/${won.companyId}/won`).expect(200);
    sbx.forbidden.add('/v1/clients');
    try {
      const b = await send({ kind: 'WON_COMPANIES', ids: [won.companyId] });
      expect(b.counts).toMatchObject({ failed: 1 });
      const reason = b.items[0]!.reason!;
      expect(reason).toContain('SampBidx accepts the API key but refused the client (403 at PUT /v1/clients): Not allowed for this key.');
      expect(reason).not.toContain('Paste a current key');
      const o = (await api(owner).get('/apps/sampbidx/overview').expect(200)).body as SampbidxOverview;
      expect(o).toMatchObject({ state: 'CONNECTED', lastError: null });
      const apps = (await api(owner).get('/apps').expect(200)).body as { key: string; state: string }[];
      expect(apps.find((a) => a.key === 'sampbidx')!.state).toBe('connected');
    } finally {
      sbx.forbidden.clear();
    }
  });
});
