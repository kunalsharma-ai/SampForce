import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { type ConsoleClientCreated, type ConsoleClientDetail, type ConsoleSubscriptionEvent, subscriptionStateOf } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { planMoveKind } from '../src/operator/subscription-events';
import { appClient, ORIGIN, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

describe('subscription states (pure)', () => {
  const base = { tenantStatus: 'ACTIVE', status: 'ACTIVE' as const, paymentStatus: 'PAID', trialEndsAt: null, currentPeriodEnd: '2030-01-01', autoRenew: true, cancelAtPeriodEnd: false };
  const now = new Date('2027-01-01T00:00:00Z');
  it('gives the Console word for each stored combination, first rule winning', () => {
    expect(subscriptionStateOf(base, now)).toBe('ACTIVE');
    expect(subscriptionStateOf({ ...base, paymentStatus: 'PENDING' }, now)).toBe('PENDING');
    expect(subscriptionStateOf({ ...base, paymentStatus: 'OVERDUE' }, now)).toBe('PAYMENT_FAILED');
    expect(subscriptionStateOf({ ...base, status: 'PAST_DUE' }, now)).toBe('PAYMENT_FAILED');
    expect(subscriptionStateOf({ ...base, status: 'UNPAID' }, now)).toBe('PAYMENT_FAILED');
    expect(subscriptionStateOf({ ...base, status: 'TRIALING', trialEndsAt: '2027-01-10' }, now)).toBe('TRIAL');
    expect(subscriptionStateOf({ ...base, status: 'TRIALING', trialEndsAt: '2026-12-10' }, now)).toBe('EXPIRED');
    expect(subscriptionStateOf({ ...base, currentPeriodEnd: '2026-12-01', autoRenew: false }, now)).toBe('EXPIRED');
    expect(subscriptionStateOf({ ...base, currentPeriodEnd: '2026-12-01', autoRenew: true }, now)).toBe('ACTIVE');
    expect(subscriptionStateOf({ ...base, tenantStatus: 'SUSPENDED' }, now)).toBe('SUSPENDED');
    expect(subscriptionStateOf({ ...base, tenantStatus: 'SUSPENDED', status: 'CANCELED' }, now)).toBe('CANCELLED');
    expect(subscriptionStateOf({ ...base, status: 'CANCELED', paymentStatus: 'OVERDUE' }, now)).toBe('CANCELLED');
  });
  it('tells upgrades from downgrades by the monthly price; a per-client price is the top plan', () => {
    expect(planMoveKind({ priceCents: 1500, yearly: false }, { priceCents: 2900, yearly: false })).toBe('UPGRADED');
    expect(planMoveKind({ priceCents: 2900, yearly: false }, { priceCents: 12000, yearly: true })).toBe('DOWNGRADED');
    expect(planMoveKind({ priceCents: 4900, yearly: false }, { priceCents: null, yearly: false })).toBe('UPGRADED');
    expect(planMoveKind({ priceCents: 1500, yearly: false }, { priceCents: 1500, yearly: false })).toBe('PLAN_CHANGED');
  });
});

/**
 * A client's subscription over its life (control center K3): every Console change shows the derived state and leaves
 * one event in the subscription history, with who, why and the before and after.
 */
describe('Console subscription lifecycle', () => {
  let app: INestApplication;
  let admin: Agent;
  let support: Agent;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const password = 'operator-password-1';
  const adminEmail = `sub-admin-${tag}@platform.test`;
  const op = (a: Agent) => ({
    post: (url: string, body: object) => a.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => a.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    get: (url: string) => a.get(`/api/v1/operator${url}`),
  });
  const signIn = async (email: string) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password }).expect(200);
    return a;
  };
  const events = async (id: string) => (await op(admin).get(`/clients/${id}/subscription/events`).expect(200)).body as ConsoleSubscriptionEvent[];

  beforeAll(async () => {
    saved.OPERATOR_JWT_SECRET = process.env.OPERATOR_JWT_SECRET;
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const hash = await new PasswordService().hash(password);
    await db.platformOperator.create({ data: { email: adminEmail, name: 'Sam Sub', passwordHash: hash, role: 'ADMIN' } });
    await db.platformOperator.create({ data: { email: `sub-support-${tag}@platform.test`, name: 'Sid Support', passwordHash: hash, role: 'SUPPORT' } });
    await db.$disconnect();
    admin = await signIn(adminEmail);
    support = await signIn(`sub-support-${tag}@platform.test`);
  });
  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('records the start, upgrades, downgrades, payment, trial, cancellation and reactivation, each with its state', async () => {
    const created = (
      await op(admin)
        .post('/clients', { organisation: { name: `Lifecycle ${tag}` }, administrator: { name: 'Lee Life', email: `lee-${tag}@client.test` }, planCode: 'growth', seats: 5, paymentStatus: 'PENDING', reason: 'New client' })
        .expect(201)
    ).body as ConsoleClientCreated;
    const id = created.client.id;
    expect(created.client.subscription).toMatchObject({ state: 'PENDING', trialEndsAt: null, cancelAtPeriodEnd: false });
    let ev = await events(id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'CREATED', toPlan: 'SampForce Growth', by: adminEmail, reason: 'New client' });

    // Paid: PENDING → ACTIVE, a payment event.
    let c = (await op(admin).put(`/clients/${id}/subscription`, { paymentStatus: 'PAID', reason: 'Bank transfer received' }).expect(200)).body as ConsoleClientDetail;
    expect(c.subscription?.state).toBe('ACTIVE');
    expect((await events(id))[0]).toMatchObject({ kind: 'PAYMENT_CHANGED', fromState: 'PENDING', toState: 'ACTIVE', changes: ['Payment: PENDING → PAID'] });

    // Upgrade, then downgrade, told apart by price.
    await op(admin).put(`/clients/${id}/subscription`, { planCode: 'professional', reason: 'Needs forecasting' }).expect(200);
    expect((await events(id))[0]).toMatchObject({ kind: 'UPGRADED', fromPlan: 'SampForce Growth', toPlan: 'SampForce Professional', fromState: null, toState: null });
    await op(admin).put(`/clients/${id}/subscription`, { planCode: 'launch', reason: 'Budget cut' }).expect(200);
    expect((await events(id))[0]).toMatchObject({ kind: 'DOWNGRADED', fromPlan: 'SampForce Professional', toPlan: 'SampForce Launch' });
    // Seats alone are a change of terms.
    await op(admin).put(`/clients/${id}/subscription`, { seats: 9, reason: 'More people' }).expect(200);
    expect((await events(id))[0]).toMatchObject({ kind: 'TERMS_CHANGED', changes: ['Seats: 5 → 9'] });

    // Trial of a bigger plan, then extended.
    c = (await op(admin).post(`/clients/${id}/subscription/trial`, { days: 14, planCode: 'business', reason: 'Evaluating Business' }).expect(200)).body as ConsoleClientDetail;
    expect(c.subscription).toMatchObject({ state: 'TRIAL', planCode: 'business' });
    expect((await events(id))[0]).toMatchObject({ kind: 'TRIAL_STARTED', fromPlan: 'SampForce Launch', toPlan: 'SampForce Business', fromState: 'ACTIVE', toState: 'TRIAL' });
    const firstEnd = new Date(c.subscription!.trialEndsAt!).getTime();
    c = (await op(admin).post(`/clients/${id}/subscription/trial`, { days: 7, reason: 'Needs another week' }).expect(200)).body as ConsoleClientDetail;
    expect(new Date(c.subscription!.trialEndsAt!).getTime() - firstEnd).toBe(7 * 86_400_000);
    expect((await events(id))[0]).toMatchObject({ kind: 'TRIAL_EXTENDED' });
    await op(admin).post(`/clients/${id}/subscription/trial`, { days: 7, planCode: 'growth', reason: 'Wrong plan' }).expect(400);

    // A renewal ends the trial; then cancel at the end of the term.
    await op(admin).post(`/clients/${id}/renew`, { months: 12, reason: 'Signed for a year' }).expect(200);
    expect((await events(id))[0]).toMatchObject({ kind: 'RENEWED', fromState: 'TRIAL', toState: 'ACTIVE' });
    // Renewing a trial starts the paid term today, not after the earlier term.
    const renewed = ((await op(admin).get(`/clients/${id}`).expect(200)).body as ConsoleClientDetail).subscription!;
    expect(renewed.startedOn).toBe(new Date().toISOString().slice(0, 10));
    c = (await op(admin).post(`/clients/${id}/subscription/cancel`, { when: 'PERIOD_END', reason: 'Moving to a competitor' }).expect(200)).body as ConsoleClientDetail;
    expect(c.subscription).toMatchObject({ state: 'ACTIVE', cancelAtPeriodEnd: true, autoRenew: false });
    expect((await events(id))[0]).toMatchObject({ kind: 'CANCEL_SCHEDULED' });

    // Cancel now, then reactivate: a new term from today.
    c = (await op(admin).post(`/clients/${id}/subscription/reactivate`, { reason: 'Will stay after all' }).expect(200)).body as ConsoleClientDetail;
    expect(c.subscription).toMatchObject({ cancelAtPeriodEnd: false, autoRenew: true });
    expect((await events(id))[0]).toMatchObject({ kind: 'REACTIVATED', changes: ['No longer cancels at the end of the term', 'Renews by itself: no → yes'] });
    c = (await op(admin).post(`/clients/${id}/subscription/cancel`, { when: 'NOW', reason: 'Asked to stop today' }).expect(200)).body as ConsoleClientDetail;
    expect(c.subscription?.state).toBe('CANCELLED');
    expect((await events(id))[0]).toMatchObject({ kind: 'CANCELLED', fromState: 'ACTIVE', toState: 'CANCELLED' });
    await op(admin).post(`/clients/${id}/subscription/cancel`, { when: 'NOW', reason: 'Again please' }).expect(400);
    c = (await op(admin).post(`/clients/${id}/subscription/reactivate`, { months: 3, reason: 'Came back' }).expect(200)).body as ConsoleClientDetail;
    expect(c.subscription).toMatchObject({ state: 'ACTIVE', cancelAtPeriodEnd: false, durationMonths: 3, startedOn: new Date().toISOString().slice(0, 10) });
    expect((await events(id))[0]).toMatchObject({ kind: 'REACTIVATED', fromState: 'CANCELLED', toState: 'ACTIVE' });
    await op(admin).post(`/clients/${id}/subscription/reactivate`, { reason: 'Not needed' }).expect(400);

    // Suspending and restoring the client shows in the history too.
    await op(admin).post(`/clients/${id}/state`, { state: 'SUSPENDED', reason: 'Unpaid invoice' }).expect(200);
    ev = await events(id);
    expect(ev[0]).toMatchObject({ kind: 'SUSPENDED', fromState: 'ACTIVE', toState: 'SUSPENDED' });
    await op(admin).post(`/clients/${id}/state`, { state: 'ACTIVE', reason: 'Invoice paid' }).expect(200);
    expect((await events(id))[0]).toMatchObject({ kind: 'RESUMED', fromState: 'SUSPENDED', toState: 'ACTIVE' });

    // Each Console change is in the platform log with its before and after.
    const db = appClient();
    try {
      const logged = await db.platformAuditLog.findFirst({ where: { action: 'client.subscription_cancelled', targetTenantId: id }, orderBy: { createdAt: 'desc' } });
      expect(logged?.metadata).toMatchObject({ reason: 'Asked to stop today' });
      expect(logged?.after).toMatchObject({ status: 'CANCELED' });
    } finally {
      await db.$disconnect();
    }
  });

  it('lets only operators who manage subscriptions change them, and any client viewer read the history', async () => {
    const created = (
      await op(admin).post('/clients', { organisation: { name: `Guarded ${tag}` }, administrator: { name: 'Gus Guard', email: `gus-${tag}@client.test` }, planCode: 'growth', seats: 2, reason: 'New client' }).expect(201)
    ).body as ConsoleClientCreated;
    const id = created.client.id;
    await op(support).post(`/clients/${id}/subscription/cancel`, { when: 'NOW', reason: 'Not allowed' }).expect(403);
    await op(support).post(`/clients/${id}/subscription/trial`, { days: 5, reason: 'Not allowed' }).expect(403);
    await op(support).post(`/clients/${id}/subscription/reactivate`, { reason: 'Not allowed' }).expect(403);
    const ev = (await op(support).get(`/clients/${id}/subscription/events`).expect(200)).body as ConsoleSubscriptionEvent[];
    expect(ev.map((e) => e.kind)).toEqual(['CREATED']);
    await op(admin).post(`/clients/${id}/subscription/trial`, { days: 0, reason: 'Zero days' }).expect(400);
    await op(admin).post(`/clients/${id}/subscription/cancel`, { when: 'SOMETIME', reason: 'Bad value' }).expect(400);
    await op(admin).get(`/clients/${randomUUID()}/subscription/events`).expect(404);
  });
});
