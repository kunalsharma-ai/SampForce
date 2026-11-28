import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ConsoleClientCreated, ConsoleClientDetail, ConsoleClientExtract } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { type LogoFixture, startLogoFixture } from './fixtures/logo-fixture';
import { appClient, ORIGIN, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

/**
 * Create Client with company extraction (control-center K2): the Console looks a company up with the same auto-fill
 * engine and logo finder as Create Company, stores nothing until the operator approves, and keeps the approved details
 * with their sources on the new client.
 */
describe('Console Create Client with company details', () => {
  let app: INestApplication;
  let fixture: LogoFixture;
  let admin: Agent;
  let support: Agent;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const password = 'operator-password-1';
  const op = (a: Agent) => ({
    post: (url: string, body: object) => a.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    get: (url: string) => a.get(`/api/v1/operator${url}`),
  });
  const signIn = async (email: string) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    saved.OPERATOR_JWT_SECRET = process.env.OPERATOR_JWT_SECRET;
    saved.LOGO_FIXTURE_URL = process.env.LOGO_FIXTURE_URL;
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    fixture = await startLogoFixture();
    process.env.LOGO_FIXTURE_URL = fixture.url;
    app = await startApp();
    const db = appClient();
    const hash = await new PasswordService().hash(password);
    await db.platformOperator.create({ data: { email: `create-admin-${tag}@platform.test`, name: 'Cara Create', passwordHash: hash, role: 'ADMIN' } });
    await db.platformOperator.create({ data: { email: `create-support-${tag}@platform.test`, name: 'Sid Support', passwordHash: hash, role: 'SUPPORT' } });
    await db.$disconnect();
    admin = await signIn(`create-admin-${tag}@platform.test`);
    support = await signIn(`create-support-${tag}@platform.test`);
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('finds company details from the website without storing anything, and only for operators who create clients', async () => {
    await op(support).post('/clients/extract', { name: 'Northwind Insights', website: 'northwind-insights.example' }).expect(403);
    await op(admin).post('/clients/extract', { name: 'N', website: '' }).expect(400);

    const db = appClient();
    try {
      const before = await db.tenant.count();
      const res = (await op(admin).post('/clients/extract', { name: 'Northwind Insights', website: 'https://northwind-insights.example', email: 'info@northwind-insights.example' }).expect(200)).body as ConsoleClientExtract;
      const byField = Object.fromEntries(res.found.map((f) => [f.field, f.value]));
      // The same values Create Company's "Find details" returns for this site (company-autofill.e2e.test.ts).
      expect(byField).toMatchObject({ foundedYear: 2009, city: 'Pune', country: 'IN', primaryEmail: 'info@northwind-insights.example', industry: 'Market research' });
      expect(res.found.find((f) => f.field === 'foundedYear')).toMatchObject({ source: 'WEBSITE', url: 'https://www.northwind-insights.example/about-us' });
      expect(res.domain).toBe('northwind-insights.example');
      expect(await db.tenant.count()).toBe(before);
      const entry = await db.platformAuditLog.findFirst({ where: { action: 'client.details_looked_up', targetLabel: 'Northwind Insights' }, orderBy: { createdAt: 'desc' } });
      expect(entry?.metadata).toMatchObject({ domain: 'northwind-insights.example' });

      // A website with a usable logo returns it for the review screen.
      const logo = (await op(admin).post('/clients/extract', { name: 'Brightwave', website: 'brightwave.example' }).expect(200)).body as ConsoleClientExtract;
      expect(logo.logo?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(logo.logo?.width).toBe(180);

      // An unreachable site says so instead of inventing anything.
      const none = (await op(admin).post('/clients/extract', { name: 'Nowhere Ltd', website: 'nowhere-at-all.example' }).expect(200)).body as ConsoleClientExtract;
      expect(none.found).toEqual([]);
      expect(none.logo).toBeNull();
      expect(none.error).toBeTruthy();
    } finally {
      await db.$disconnect();
    }
  });

  it('creates the client with the approved details, their sources, the company email and a customer ID', async () => {
    const created = (
      await op(admin)
        .post('/clients', {
          organisation: { name: `Northwind Insights ${tag}` },
          administrator: { name: 'Priya Nair', email: `priya-${tag}@client.test` },
          planCode: 'growth', seats: 12, paymentStatus: 'PENDING', superCanCreateExecutives: true,
          companyEmail: 'Info@Northwind-Insights.example',
          profile: { website: 'northwind-insights.example', industry: 'Market research', countryCode: 'in', city: 'Pune', contactName: 'Priya Nair', contactEmail: 'priya@northwind-insights.example', contactPhone: '+91 20 5555 0100' },
          details: {
            values: { foundedYear: '2009', industry: 'Market research', services: ['Online surveys', 'Panel management'], overview: 'Fieldwork and panels across India.' },
            sources: { foundedYear: { source: 'WEBSITE', url: 'https://www.northwind-insights.example/about-us' }, industry: { source: 'WEBSITE', url: 'https://northwind-insights.example/' }, services: { source: 'USER', url: null }, overview: { source: 'USER', url: null } },
          },
          reason: 'Signed order form',
        })
        .expect(201)
    ).body as ConsoleClientCreated;
    const c = created.client;
    expect(c.customerId).toMatch(/^SF-\d{6}$/);
    expect(c.profile).toMatchObject({ website: 'https://northwind-insights.example', industry: 'Market research', countryCode: 'IN', city: 'Pune', companyEmail: 'info@northwind-insights.example', contactPhone: '+91 20 5555 0100' });
    expect(c.profile.details?.values.services).toEqual(['Online surveys', 'Panel management']);
    expect(c.profile.details?.sources.foundedYear).toEqual({ source: 'WEBSITE', url: 'https://www.northwind-insights.example/about-us' });

    const again = (await op(admin).get(`/clients/${c.id}`).expect(200)).body as ConsoleClientDetail;
    expect(again.customerId).toBe(c.customerId);
    expect(again.profile.details?.values.foundedYear).toBe('2009');
    const db = appClient();
    try {
      const entry = await db.platformAuditLog.findFirst({ where: { action: 'client.created', targetTenantId: c.id } });
      expect(JSON.stringify(entry?.metadata)).toContain('Company details approved: 4 fields (2 found automatically)');
    } finally {
      await db.$disconnect();
    }
  });

  it('keeps the short form working: no details, nothing invented', async () => {
    const created = (
      await op(admin)
        .post('/clients', { organisation: { name: `Plain Client ${tag}` }, administrator: { name: 'Pat Plain', email: `pat-${tag}@client.test` }, planCode: 'growth', seats: 3, reason: 'New client' })
        .expect(201)
    ).body as ConsoleClientCreated;
    expect(created.client.profile).toMatchObject({ website: null, companyEmail: null, details: null });
  });

  it('refuses details with unknown fields or sources', async () => {
    await op(admin)
      .post('/clients', {
        organisation: { name: `Bad Details ${tag}` }, administrator: { name: 'Bo Bad', email: `bo-${tag}@client.test` }, planCode: 'growth', seats: 1,
        details: { values: { favouriteColour: 'blue' }, sources: {} },
      })
      .expect(400);
    await op(admin)
      .post('/clients', {
        organisation: { name: `Bad Source ${tag}` }, administrator: { name: 'Bo Bad', email: `bo2-${tag}@client.test` }, planCode: 'growth', seats: 1,
        details: { values: { industry: 'x' }, sources: { industry: { source: 'GUESS', url: null } } },
      })
      .expect(400);
  });
});
