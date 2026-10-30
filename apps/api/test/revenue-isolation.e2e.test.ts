import type { INestApplication } from '@nestjs/common';
import { withDbContext } from '@dealflow/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, appClient, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const TABLES = [
  'commercial_settings', 'products', 'price_books', 'price_book_entries', 'tax_rates', 'quotes', 'quote_lines', 'contracts',
  'campaigns', 'segments', 'lead_forms', 'form_submissions', 'exchange_rates', 'sales_targets', 'escalations', 'company_health',
] as const;

/** Row-level security for every Phase 5 table, checked with the runtime database role, plus role checks. */
describe('commercial, marketing and success tenant isolation', () => {
  let app: INestApplication;
  let a: TestUser;
  let b: TestUser;
  let token: string;
  const db = appClient();

  beforeAll(async () => {
    app = await startApp();
    a = await registerUser(app, 'Iso Five A');
    b = await registerUser(app, 'Iso Five B');
    const h = api(a);
    const base = (await h.get('/tenants/current').expect(200)).body.defaultCurrency as string;
    await h.patch('/catalog/settings', { discountApprovalThreshold: 15 }).expect(200);
    const product = (await h.post('/catalog/products', { name: 'Thing' }).expect(201)).body.id;
    const tax = (await h.post('/catalog/tax-rates', { name: 'GST', rate: 5 }).expect(201)).body.id;
    const book = (await h.post('/catalog/price-books', { name: 'List', currency: base, isDefault: true }).expect(201)).body.id;
    await h.put(`/catalog/price-books/${book}/prices/${product}`, { unitPrice: 50 }).expect(204);
    const stage = (await h.get('/pipelines').expect(200)).body[0].stages[0].id;
    const company = (await h.post('/companies', { name: 'Iso Customer' }).expect(201)).body.id;
    const deal = (await h.post('/deals', { name: 'Iso deal', amount: 50, stageId: stage, companyId: company }).expect(201)).body.id;
    await h.post('/quotes', { opportunityId: deal, lines: [{ productId: product, quantity: 1, taxRateId: tax }] }).expect(201);
    const contract = (await h.post('/contracts', { name: 'Iso contract', companyId: company, value: 50, startDate: '2026-01-01', endDate: '2099-01-01' }).expect(201)).body.id;
    await h.post(`/contracts/${contract}/sign`, { signedBy: 'X', signedAt: '2026-01-01', method: 'wet_ink' }).expect(200);
    await h.post('/campaigns', { name: 'Iso campaign', channel: 'event' }).expect(201);
    await h.post('/segments', { name: 'Iso segment', entity: 'contact', rules: { match: 'all', rules: [] } }).expect(201);
    const form = (await h.post('/forms', { name: 'Iso form', title: 'Hi', fields: [{ key: 'fullName', label: 'Name', required: true }] }).expect(201)).body;
    token = form.publicToken;
    await request(app.getHttpServer()).post(`/api/v1/public/forms/${token}`).send({ fullName: 'Iso Visitor' }).expect(200);
    await h.put('/analytics/exchange-rates', { currency: base === 'EUR' ? 'USD' : 'EUR', rate: 1.2, effectiveDate: '2026-10-01' }).expect(200);
    await h.put('/analytics/targets', { period: '2026-Q4', userId: null, amount: 1000 }).expect(200);
    await h.post('/success/escalations', { companyId: company, title: 'Iso issue' }).expect(201);
    await h.get('/success/customers').expect(200);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const count = (table: string, ctx: { tenantId?: string }, extra = '') =>
    withDbContext(db, ctx, async (tx) => {
      if (extra) await tx.$executeRawUnsafe(extra);
      const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid`, a.tenantId);
      return Number(r[0]!.n);
    });

  it('tenant A has data in every new table; others and a missing context see none', async () => {
    for (const t of TABLES) {
      expect(await count(t, { tenantId: a.tenantId }), t).toBeGreaterThan(0);
      expect(await count(t, { tenantId: b.tenantId }), t).toBe(0);
      expect(await count(t, {}), t).toBe(0);
    }
  });

  it('the worker scan flag opens only contracts among the new tables', async () => {
    const scan = "SELECT set_config('app.worker_scan', 'on', true)";
    for (const t of TABLES) {
      const n = await count(t, {}, scan);
      if (t === 'contracts') expect(n, t).toBeGreaterThan(0);
      else expect(n, t).toBe(0);
    }
  });

  it('the form token opens exactly one form and nothing else', async () => {
    const set = `SELECT set_config('app.form_token', '${token}', true)`;
    expect(await count('lead_forms', {}, set)).toBe(1);
    expect(await count('form_submissions', {}, set)).toBe(0);
    expect(await count('lead_forms', {}, "SELECT set_config('app.form_token', 'wrong-token-value', true)")).toBe(0);
  });

  it('refuses writes into another tenant', async () => {
    await expect(withDbContext(db, { tenantId: b.tenantId }, (tx) => tx.product.create({ data: { tenantId: a.tenantId, name: 'Planted' } }))).rejects.toThrow();
    await expect(withDbContext(db, { tenantId: b.tenantId }, (tx) => tx.campaign.create({ data: { tenantId: a.tenantId, name: 'Planted', channel: 'other', currency: 'USD' } }))).rejects.toThrow();
  });

  it('API routes return 404 across workspaces', async () => {
    const quote = (await api(a).get('/quotes').expect(200)).body[0];
    const contract = (await api(a).get('/contracts').expect(200)).body[0];
    await api(b).get(`/quotes/${quote.id}`).expect(404);
    await api(b).get(`/quotes/${quote.id}/pdf`).expect(404);
    await api(b).post(`/quotes/${quote.id}/transition`, { action: 'submit' }).expect(404);
    await api(b).get(`/contracts/${contract.id}`).expect(404);
    await api(b).post(`/contracts/${contract.id}/terminate`, { reason: 'x' }).expect(404);
    expect((await api(b).get('/catalog/products').expect(200)).body).toEqual([]);
    expect((await api(b).get('/forms').expect(200)).body).toEqual([]);
  });

  it('viewers can read commercial records but not change them', async () => {
    await asTenant(a.tenantId, (tx) => tx.subscription.update({ where: { tenantId: a.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    const viewer = await inviteMember(app, a, 'viewer');
    const v = api(viewer);
    const quote = (await v.get('/quotes').expect(200)).body[0];
    await v.get('/contracts').expect(200);
    await v.get('/campaigns').expect(200);
    await v.get('/success/customers').expect(200);
    await v.patch(`/quotes/${quote.id}`, { notes: 'x' }).expect(403);
    await v.post('/contracts', { name: 'x', startDate: '2026-01-01' }).expect(403);
    await v.post('/success/escalations', { companyId: quote.deal.companyId, title: 'x' }).expect(403);
    await v.patch('/catalog/settings', { quoteValidityDays: 5 }).expect(403);
    await v.put('/analytics/targets', { period: '2026-Q4', userId: null, amount: 1 }).expect(403);
  });
});
