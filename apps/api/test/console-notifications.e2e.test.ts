import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { ConsoleNotificationSweep, NOTIFICATION_CURSOR_KEY } from '../src/operator/console-notifications.service';
import { startSmtpFixture, type SmtpFixture } from './fixtures/smtp-fixture';
import { appClient, asTenant, ORIGIN, registerUser, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;
type Row = { id: string; type: string; title: string; body: string | null; link: string | null; client: { id: string; name: string } | null; readAt: string | null };
type Page = { items: Row[]; unread: number; next: string | null };

/**
 * Console notifications (ADR 0074, C3b): the worker's sweep turns platform events into notifications for the
 * operators whose role may act on them, once each, in the Console and by email as each operator chooses.
 */
describe('Console notifications', () => {
  let app: INestApplication;
  let smtp: SmtpFixture;
  let admin: Agent;
  let support: Agent;
  let sweep: ConsoleNotificationSweep;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const adminEmail = `ntf-admin-${tag}@platform.test`;
  const supportEmail = `ntf-sup-${tag}@platform.test`;
  const password = 'operator-password-1';
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });
  const mine = async (agent: Agent, q = '') => (await op(agent).get(`/me/notifications?limit=100${q}`).expect(200)).body as Page;

  beforeAll(async () => {
    smtp = await startSmtpFixture();
    for (const [k, v] of Object.entries({ SMTP_URL: smtp.url, MAIL_FROM: 'SampForce <no-reply@dealflow.test>', PUBLIC_WEB_URL: 'https://app.dealflow.test', OPERATOR_JWT_SECRET: OP_SECRET })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    sweep = app.get(ConsoleNotificationSweep);
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: adminEmail, name: 'Ada Notify', passwordHash, role: 'ADMIN' },
        { email: supportEmail, name: 'Sam Notify', passwordHash, role: 'SUPPORT' },
      ],
    });
    // Start the sweep from now, so notifications from earlier test files are not part of this one.
    await db.platformSetting.upsert({ where: { key: NOTIFICATION_CURSOR_KEY }, create: { key: NOTIFICATION_CURSOR_KEY, value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    await smtp.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('starts from now on a new deployment instead of sending out history', async () => {
    const db = appClient();
    try {
      const before = await db.platformSetting.findUniqueOrThrow({ where: { key: NOTIFICATION_CURSOR_KEY } });
      await db.platformSetting.delete({ where: { key: NOTIFICATION_CURSOR_KEY } });
      expect(await sweep.sweep()).toBe(0);
      expect(await db.platformSetting.findUnique({ where: { key: NOTIFICATION_CURSOR_KEY } })).not.toBeNull();
      await db.platformSetting.update({ where: { key: NOTIFICATION_CURSOR_KEY }, data: { value: before.value } });
    } finally {
      await db.$disconnect();
    }
  });

  it('tells each operator about what their role may act on, once', async () => {
    const org = `Notify Lattice ${tag}`;
    const owner = await registerUser(app, org, { plan: 'growth' });
    // A failed payment: the subscription goes past due.
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { status: 'PAST_DUE', pastDueSince: new Date() } }));
    await sweep.sweep();

    const a = await mine(admin);
    const joined = a.items.find((n) => n.type === 'client.created' && n.client?.id === owner.tenantId)!;
    expect(joined).toMatchObject({ title: `New client: ${org}`, link: `/operator/clients/${owner.tenantId}`, readAt: null });
    expect(a.items.find((n) => n.type === 'payment.failed' && n.client?.id === owner.tenantId)).toMatchObject({ title: `Payment failed: ${org}` });

    // Support Admins see new clients, never billing.
    const s = await mine(support);
    expect(s.items.some((n) => n.type === 'client.created' && n.client?.id === owner.tenantId)).toBe(true);
    expect(s.items.some((n) => n.type === 'payment.failed')).toBe(false);

    // Payment failures go by email by default; new clients do not.
    const mail = smtp.messages.filter((m) => m.to.includes(adminEmail));
    expect(mail.some((m) => m.subject === `SampForce Console: Payment failed: ${org}` && m.text.includes(`https://app.dealflow.test/operator/clients/${owner.tenantId}`))).toBe(true);
    expect(mail.some((m) => m.subject.includes('New client'))).toBe(false);

    // A second look at the same events sends nothing new. Other test files add clients at the same time, so count
    // only this client's notifications and mail.
    const about = async () => (await mine(admin)).items.filter((n) => n.client?.id === owner.tenantId).length;
    const mailed = () => smtp.messages.filter((m) => m.subject.includes(org)).length;
    const count = await about();
    const sent = mailed();
    const db2 = appClient();
    try {
      await db2.platformSetting.update({ where: { key: NOTIFICATION_CURSOR_KEY }, data: { value: new Date(Date.now() - 60_000).toISOString() } });
    } finally {
      await db2.$disconnect();
    }
    await sweep.sweep();
    expect(await about()).toBe(count);
    expect(mailed()).toBe(sent);
  });

  it('marks notifications read, one or all, and counts what is unread', async () => {
    const page = await mine(admin, '&unread=true');
    expect(page.unread).toBeGreaterThanOrEqual(2);
    expect((await op(admin).get('/me/notifications/unread').expect(200)).body.unread).toBe(page.unread);
    const first = page.items[0]!;
    expect((await op(admin).post(`/me/notifications/${first.id}/read`).expect(200)).body.unread).toBe(page.unread - 1);
    // Someone else's notification is not found.
    await op(support).post(`/me/notifications/${first.id}/read`).expect(404);
    await op(admin).post('/me/notifications/read-all').expect(200);
    expect((await mine(admin, '&unread=true')).items).toEqual([]);
    expect((await mine(admin)).items.every((n) => n.readAt)).toBe(true);
  });

  it('lets each operator choose the Console, email, both or neither for the types their role receives', async () => {
    const prefs = (await op(support).get('/me/notification-preferences').expect(200)).body as { type: string; inApp: boolean; email: boolean }[];
    expect(prefs.map((p) => p.type)).toContain('client.created');
    expect(prefs.map((p) => p.type)).toContain('ticket.new');
    expect(prefs.map((p) => p.type)).not.toContain('payment.failed');
    const set = (await op(support).put('/me/notification-preferences', { prefs: [{ type: 'client.created', inApp: false, email: false }, { type: 'payment.failed', inApp: true, email: true }] }).expect(200)).body as { type: string; inApp: boolean }[];
    expect(set.find((p) => p.type === 'client.created')).toMatchObject({ inApp: false });
    expect(set.some((p) => p.type === 'payment.failed')).toBe(false);
    await op(support).put('/me/notification-preferences', { prefs: [{ type: 'nope', inApp: true, email: true }] }).expect(400);

    // The admin chooses email only for new clients.
    await op(admin).put('/me/notification-preferences', { prefs: [{ type: 'client.created', inApp: false, email: true }] }).expect(200);
    const org = `Quiet Lattice ${tag}`;
    const owner = await registerUser(app, org, { plan: 'growth' });
    await sweep.sweep();
    expect((await mine(support)).items.some((n) => n.client?.id === owner.tenantId)).toBe(false);
    expect((await mine(admin)).items.some((n) => n.client?.id === owner.tenantId)).toBe(false);
    expect(smtp.messages.some((m) => m.to.includes(adminEmail) && m.subject === `SampForce Console: New client: ${org}`)).toBe(true);
  });

  it('sends due reminders once: subscriptions ending and invoices overdue', async () => {
    const org = `Due Lattice ${tag}`;
    const owner = await registerUser(app, org, { plan: 'growth' });
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { status: 'ACTIVE', autoRenew: false, currentPeriodEnd: new Date(Date.now() + 2 * 86_400_000 + 3_600_000) } }));
    await asTenant(owner.tenantId, (tx) =>
      tx.invoice.create({ data: { tenantId: owner.tenantId, provider: 'OFFLINE', providerInvoiceId: `due-${tag}`, number: `SF-DUE-${tag}`, status: 'OPEN', currency: 'USD', subtotalCents: 50_000, totalCents: 50_000, issuedAt: new Date(Date.now() - 20 * 86_400_000) } }),
    );
    await sweep.sweep();
    const ending = (await mine(admin)).items.find((n) => n.type === 'subscription.expiring' && n.client?.id === owner.tenantId)!;
    expect(ending.title).toBe(`${org}: subscription ends in 2 days`);
    expect((await mine(admin)).items.find((n) => n.type === 'payment.overdue' && n.client?.id === owner.tenantId)).toMatchObject({ title: `Invoice overdue: ${org}`, body: `Invoice SF-DUE-${tag} is still open 14 days after it was issued.` });
    // Again on the next pass: nothing new.
    await sweep.sweep();
    expect((await mine(admin)).items.filter((n) => n.client?.id === owner.tenantId)).toHaveLength(2); // ending and overdue; new clients are email-only for this operator now
  });
});
