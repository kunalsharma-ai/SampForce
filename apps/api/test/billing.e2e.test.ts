import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service';
import { billingEnv, type BillingFixture, razorpaySignature, startBillingFixture, stripeSignature, stripeSubscription } from './fixtures/billing-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/**
 * Billing against local Stripe and Razorpay fixtures: checkout, signed webhooks, idempotency, seats,
 * plan changes, dunning, trials and the entitlements that follow from them.
 */
describe('billing without provider keys', () => {
  let app: INestApplication;
  let owner: TestUser;
  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Unbilled Ltd', { plan: 'free' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('shows plans but says checkout is not configured', async () => {
    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o).toMatchObject({ plan: { code: 'free' }, status: 'ACTIVE', providers: { STRIPE: false, RAZORPAY: false }, portalAvailable: false, trialAvailable: true });
    expect(o.catalog.every((p: { checkout: { STRIPE: { MONTH: boolean }; RAZORPAY: { MONTH: boolean } } }) => !p.checkout.STRIPE.MONTH && !p.checkout.RAZORPAY.MONTH)).toBe(true);
    const res = await api(owner).post('/billing/checkout', { provider: 'STRIPE', planCode: 'growth', interval: 'MONTH', seats: 1 }).expect(503);
    expect(res.body.error.code).toBe('BILLING_NOT_CONFIGURED');
    await request(app.getHttpServer()).post('/api/v1/billing/webhooks/stripe').send({}).expect(404);
  });

  it('public pricing is labelled a preview until published', async () => {
    const p = (await request(app.getHttpServer()).get('/api/v1/public/pricing').expect(200)).body;
    expect(p).toMatchObject({ published: false, currency: 'USD' });
    expect(p.plans.map((x: { code: string }) => x.code)).toContain('enterprise_plus');
    expect(p.plans.every((x: { buyOnline: boolean }) => !x.buyOnline)).toBe(true);
  });
});

