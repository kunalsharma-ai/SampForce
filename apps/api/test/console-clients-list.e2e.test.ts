import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { startSmtpFixture, type SmtpFixture } from './fixtures/smtp-fixture';
import { appClient, asTenant, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;
type Row = { id: string; name: string; state: string; countryCode: string | null };
type Page = { items: Row[]; total: number; page: number; perPage: number };
type Bulk = { action: string; done: { id: string }[]; skipped: { id: string; reason: string }[]; failed: { id: string; reason: string }[] };

/**
 * The Console clients list (ADR 0074, C4b): filters that combine, sort, pages, CSV export, and bulk actions that change
 * each client the way its own page would, with CONFIRM before taking access away and an audit entry for every client.
 */
describe('Console clients list and bulk actions', () => {
  let app: INestApplication;
  let smtp: SmtpFixture;
  let admin: Agent;
  let support: Agent;
  let alpha: TestUser;
  let bravo: TestUser;
  let charlie: TestUser;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const password = 'operator-password-1';
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    patch: (url: string, body: object) => agent.patch(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });
  const page = async (q: string) => (await op(admin).get(`/clients/page?search=${encodeURIComponent(tag)}&${q}`).expect(200)).body as Page;
  const bulk = (agent: Agent, body: object) => op(agent).post('/clients/bulk', body);
  const profile = (name: string, place: { countryCode: string; regionCode?: string; city?: string }) => ({
    name, legalName: null, website: null, industry: null, regionCode: null, city: null, addressLine1: null, addressLine2: null, postalCode: null,
    contactName: null, contactEmail: null, contactPhone: null, ...place,
  });
  const ids = () => [alpha.tenantId, bravo.tenantId, charlie.tenantId];

  beforeAll(async () => {
    smtp = await startSmtpFixture();
    for (const [k, v] of Object.entries({ SMTP_URL: smtp.url, MAIL_FROM: 'SampForce <no-reply@dealflow.test>', OPERATOR_JWT_SECRET: OP_SECRET })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: `list-admin-${tag}@platform.test`, name: 'Ada List', passwordHash, role: 'ADMIN' },
        { email: `list-sup-${tag}@platform.test`, name: 'Sam List', passwordHash, role: 'SUPPORT' },
      ],
    });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: `list-admin-${tag}@platform.test`, password }).expect(200);
    await op(support).post('/login', { email: `list-sup-${tag}@platform.test`, password }).expect(200);

    alpha = await registerUser(app, `Alpha Mills ${tag}`);
    bravo = await registerUser(app, `Bravo Labs ${tag}`);
    charlie = await registerUser(app, `Charlie Works ${tag}`);
    await op(admin).patch(`/clients/${alpha.tenantId}/profile`, profile(`Alpha Mills ${tag}`, { countryCode: 'IN', regionCode: 'MH', city: 'Pune' })).expect(200);
    await op(admin).patch(`/clients/${bravo.tenantId}/profile`, profile(`Bravo Labs ${tag}`, { countryCode: 'US' })).expect(200);
    await op(admin).post(`/clients/${charlie.tenantId}/state`, { state: 'SUSPENDED', reason: 'Testing the list filters' }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    await smtp.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('filters, sorts and pages the clients', async () => {
    expect((await page('')).total).toBe(3);
    expect((await page('country=in')).items.map((r) => r.id)).toEqual([alpha.tenantId]);
    expect((await page('state=SUSPENDED')).items.map((r) => r.id)).toEqual([charlie.tenantId]);
    expect((await page('state=ACTIVE&country=US')).items.map((r) => r.id)).toEqual([bravo.tenantId]);
    expect((await page('sort=name&dir=asc')).items.map((r) => r.id)).toEqual(ids());
    expect((await page('sort=name&dir=desc')).items.map((r) => r.id)).toEqual([...ids()].reverse());
    expect((await page('sort=country&dir=asc')).items.map((r) => r.countryCode)).toEqual([null, 'IN', 'US']);
    // Empty filter values from the page's form mean "any".
    expect((await page('state=&country=&payment=&createdFrom=')).total).toBe(3);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    expect((await page(`createdFrom=${tomorrow}`)).total).toBe(0);
    expect((await page(`createdFrom=${today}&createdTo=${today}`)).total).toBe(3);
    // A page past the end shows the last one.
    const last = await page('perPage=25&page=9');
    expect(last.page).toBe(1);
    expect(last.items).toHaveLength(3);
    await op(admin).get('/clients/page?perPage=30').expect(400);
    // An administrator's email finds their client.
    const byEmail = (await op(admin).get(`/clients/page?search=${encodeURIComponent(bravo.email)}`).expect(200)).body as Page;
    expect(byEmail.items.map((r) => r.id)).toEqual([bravo.tenantId]);
    // The fixed paths win over clients/:id.
    await op(admin).get('/clients/not-a-uuid').expect(400);
  });

  it('exports what the filters show as CSV', async () => {
    const res = await op(admin).get(`/clients/export?search=${encodeURIComponent(tag)}&sort=name&dir=asc`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = (res.text as string).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('"Customer ID","Client","Status","Country"');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(`Alpha Mills ${tag}`);
    expect(lines[1]).toContain('India');
    const audit = (await op(admin).get('/audit-log?action=clients.exported&limit=5').expect(200)).body as { metadata: { rows: number } }[];
    expect(audit[0]!.metadata.rows).toBe(3);
  });

  it('changes status in bulk, with CONFIRM to take access away and each client audited', async () => {
    // Support may not change a client's status.
    await bulk(support, { action: 'state', ids: ids(), state: 'ACTIVE', reason: 'Bulk activation test' }).expect(403);
    const refused = await bulk(admin, { action: 'state', ids: ids(), state: 'SUSPENDED', reason: 'Bulk suspension test' }).expect(400);
    expect(JSON.stringify(refused.body)).toContain('Type CONFIRM');
    const missing = randomUUID();
    const r = (await bulk(admin, { action: 'state', ids: [...ids(), missing], state: 'SUSPENDED', reason: 'Bulk suspension test', confirm: 'CONFIRM' }).expect(200)).body as Bulk;
    expect(r.done.map((d) => d.id).sort()).toEqual([alpha.tenantId, bravo.tenantId].sort());
    expect(r.skipped).toEqual([expect.objectContaining({ id: charlie.tenantId, reason: 'Already suspended.' })]);
    expect(r.failed).toEqual([expect.objectContaining({ id: missing, reason: 'Client not found.' })]);
    expect((await page('state=SUSPENDED')).total).toBe(3);

    const back = (await bulk(admin, { action: 'state', ids: ids(), state: 'ACTIVE', reason: 'Bulk activation test' }).expect(200)).body as Bulk;
    expect(back.done).toHaveLength(3);
    const perClient = (await op(admin).get(`/audit-log?tenantId=${alpha.tenantId}&action=client.state_changed&limit=5`).expect(200)).body as { after: { state: string } }[];
    expect(perClient.map((e) => e.after.state).slice(0, 2)).toEqual(['ACTIVE', 'SUSPENDED']);
    const run = (await op(admin).get('/audit-log?action=clients.bulk&limit=5').expect(200)).body as { metadata: Record<string, unknown> }[];
    expect(run[0]!.metadata).toMatchObject({ action: 'state', state: 'ACTIVE', requested: 3 });
    expect(run[0]!.metadata).not.toHaveProperty('confirm');
  });

  it('extends subscriptions, sets feature overrides and emails administrators in bulk', async () => {
    const end = new Date('2027-01-31T00:00:00Z');
    await asTenant(alpha.tenantId, (tx) => tx.subscription.update({ where: { tenantId: alpha.tenantId }, data: { currentPeriodEnd: end } }));
    await asTenant(bravo.tenantId, (tx) => tx.subscription.update({ where: { tenantId: bravo.tenantId }, data: { currentPeriodEnd: null } }));
    const ext = (await bulk(admin, { action: 'extend', ids: [alpha.tenantId, bravo.tenantId], days: 14, reason: 'Goodwill after an outage' }).expect(200)).body as Bulk;
    expect(ext.done.map((d) => d.id)).toEqual([alpha.tenantId]);
    expect(ext.skipped).toEqual([expect.objectContaining({ id: bravo.tenantId, reason: 'No renewal date to extend.' })]);
    const sub = await asTenant(alpha.tenantId, (tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: alpha.tenantId } }));
    expect(sub.currentPeriodEnd!.toISOString()).toBe('2027-02-14T00:00:00.000Z');
    const extAudit = (await op(admin).get(`/audit-log?tenantId=${alpha.tenantId}&action=client.subscription_extended&limit=1`).expect(200)).body as { before: object; after: object }[];
    expect(extAudit[0]).toMatchObject({ before: { currentPeriodEnd: '2027-01-31T00:00:00.000Z' }, after: { currentPeriodEnd: '2027-02-14T00:00:00.000Z' } });

    await bulk(support, { action: 'feature', ids: ids(), feature: 'rfqs', enabled: false, reason: 'Pausing RFQs' }).expect(403);
    const off = (await bulk(admin, { action: 'feature', ids: [alpha.tenantId, bravo.tenantId], feature: 'rfqs', enabled: false, reason: 'Pausing RFQs' }).expect(200)).body as Bulk;
    expect(off.done).toHaveLength(2);
    const again = (await bulk(admin, { action: 'feature', ids: [alpha.tenantId, bravo.tenantId], feature: 'rfqs', enabled: false, reason: 'Pausing RFQs' }).expect(200)).body as Bulk;
    expect(again.skipped.map((s) => s.reason)).toEqual(['Already set that way.', 'Already set that way.']);
    const overrides = await asTenant(alpha.tenantId, (tx) => tx.tenantFeatureOverride.findMany({ where: { tenantId: alpha.tenantId, feature: 'rfqs' } }));
    expect(overrides.map((o) => o.enabled)).toEqual([false]);
    const cleared = (await bulk(admin, { action: 'feature', ids: [alpha.tenantId, bravo.tenantId], feature: 'rfqs', enabled: null, reason: 'RFQs back on' }).expect(200)).body as Bulk;
    expect(cleared.done).toHaveLength(2);

    const subject = `Planned maintenance ${tag}`;
    // Support may broadcast to administrators.
    const sent = (await bulk(support, { action: 'notify', ids: ids(), subject, message: 'SampForce will be down for 20 minutes on Sunday at 02:00 UTC.' }).expect(200)).body as Bulk;
    expect(sent.done).toHaveLength(3);
    const mail = smtp.messages.filter((m) => m.subject === subject);
    expect(mail.map((m) => m.to).flat().sort()).toEqual([alpha.email, bravo.email, charlie.email].sort());
    const run = (await op(admin).get('/audit-log?action=clients.bulk&limit=1').expect(200)).body as { metadata: Record<string, unknown> }[];
    expect(run[0]!.metadata).toMatchObject({ action: 'notify', subject, requested: 3 });
    expect(run[0]!.metadata).not.toHaveProperty('message');
  });
});
