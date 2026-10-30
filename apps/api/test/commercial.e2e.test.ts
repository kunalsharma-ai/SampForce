import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalsService } from '../src/automation/approvals.service';
import { ContractsService } from '../src/commercial/contracts.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Catalogue, quotes with discount approval, quote versions and PDFs, and contracts with renewals. */
describe('quotes and contracts', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Quote Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.updateMany({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth' } }));
    member = await inviteMember(app, owner, 'member');
    manager = await inviteMember(app, owner, 'manager');
    const o = api(owner);
    ids.tax = (await o.post('/catalog/tax-rates', { name: 'VAT', rate: 10 }).expect(201)).body.id;
    ids.a = (await o.post('/catalog/products', { name: 'Seat licence', sku: 'SEAT', unit: 'seat' }).expect(201)).body.id;
    ids.b = (await o.post('/catalog/products', { name: 'Onboarding', sku: 'ONB' }).expect(201)).body.id;
    const currency = (await o.get('/tenants/current').expect(200)).body.defaultCurrency ?? 'USD';
    ids.currency = currency;
    ids.book = (await o.post('/catalog/price-books', { name: 'Standard', currency, isDefault: true }).expect(201)).body.id;
    await o.put(`/catalog/price-books/${ids.book}/prices/${ids.a}`, { unitPrice: 100 }).expect(204);
    await o.put(`/catalog/price-books/${ids.book}/prices/${ids.b}`, { unitPrice: 250 }).expect(204);
    const stage = (await o.get('/pipelines').expect(200)).body[0].stages[0];
    ids.company = (await o.post('/companies', { name: 'Globex' }).expect(201)).body.id;
    ids.deal = (await api(member).post('/deals', { name: 'Globex rollout', amount: 1000, stageId: stage.id, companyId: ids.company }).expect(201)).body.id;
    ids.eurDeal = (await o.post('/deals', { name: 'Euro deal', amount: 1000, currency: currency === 'EUR' ? 'GBP' : 'EUR', stageId: stage.id }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('only catalogue managers can change products and prices', async () => {
    await api(member).post('/catalog/products', { name: 'Sneaky' }).expect(403);
    await api(member).put(`/catalog/price-books/${ids.book}/prices/${ids.a}`, { unitPrice: 1 }).expect(403);
    const products = (await api(member).get('/catalog/products').expect(200)).body;
    expect(products.find((p: { id: string }) => p.id === ids.a).prices).toEqual([{ priceBookId: ids.book, currency: ids.currency, unitPrice: 100 }]);
  });

  it('prices every line from the price book and computes exact totals', async () => {
    const q = (
      await api(member)
        .post('/quotes', {
          opportunityId: ids.deal,
          lines: [
            { productId: ids.a, quantity: 3, discountPercent: 5, taxRateId: ids.tax, unitPrice: 1 },
            { productId: ids.b, quantity: 2, taxRateId: ids.tax },
          ],
        })
        .expect(201)
    ).body;
    ids.q1 = q.id;
    expect(q.reference).toMatch(/^Q-\d{4}$/);
    expect(q.lines.map((l: { unitPrice: number; netTotal: number; taxTotal: number }) => [l.unitPrice, l.netTotal, l.taxTotal])).toEqual([
      [100, 285, 28.5],
      [250, 500, 50],
    ]);
    expect({ subtotal: q.subtotal, discountTotal: q.discountTotal, taxTotal: q.taxTotal, total: q.total }).toEqual({ subtotal: 800, discountTotal: 15, taxTotal: 78.5, total: 863.5 });
    expect(q.needsApproval).toBe(false);
  });

  it('refuses a quote when there is no price book in the deal currency', async () => {
    const res = await api(owner).post('/quotes', { opportunityId: ids.eurDeal, lines: [] }).expect(400);
    expect(res.body.error.code).toBe('NO_PRICE_BOOK');
  });

  it('a discount within the limit is approved on submit; accept can update the deal amount', async () => {
    const m = api(member);
    expect((await m.post(`/quotes/${ids.q1}/transition`, { action: 'submit' }).expect(200)).body.status).toBe('APPROVED');
    await m.patch(`/quotes/${ids.q1}`, { notes: 'late change' }).expect(409);
    expect((await m.post(`/quotes/${ids.q1}/transition`, { action: 'mark_sent' }).expect(200)).body.status).toBe('SENT');
    expect((await m.post(`/quotes/${ids.q1}/transition`, { action: 'accept', updateDealAmount: true }).expect(200)).body.status).toBe('ACCEPTED');
    expect((await m.get(`/deals/${ids.deal}`).expect(200)).body.amount).toBe(785);
  });

  it('renders a PDF of the quote', async () => {
    const res = await api(member).get(`/quotes/${ids.q1}/pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a discount above the limit needs someone else with quotes:approve', async () => {
    const q = (await api(member).post('/quotes', { opportunityId: ids.deal, lines: [{ productId: ids.a, quantity: 10, discountPercent: 25 }] }).expect(201)).body;
    ids.q2 = q.id;
    const submitted = (await api(member).post(`/quotes/${q.id}/transition`, { action: 'submit' }).expect(200)).body;
    expect(submitted.status).toBe('PENDING_APPROVAL');
    await api(member).post(`/quotes/${q.id}/transition`, { action: 'mark_sent' }).expect(409);
    // Members cannot open the approvals inbox; managers see the request and are notified.
    await api(member).get('/approvals').expect(403);
    const pending = (await api(manager).get('/approvals').expect(200)).body.filter((a: { kind: string }) => a.kind === 'quote_discount');
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toMatchObject({ quoteId: q.id, maxDiscountPercent: 25, threshold: 10 });
    const inbox = (await api(manager).get('/notifications').expect(200)).body;
    expect(inbox.items).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'quote.approval_requested' })]));
    await api(manager).post(`/approvals/${pending[0].id}/decision`, { decision: 'approve' }).expect(200);
    expect((await api(member).get(`/quotes/${q.id}`).expect(200)).body.status).toBe('APPROVED');
  });

  it('blocks approving a discount on your own quote', async () => {
    const q = (await api(owner).post('/quotes', { opportunityId: ids.deal, lines: [{ productId: ids.b, quantity: 1, discountPercent: 40 }] }).expect(201)).body;
    await api(owner).post(`/quotes/${q.id}/transition`, { action: 'submit' }).expect(200);
    const approval = (await api(owner).get('/approvals').expect(200)).body.find((a: { payload: { quoteId?: string } }) => a.payload.quoteId === q.id);
    const res = await api(owner).post(`/approvals/${approval.id}/decision`, { decision: 'approve' }).expect(403);
    expect(res.body.error.code).toBe('SELF_APPROVAL');
    await api(manager).post(`/approvals/${approval.id}/decision`, { decision: 'reject', note: 'too deep' }).expect(200);
    expect((await api(owner).get(`/quotes/${q.id}`).expect(200)).body.status).toBe('REJECTED');
    // A rejected quote can be edited and resubmitted.
    await api(owner).patch(`/quotes/${q.id}`, { lines: [{ productId: ids.b, quantity: 1, discountPercent: 10 }] }).expect(200);
    expect((await api(owner).post(`/quotes/${q.id}/transition`, { action: 'submit' }).expect(200)).body.status).toBe('APPROVED');
  });

  it('an expired approval request sends the quote back to draft', async () => {
    const q = (await api(member).post('/quotes', { opportunityId: ids.deal, lines: [{ productId: ids.a, quantity: 1, discountPercent: 50 }] }).expect(201)).body;
    const submitted = (await api(member).post(`/quotes/${q.id}/transition`, { action: 'submit' }).expect(200)).body;
    await asTenant(owner.tenantId, (tx) => tx.approvalRequest.update({ where: { id: submitted.approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    // Only the jobs under test run here, so parallel test files keep their own queue items.
    await app.get(ApprovalsService).expireDue();
    const after = (await api(member).get(`/quotes/${q.id}`).expect(200)).body;
    expect(after.status).toBe('DRAFT');
    expect(after.approvalId).toBeNull();
  });

  it('revising makes a new version at current prices and locks the old one', async () => {
    await api(owner).put(`/catalog/price-books/${ids.book}/prices/${ids.a}`, { unitPrice: 120 }).expect(204);
    const v2 = (await api(member).post(`/quotes/${ids.q2}/transition`, { action: 'revise' }).expect(200)).body;
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('DRAFT');
    expect(v2.lines[0].unitPrice).toBe(120);
    expect(v2.lines[0].discountPercent).toBe(25);
    const res = await api(member).post(`/quotes/${ids.q2}/transition`, { action: 'mark_sent' }).expect(409);
    expect(res.body.error.code).toBe('QUOTE_SUPERSEDED');
    const versions = (await api(member).get(`/quotes/${v2.id}/versions`).expect(200)).body;
    expect(versions.map((v: { version: number; isLatest: boolean }) => [v.version, v.isLatest])).toEqual([
      [2, true],
      [1, false],
    ]);
    const audit = (await api(owner).get('/audit-logs?limit=100').expect(200)).body.items as { action: string; metadata: { from?: number; to?: number } }[];
    expect(audit.some((e) => e.action === 'price.changed' && e.metadata.from === 100 && e.metadata.to === 120)).toBe(true);
  });

  it('creates a contract only from an accepted quote, with the net value', async () => {
    const bad = await api(member).post('/contracts', { name: 'Too early', quoteId: ids.q2, startDate: ymd(0) }).expect(409);
    expect(bad.body.error.code).toBe('QUOTE_NOT_ACCEPTED');
    const c = (await api(member).post('/contracts', { name: 'Globex subscription', quoteId: ids.q1, startDate: ymd(-30), endDate: ymd(335), value: 1 }).expect(201)).body;
    ids.contract = c.id;
    expect(c).toMatchObject({ status: 'DRAFT', value: 785, currency: ids.currency, company: { id: ids.company }, deal: { id: ids.deal } });
    expect(c.reference).toMatch(/^C-\d{4}$/);
    expect((await api(member).get(`/quotes/${ids.q1}`).expect(200)).body.contractId).toBe(c.id);
    const signed = (await api(member).post(`/contracts/${c.id}/sign`, { signedBy: 'Hank Scorpio', signedAt: ymd(0), method: 'wet_ink' }).expect(200)).body;
    expect(signed.status).toBe('ACTIVE');
    const locked = await api(member).patch(`/contracts/${c.id}`, { value: 10 }).expect(409);
    expect(locked.body.error.code).toBe('CONTRACT_SIGNED');
    await api(member).patch(`/contracts/${c.id}`, { autoRenew: true }).expect(200);
  });

  it('sends one renewal reminder, expires ended contracts and links renewals', async () => {
    const m = api(member);
    const soon = (await m.post('/contracts', { name: 'Ending soon', companyId: ids.company, value: 500, startDate: ymd(-355), endDate: ymd(10), renewalNoticeDays: 30 }).expect(201)).body;
    await m.post(`/contracts/${soon.id}/sign`, { signedBy: 'A Person', signedAt: ymd(-355), method: 'email_confirmation' }).expect(200);
    const ended = (await m.post('/contracts', { name: 'Already ended', companyId: ids.company, value: 100, startDate: ymd(-400), endDate: ymd(-1) }).expect(201)).body;
    await m.post(`/contracts/${ended.id}/sign`, { signedBy: 'A Person', signedAt: ymd(-400), method: 'wet_ink' }).expect(200);

    await app.get(ContractsService).runDue();
    await app.get(ContractsService).runDue();
    const notes = (await m.get('/notifications').expect(200)).body;
    const list = notes.items as { type: string; link: string }[];
    expect(list.filter((n) => n.type === 'contract.renewal_due' && n.link === `/app/contracts/${soon.id}`)).toHaveLength(1);
    expect(list.filter((n) => n.type === 'contract.expired' && n.link === `/app/contracts/${ended.id}`)).toHaveLength(1);
    expect((await m.get(`/contracts/${ended.id}`).expect(200)).body.status).toBe('EXPIRED');

    const due = (await m.get('/contracts?renewalWithinDays=30').expect(200)).body;
    expect(due.map((c: { id: string }) => c.id)).toContain(soon.id);

    const renewal = (await m.post(`/contracts/${soon.id}/renew`).expect(200)).body;
    expect(renewal).toMatchObject({ status: 'DRAFT', renewedFromId: soon.id, startDate: ymd(11), value: 500 });
    await m.post(`/contracts/${soon.id}/renew`).expect(409);
    await m.post(`/contracts/${renewal.id}/sign`, { signedBy: 'A Person', signedAt: ymd(0), method: 'external_esign' }).expect(200);
    expect((await m.get(`/contracts/${soon.id}`).expect(200)).body.status).toBe('RENEWED');
  });

  it('terminates only active contracts and keeps the reason', async () => {
    const t = (await api(member).post(`/contracts/${ids.contract}/terminate`, { reason: 'Customer went bust' }).expect(200)).body;
    expect(t.status).toBe('TERMINATED');
    await api(member).post(`/contracts/${ids.contract}/terminate`, { reason: 'again' }).expect(409);
  });
});
