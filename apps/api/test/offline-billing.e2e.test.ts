import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { addMonths, BillingService } from '../src/billing/billing.service';
import { billingEnv, type BillingFixture, startBillingFixture } from './fixtures/billing-fixture';
import { api, appClient, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
const INSTRUCTIONS = 'Bank: Example Test Bank\\nAccount: 000-TEST\\nQuote the invoice number.';
const DAY = 86_400_000;

/**
 * Offline payment: online checkout is off by default, a workspace requests an invoice, an operator records
 * the bank transfer, and the plan starts, renews, lapses into the grace period or ends.
 */
describe('offline payment', () => {
  let app: INestApplication;
  let fixture: BillingFixture;
  let owner: TestUser;
  let member: TestUser;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  const saved: Record<string, string | undefined> = {};
  const password = 'operator-password-1';
  const adminEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;
  const supportEmail = `sup-${randomUUID().slice(0, 8)}@platform.test`;
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });
  const sub = () => asTenant(owner.tenantId, (tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: owner.tenantId } }));

  beforeAll(async () => {
    fixture = await startBillingFixture();
    // Provider keys are set but online payments are not turned on.
    const env = { ...billingEnv(fixture.url), ONLINE_PAYMENTS_ENABLED: 'false', OFFLINE_PAYMENT_INSTRUCTIONS: INSTRUCTIONS, OPERATOR_JWT_SECRET: OP_SECRET };
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
    owner = await registerUser(app, 'Bank Transfer Ltd');
    member = await inviteMember(app, owner, 'member');
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('turns online checkout off even with provider keys set', async () => {
    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o.providers).toEqual({ STRIPE: false, RAZORPAY: false });
    expect(o.catalog.every((p: { checkout: Record<string, Record<string, boolean>> }) => !p.checkout.STRIPE!.MONTH && !p.checkout.RAZORPAY!.MONTH)).toBe(true);
    expect(o.offline).toEqual({ instructions: 'Bank: Example Test Bank\nAccount: 000-TEST\nQuote the invoice number.', openInvoice: null });
    const res = await api(owner).post('/billing/checkout', { provider: 'STRIPE', planCode: 'growth', interval: 'MONTH', seats: 2 }).expect(503);
    expect(res.body.error.code).toBe('ONLINE_PAYMENTS_OFF');
    expect(fixture.state.requests.some((r) => r.path.includes('checkout'))).toBe(false);
    expect((await request(app.getHttpServer()).get('/api/v1/public/pricing').expect(200)).body.onlinePayments).toBe(false);
  });

  it('issues an invoice at rate-card prices to billing managers only, one open at a time', async () => {
    await api(member).post('/billing/invoice-requests', { planCode: 'growth', interval: 'YEAR', seats: 3 }).expect(403);
    expect((await api(owner).post('/billing/invoice-requests', { planCode: 'growth', interval: 'YEAR', seats: 1 }).expect(400)).body.error.code).toBe('TOO_FEW_SEATS');
    const first = (await api(owner).post('/billing/invoice-requests', { planCode: 'growth', interval: 'YEAR', seats: 3 }).expect(201)).body;
    // Growth annual: $12 per seat per month, 3 seats, 12 months.
    expect(first).toMatchObject({ provider: 'OFFLINE', status: 'OPEN', currency: 'USD', totalCents: 12 * 100 * 3 * 12, planCode: 'growth', interval: 'YEAR', seats: 3, paidAt: null });
    expect(first.number).toMatch(/^DF-\d{6}$/);
    expect((await api(owner).post('/billing/invoice-requests', { planCode: 'launch', interval: 'MONTH', seats: 3 }).expect(409)).body.error.code).toBe('OPEN_INVOICE');
    expect((await api(owner).get('/billing').expect(200)).body.offline.openInvoice).toMatchObject({ id: first.id });

    await api(owner).post(`/billing/invoice-requests/${first.id}/cancel`, {}).expect(204);
    await api(owner).post(`/billing/invoice-requests/${first.id}/cancel`, {}).expect(404);
    const second = (await api(owner).post('/billing/invoice-requests', { planCode: 'growth', interval: 'MONTH', seats: 3 }).expect(201)).body;
    expect(second.totalCents).toBe(15 * 100 * 3);
    expect(second.number).not.toBe(first.number);
    // The workspace's plan does not change until the payment is recorded.
    expect((await sub()).planCode).toBe('free');
  });

  it('lists open invoices to operators; only admins record a payment, which starts the plan', async () => {
    const open = (await op(support).get('/invoices/open').expect(200)).body as { id: string; tenant: { id: string } }[];
    const inv = open.find((i) => i.tenant.id === owner.tenantId)!;
    expect(inv).toBeTruthy();
    await op(support).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/paid`, { reference: 'UTR123' }).expect(403);
    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    await op(admin).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/paid`, { reference: 'UTR123', receivedOn: tomorrow }).expect(400);
    const detail = (await op(admin).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/paid`, { reference: 'UTR123' }).expect(200)).body;
    expect(detail.subscription).toMatchObject({ planCode: 'growth', status: 'ACTIVE', seats: 3, provider: 'OFFLINE' });
    await op(admin).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/paid`, { reference: 'UTR123' }).expect(409);

    const s = await sub();
    expect(s.currentPeriodEnd!.getTime()).toBe(addMonths(s.currentPeriodStart, 1).getTime());
    const o = (await api(owner).get('/billing').expect(200)).body;
    expect(o).toMatchObject({ plan: { code: 'growth' }, status: 'ACTIVE', provider: 'OFFLINE', seatLimit: 3, offline: { openInvoice: null } });
    const invoices = (await api(owner).get('/billing/invoices').expect(200)).body;
    expect(invoices[0]).toMatchObject({ id: inv.id, status: 'PAID', paymentReference: 'UTR123', amountPaidCents: 15 * 100 * 3 });
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirst({ where: { action: 'billing.offline_payment_recorded' } }));
    expect(audit).toMatchObject({ actorType: 'PLATFORM_ADMIN', entityId: inv.id });
    const platform = (await op(admin).get(`/audit-log?tenantId=${owner.tenantId}`).expect(200)).body as { action: string }[];
    expect(platform.some((l) => l.action === 'tenant.offline_payment_recorded')).toBe(true);
    const notes = (await api(owner).get('/notifications').expect(200)).body;
    expect(JSON.stringify(notes)).toContain(`Payment received for invoice ${invoices[0].number}`);
  });

  it('refuses provider-only changes on an invoice plan and renews from the end of the period', async () => {
    expect((await api(owner).post('/billing/seats', { seats: 5 }).expect(409)).body.error.code).toBe('OFFLINE_PLAN');
    expect((await api(owner).post('/billing/plan', { planCode: 'professional', interval: 'MONTH' }).expect(409)).body.error.code).toBe('OFFLINE_PLAN');
    const before = await sub();
    const renewal = (await api(owner).post('/billing/invoice-requests', { planCode: 'growth', interval: 'MONTH', seats: 3 }).expect(201)).body;
    await op(admin).post(`/tenants/${owner.tenantId}/invoices/${renewal.id}/paid`, { reference: 'UTR124' }).expect(200);
    const after = await sub();
    expect(after.currentPeriodStart.getTime()).toBe(before.currentPeriodEnd!.getTime());
    expect(after.currentPeriodEnd!.getTime()).toBe(addMonths(before.currentPeriodEnd!, 1).getTime());
  });

  it('starts the grace period when a paid period ends unrenewed, then pauses paid features', async () => {
    const ended = new Date(Date.now() - DAY);
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { currentPeriodEnd: ended } }));
    await app.get(BillingService).runDue(true);
    expect(await sub()).toMatchObject({ status: 'PAST_DUE', pastDueSince: ended });
    expect((await api(owner).get('/billing').expect(200)).body.restricted).toBe(false);

    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { pastDueSince: new Date(Date.now() - 15 * DAY) } }));
    await app.get(BillingService).runDue(true);
    expect((await sub()).status).toBe('UNPAID');
    expect((await api(owner).get('/billing').expect(200)).body).toMatchObject({ restricted: true, appliedPlan: 'free' });

    // Paying again restores the plan with a fresh period from the payment date.
    const inv = (await api(owner).post('/billing/invoice-requests', { planCode: 'growth', interval: 'MONTH', seats: 3 }).expect(201)).body;
    await op(admin).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/paid`, { reference: 'UTR125' }).expect(200);
    const s = await sub();
    expect(s).toMatchObject({ status: 'ACTIVE', pastDueSince: null });
    expect(s.currentPeriodStart.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('moves to Free at the end of the period when cancellation is scheduled', async () => {
    await api(owner).post('/billing/cancel', {}).expect(200);
    expect((await sub()).cancelAtPeriodEnd).toBe(true);
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } }));
    await app.get(BillingService).runDue(true);
    expect(await sub()).toMatchObject({ planCode: 'free', status: 'ACTIVE', provider: 'NONE', cancelAtPeriodEnd: false });
  });

  it('lets an admin void an invoice that will not be paid', async () => {
    const inv = (await api(owner).post('/billing/invoice-requests', { planCode: 'launch', interval: 'MONTH', seats: 2 }).expect(201)).body;
    await op(support).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/void`, { reason: 'Customer changed their mind' }).expect(403);
    await op(admin).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/void`, { reason: 'Customer changed their mind' }).expect(200);
    await op(admin).post(`/tenants/${owner.tenantId}/invoices/${inv.id}/paid`, { reference: 'late' }).expect(409);
    expect((await api(owner).get('/billing').expect(200)).body.offline.openInvoice).toBeNull();
  });
});

describe('addMonths', () => {
  it('keeps the day of the month, clamped to the month end', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2026-10-31T06:00:00Z'), 12).toISOString()).toBe('2027-10-31T06:00:00.000Z');
    expect(addMonths(new Date('2026-12-15T00:00:00Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});
