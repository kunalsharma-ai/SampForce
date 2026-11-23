import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_KEYS, withParents } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';
import { addMonths } from '../src/operator/console.service';
import { api, appClient, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/**
 * Console Admin (ADR 0071, part 2): the platform owner creates client organisations, sells them plans and sets their
 * workspace limits and authority, and every change reaches the client's Super Workspace and the workspaces below it on
 * their next request. Spec scenarios 1, 2 and 14, plus the Console's own rules.
 */
describe('Console clients, plans and limits', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  const adminEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;
  const supportEmail = `sup-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    patch: (url: string, body: object) => agent.patch(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });

  // Plan A has every feature; Plan B leaves out ten (RFQs among them), like the spec's "Plan B with fewer features".
  const left = ['rfqs', 'sampbidx', 'lead_transfers', 'quick_bid', 'bid_templates', 'revenue_attribution', 'client_portal', 'docusign', 'gamification', 'forecasting'].filter((k) => (FEATURE_KEYS as readonly string[]).includes(k));
  const planBFeatures = FEATURE_KEYS.filter((k) => !left.includes(k));
  const limits = { maxUsers: null, maxPipelines: null, monthlyAiCredits: 1000, automationRunsPerMonth: 10000, maxManagerWorkspaces: 10, maxExecutiveWorkspaces: 20 };
  const terms = (price: number) => ({ description: 'Sold by the SampForce team', priceCents: price, currency: 'INR', billingFrequency: 'MONTH', supportLevel: 'PRIORITY', durationMonths: 12, autoRenew: true, upgradeTo: [], available: true });
  let planA: string;
  let planB: string;
  let clientId: string;
  let superAdmin: TestUser;
  let other: TestUser;

  async function acceptInvite(inviteUrl: string, name: string): Promise<TestUser> {
    const token = inviteUrl.split('/invite/')[1]!;
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password: 'a-long-password-1' }).expect(200);
    const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { email: string }; tenant: { id: string } };
    return { agent, email: me.user.email, password: 'a-long-password-1', tenantId: me.tenant.id };
  }

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
    other = await registerUser(app, 'Unrelated Client Ltd', { plan: 'growth' });
  });
  afterAll(async () => {
    // Plans are shared reference data: remove the ones made here so later suites see the shipped catalogue only.
    const db = ownerClient();
    try {
      await db.subscription.updateMany({ where: { planCode: { in: [planA, planB].filter(Boolean) } }, data: { planCode: 'free' } });
      await db.plan.deleteMany({ where: { code: { in: [planA, planB].filter(Boolean) } } });
    } finally {
      await db.$disconnect();
    }
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('creates plans with their features, limits and commercial terms (scenario 2)', async () => {
    const a = (await op(admin).post('/console-plans', { name: `Plan A ${randomUUID().slice(0, 4)}`, features: [...FEATURE_KEYS], limits, terms: terms(5_000_000), reason: 'Full platform plan' }).expect(201)).body;
    planA = a.find((p: { name: string }) => p.name.startsWith('Plan A')).code;
    const b = (await op(admin).post('/console-plans', { name: `Plan B ${randomUUID().slice(0, 4)}`, features: planBFeatures, limits, terms: { ...terms(3_000_000), upgradeTo: [planA] }, reason: 'Plan without RFQs' }).expect(201)).body;
    const row = b.find((p: { name: string }) => p.name.startsWith('Plan B'));
    planB = row.code;
    expect(planA).toMatch(/^custom_plan_a/);
    expect(row).toMatchObject({ custom: true, terms: { priceCents: 3_000_000, currency: 'INR', supportLevel: 'PRIORITY', durationMonths: 12, upgradeTo: [planA] }, limits: { maxManagerWorkspaces: 10 } });
    expect(row.features).toHaveLength(planBFeatures.length);
    // Names are unique, upgrade targets must exist, and only admins change plans.
    await op(admin).post('/console-plans', { name: row.name, features: [], limits, terms: terms(1), reason: 'Duplicate name' }).expect(409);
    await op(admin).post('/console-plans', { name: 'Plan Z', features: [], limits, terms: { ...terms(1), upgradeTo: ['nope'] }, reason: 'Unknown target' }).expect(400);
    await op(support).post('/console-plans', { name: 'Plan S', features: [], limits, terms: terms(1), reason: 'Support may not' }).expect(403);
    await op(admin).patch(`/console-plans/growth`, { name: 'Renamed Growth', reason: 'Shipped plans keep names' }).expect(400);
  });

  it('creates a client organisation with its Super Workspace, subscription, limits and administrator (scenarios 1 and 3)', async () => {
    const created = (
      await op(admin)
        .post('/clients', {
          organisation: { name: 'Frequent Research Fieldwork Solutions' },
          administrator: { name: 'Kavya Iyer', email: `kavya-${randomUUID().slice(0, 6)}@client.test`, designation: 'Head of Sales Operations' },
          planCode: planB, seats: 25, startsOn: '2026-11-01', priceCents: 2_750_000, currency: 'INR', paymentStatus: 'PAID',
          maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 6, superCanCreateExecutives: true, reason: 'Signed order form',
        })
        .expect(201)
    ).body;
    clientId = created.client.id;
    expect(created.inviteUrl).toMatch(/\/invite\//);
    expect(created.client).toMatchObject({
      state: 'ACTIVE', awaitingAdministrator: true, usage: { managers: 0, executives: 0 },
      subscription: { planCode: planB, seats: 25, startedOn: '2026-11-01', renewsOn: '2027-11-01', durationMonths: 12, priceCents: 2_750_000, currency: 'INR', paymentStatus: 'PAID', limits: { managers: 4, executives: 6 }, limitsSetForClient: { managers: true, executives: true } },
    });
    expect(created.client.workspaces).toEqual([expect.objectContaining({ level: 'SUPER', name: 'Frequent Research Fieldwork Solutions', designation: 'Head of Sales Operations' })]);
    expect(created.client.history[0]).toMatchObject({ action: 'client.created', reason: 'Signed order form', by: adminEmail });

    // The administrator joins as the owner of the Super Workspace and gets Plan B's features, nothing more.
    superAdmin = await acceptInvite(created.inviteUrl, 'Kavya Iyer');
    const me = (await api(superAdmin).get('/auth/me').expect(200)).body;
    expect(me.role).toBe('owner');
    expect(me.workspace).toMatchObject({ level: 'SUPER', designation: 'Head of Sales Operations' });
    expect([...me.tenant.features].sort()).toEqual(withParents(planBFeatures).sort());
    const rfq = await api(superAdmin).get('/rfqs').expect(403);
    expect(rfq.body.error.code).toMatch(/FEATURE_NOT_(IN_PLAN|GRANTED)/);

    // Four Manager Workspaces fit, the fifth is refused (scenarios 4 and 5 with the Console's limits).
    for (let i = 1; i <= 4; i++) await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: `Region ${i}` }).expect(201);
    const fifth = await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'Region 5' }).expect(403);
    expect(fifth.body.error.code).toBe('WORKSPACE_LIMIT_REACHED');
    const detail = (await op(admin).get(`/clients/${clientId}`).expect(200)).body;
    expect(detail).toMatchObject({ awaitingAdministrator: false, usage: { managers: 4, executives: 0 }, administrators: [expect.objectContaining({ name: 'Kavya Iyer' })] });
    expect(detail.workspaces.filter((w: { level: string }) => w.level === 'MANAGER')).toHaveLength(4);
  });

  it('applies a subscription change to the Super Workspace and every workspace below it (scenario 14)', async () => {
    const tree = (await api(superAdmin).get('/workspaces').expect(200)).body;
    const region1 = tree.workspaces.find((w: { name: string }) => w.name === 'Region 1').id;

    // Upgrading to Plan A brings RFQs to the Super Workspace at once.
    await op(admin).put(`/clients/${clientId}/subscription`, { planCode: planA, reason: 'Upgraded to Plan A' }).expect(200);
    await api(superAdmin).get('/rfqs').expect(200);
    // Raising the manager limit lets a fifth Manager Workspace in.
    await op(admin).put(`/clients/${clientId}/subscription`, { maxManagerWorkspaces: 5, reason: 'Fifth region approved' }).expect(200);
    await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'Region 5' }).expect(201);
    expect((await api(superAdmin).get('/workspaces').expect(200)).body.usage.managers).toEqual({ used: 5, max: 5 });

    // Taking a feature out of the plan removes it from the Super Workspace and from the Manager Workspace below it.
    const before = (await api(superAdmin).get('/workspaces').expect(200)).body.workspaces.find((w: { id: string }) => w.id === region1);
    expect(before.features).toContain('task_management');
    await op(admin).patch(`/console-plans/${planA}`, { features: FEATURE_KEYS.filter((k) => k !== 'task_management'), reason: 'Tasks move to an add-on' }).expect(200);
    const me = (await api(superAdmin).get('/auth/me').expect(200)).body;
    expect(me.tenant.features).not.toContain('task_management');
    const after = (await api(superAdmin).get('/workspaces').expect(200)).body.workspaces.find((w: { id: string }) => w.id === region1);
    expect(after.features).not.toContain('task_management');

    // A change for this client leaves an unrelated client untouched.
    const otherMe = (await api(other).get('/auth/me').expect(200)).body;
    expect(otherMe.tenant.plan).toBe('growth');
    expect(otherMe.tenant.features).toContain('task_management');

    const history = (await op(admin).get(`/clients/${clientId}`).expect(200)).body.history as { action: string; changes: string[] }[];
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(['client.created', 'client.subscription_changed']));
    expect(history.flatMap((h) => h.changes)).toEqual(expect.arrayContaining([expect.stringMatching(/^Plan: Plan B .* → Plan A /), 'Manager Workspaces: 4 → 5']));
    // A plan whose upgrade settings name its targets refuses others.
    await op(admin).put(`/clients/${clientId}/subscription`, { planCode: planB, reason: 'Back to B' }).expect(200);
    await op(admin).put(`/clients/${clientId}/subscription`, { planCode: 'growth', reason: 'Not an allowed move' }).expect(400);
    await op(admin).put(`/clients/${clientId}/subscription`, { planCode: planA, reason: 'Upgrade again' }).expect(200);
  });

  it('sets the Super Workspace’s authority: its action ceiling and whether it creates Executive Workspaces', async () => {
    await op(admin).put(`/clients/${clientId}/authority`, { canCreateExecutives: false, reason: 'Executives through managers only' }).expect(200);
    const refused = await api(superAdmin).post('/workspaces', { level: 'EXECUTIVE', name: 'Direct Seller' }).expect(403);
    expect(refused.body.error.code).toBe('WORKSPACE_CREATE_FORBIDDEN');
    await op(admin).put(`/clients/${clientId}/authority`, { canCreateExecutives: true, reason: 'Allowed again' }).expect(200);
    await api(superAdmin).post('/workspaces', { level: 'EXECUTIVE', name: 'Direct Seller' }).expect(201);

    // A ceiling of viewing only in CRM: the Super Workspace can read leads but not add them.
    const all = ['view', 'create', 'edit', 'delete', 'export', 'assign', 'approve', 'manage', 'configure', 'reports', 'cross_workspace'];
    const ceiling = { CRM: ['view'], Sales: all, Communication: all, Engage: all, Intelligence: all, Revenue: all, Apps: all, Administration: all };
    const set = (await op(admin).put(`/clients/${clientId}/authority`, { actions: ceiling, reason: 'Read-only CRM while migrating' }).expect(200)).body;
    expect(set.authority.actions.CRM).toEqual(['view']);
    await api(superAdmin).get('/leads').expect(200);
    const add = await api(superAdmin).post('/leads', { fullName: 'Blocked Lead' }).expect(403);
    expect(add.body.error.code).toBe('ACTION_NOT_GRANTED');
    await op(admin).put(`/clients/${clientId}/authority`, { actions: null, reason: 'Migration finished' }).expect(200);
    await api(superAdmin).post('/leads', { fullName: 'Allowed Lead' }).expect(201);
    // Only admins change a client.
    await op(support).put(`/clients/${clientId}/authority`, { actions: null, reason: 'Support may not' }).expect(403);
  });

  it('renews, suspends, deactivates and activates a client, keeping its data', async () => {
    const renewed = (await op(admin).post(`/clients/${clientId}/renew`, { months: 6, paymentStatus: 'PENDING', reason: 'Six-month extension' }).expect(200)).body;
    expect(renewed.subscription).toMatchObject({ renewsOn: '2028-05-01', paymentStatus: 'PENDING', durationMonths: 6, status: 'ACTIVE' });

    await op(admin).post(`/clients/${clientId}/state`, { state: 'SUSPENDED', reason: 'Payment overdue' }).expect(200);
    await api(superAdmin).get('/leads').expect(401);
    await op(admin).post(`/clients/${clientId}/state`, { state: 'DEACTIVATED', reason: 'Contract ended' }).expect(200);
    const off = (await op(admin).get(`/clients/${clientId}`).expect(200)).body;
    expect(off).toMatchObject({ state: 'DEACTIVATED', subscription: { status: 'CANCELED' } });
    await op(admin).post(`/clients/${clientId}/state`, { state: 'ACTIVE', reason: 'Contract renewed' }).expect(200);
    const leads = (await api(superAdmin).get('/leads').expect(200)).body.items as { fullName?: string; name?: string }[];
    expect(leads.length).toBeGreaterThan(0);
    const on = (await op(admin).get(`/clients/${clientId}`).expect(200)).body;
    expect(on).toMatchObject({ state: 'ACTIVE', subscription: { status: 'ACTIVE' } });
    expect(on.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['client.renewed', 'client.state_changed', 'client.authority_changed']));
  });

  it('shows platform figures on the Console dashboard without any sales records', async () => {
    const o = (await op(support).get('/overview').expect(200)).body;
    expect(o.clients.total).toBeGreaterThanOrEqual(2);
    expect(o.superWorkspaces).toBe(o.clients.total);
    expect(o.workspaces.managers).toBeGreaterThanOrEqual(5);
    expect(o.plansSold).toEqual(expect.arrayContaining([expect.objectContaining({ code: planA, clients: 1 })]));
    expect(o.monthlyRecurring).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'INR', cents: 2_750_000 })]));
    expect(o.outstanding).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'INR', clients: 1 })]));
    expect(JSON.stringify(o)).not.toContain('Allowed Lead');
    const list = (await op(support).get('/clients?search=Frequent').expect(200)).body;
    expect(list.map((c: { id: string }) => c.id)).toContain(clientId);
  });

  it('adds whole months without running past the end of a month', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(new Date('2026-11-01T00:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2027-11-01');
  });
});
