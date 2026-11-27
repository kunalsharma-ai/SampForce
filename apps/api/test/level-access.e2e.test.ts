import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_KEYS, type PlanCode } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, ORIGIN, ownerClient, registerUser, setPlan, startApp, type TestUser, workspacePerson } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/*
 * Section and field access per level (redesign R8, ADR 0092): the Console, and only the Console, decides which menu
 * sections and which record fields Manager and Executive Workspaces may see. The server enforces it: a withheld
 * section is refused, a hidden field comes back empty and cannot be changed. The Super Workspace sees everything.
 */
describe('Console section and field access', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  let owner: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let executive: TestUser & { userId: string; workspaceId: string };
  let plan: string;
  const password = 'operator-password-1';
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });

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
    executive = await workspacePerson(app, owner, 'EXECUTIVE', 'Ravi Executive');
    const sup = (await api(owner).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    for (const w of [manager, executive]) await api(owner).put(`/workspaces/${w.workspaceId}/permissions`, { actions: sup, features: [...FEATURE_KEYS] }).expect(200);
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

  const me = async (u: TestUser) => (await api(u).get('/auth/me').expect(200)).body;
  const setClient = (override: object | null) => op(admin).put(`/workspace-rules/clients/${owner.tenantId}`, { override, reason: 'Access test' });

  it('withholds single sections from one level only, and refuses them on the server', async () => {
    expect((await me(executive)).tenant.features).toContain('quotes');
    // Support staff may read but not change; an unknown section is refused.
    await op(support).put(`/workspace-rules/clients/${owner.tenantId}`, { override: { executiveHiddenSections: ['quotes'] }, reason: 'Not allowed' }).expect(403);
    await setClient({ executiveHiddenSections: ['not_a_section'] }).expect(400);
    const r = (await setClient({ executiveHiddenSections: ['quotes', 'contracts'] }).expect(200)).body;
    expect(r.effective.executiveHiddenSections).toEqual(['quotes', 'contracts']);
    expect(r.effective.managerHiddenSections).toEqual([]);

    const exec = await me(executive);
    expect(exec.tenant.features).not.toContain('quotes');
    expect(exec.tenant.features).not.toContain('contracts');
    expect(exec.workspace.hiddenSections).toEqual(['quotes', 'contracts']);
    expect(exec.workspace.actions.quotes ?? []).toEqual([]);
    expect((await api(executive).get('/quotes').expect(403)).body.error.code).toBe('FEATURE_NOT_GRANTED');
    // The manager and the Super Workspace keep them.
    expect((await me(manager)).tenant.features).toContain('quotes');
    await api(manager).get('/quotes').expect(200);
    await api(owner).get('/quotes').expect(200);

    // Back to the plan: the executive has them again on the next request.
    await setClient(null).expect(200);
    expect((await me(executive)).tenant.features).toContain('quotes');
    await api(executive).get('/quotes').expect(200);
  });

  it('hides record fields from a level: empty in every response, unchanged by its edits', async () => {
    const company = (await api(owner).post('/companies', { name: `Hidden Fields Co ${Date.now()}`, primaryEmail: 'sales@hidden.test', primaryPhone: '+919876543210', website: 'https://hidden.test', industry: 'Research', managerId: manager.userId, ownerId: executive.userId }).expect(201)).body;
    const contact = (await api(owner).post('/contacts', { firstName: 'Asha', lastName: 'Rao', email: 'asha@hidden.test', phone: '+919812345678', jobTitle: 'Buyer', companyId: company.id, ownerId: executive.userId }).expect(201)).body;

    await setClient({ managerHiddenFields: ['company.primaryEmail', 'contact.phone'], executiveHiddenFields: ['company.primaryEmail', 'company.website', 'contact.email'] }).expect(200);
    await setClient({ executiveHiddenFields: ['company.nope'] }).expect(400);
    expect((await me(manager)).workspace.hiddenFields).toEqual(['company.primaryEmail', 'contact.phone']);
    expect((await me(owner)).workspace.hiddenFields).toEqual([]);

    // The executive: the company's email and website are empty, its other fields and its name stay.
    const ec = (await api(executive).get(`/companies/${company.id}`).expect(200)).body;
    expect(ec.name).toBe(company.name);
    expect(ec.primaryEmail).toBeNull();
    expect(ec.website).toBeNull();
    expect(ec.domain ?? null).toBeNull();
    expect(ec.industry).toBe('Research');
    expect(ec.primaryPhone).toBe('+919876543210');
    const list = (await api(executive).get('/companies').query({ q: 'Hidden Fields Co' }).expect(200)).body;
    const row = (list.items ?? list.data ?? list).find((c: { id: string }) => c.id === company.id);
    expect(row.primaryEmail).toBeNull();
    const ect = (await api(executive).get(`/contacts/${contact.id}`).expect(200)).body;
    expect(ect.email).toBeNull();
    expect(ect.phone).toBe('+919812345678');

    // The manager: the contact's phone is hidden, its email is not.
    const mct = (await api(manager).get(`/contacts/${contact.id}`).expect(200)).body;
    expect(mct.phone).toBeNull();
    expect(mct.email).toBe('asha@hidden.test');

    // An edit that sends a hidden field does not change it; the other fields are saved.
    await api(executive).patch(`/companies/${company.id}`, { primaryEmail: 'changed@hidden.test', industry: 'Market research' }).expect(200);
    const oc = (await api(owner).get(`/companies/${company.id}`).expect(200)).body;
    expect(oc.primaryEmail).toBe('sales@hidden.test');
    expect(oc.industry).toBe('Market research');
    expect(oc.website).toBe('https://hidden.test');

    await setClient(null).expect(200);
    expect((await api(executive).get(`/companies/${company.id}`).expect(200)).body.primaryEmail).toBe('sales@hidden.test');
  });

  it('applies plan-wide access to every client on the plan, under a client override', async () => {
    const plans = (await op(admin).get('/workspace-rules').expect(200)).body;
    const rules = plans.plans.find((p: { planCode: string }) => p.planCode === plan).rules;
    await op(admin).put(`/workspace-rules/plans/${plan}`, { rules: { ...rules, managerHiddenSections: ['contracts'], managerHiddenFields: ['deal.amount'] }, reason: 'Plan access' }).expect(200);
    const m = await me(manager);
    expect(m.tenant.features).not.toContain('contracts');
    expect(m.workspace.hiddenFields).toEqual(['deal.amount']);
    // A rules body from before R8 (without the new lists) still saves and clears them.
    const { managerHiddenSections: _a, executiveHiddenSections: _b, managerHiddenFields: _c, executiveHiddenFields: _d, ...old } = rules;
    await op(admin).put(`/workspace-rules/plans/${plan}`, { rules: old, reason: 'Old screen' }).expect(200);
    expect((await me(manager)).tenant.features).toContain('contracts');
  });

  it('moves the Leads and Accounts switch to the Console', async () => {
    // The client's own Settings can no longer change it; it can still read it.
    await api(owner).put('/tenants/current/menu-sections', { leads: true, accounts: true }).expect(404);
    expect((await api(owner).get('/tenants/current/menu-sections').expect(200)).body).toEqual({ leads: false, accounts: false });
    await op(support).put(`/workspace-rules/clients/${owner.tenantId}/menu-sections`, { leads: true, accounts: false, reason: 'Not allowed' }).expect(403);
    await op(admin).put(`/workspace-rules/clients/${owner.tenantId}/menu-sections`, { leads: true, accounts: false }).expect(400);
    expect((await op(admin).put(`/workspace-rules/clients/${owner.tenantId}/menu-sections`, { leads: true, accounts: false, reason: 'Client asked' }).expect(200)).body).toEqual({ leads: true, accounts: false });
    expect((await op(support).get(`/workspace-rules/clients/${owner.tenantId}/menu-sections`).expect(200)).body).toEqual({ leads: true, accounts: false });
    expect((await me(owner)).tenant.features).toContain('leads_section');
    expect((await me(manager)).tenant.features).toContain('leads_section');
    expect((await me(owner)).tenant.features).not.toContain('accounts_section');
    // The Console's section rules can still withhold it from one level.
    await setClient({ executiveHiddenSections: ['leads_section'] }).expect(200);
    expect((await me(executive)).tenant.features).not.toContain('leads_section');
    await setClient(null).expect(200);
    const db = ownerClient();
    try {
      expect(await db.auditLog.count({ where: { tenantId: owner.tenantId, action: 'tenant.menu_sections' } })).toBe(1);
    } finally {
      await db.$disconnect();
    }
    await op(admin).put(`/workspace-rules/clients/${owner.tenantId}/menu-sections`, { leads: false, accounts: false, reason: 'Back' }).expect(200);
  });
});