describe('billing with Stripe and Razorpay fixtures', () => {
  let app: INestApplication;
  let fixture: BillingFixture;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let rzOwner: TestUser;
  const saved: Record<string, string | undefined> = {};
  const http = () => request(app.getHttpServer());
  let n = 0;

  const stripeEvent = (type: string, object: Record<string, unknown>) => JSON.stringify({ id: `evt_${++n}_${Date.now()}`, type, data: { object } });
  const sendStripe = (body: string, sig = stripeSignature(body)) => http().post('/api/v1/billing/webhooks/stripe').set('content-type', 'application/json').set('stripe-signature', sig).send(body);
  const sendRazorpay = (body: string, eventId: string, sig = razorpaySignature(body)) =>
    http().post('/api/v1/billing/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', eventId).send(body);

  beforeAll(async () => {
    fixture = await startBillingFixture();
    for (const [k, v] of Object.entries(billingEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    owner = await registerUser(app, 'Stripe Buyer Ltd', { plan: 'free' });
    member = await inviteMember(app, owner, 'member');
    rzOwner = await registerUser(app, 'Razorpay Buyer Ltd', { plan: 'free' });
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('only billing managers start checkout; Stripe gets the workspace reference and seat count', async () => {
    await api(member).post('/billing/checkout', { provider: 'STRIPE', planCode: 'growth', interval: 'MONTH', seats: 3 }).expect(403);
    const tooFew = await api(owner).post('/billing/checkout', { provider: 'STRIPE', planCode: 'growth', interval: 'MONTH', seats: 1 }).expect(400);
    expect(tooFew.body.error.code).toBe('TOO_FEW_SEATS');
    const noPrice = await api(owner).post('/billing/checkout', { provider: 'STRIPE', planCode: 'business', interval: 'MONTH', seats: 3 }).expect(400);
    expect(noPrice.body.error.code).toBe('PRICE_NOT_CONFIGURED');

    const { url } = (await api(owner).post('/billing/checkout', { provider: 'STRIPE', planCode: 'growth', interval: 'MONTH', seats: 3 }).expect(200)).body;
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const sent = new URLSearchParams(fixture.state.requests.find((r) => r.path === '/v1/checkout/sessions')!.body);
    expect(Object.fromEntries(sent)).toMatchObject({
      mode: 'subscription', client_reference_id: owner.tenantId, 'line_items[0][price]': 'price_growth_m', 'line_items[0][quantity]': '3',
      allow_promotion_codes: 'true', 'subscription_data[metadata][tenant_id]': owner.tenantId, customer_email: owner.email,
    });
    expect([...sent.keys()].some((k) => /card|number|cvc/i.test(k))).toBe(false);
  });

  it('a signed checkout webhook activates the plan once, however often it is delivered', async () => {
    fixture.state.stripeSubs.sub_1 = stripeSubscription('sub_1', { customer: 'cus_1', price: 'price_growth_m', quantity: 3, tenantId: owner.tenantId });
    const body = stripeEvent('checkout.session.completed', { id: 'cs_1', client_reference_id: owner.tenantId, customer: 'cus_1', subscription: 'sub_1', metadata: {} });
    expect((await sendStripe(body).expect(200)).body).toEqual({ received: true });
    expect((await sendStripe(body).expect(200)).body).toEqual({ received: true, duplicate: true });

    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o).toMatchObject({ plan: { code: 'growth' }, status: 'ACTIVE', seats: 3, seatLimit: 3, provider: 'STRIPE', portalAvailable: true, restricted: false });
    const audit = (await api(owner).get('/audit-logs?limit=50').expect(200)).body.items as { action: string; actorType: string }[];
    expect(audit.filter((a) => a.action === 'billing.subscription_synced')).toHaveLength(1);
    expect(audit.find((a) => a.action === 'billing.checkout_started')).toBeTruthy();
    const again = await api(owner).post('/billing/checkout', { provider: 'STRIPE', planCode: 'growth', interval: 'MONTH', seats: 3 }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_SUBSCRIBED');
  });

  it('rejects unsigned, tampered and stale webhooks', async () => {
    const body = stripeEvent('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1', metadata: { tenant_id: owner.tenantId } });
    expect((await sendStripe(body, 'nothing').expect(400)).body.error.code).toBe('INVALID_SIGNATURE');
    await sendStripe(body, stripeSignature(body, undefined, 'whsec_wrong')).expect(400);
    await sendStripe(body.replace('sub_1', 'sub_2'), stripeSignature(body)).expect(400);
    await sendStripe(body, stripeSignature(body, Math.floor(Date.now() / 1000) - 3600)).expect(400);
    await sendRazorpay('{"event":"subscription.activated"}', 'evt_x', 'deadbeef').expect(400);
  });

  it('records invoices and starts the grace period when a payment fails', async () => {
    const invoice = (status: string, extra: object = {}) => ({
      id: 'in_1', object: 'invoice', customer: 'cus_1', number: 'DF-0001', status, currency: 'usd', subtotal: 4500, total: 4500, amount_paid: status === 'paid' ? 4500 : 0,
      period_start: 1_790_000_000, period_end: 1_792_600_000, hosted_invoice_url: 'https://invoice.stripe.test/in_1', invoice_pdf: 'https://invoice.stripe.test/in_1.pdf',
      parent: { subscription_details: { subscription: 'sub_1', metadata: { tenant_id: owner.tenantId } } }, ...extra,
    });
    await sendStripe(stripeEvent('invoice.paid', invoice('paid', { status_transitions: { paid_at: 1_790_000_100 } }))).expect(200);
    const rows = (await api(owner).get('/billing/invoices').expect(200)).body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'STRIPE', number: 'DF-0001', status: 'PAID', currency: 'USD', totalCents: 4500, amountPaidCents: 4500, hostedUrl: 'https://invoice.stripe.test/in_1' });
    await api(member).get('/billing/invoices').expect(403);

    fixture.state.stripeSubs.sub_1!.status = 'past_due';
    await sendStripe(stripeEvent('invoice.payment_failed', invoice('open', { id: 'in_2', number: 'DF-0002' }))).expect(200);
    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o.status).toBe('PAST_DUE');
    expect(o.restricted).toBe(false);
    expect(new Date(o.graceEndsAt).getTime() - new Date(o.pastDueSince).getTime()).toBe(14 * 86_400_000);
    const notes = (await api(owner).get('/notifications').expect(200)).body.items as { type: string }[];
    expect(notes.some((x) => x.type === 'billing.payment_failed')).toBe(true);
  });

  it('after the grace period, Free allowances apply but nothing is deleted', async () => {
    await api(owner).post('/leads', { fullName: 'Kept Lead', email: 'kept@lead.test' }).expect(201);
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { pastDueSince: new Date(Date.now() - 15 * 86_400_000) } }));
    expect(await app.get(BillingService).runDue(true)).toBeGreaterThanOrEqual(1);
    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o).toMatchObject({ status: 'UNPAID', restricted: true, appliedPlan: 'free', plan: { code: 'growth' }, seatLimit: 2 });
    expect(o.usage.pipelines.limit).toBe(1);
    const invite = await api(owner).post('/tenants/current/invitations', { email: 'third@x.test', roleKey: 'member' }).expect(403);
    expect(invite.body.error.code).toBe('PLAN_LIMIT');
    expect((await api(owner).get('/leads?q=kept@lead.test').expect(200)).body.items).toHaveLength(1);

    // Paying restores the plan.
    fixture.state.stripeSubs.sub_1!.status = 'active';
    await sendStripe(stripeEvent('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1', metadata: { tenant_id: owner.tenantId } })).expect(200);
    expect((await api(owner).get('/billing').expect(200)).body).toMatchObject({ status: 'ACTIVE', restricted: false, pastDueSince: null });
  });

  it('changes seats with proration and refuses fewer seats than are in use', async () => {
    const few = await api(owner).post('/billing/seats', { seats: 1 }).expect(400);
    expect(few.body.error.code).toBe('TOO_FEW_SEATS');
    expect((await api(owner).post('/billing/seats', { seats: 5 }).expect(200)).body).toEqual({ appliesAt: 'now' });
    const upd = fixture.state.requests.filter((r) => r.method === 'POST' && r.path === '/v1/subscriptions/sub_1').at(-1)!;
    expect(Object.fromEntries(new URLSearchParams(upd.body))).toMatchObject({ 'items[0][id]': 'si_sub_1', 'items[0][quantity]': '5', proration_behavior: 'create_prorations' });
    expect((await api(owner).get('/billing').expect(200)).body.seats).toBe(5);
  });

  it('blocks a downgrade that current usage does not fit, and upgrades through the provider', async () => {
    for (const name of ['Two', 'Three', 'Four']) await api(owner).post('/pipelines', { name, stages: [{ name: 'Open', probability: 10, category: 'OPEN' }, { name: 'Won', probability: 100, category: 'WON' }, { name: 'Lost', probability: 0, category: 'LOST' }] }).expect(201);
    const blocked = await api(owner).post('/billing/plan', { planCode: 'launch', interval: 'MONTH' }).expect(409);
    expect(blocked.body.error.code).toBe('DOWNGRADE_BLOCKED');
    expect(blocked.body.error.details[0].message).toMatch(/4 pipelines/);
    await api(owner).post('/billing/plan', { planCode: 'professional', interval: 'MONTH' }).expect(200);
    expect((await api(owner).get('/billing').expect(200)).body.plan.code).toBe('professional');
  });

  it('schedules and withdraws cancellation; the portal opens on the Stripe customer', async () => {
    await api(owner).post('/billing/cancel').expect(200);
    expect((await api(owner).get('/billing').expect(200)).body.cancelAtPeriodEnd).toBe(true);
    await api(owner).post('/billing/resume').expect(200);
    expect((await api(owner).get('/billing').expect(200)).body.cancelAtPeriodEnd).toBe(false);
    expect((await api(owner).post('/billing/portal').expect(200)).body.url).toBe('https://billing.stripe.test/p/cus_1');
  });

  it('a deleted subscription returns the workspace to Free, keeping its data', async () => {
    fixture.state.stripeSubs.sub_1!.status = 'canceled';
    await sendStripe(stripeEvent('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1', metadata: { tenant_id: owner.tenantId } })).expect(200);
    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o).toMatchObject({ plan: { code: 'free' }, status: 'ACTIVE', provider: 'STRIPE', portalAvailable: true });
    expect((await api(owner).get('/pipelines').expect(200)).body).toHaveLength(4);
    expect((await api(owner).get('/billing/invoices').expect(200)).body).toHaveLength(2);
  });

  it('ignores webhooks for workspaces it does not know', async () => {
    fixture.state.stripeSubs.sub_ghost = stripeSubscription('sub_ghost', { customer: 'cus_ghost', price: 'price_growth_m', quantity: 1 });
    const res = await sendStripe(stripeEvent('customer.subscription.updated', { id: 'sub_ghost', customer: 'cus_ghost', metadata: { tenant_id: '00000000-0000-4000-8000-000000000000' } })).expect(200);
    expect(res.body).toEqual({ received: true, ignored: 'unknown_workspace' });
  });

  it('Razorpay: hosted subscription link, signed activation, changes from the next cycle', async () => {
    const { url } = (await api(rzOwner).post('/billing/checkout', { provider: 'RAZORPAY', planCode: 'growth', interval: 'MONTH', seats: 2 }).expect(200)).body;
    expect(url).toMatch(/^https:\/\/rzp\.test\/i\/sub_rzp/);
    const id = url.split('/').at(-1)!;
    expect(fixture.state.razorpaySubs[id]).toMatchObject({ plan_id: 'plan_growth_m', quantity: 2, notes: { tenant_id: rzOwner.tenantId } });

    Object.assign(fixture.state.razorpaySubs[id]!, { status: 'active', customer_id: 'cust_rz1', current_start: 1_790_000_000, current_end: 1_792_600_000 });
    const body = JSON.stringify({ entity: 'event', event: 'subscription.activated', payload: { subscription: { entity: { id, customer_id: 'cust_rz1', status: 'active', notes: { tenant_id: rzOwner.tenantId } } } } });
    await sendRazorpay(body, 'evt_rz_1').expect(200);
    expect((await sendRazorpay(body, 'evt_rz_1').expect(200)).body.duplicate).toBe(true);
    expect((await api(rzOwner).get('/billing').expect(200)).body).toMatchObject({ plan: { code: 'growth' }, status: 'ACTIVE', provider: 'RAZORPAY', seats: 2, portalAvailable: false });

    expect((await api(rzOwner).post('/billing/seats', { seats: 4 }).expect(200)).body).toEqual({ appliesAt: 'cycle_end' });
    expect(fixture.state.razorpaySubs[id]!.pending_update).toEqual({ quantity: 4, schedule_change_at: 'cycle_end' });
    expect((await api(rzOwner).get('/billing').expect(200)).body.seats).toBe(2);

    const charged = JSON.stringify({ entity: 'event', event: 'subscription.charged', payload: { subscription: { entity: { id, status: 'active', notes: { tenant_id: rzOwner.tenantId } } }, payment: { entity: { id: 'pay_1', invoice_id: 'inv_rz1', amount: 240000, currency: 'INR', created_at: 1_790_000_050 } } } });
    await sendRazorpay(charged, 'evt_rz_2').expect(200);
    expect((await api(rzOwner).get('/billing/invoices').expect(200)).body[0]).toMatchObject({ provider: 'RAZORPAY', status: 'PAID', currency: 'INR', totalCents: 240000 });

    await api(rzOwner).post('/billing/cancel').expect(200);
    expect(fixture.state.razorpaySubs[id]!.cancel_requested).toEqual({ cancel_at_cycle_end: 1 });
    expect((await api(rzOwner).post('/billing/resume').expect(409)).body.error.code).toBe('NOT_SUPPORTED');
    expect((await api(rzOwner).post('/billing/portal').expect(409)).body.error.code).toBe('NO_BILLING_ACCOUNT');
  });
});

