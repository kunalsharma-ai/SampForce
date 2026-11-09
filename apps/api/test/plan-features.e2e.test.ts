import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAN_CODES, PLAN_ENTITLEMENTS } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, asTenant, ORIGIN, ownerClient, registerUser, setPlan, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/**
 * Plan features (ADR 0057): what a workspace can use follows its plan; platform operators decide what each plan
 * includes and can grant or withhold a feature for one workspace. The API refuses everything outside the plan.
 */
describe('plan features', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  let free: TestUser;
  let launch: TestUser;
  const adminEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;
  const supportEmail = `sup-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });
  const freeLimits = { maxUsers: 2, maxPipelines: 1, monthlyAiCredits: 50, automationRunsPerMonth: 500 };

  /** Plans are shared reference data, so every change made here is put back for the suites that follow. */
  async function restorePlans() {
    const db = ownerClient();
    try {
      for (const code of PLAN_CODES) await db.plan.update({ where: { code }, data: { entitlements: PLAN_ENTITLEMENTS[code] as object } });
    } finally {
      await db.$disconnect();
    }
  }

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
    free = await registerUser(app, 'Free Features Ltd', { plan: 'free' });
    launch = await registerUser(app, 'Launch Features Ltd', { plan: 'launch' });
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
  });
  afterAll(async () => {
    await restorePlans();
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('a new workspace has Free’s features: core CRM works, features from higher plans are refused', async () => {
    const me = (await api(free).get('/auth/me').expect(200)).body;
    expect(me.tenant.features).toEqual(PLAN_ENTITLEMENTS.free.features);
    await api(free).post('/leads', { fullName: 'Core Lead' }).expect(201);
    await api(free).get('/workflows').expect(200);
    const refused = await api(free).get('/sequences').expect(403);
    expect(refused.body.error).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', message: 'Email sequences is not included in your plan. A workspace admin can upgrade on the Billing page.' });
    expect(refused.body.error.details).toEqual([{ path: 'feature', message: 'sequences' }]);
    for (const url of ['/quotes', '/contracts', '/forecast', '/analytics/targets', '/success/customers', '/visitors/settings', '/gamification/settings', '/webhooks', '/api-keys', '/deal-health', '/portal/settings']) {
      expect((await api(free).get(url)).body.error?.code, url).toBe('FEATURE_NOT_IN_PLAN');
    }
    const billing = (await api(free).get('/billing').expect(200)).body;
    expect(billing.features).toEqual(PLAN_ENTITLEMENTS.free.features);
    expect(billing.catalog.find((p: { code: string }) => p.code === 'growth').entitlements.features).toContain('forecasting');
  });

  it('says so in the reader’s language', async () => {
    const res = await free.agent.get('/api/v1/sequences').set('accept-language', 'es').expect(403);
    expect(res.body.error.message).toBe('Secuencias de correo no está incluido en tu plan. Un administrador del espacio de trabajo puede cambiar de plan en la página Facturación.');
  });

  it('a paid plan includes more, and a workspace apps route follows the app’s feature', async () => {
    await api(launch).get('/sequences').expect(200);
    await api(launch).get('/email-templates').expect(200);
    expect((await api(launch).get('/forecast')).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await api(launch).get('/apps/slack/channels')).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    // Listing apps and disconnecting one always work.
    await api(launch).get('/apps').expect(200);
    expect((await api(launch).del('/apps/slack')).body?.error?.code).not.toBe('FEATURE_NOT_IN_PLAN');
  });

  it('an unpaid or canceled paid plan falls back to Free’s features, and paying brings them back', async () => {
    await asTenant(launch.tenantId, (tx) => tx.subscription.update({ where: { tenantId: launch.tenantId }, data: { status: 'UNPAID' } }));
    expect((await api(launch).get('/sequences')).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await api(launch).get('/auth/me').expect(200)).body.tenant).toMatchObject({ plan: 'launch', appliedPlan: 'free' });
    await setPlan(launch.tenantId, 'launch');
    await api(launch).get('/sequences').expect(200);
  });

  it('operators see every plan’s features; only admins change them, and the change applies at once', async () => {
    const plans = (await op(support).get('/plans').expect(200)).body as { code: string; features: string[]; limits: object; changedFromDefault: string[]; workspaces: number }[];
    expect(plans.map((p) => p.code)).toEqual([...PLAN_CODES]);
    expect(plans.find((p) => p.code === 'free')).toMatchObject({ features: PLAN_ENTITLEMENTS.free.features, limits: freeLimits, changedFromDefault: [] });
    expect(plans.find((p) => p.code === 'free')!.workspaces).toBeGreaterThanOrEqual(1);

    const change = { features: [...PLAN_ENTITLEMENTS.free.features, 'sequences', 'email_templates'], limits: { ...freeLimits, maxPipelines: 2 }, reason: 'Pilot: sequences on Free' };
    await op(support).put('/plans/free', change).expect(403);
    await op(admin).put('/plans/free', { ...change, features: ['not_a_feature'] }).expect(400);
    await op(admin).put('/plans/free', { ...change, reason: 'x' }).expect(400);
    const after = (await op(admin).put('/plans/free', change).expect(200)).body as typeof plans;
    expect(after.find((p) => p.code === 'free')!.changedFromDefault).toEqual(['email_templates', 'sequences']);

    await api(free).get('/sequences').expect(200);
    expect((await api(free).get('/auth/me').expect(200)).body.tenant.features).toContain('sequences');
    // Limits change with it: Free now allows a second pipeline.
    await api(free).post('/pipelines', { name: 'Second pipeline', stages: [{ name: 'New', probability: 10 }, { name: 'Won', probability: 100, category: 'WON' }, { name: 'Lost', probability: 0, category: 'LOST' }] }).expect(201);
    // The public pricing page shows the live plans.
    const pricing = (await request(app.getHttpServer()).get('/api/v1/public/pricing').expect(200)).body;
    expect(pricing.plans.find((p: { code: string }) => p.code === 'free').entitlements.features).toContain('sequences');

    const log = (await op(admin).get('/audit-log').expect(200)).body as { action: string; metadata: Record<string, unknown> }[];
    expect(log.find((l) => l.action === 'plan.definition_changed')?.metadata).toMatchObject({ plan: 'free', reason: 'Pilot: sequences on Free', added: ['email_templates', 'sequences'], removed: [] });

    // Taking a feature out of a plan refuses it again; nothing the workspace made is deleted.
    await op(admin).put('/plans/free', { features: PLAN_ENTITLEMENTS.free.features, limits: freeLimits, reason: 'Pilot over' }).expect(200);
    expect((await api(free).get('/sequences')).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await api(free).get('/pipelines').expect(200)).body).toHaveLength(2);
    await api(free).post('/pipelines', { name: 'Third', stages: [{ name: 'New', probability: 10 }, { name: 'Won', probability: 100, category: 'WON' }, { name: 'Lost', probability: 0, category: 'LOST' }] }).expect(403);
  });

  it('operators grant or withhold a feature for one workspace, recorded in both audit logs', async () => {
    await op(support).post(`/tenants/${free.tenantId}/features`, { overrides: { forecasting: true }, reason: 'Sales-led pilot' }).expect(403);
    await op(admin).post(`/tenants/${free.tenantId}/features`, { overrides: {}, reason: 'Nothing at all' }).expect(400);
    const detail = (await op(admin).post(`/tenants/${free.tenantId}/features`, { overrides: { forecasting: true, ai_assistant: false }, reason: 'Sales-led pilot' }).expect(200)).body;
    expect(detail.features).toMatchObject({ appliedPlan: 'free', planFeatures: PLAN_ENTITLEMENTS.free.features });
    expect(detail.features.effective).toContain('forecasting');
    expect(detail.features.effective).not.toContain('ai_assistant');
    expect(detail.features.overrides).toEqual([
      expect.objectContaining({ feature: 'ai_assistant', enabled: false, reason: 'Sales-led pilot', updatedBy: adminEmail }),
      expect.objectContaining({ feature: 'forecasting', enabled: true }),
    ]);

    await api(free).get('/forecast/settings').expect(200);
    const ai = await api(free).post('/ai/copilot', { question: 'How is my pipeline?' }).expect(403);
    expect(ai.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    // Other workspaces are not affected.
    expect((await api(launch).get('/forecast')).body.error.code).toBe('FEATURE_NOT_IN_PLAN');

    const audit = (await api(free).get('/audit-logs').expect(200)).body as { items: { action: string; actorType: string; metadata: Record<string, unknown> }[] };
    expect(audit.items.find((a) => a.action === 'billing.features_overridden')).toMatchObject({ actorType: 'PLATFORM_ADMIN', metadata: { operator: adminEmail, reason: 'Sales-led pilot' } });

    // An override wins over the plan, both ways, until it is removed.
    await op(admin).post(`/tenants/${free.tenantId}/features`, { overrides: { forecasting: null, ai_assistant: null }, reason: 'Pilot finished' }).expect(200);
    expect((await api(free).get('/forecast/settings')).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await api(free).get('/auth/me').expect(200)).body.tenant.features).toEqual(PLAN_ENTITLEMENTS.free.features);
  });

  it('public pages and API keys stop working outside the plan', async () => {
    const owner = await registerUser(app, 'Public Pages Ltd', { plan: 'growth' });
    const form = (await api(owner).post('/forms', { name: 'Contact', title: 'Contact us', fields: [{ key: 'fullName', label: 'Name', required: true }, { key: 'email', label: 'Email', required: true }], consentText: 'You may contact me about my enquiry.' }).expect(201)).body;
    const token = form.publicToken as string;
    await request(app.getHttpServer()).get(`/api/v1/public/forms/${token}`).expect(200);
    const key = (await api(owner).post('/api-keys', { name: 'Zapier', scopes: ['leads:read'] }).expect(201)).body.key as string;
    await request(app.getHttpServer()).get('/api/v1/zapier/me').set('authorization', `Bearer ${key}`).expect(200);

    await setPlan(owner.tenantId, 'free');
    await request(app.getHttpServer()).get(`/api/v1/public/forms/${token}`).expect(404);
    const refused = await request(app.getHttpServer()).get('/api/v1/zapier/me').set('authorization', `Bearer ${key}`).expect(403);
    expect(refused.body.error.code).toBe('FEATURE_NOT_IN_PLAN');

    await setPlan(owner.tenantId, 'growth');
    await request(app.getHttpServer()).get(`/api/v1/public/forms/${token}`).expect(200);
  });

  it('workflows stay saved but do not run while the plan leaves automation out', async () => {
    await op(admin).post(`/tenants/${launch.tenantId}/features`, { overrides: { automation: false }, reason: 'Abuse review' }).expect(200);
    expect((await api(launch).get('/workflows')).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    await op(admin).post(`/tenants/${launch.tenantId}/features`, { overrides: { automation: null }, reason: 'Review closed' }).expect(200);
    await api(launch).get('/workflows').expect(200);
  });
});
