import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_GROUPS, FEATURE_KEYS, FEATURES, type PlanCode } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, ORIGIN, ownerClient, registerUser, setPlan, startApp, type TestUser, workspacePerson } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/*
 * Console rules (workspace redesign W3): per plan, with a per-client override, the Console caps whether Manager and
 * Executive Workspaces may delete, which modules each level may use, and whether each level must use two-step
 * sign-in. A Super Workspace chooses within them and can never go beyond.
 */
describe('Console workspace rules', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  let owner: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let plan: string;
  const password = 'operator-password-1';
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });
  const all = { managerDelete: true, executiveDelete: true, managerModules: [...FEATURE_GROUPS], executiveModules: [...FEATURE_GROUPS], mfaRequired: { SUPER: false, MANAGER: false, EXECUTIVE: false }, managerHiddenSections: [], executiveHiddenSections: [], managerHiddenFields: [], executiveHiddenFields: [] };
  const salesFeature = FEATURES.find((f) => f.group === 'Sales')!.key;

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    const adminEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;
    const supportEmail = `sup-${randomUUID().slice(0, 8)}@platform.test`;
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);

    // A plan of its own, so these rules never reach other suites.
    const limits = { maxUsers: null, maxPipelines: null, monthlyAiCredits: 1000, automationRunsPerMonth: 10000, maxManagerWorkspaces: 5, maxExecutiveWorkspaces: 5 };
    const terms = { description: 'Rules test', priceCents: 100, currency: 'INR', billingFrequency: 'MONTH', supportLevel: 'STANDARD', durationMonths: 12, autoRenew: true, upgradeTo: [], available: true };
    const name = `Rules Plan ${randomUUID().slice(0, 4)}`;
    const plans = (await op(admin).post('/console-plans', { name, features: [...FEATURE_KEYS], limits, terms, reason: 'Workspace rules test' }).expect(201)).body;
    plan = plans.find((p: { name: string }) => p.name === name).code;
    owner = await registerUser(app, 'Rules Client Ltd');
    await setPlan(owner.tenantId, plan as PlanCode);
    manager = await workspacePerson(app, owner, 'MANAGER', 'Neha Manager');
  });

  afterAll(async () => {
    const db = ownerClient();
    try {
      await db.planWorkspaceRules.deleteMany({ where: { planCode: plan } });
      await db.subscription.updateMany({ where: { planCode: plan }, data: { planCode: 'free' } });
      await db.plan.deleteMany({ where: { code: plan } });
    } finally {
      await db.$disconnect();
    }
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  /** Gives the manager's workspace every action the Super Workspace has, Delete included. */
  async function grantEverything() {
    const sup = (await api(owner).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { actions: sup, features: [...FEATURE_KEYS] }).expect(200);
  }

  it('lists every plan with no limits by default, and only admins change them', async () => {
    const list = (await op(support).get('/workspace-rules').expect(200)).body;
    expect(list.defaults).toEqual(all);
    expect(list.plans.find((p: { planCode: string }) => p.planCode === plan)).toMatchObject({ rules: all, customised: false });
    await op(support).put(`/workspace-rules/plans/${plan}`, { rules: all, reason: 'Not allowed' }).expect(403);
    await op(admin).put(`/workspace-rules/plans/${plan}`, { rules: { ...all, managerDelete: 'yes' }, reason: 'Bad' }).expect(400);
    await op(admin).put('/workspace-rules/plans/no_such_plan', { rules: all, reason: 'Missing plan' }).expect(404);
  });

  it('a plan rule takes Delete away from Manager Workspaces, whatever the Super Workspace grants', async () => {
    await grantEverything();
    const lead = (await api(manager).post('/leads', { fullName: 'Rule Lead' }).expect(201)).body.lead;
    expect((await api(manager).get('/auth/me').expect(200)).body.workspace.actions.CRM).toContain('delete');

    const res = (await op(admin).put(`/workspace-rules/plans/${plan}`, { rules: { ...all, managerDelete: false }, reason: 'Managers must not delete' }).expect(200)).body;
    expect(res.plans.find((p: { planCode: string }) => p.planCode === plan)).toMatchObject({ customised: true, rules: { managerDelete: false } });

    // Applies on the next request; the Super Workspace keeps Delete.
    expect((await api(manager).get('/auth/me').expect(200)).body.workspace.actions.CRM).not.toContain('delete');
    expect((await api(manager).del(`/leads/${lead.id}`).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    expect((await api(owner).get('/auth/me').expect(200)).body.workspace.actions.CRM).toContain('delete');
    // The Permission Center is told the rule, so it can say why.
    expect((await api(owner).get('/workspaces').expect(200)).body.rules.managerDelete).toBe(false);
  });

  it('a client override beats the plan, is logged in both audit logs, and can be removed', async () => {
    await op(support).put(`/workspace-rules/clients/${owner.tenantId}`, { override: { managerDelete: true }, reason: 'Not allowed' }).expect(403);
    await op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override: { managerDelete: true } }).expect(400);
    const set = (await op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override: { managerDelete: true }, reason: 'Agreed with the client' }).expect(200)).body;
    expect(set).toMatchObject({ planCode: plan, planRules: { managerDelete: false }, override: { managerDelete: true }, effective: { managerDelete: true } });

    const lead = (await api(manager).post('/leads', { fullName: 'Override Lead' }).expect(201)).body.lead;
    await api(manager).del(`/leads/${lead.id}`).expect(204);

    const log = (await api(owner).get('/audit-logs?category=security').expect(200)).body;
    const rows = (log.items ?? log.rows ?? log) as { action: string; actorType?: string }[];
    expect(rows.some((r) => r.action === 'security.workspace_rules_changed')).toBe(true);
    const platform = (await op(admin).get('/audit-log').expect(200)).body;
    expect(JSON.stringify(platform)).toContain('tenant.workspace_rules_changed');

    const cleared = (await op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override: null, reason: 'Back to the plan' }).expect(200)).body;
    expect(cleared).toMatchObject({ override: null, effective: { managerDelete: false } });
  });

  it('withholds modules from a level', async () => {
    expect((await api(manager).get('/auth/me').expect(200)).body.tenant.features).toContain(salesFeature);
    await op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override: { managerModules: FEATURE_GROUPS.filter((g) => g !== 'Sales') }, reason: 'No sales module for managers' }).expect(200);
    const me = (await api(manager).get('/auth/me').expect(200)).body;
    expect(me.tenant.features).not.toContain(salesFeature);
    expect(me.workspace.actions.Sales ?? []).toEqual([]);
    expect((await api(owner).get('/auth/me').expect(200)).body.tenant.features).toContain(salesFeature);
    await op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override: null, reason: 'Undo' }).expect(200);
  });

  it('requires two-step sign-in for one level only', async () => {
    await op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override: { mfaRequired: { MANAGER: true } }, reason: 'Managers must use two-step sign-in' }).expect(200);
    expect((await api(manager).get('/auth/me').expect(200)).body.restriction).toBe('mfa_enrolment');
    expect((await api(manager).get('/leads').expect(403)).body.error.code).toBeDefined();
    expect((await api(owner).get('/auth/me').expect(200)).body.restriction).toBeUndefined();
    await api(owner).get('/leads').expect(200);
    await op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override: null, reason: 'Undo' }).expect(200);
    expect((await api(manager).get('/auth/me').expect(200)).body.restriction).toBeUndefined();
  });
});