describe('trials and plan entitlements', () => {
  let app: INestApplication;
  let owner: TestUser;
  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Trial Co Ltd', { plan: 'free' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('one trial per workspace lifts Free limits until it ends', async () => {
    await inviteMember(app, owner, 'member');
    await api(owner).post('/tenants/current/invitations', { email: 'blocked@x.test', roleKey: 'member' }).expect(403);
    const { trialEndsAt } = (await api(owner).post('/billing/trial', { planCode: 'professional' }).expect(200)).body;
    expect(new Date(trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect((await api(owner).get('/billing').expect(200)).body).toMatchObject({ status: 'TRIALING', plan: { code: 'professional' }, seatLimit: 10, trialAvailable: false });
    await api(owner).post('/tenants/current/invitations', { email: 'allowed@x.test', roleKey: 'member' }).expect(201);
    expect((await api(owner).post('/billing/trial', { planCode: 'growth' }).expect(409)).body.error.code).toBe('TRIAL_USED');

    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { trialEndsAt: new Date(Date.now() - 1000) } }));
    await app.get(BillingService).runDue(true);
    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o).toMatchObject({ status: 'ACTIVE', plan: { code: 'free' }, trialAvailable: false, trialEndsAt: null });
    const notes = (await api(owner).get('/notifications').expect(200)).body.items as { type: string }[];
    expect(notes.some((x) => x.type === 'billing.trial_ended')).toBe(true);
    expect((await api(owner).post('/billing/trial', { planCode: 'growth' }).expect(409)).body.error.code).toBe('TRIAL_USED');
  });

  it('custom roles: Professional and above, system roles fixed, no granting what you lack', async () => {
    const free = await api(owner).post('/tenants/current/roles', { name: 'Sales ops', permissions: ['leads:read'] }).expect(403);
    expect(free.body.error.code).toBe('PLAN_LIMIT');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'professional', seats: 10 } }));

    const role = (await api(owner).post('/tenants/current/roles', { name: 'Sales ops', description: 'Reads pipeline, edits leads', permissions: ['leads:read', 'leads:write', 'deals:read'] }).expect(201)).body;
    expect(role).toMatchObject({ key: 'custom-sales-ops', isSystem: false, members: 0 });
    const roles = (await api(owner).get('/tenants/current/roles').expect(200)).body as { key: string; isSystem: boolean }[];
    const ownerRole = roles.find((r) => r.key === 'owner') as unknown as { id: string };
    expect((await api(owner).put(`/tenants/current/roles/${ownerRole.id}`, { name: 'Boss', permissions: ['leads:read'] }).expect(400)).body.error.code).toBe('SYSTEM_ROLE');

    const admin = await inviteMember(app, owner, 'admin');
    const escalate = await api(admin).post('/tenants/current/roles', { name: 'Payer', permissions: ['billing:manage'] }).expect(403);
    expect(escalate.body.error.details[0].message).toBe('billing:manage');

    const person = await inviteMember(app, owner, role.key);
    expect((await api(person).get('/auth/me').expect(200)).body.permissions.sort()).toEqual(['deals:read', 'leads:read', 'leads:write']);
    await api(person).get('/leads').expect(200);
    await api(person).get('/companies').expect(403);
    expect((await api(owner).del(`/tenants/current/roles/${role.id}`).expect(409)).body.error.code).toBe('ROLE_IN_USE');

    const members = (await api(owner).get('/tenants/current/members').expect(200)).body as { membershipId: string; email: string }[];
    const m = members.find((x) => x.email === person.email)!;
    await api(owner).patch(`/tenants/current/members/${m.membershipId}/role`, { roleKey: 'viewer' }).expect(200);
    await api(owner).del(`/tenants/current/roles/${role.id}`).expect(204);

    // A discount approver does not need automation rights to use the approvals inbox.
    const approverRole = (await api(owner).post('/tenants/current/roles', { name: 'Discount approver', permissions: ['quotes:read', 'quotes:approve'] }).expect(201)).body;
    const approver = await inviteMember(app, owner, approverRole.key);
    expect((await api(approver).get('/approvals?status=PENDING').expect(200)).body).toEqual([]);
    await api(approver).get('/workflows').expect(403);
  });
});
