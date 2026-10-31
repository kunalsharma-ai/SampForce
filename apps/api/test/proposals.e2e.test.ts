import type { INestApplication } from '@nestjs/common';
import type { PublicProposal, QuoteRow } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProposalsService } from '../src/commercial/proposals.service';
import { startProviderFixture, providerEnv, type ProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

// 1x1 PNG
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function decodeSent(body: string): { headers: string; text: string } {
  const mime = Buffer.from((JSON.parse(body) as { raw: string }).raw, 'base64url').toString();
  const [headers = '', ...rest] = mime.split('\r\n\r\n');
  const parts = rest.join('\r\n\r\n');
  const plain = parts.match(/Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/)?.[1];
  return { headers, text: Buffer.from((plain ?? parts).replace(/\r\n/g, ''), 'base64').toString() };
}

/** Enhancement feature 9: proposals on quotes, with sections, branding, an online link, email sending and views. */
describe('proposals', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let owner: TestUser;
  let proposals: ProposalsService;
  const ids: Record<string, string> = {};
  const saved: Record<string, string | undefined> = {};
  const pub = () => request(app.getHttpServer());

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    proposals = app.get(ProposalsService);
    owner = await registerUser(app, 'Proposal Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.updateMany({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    const o = api(owner);
    const { url } = (await o.post('/integrations/google/connect').expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    await o.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    ids.product = (await o.post('/catalog/products', { name: 'Seat licence', unit: 'seat' }).expect(201)).body.id;
    const currency = (await o.get('/tenants/current').expect(200)).body.defaultCurrency ?? 'USD';
    ids.book = (await o.post('/catalog/price-books', { name: 'Standard', currency, isDefault: true }).expect(201)).body.id;
    await o.put(`/catalog/price-books/${ids.book}/prices/${ids.product}`, { unitPrice: 100 }).expect(204);
    const stage = (await o.get('/pipelines').expect(200)).body[0].stages[0];
    ids.company = (await o.post('/companies', { name: 'Globex' }).expect(201)).body.id;
    ids.contact = (await o.post('/contacts', { firstName: 'Gia', lastName: 'Buyer', email: 'gia@globex.test', companyId: ids.company }).expect(201)).body.id;
    ids.deal = (await o.post('/deals', { name: 'Globex rollout', amount: 1000, stageId: stage.id, companyId: ids.company, contactId: ids.contact }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('stores branding, and keeps the logo out of the audit log', async () => {
    const o = api(owner);
    await o.patch('/catalog/settings', { logoDataUrl: 'data:image/gif;base64,R0lGOD' }).expect(400);
    const s = (await o.patch('/catalog/settings', { proposalHeader: 'Globex-ready since 2020', proposalFooter: 'Proposal Co Ltd, 1 Main St', logoDataUrl: LOGO }).expect(200)).body;
    expect(s).toMatchObject({ proposalHeader: 'Globex-ready since 2020', proposalFooter: 'Proposal Co Ltd, 1 Main St', logoDataUrl: LOGO });
    const audit = (await o.get('/audit-logs?limit=5').expect(200)).body.items as { action: string; metadata: { after: { logoDataUrl: string } } }[];
    expect(audit.find((a) => a.action === 'commercial_settings.updated')!.metadata.after.logoDataUrl).toBe('(image)');
  });

  it('keeps sections through edits and revisions, and only shares an approved quote', async () => {
    const o = api(owner);
    const q = (await o.post('/quotes', { opportunityId: ids.deal, title: 'Globex proposal', lines: [{ productId: ids.product, quantity: 10 }], sections: [{ heading: 'Executive summary', body: 'Faster onboarding for Globex.' }] }).expect(201)).body as QuoteRow;
    expect(q.sections).toEqual([{ heading: 'Executive summary', body: 'Faster onboarding for Globex.' }]);
    expect(q.share).toEqual({ enabled: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0 });
    const edited = (await o.patch(`/quotes/${q.id}`, { sections: [{ heading: 'Executive summary', body: 'Faster onboarding.' }, { heading: 'Scope of work', body: 'Ten seats and setup.' }] }).expect(200)).body as QuoteRow;
    expect(edited.sections.map((s) => s.heading)).toEqual(['Executive summary', 'Scope of work']);
    await o.patch(`/quotes/${q.id}`, { sections: [{ heading: '', body: 'x' }] }).expect(400);
    await o.post(`/quotes/${q.id}/share`, { enabled: true }).expect(409);
    await o.post(`/quotes/${q.id}/send`, { to: 'gia@globex.test', subject: 'Proposal', message: 'Hi Gia' }).expect(409);
    await o.post(`/quotes/${q.id}/transition`, { action: 'submit' }).expect(200);
    ids.quote = q.id;
  });

  it('emails the proposal with a working link, marks it sent and logs it on the contact', async () => {
    const o = api(owner);
    const before = fixture.state.sent.length;
    const sent = (await o.post(`/quotes/${ids.quote}/send`, { to: 'gia@globex.test', subject: 'Your Globex proposal', message: 'Hi Gia, here is the proposal we discussed.' }).expect(200)).body as QuoteRow;
    expect(sent.status).toBe('SENT');
    expect(sent.share.enabled).toBe(true);
    expect(fixture.state.sent.length).toBe(before + 1);
    const mail = decodeSent(fixture.state.sent.at(-1)!.body);
    const link = mail.text.match(/View the proposal: (\S+)/)![1]!;
    expect(link).toMatch(/^http:\/\/localhost:3000\/p\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    ids.token = link.split('/p/')[1]!;
    const emails = (await o.get(`/emails?contactId=${ids.contact}`).expect(200)).body as { subject: string }[];
    expect(emails.map((e) => e.subject)).toContain('Your Globex proposal');
    expect((await o.get(`/quotes/${ids.quote}/share`).expect(200)).body.url).toBe(link);
  });

  it('shows the online proposal without signing in, counts views and tells the rep once', async () => {
    const preview = (await pub().get(`/api/v1/proposals/view/${ids.token}?preview=1`).expect(200)).body as PublicProposal;
    expect(preview).toMatchObject({ title: 'Globex proposal', preparedFor: 'Globex', status: 'SENT', superseded: false, total: 1000, seller: { name: 'Proposal Co', logoDataUrl: LOGO, footer: 'Proposal Co Ltd, 1 Main St' } });
    expect(preview.sections).toHaveLength(2);
    expect((await api(owner).get(`/quotes/${ids.quote}`).expect(200)).body.share.viewCount).toBe(0);

    await pub().get(`/api/v1/proposals/view/${ids.token}`).expect(200);
    await pub().get(`/api/v1/proposals/view/${ids.token}`).expect(200);
    const q = (await api(owner).get(`/quotes/${ids.quote}`).expect(200)).body as QuoteRow;
    expect(q.share.viewCount).toBe(2);
    expect(q.share.firstViewedAt).not.toBeNull();
    const notes = (await api(owner).get('/notifications').expect(200)).body;
    const items = (Array.isArray(notes) ? notes : notes.items) as { type: string; body: string }[];
    expect(items.filter((n) => n.type === 'quote.viewed')).toHaveLength(1);
    expect(items.find((n) => n.type === 'quote.viewed')!.body).toMatch(/security scanners/);

    const pdf = await pub().get(`/api/v1/proposals/view/${ids.token}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
  });

  it('rejects forged tokens and tracking tokens, and stops working when sharing is turned off', async () => {
    await pub().get('/api/v1/proposals/view/not-a-token').expect(404);
    const [raw] = ids.token!.split('.');
    await pub().get(`/api/v1/proposals/view/${raw}.AAAAAAAAAAAAAAAAAAAAAA`).expect(404);
    // A sequence tracking token for the same ids does not open a proposal.
    const { SequenceRunner } = await import('../src/sequences/sequence-runner.service');
    const tracking = app.get(SequenceRunner).signer.token(owner.tenantId, ids.quote!);
    await pub().get(`/api/v1/proposals/view/${tracking}`).expect(404);
    expect(proposals.signer.verify(ids.token!)).toEqual({ tenantId: owner.tenantId, messageId: ids.quote });

    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).post(`/quotes/${ids.quote}/share`, { enabled: false }).expect(403);
    await api(owner).post(`/quotes/${ids.quote}/share`, { enabled: false }).expect(200);
    await pub().get(`/api/v1/proposals/view/${ids.token}`).expect(404);
    await pub().get(`/api/v1/proposals/view/${ids.token}/pdf`).expect(404);
    await api(owner).post(`/quotes/${ids.quote}/share`, { enabled: true }).expect(200);
  });

  it('says when a newer version replaced the shared one', async () => {
    const o = api(owner);
    const next = (await o.post(`/quotes/${ids.quote}/transition`, { action: 'revise' }).expect(200)).body as QuoteRow;
    expect(next.sections.map((s) => s.heading)).toEqual(['Executive summary', 'Scope of work']);
    expect(next.share.enabled).toBe(false);
    const old = (await pub().get(`/api/v1/proposals/view/${ids.token}?preview=1`).expect(200)).body as PublicProposal;
    expect(old.superseded).toBe(true);
  });
});
