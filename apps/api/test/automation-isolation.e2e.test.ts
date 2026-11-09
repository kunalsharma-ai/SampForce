import type { INestApplication } from '@nestjs/common';
import { type DbContext, withDbContext } from '@dealflow/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { api, appClient, asTenant, countCollection, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const TABLES = [
  'domain_events',
  'workflows',
  'workflow_versions',
  'workflow_executions',
  'workflow_steps',
  'approval_requests',
  'notifications',
  'webhooks',
  'webhook_deliveries',
  'integration_connections',
  'email_messages',
  'meetings',
] as const;
const QUEUE_TABLES = ['domain_events', 'workflow_executions', 'webhook_deliveries', 'integration_connections', 'approval_requests'];

/** Workspace isolation (the database guard) for every Phase 3 table, checked through the guarded client. */
describe('automation and communication tenant isolation', () => {
  let app: INestApplication;
  let a: TestUser;
  let b: TestUser;
  const db = appClient();

  beforeAll(async () => {
    app = await startApp();
    a = await registerUser(app, 'Iso A');
    b = await registerUser(app, 'Iso B');
    await asTenant(a.tenantId, (tx) => tx.subscription.update({ where: { tenantId: a.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    // Give tenant A at least one row in every table.
    const h = api(a);
    const wf = (
      await h
        .post('/workflows', {
          name: 'Iso flow',
          definition: { trigger: { event: 'lead.created' }, start: 'g', nodes: [{ id: 'g', type: 'approval', title: 'Check', next: null }] },
        })
        .expect(201)
    ).body;
    await h.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    await h.post('/webhooks', { url: 'http://127.0.0.1:9/never', events: ['lead.created'] }).expect(201);
    await h.post('/leads', { fullName: 'Iso Lead', email: 'iso@x.test' }).expect(201);
    // The relay takes the oldest 100 events across every workspace per tick, and other test files add events in
    // parallel, so tick until this workspace's workflow has started.
    for (let i = 0; i < 30; i++) {
      await app.get(WorkerService).tick();
      if (await asTenant(a.tenantId, (tx) => tx.workflowExecution.count({ where: { tenantId: a.tenantId } }))) break;
    }
    await asTenant(a.tenantId, async (tx) => {
      const owner = await tx.membership.findFirstOrThrow({ where: { tenantId: a.tenantId } });
      const conn = await tx.integrationConnection.create({
        data: { tenantId: a.tenantId, userId: owner.userId, provider: 'GOOGLE', accountEmail: 'a@x.test', scopes: [], credentialsEncrypted: 'v1.x.y.z' },
      });
      await tx.emailMessage.create({
        data: { tenantId: a.tenantId, connectionId: conn.id, providerMessageId: 'iso', direction: 'INBOUND', fromAddress: 'iso@x.test', toAddresses: [], ccAddresses: [], subject: 's', sentAt: new Date() },
      });
      await tx.meeting.create({ data: { tenantId: a.tenantId, connectionId: conn.id, providerEventId: 'iso', title: 'm', startsAt: new Date(), endsAt: new Date(), attendees: [] } });
    });
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const count = (table: string, ctx: DbContext, extra: DbContext = {}) =>
    withDbContext(db, { ...ctx, ...extra }, (tx) => countCollection(tx, table, { tenantId: a.tenantId }));

  it('tenant A has data in every table', async () => {
    const owner = await asTenant(a.tenantId, (tx) => tx.membership.findFirstOrThrow({ where: { tenantId: a.tenantId } }));
    for (const t of TABLES) expect(await count(t, { tenantId: a.tenantId, userId: owner.userId }), t).toBeGreaterThan(0);
  });

  it('another tenant and a missing context see none of it', async () => {
    for (const t of TABLES) {
      expect(await count(t, { tenantId: b.tenantId }), t).toBe(0);
      expect(await count(t, {}), t).toBe(0);
    }
  });

  it('the worker scan flag opens only queue tables, and only for reading due work', async () => {
    const scan: DbContext = { workerScan: true };
    for (const t of TABLES) {
      const n = await count(t, {}, scan);
      if (QUEUE_TABLES.includes(t)) expect(n, t).toBeGreaterThan(0);
      else expect(n, t).toBe(0);
    }
  });

  it('refuses writes into another tenant', async () => {
    await expect(
      withDbContext(db, { tenantId: b.tenantId }, (tx) =>
        tx.webhook.create({ data: { tenantId: a.tenantId, url: 'https://x.test', events: [], secretEncrypted: 'x', createdById: a.tenantId } }),
      ),
    ).rejects.toThrow();
    await expect(
      withDbContext(db, { tenantId: b.tenantId }, (tx) => tx.domainEvent.createMany({ data: [{ tenantId: a.tenantId, type: 'lead.created' }] })),
    ).rejects.toThrow();
  });

  it('keeps notifications personal inside a tenant and the outbox append-only', async () => {
    const rep = await inviteMember(app, a, 'member');
    await asTenant(a.tenantId, (tx) => tx.notification.createMany({ data: [{ tenantId: a.tenantId, userId: rep.userId, type: 't', title: 'For rep only' }] }));
    const owner = await asTenant(a.tenantId, (tx) => tx.membership.findFirstOrThrow({ where: { tenantId: a.tenantId, role: { key: 'owner' } } }));
    const seenByOwner = await withDbContext(db, { tenantId: a.tenantId, userId: owner.userId }, (tx) => tx.notification.count({ where: { title: 'For rep only' } }));
    const seenByRep = await withDbContext(db, { tenantId: a.tenantId, userId: rep.userId }, (tx) => tx.notification.count({ where: { title: 'For rep only' } }));
    expect([seenByOwner, seenByRep]).toEqual([0, 1]);
    await expect(withDbContext(db, { tenantId: a.tenantId }, (tx) => tx.domainEvent.deleteMany({}))).rejects.toThrow(/cannot be deleted/);
  });
});
