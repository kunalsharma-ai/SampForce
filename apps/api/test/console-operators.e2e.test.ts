import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILT_IN_ROLE_DEFS, OPERATOR_PERMISSIONS } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';
import { appClient, ORIGIN, registerUser, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

/**
 * Console roles and permissions (ADR 0074): six built-in roles and custom ones, operators invited by a one-time link,
 * every route checked against the operator's permissions, and no way to give away more than one holds.
 */
describe('Console operators, roles and permissions', () => {
  let app: INestApplication;
  let admin: Agent;
  let support: Agent;
  const tag = randomUUID().slice(0, 6);
  const adminEmail = `ops-${tag}@platform.test`;
  const supportEmail = `sup-${tag}@platform.test`;
  const password = 'operator-password-1';
  const org = `Quasar Fieldwork ${tag}`;
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    patch: (url: string, body: object) => agent.patch(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    del: (url: string) => agent.delete(`/api/v1/operator${url}`).set('origin', ORIGIN),
  });
  const tokenOf = (link: string) => /#token=([A-Za-z0-9_-]+)/.exec(link)![1]!;

  /** Invites an operator with a role and has them choose a password; returns their signed-in agent and id. */
  const join = async (role: string, who: string) => {
    const res = (await op(admin).post('/operators', { email: `${who}-${tag}@platform.test`, name: `${who} ${tag}`, role }).expect(201)).body;
    const agent = request.agent(app.getHttpServer());
    await op(agent).post('/password', { token: tokenOf(res.link), password: 'a-long-passphrase-9' }).expect(200);
    return { agent, id: res.operator.id as string, email: res.operator.email as string };
  };

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' },
        { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' },
      ],
    });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
    await registerUser(app, org, { plan: 'growth' });
  });
  afterAll(async () => {
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('gives operators made before roles existed the matching built-in role', async () => {
    const a = (await op(admin).get('/me').expect(200)).body;
    expect(a).toMatchObject({ role: 'ADMIN', consoleRole: 'super_admin', roleName: 'Super Admin' });
    expect(a.permissions).toEqual([...OPERATOR_PERMISSIONS]);
    const s = (await op(support).get('/me').expect(200)).body;
    expect(s).toMatchObject({ role: 'SUPPORT', consoleRole: 'support', roleName: 'Support Admin' });
    expect(s.permissions).toContain('support.handle');
    expect(s.permissions).not.toContain('billing.view');
  });

  it('checks every route against the permissions of the role', async () => {
    await op(support).get('/clients').expect(200);
    expect((await op(support).get('/invoices/open').expect(403)).body.error.code).toBe('FORBIDDEN');
    await op(support).get('/audit-log').expect(403);
    await op(support).get('/operators').expect(403);
    await op(support).get('/roles').expect(403);
    await op(support).get('/support/tickets/counts').expect(200);
  });

  it('lists the six built-in roles with how many operators have each', async () => {
    const roles = (await op(admin).get('/roles').expect(200)).body as { key: string; builtIn: boolean; operators: number; permissions: string[] }[];
    expect(roles.slice(0, 6).map((r) => r.key)).toEqual(['super_admin', 'finance', 'support', 'sales', 'operations', 'read_only']);
    expect(roles.find((r) => r.key === 'super_admin')!.operators).toBeGreaterThanOrEqual(1);
    expect(roles.find((r) => r.key === 'read_only')!.permissions).toEqual(BUILT_IN_ROLE_DEFS.read_only.permissions);
    // Changing a permission brings the matching view permission.
    expect(roles.find((r) => r.key === 'finance')!.permissions).toEqual(expect.arrayContaining(['billing.manage', 'billing.view']));
  });

  it('invites an operator by a one-time link, which signs them in with the role they were given', async () => {
    const email = `fin-${tag}@platform.test`;
    const res = (await op(admin).post('/operators', { email: email.toUpperCase(), name: 'Fiona Finance', role: 'finance' }).expect(201)).body;
    expect(res).toMatchObject({ emailed: false, operator: { email, role: 'finance', roleName: 'Finance Admin', status: 'INVITED', lastLoginAt: null } });
    expect(res.link).toMatch(/\/operator\/set-password#token=/);
    await op(admin).post('/operators', { email, name: 'Again', role: 'finance' }).expect(409);
    // No password yet, so no sign-in.
    await op(request.agent(app.getHttpServer())).post('/login', { email, password: 'anything-at-all-1' }).expect(401);

    const token = tokenOf(res.link);
    expect((await op(admin).get(`/password/link?token=${token}`).expect(200)).body).toMatchObject({ purpose: 'invite', email, name: 'Fiona Finance' });
    const fiona = request.agent(app.getHttpServer());
    expect((await op(fiona).post('/password', { token, password: 'short1' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await op(fiona).post('/password', { token, password: 'onlylettersherenow' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const me = (await op(fiona).post('/password', { token, password: 'fiona-finance-2026' }).expect(200)).body;
    expect(me).toMatchObject({ email, consoleRole: 'finance', role: 'SUPPORT' });
    expect((await op(fiona).get('/me').expect(200)).body.permissions).toEqual(BUILT_IN_ROLE_DEFS.finance.permissions);
    // The link works once.
    expect((await op(request.agent(app.getHttpServer())).post('/password', { token, password: 'another-pass-2026' }).expect(400)).body.error.code).toBe('LINK_INVALID');
    await op(request.agent(app.getHttpServer())).get(`/password/link?token=${token}`).expect(400);

    await op(fiona).get('/invoices/open').expect(200);
    await op(fiona).post('/clients', {}).expect(403);
    await op(fiona).get('/operators').expect(403);
    const rows = (await op(admin).get('/operators').expect(200)).body as { email: string; status: string }[];
    expect(rows.find((r) => r.email === email)).toMatchObject({ status: 'ACTIVE' });
  });

  it('searches only what the role may open', async () => {
    const { agent } = await join('finance', 'searcher');
    const hits = (await op(agent).get(`/search?q=${encodeURIComponent(org)}`).expect(200)).body.hits as { kind: string }[];
    expect(hits.some((h) => h.kind === 'client')).toBe(true);
    // The owner is named after the organisation: Super Admins find them, Finance Admins (no users.view) do not.
    expect(((await op(admin).get(`/search?q=${encodeURIComponent(org)}`).expect(200)).body.hits as { kind: string }[]).some((h) => h.kind === 'user')).toBe(true);
    expect(hits.some((h) => h.kind === 'user' || h.kind === 'workspace' || h.kind === 'ticket')).toBe(false);
  });

  it('keeps custom roles, adds the view permissions they need, and applies changes at once', async () => {
    expect((await op(admin).post('/roles', { name: 'Finance Admin', permissions: ['clients.view'] }).expect(409)).body.error.code).toBe('CONFLICT');
    await op(admin).post('/roles', { name: 'Empty', permissions: [] }).expect(400);
    await op(admin).post('/roles', { name: 'Bad', permissions: ['nope.nope'] }).expect(400);
    const role = (await op(admin).post('/roles', { name: `Onboarding ${tag}`, description: 'Sets up new clients', permissions: ['clients.edit'] }).expect(201)).body;
    expect(role).toMatchObject({ builtIn: false, operators: 0, permissions: ['clients.view', 'clients.edit'] });

    const { agent, id } = await join(role.key, 'onboard');
    expect((await op(agent).get('/me').expect(200)).body).toMatchObject({ consoleRole: role.key, roleName: `Onboarding ${tag}`, permissions: ['clients.view', 'clients.edit'] });
    await op(agent).get('/invoices/open').expect(403);
    await op(admin).patch(`/roles/${role.key}`, { permissions: ['clients.edit', 'billing.view'] }).expect(200);
    await op(agent).get('/invoices/open').expect(200);

    await op(admin).patch('/roles/finance', { name: 'Mine' }).expect(400);
    expect((await op(admin).del(`/roles/${role.key}`).expect(409)).body.error.code).toBe('ROLE_IN_USE');
    await op(admin).patch(`/operators/${id}`, { role: 'read_only' }).expect(200);
    expect((await op(agent).get('/me').expect(200)).body.consoleRole).toBe('read_only');
    await op(admin).del(`/roles/${role.key}`).expect(204);
    expect(((await op(admin).get('/roles').expect(200)).body as { key: string }[]).some((r) => r.key === role.key)).toBe(false);
  });

  it('never lets an operator give away more than they hold', async () => {
    const role = (await op(admin).post('/roles', { name: `People lead ${tag}`, permissions: ['operators.manage', 'clients.view', 'users.view'] }).expect(201)).body;
    const { agent } = await join(role.key, 'lead');
    expect((await op(agent).post('/operators', { email: `x-${tag}@platform.test`, name: 'X', role: 'super_admin' }).expect(403)).body.error.message).toBe('You can only give permissions that you have yourself.');
    await op(agent).post('/roles', { name: `Bigger ${tag}`, permissions: ['billing.manage'] }).expect(403);
    await op(agent).patch(`/roles/${role.key}`, { permissions: ['operators.manage', 'billing.view'] }).expect(403);
    // Cannot change a Super Admin, whose permissions they do not hold.
    const superRow = ((await op(agent).get('/operators').expect(200)).body as { id: string; email: string }[]).find((r) => r.email === adminEmail)!;
    await op(agent).patch(`/operators/${superRow.id}`, { status: 'DISABLED' }).expect(403);
    // Within their own permissions they can invite.
    const ok = (await op(agent).post('/roles', { name: `Viewer ${tag}`, permissions: ['clients.view'] }).expect(201)).body;
    await op(agent).post('/operators', { email: `viewer-${tag}@platform.test`, name: 'Viewer', role: ok.key }).expect(201);
  });

  it('refuses changes to oneself and switches a disabled operator out at once', async () => {
    const meId = (await op(admin).get('/me').expect(200)).body.id;
    await op(admin).patch(`/operators/${meId}`, { status: 'DISABLED' }).expect(403);
    await op(admin).patch(`/operators/${meId}`, { role: 'finance' }).expect(403);
    await op(admin).patch(`/operators/${meId}`, { name: 'Ada Operator' }).expect(200);

    const { agent, id } = await join('sales', 'leaver');
    await op(agent).get('/me').expect(200);
    expect((await op(admin).patch(`/operators/${id}`, { status: 'DISABLED' }).expect(200)).body.status).toBe('DISABLED');
    await op(agent).get('/me').expect(401);
    expect((await op(admin).post(`/operators/${id}/link`).expect(409)).body.error.code).toBe('OPERATOR_DISABLED');
  });

  it('issues a reset link that replaces the password, and a new invitation for someone who has not joined', async () => {
    const { id, email } = await join('operations', 'resetter');
    const reset = (await op(admin).post(`/operators/${id}/link`).expect(200)).body;
    expect(reset.emailed).toBe(false);
    const fresh = request.agent(app.getHttpServer());
    expect((await op(fresh).get(`/password/link?token=${tokenOf(reset.link)}`).expect(200)).body.purpose).toBe('reset');
    expect((await op(fresh).post('/password', { token: tokenOf(reset.link), password: 'a-long-passphrase-9' }).expect(400)).body.error.code).toBe('PASSWORD_REUSED');
    await op(fresh).post('/password', { token: tokenOf(reset.link), password: 'brand-new-pass-77' }).expect(200);
    await op(request.agent(app.getHttpServer())).post('/login', { email, password: 'brand-new-pass-77' }).expect(200);

    const invited = (await op(admin).post('/operators', { email: `late-${tag}@platform.test`, name: 'Late', role: 'support' }).expect(201)).body;
    const again = (await op(admin).post(`/operators/${invited.operator.id}/link`).expect(200)).body;
    // The first link stops working once a new one is issued.
    await op(request.agent(app.getHttpServer())).get(`/password/link?token=${tokenOf(invited.link)}`).expect(400);
    await op(request.agent(app.getHttpServer())).get(`/password/link?token=${tokenOf(again.link)}`).expect(200);
  });

  it('answers forgot-password the same for any address, and audits operator changes', async () => {
    const anon = request.agent(app.getHttpServer());
    await op(anon).post('/password/forgot', { email: adminEmail }).expect(204);
    await op(anon).post('/password/forgot', { email: `nobody-${tag}@platform.test` }).expect(204);
    await op(anon).post('/password/forgot', { email: 'not-an-email' }).expect(400);
    const db = appClient();
    try {
      const actions = (await db.platformAuditLog.findMany({ where: { action: { in: ['operator.invited', 'operator.joined', 'operator_role.created', 'operator.role_changed', 'operator.disabled', 'operator.password_reset'] } }, select: { action: true, metadata: true } }))
        .filter((r) => JSON.stringify(r.metadata).includes(tag) || r.action === 'operator.joined' || r.action === 'operator.password_reset')
        .map((r) => r.action);
      expect(new Set(actions)).toEqual(new Set(['operator.invited', 'operator.joined', 'operator_role.created', 'operator.role_changed', 'operator.disabled', 'operator.password_reset']));
    } finally {
      await db.$disconnect();
    }
  });
});
