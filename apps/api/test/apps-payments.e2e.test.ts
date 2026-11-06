import type { INestApplication } from '@nestjs/common';
import type { PublicProposal } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CardPaymentsFixture, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WHSEC, startCardPaymentsFixture, STRIPE_WHSEC } from './fixtures/card-payments-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

interface PaymentsStatus {
  key: string;
  state: string;
  warnings: string[];
  connection: { accountName: string; externalAccountId: string; lastError: string | null; settings: { provider: string; mode: string; webhookUrl: string; lastWebhookAt: string | null } } | null;
}

/** Card payments on proposals into the workspace's own Stripe or Razorpay account, against a local stand-in. */
describe('card payments on proposals (stand-in)', () => {
  let app: INestApplication;
  let pay: CardPaymentsFixture;
  let restore: () => void;
  let owner: TestUser;
  const pub = () => request(app.getHttpServer());
  const status = async (u: TestUser) => ((await api(u).get('/apps').expect(200)).body as PaymentsStatus[]).find((a) => a.key === 'payments')!;
  const view = async (token: string) => (await pub().get(`/api/v1/proposals/view/${token}?preview=1`).expect(200)).body as PublicProposal;
  // Key saving (5 a minute) and "Pay by card" (10 a minute) are rate limited per address, so each call here uses its own.
  let ip = 0;
  const from = () => `198.51.100.${++ip}`;
  const keys = (u: TestUser, body: object) => u.agent.post('/api/v1/apps/payments/keys').set('origin', ORIGIN).set('x-forwarded-for', from()).send(body);
  const startPay = (token: string) => pub().post(`/api/v1/proposals/view/${token}/pay`).set('x-forwarded-for', from());
  const hook = (s: PaymentsStatus, w: { body: string; headers: Record<string, string> }) => pub().post(new URL(s.connection!.settings.webhookUrl).pathname).set(w.headers).send(w.body);

  /** A workspace with a deal, an approved and shared quote of 10 x 100, and its public token. */
  async function workspace(name: string) {
    const user = await registerUser(app, name);
    await asTenant(user.tenantId, (tx) => tx.subscription.update({ where: { tenantId: user.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    const o = api(user);
    const product = (await o.post('/catalog/products', { name: 'Seat licence', unit: 'seat' }).expect(201)).body.id;
    const currency = (await o.get('/tenants/current').expect(200)).body.defaultCurrency ?? 'USD';
    const book = (await o.post('/catalog/price-books', { name: 'Standard', currency, isDefault: true }).expect(201)).body.id;
    await o.put(`/catalog/price-books/${book}/prices/${product}`, { unitPrice: 100 }).expect(204);
    const stage = (await o.get('/pipelines').expect(200)).body[0].stages[0];
    const company = (await o.post('/companies', { name: 'Globex' }).expect(201)).body.id;
    const contact = (await o.post('/contacts', { firstName: 'Gia', lastName: 'Buyer', email: 'gia@globex.test', companyId: company }).expect(201)).body.id;
    const deal = (await o.post('/deals', { name: 'Globex rollout', amount: 1000, stageId: stage.id, companyId: company, contactId: contact }).expect(201)).body.id;
    const quote = (await o.post('/quotes', { opportunityId: deal, title: 'Globex proposal', lines: [{ productId: product, quantity: 10 }] }).expect(201)).body;
    await o.post(`/quotes/${quote.id}/transition`, { action: 'submit' }).expect(200);
    const { url } = (await o.post(`/quotes/${quote.id}/share`, { enabled: true }).expect(200)).body as { url: string };
    return { user, quoteId: quote.id as string, currency: currency as string, token: new URL(url).pathname.split('/').pop()! };
  }

  beforeAll(async () => {
    pay = await startCardPaymentsFixture();
    restore = setEnv({ STRIPE_API_BASE_URL: pay.url, RAZORPAY_API_BASE_URL: pay.url });
    app = await startApp();
    owner = await registerUser(app, 'Pay Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
  });

  afterAll(async () => {
    await app.close();
    await pay.close();
    restore();
  });

  it('starts not connected with nothing for an operator to configure, and is not an OAuth app', async () => {
    expect(await status(owner)).toMatchObject({ key: 'payments', state: 'not_connected', connection: null, warnings: [] });
    expect((await api(owner).post('/apps/payments/connect', {}).expect(400)).body.error.code).toBe('NOT_OAUTH');
  });

  it('saves keys only after the provider accepts them; keys are sealed and never returned', async () => {
    const member = await inviteMember(app, owner, 'member');
    await keys(member, { provider: 'stripe', secretKey: 'sk_test_goodMember01', webhookSecret: STRIPE_WHSEC }).expect(403);
    // A publishable key is the common mistake; it is refused before any call.
    await keys(owner, { provider: 'stripe', secretKey: 'pk_test_123', webhookSecret: STRIPE_WHSEC }).expect(400);

    const refused = await keys(owner, { provider: 'stripe', secretKey: 'sk_test_wrongKey00001', webhookSecret: STRIPE_WHSEC }).expect(400);
    expect(refused.body.error.message).toContain('Stripe refused the keys');
    const noPerm = await keys(owner, { provider: 'stripe', secretKey: 'rk_test_goodnocheckout1', webhookSecret: STRIPE_WHSEC }).expect(400);
    expect(noPerm.body.error.message).toContain('missing a permission');
    expect((await status(owner)).state).toBe('not_connected');

    // A restricted key works; it cannot read the account name, which is only a label.
    const s = (await keys(owner, { provider: 'stripe', secretKey: 'rk_test_goodRestricted1', webhookSecret: STRIPE_WHSEC }).expect(200)).body as PaymentsStatus;
    expect(s).toMatchObject({ state: 'connected', connection: { accountName: 'Stripe account (test mode)', settings: { provider: 'stripe', mode: 'test', lastWebhookAt: null } } });
    expect(s.connection!.settings.webhookUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/apps\/payments\/webhooks\/[a-f0-9]{24}$/);
    expect(s.warnings[0]).toContain('No payment confirmation has arrived yet');
    expect(JSON.stringify(s)).not.toContain('rk_test');
    expect(JSON.stringify(s)).not.toContain(STRIPE_WHSEC);
    const row = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirstOrThrow({ where: { tenantId: owner.tenantId, provider: 'PAYMENTS' } }));
    expect(row.credentialsEncrypted).toMatch(/^v1\./);
    expect(row.credentialsEncrypted).not.toContain('rk_test');

    // Replacing keys keeps the webhook URL, so the dashboard setting stays valid.
    const again = (await keys(owner, { provider: 'stripe', secretKey: 'sk_test_goodFull000001', webhookSecret: STRIPE_WHSEC }).expect(200)).body as PaymentsStatus;
    expect(again.connection!.settings.webhookUrl).toBe(s.connection!.settings.webhookUrl);
    expect(again.connection!.accountName).toBe('Globex Payments (test mode)');
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action: { in: ['app.connected', 'app.keys_replaced'] } }, orderBy: { createdAt: 'asc' } }));
    expect(audit.map((a) => a.action)).toEqual(['app.connected', 'app.keys_replaced']);
    expect(JSON.stringify(audit)).not.toContain('sk_test');
  });

  it('offers card payment only on an accepted proposal, and opens a Checkout Session for the exact total', async () => {
    const w = await workspace('Stripe Seller');
    await keys(w.user, { provider: 'stripe', secretKey: 'sk_test_goodSeller0001', webhookSecret: STRIPE_WHSEC }).expect(200);

    expect((await view(w.token)).payment).toEqual({ available: false, provider: 'stripe', paid: false, paidAt: null, reason: 'Card payment opens once the proposal is accepted.' });
    expect((await startPay(w.token).expect(409)).body.error.code).toBe('CANNOT_PAY');
    await startPay('not-a-token').expect(404);

    await api(w.user).post(`/quotes/${w.quoteId}/transition`, { action: 'accept' }).expect(200);
    expect((await view(w.token)).payment).toMatchObject({ available: true, reason: null });

    const { url } = (await startPay(w.token).expect(200)).body as { url: string };
    const session = pay.sessions.at(-1)!;
    expect(url).toBe(`${pay.url}/checkout/${session.id}`);
    expect(session).toMatchObject({ provider: 'stripe', key: 'sk_test_goodSeller0001', amount: 100000, currency: w.currency, customerEmail: 'gia@globex.test', successUrl: `http://localhost:3000/p/${w.token}?payment=done`, cancelUrl: `http://localhost:3000/p/${w.token}` });
    expect(session.metadata).toMatchObject({ sampforce_quote_id: w.quoteId, sampforce_tenant_id: w.user.tenantId });
    const rows = (await api(w.user).get(`/apps/payments/quotes/${w.quoteId}`).expect(200)).body;
    expect(rows).toEqual([expect.objectContaining({ id: session.metadata.sampforce_payment_id, status: 'pending', amount: 1000, currency: w.currency, provider: 'stripe' })]);
  });

  it('marks paid only on a correctly signed webhook with the amount asked, once, and tells the rep', async () => {
    const w = await workspace('Webhook Seller');
    const s = (await keys(w.user, { provider: 'stripe', secretKey: 'sk_test_goodHooks00001', webhookSecret: STRIPE_WHSEC }).expect(200)).body as PaymentsStatus;
    await api(w.user).post(`/quotes/${w.quoteId}/transition`, { action: 'accept' }).expect(200);
    await startPay(w.token).expect(200);
    const id = pay.sessions.at(-1)!.id;

    // Wrong secret, a stale timestamp, an unknown endpoint: refused and nothing changes.
    await hook(s, pay.webhookFor(id, 'paid', { secret: 'whsec_someoneElse0001' })).expect(404);
    await hook(s, pay.webhookFor(id, 'paid', { at: Math.floor(Date.now() / 1000) - 600 })).expect(404);
    const good = pay.webhookFor(id, 'paid');
    await pub().post('/api/v1/apps/payments/webhooks/000000000000000000000000').set(good.headers).send(good.body).expect(404);
    expect((await view(w.token)).payment!.paid).toBe(false);

    // A payment for a different amount is recorded but does not count.
    await hook(s, pay.webhookFor(id, 'paid', { amount: 100 })).expect(200);
    expect((await view(w.token)).payment!.paid).toBe(false);
    expect((await api(w.user).get('/apps/payments/events').expect(200)).body[0]).toMatchObject({ kind: 'payment.mismatch', ok: false });

    await hook(s, good).expect(200);
    await hook(s, good).expect(200); // Providers retry; the second delivery changes nothing.
    const p = (await view(w.token)).payment!;
    expect(p).toMatchObject({ paid: true, available: false });
    expect(p.paidAt).not.toBeNull();
    const rows = (await api(w.user).get(`/apps/payments/quotes/${w.quoteId}`).expect(200)).body;
    expect(rows[0]).toMatchObject({ status: 'paid', payerEmail: 'gia@globex.test', providerPaymentId: `pi_${id.slice(3)}` });
    const audit = await asTenant(w.user.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: w.user.tenantId, action: 'quote.paid' } }));
    expect(audit).toHaveLength(1);
    const notes = ((await api(w.user).get('/notifications').expect(200)).body.items as { type: string; body: string }[]).filter((n) => n.type === 'quote.paid');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('confirmed by Stripe');
    expect((await status(w.user)).warnings).toEqual([]);
    expect((await startPay(w.token).expect(409)).body.error.code).toBe('ALREADY_PAID');
  });

  it('works with Razorpay payment links, and one workspace cannot mark another’s payment paid', async () => {
    const a = await workspace('Razorpay Seller');
    const sa = (await keys(a.user, { provider: 'razorpay', keyId: RAZORPAY_KEY_ID, keySecret: RAZORPAY_KEY_SECRET, webhookSecret: RAZORPAY_WHSEC }).expect(200)).body as PaymentsStatus;
    expect(sa.connection).toMatchObject({ settings: { provider: 'razorpay', mode: 'test' } });
    const wrong = await keys(a.user, { provider: 'razorpay', keyId: RAZORPAY_KEY_ID, keySecret: 'wrongSecret12345', webhookSecret: RAZORPAY_WHSEC }).expect(400);
    expect(wrong.body.error.message).toContain('Razorpay refused the keys');
    await api(a.user).post(`/quotes/${a.quoteId}/transition`, { action: 'accept' }).expect(200);
    const { url } = (await startPay(a.token).expect(200)).body as { url: string };
    const link = pay.sessions.at(-1)!;
    expect(url).toBe(`${pay.url}/rzp/${link.id}`);
    expect(link).toMatchObject({ provider: 'razorpay', amount: 100000, reference: link.metadata.sampforce_payment_id });

    // Workspace B has its own keys; a webhook signed with B's secret naming A's payment is ignored.
    const b = await workspace('Other Seller');
    const sb = (await keys(b.user, { provider: 'razorpay', keyId: 'rzp_test_goodOther1', keySecret: RAZORPAY_KEY_SECRET, webhookSecret: 'other-secret' }).expect(200)).body as PaymentsStatus;
    await hook(sb, pay.webhookFor(link.id, 'paid', { secret: 'other-secret' })).expect(200);
    expect((await view(a.token)).payment!.paid).toBe(false);
    // And A's endpoint refuses B's signature.
    await hook(sa, pay.webhookFor(link.id, 'paid', { secret: 'other-secret' })).expect(404);

    await hook(sa, pay.webhookFor(link.id, 'paid')).expect(200);
    expect((await view(a.token)).payment).toMatchObject({ paid: true, provider: 'razorpay' });
  });

  it('an expired session can be retried, and disconnecting removes the option from the proposal', async () => {
    const w = await workspace('Expiry Seller');
    const s = (await keys(w.user, { provider: 'stripe', secretKey: 'sk_test_goodExpiry0001', webhookSecret: STRIPE_WHSEC }).expect(200)).body as PaymentsStatus;
    await api(w.user).post(`/quotes/${w.quoteId}/transition`, { action: 'accept' }).expect(200);
    await startPay(w.token).expect(200);
    await hook(s, pay.webhookFor(pay.sessions.at(-1)!.id, 'expired')).expect(200);
    expect((await api(w.user).get(`/apps/payments/quotes/${w.quoteId}`).expect(200)).body[0].status).toBe('expired');
    expect((await view(w.token)).payment!.available).toBe(true);
    await startPay(w.token).expect(200);

    await api(w.user).del('/apps/payments').expect(204);
    expect((await view(w.token)).payment).toBeUndefined();
    expect((await startPay(w.token).expect(409)).body.error.code).toBe('PAYMENTS_OFF');
    // The payment history stays on the quote.
    expect((await api(w.user).get(`/apps/payments/quotes/${w.quoteId}`).expect(200)).body).toHaveLength(2);
  });
});
