import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * The Leads and Accounts pages are hidden until the Super Workspace switches them on, for the whole organisation
 * (redesign, menu). Only the Super Workspace's administrators may switch them; other organisations are untouched.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id };
}

const features = async (u: TestUser) => (await api(u).get('/auth/me').expect(200)).body.tenant.features as string[];

describe('menu sections: Leads and Accounts', () => {
  let app: INestApplication;
  let owner: TestUser;
  let manager: TestUser;
  let other: TestUser;
  const db = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Menu Sections Research');
    const m = (await api(owner).post('/workspaces', { level: 'MANAGER', name: 'West Team', person: { inviteEmail: `west.${Date.now()}@client.test` } }).expect(201)).body;
    manager = await acceptInvite(app, m.inviteUrl, 'Neha Kapoor');
    other = await registerUser(app, 'Menu Sections Other');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('hides both pages until the Super Workspace shows them, then shows them to every workspace', async () => {
    expect((await api(owner).get('/tenants/current/menu-sections').expect(200)).body).toEqual({ leads: false, accounts: false });
    expect(await features(owner)).not.toContain('leads_section');
    expect(await features(manager)).not.toContain('leads_section');

    // A Manager Workspace may not switch them; the Super Workspace may.
    expect((await api(manager).put('/tenants/current/menu-sections', { leads: true, accounts: true }).expect(403)).body.error.code).toMatch(/SUPER_WORKSPACE_ONLY|FORBIDDEN/);
    expect((await api(owner).put('/tenants/current/menu-sections', { leads: true, accounts: false }).expect(200)).body).toEqual({ leads: true, accounts: false });
    expect(await features(owner)).toContain('leads_section');
    expect(await features(owner)).not.toContain('accounts_section');
    expect(await features(manager)).toContain('leads_section');

    // Hidden again for everyone, and recorded.
    await api(owner).put('/tenants/current/menu-sections', { leads: false, accounts: false }).expect(200);
    expect(await features(owner)).not.toContain('leads_section');
    expect(await features(manager)).not.toContain('leads_section');
    const audit = await db.auditLog.findMany({ where: { tenantId: owner.tenantId, action: 'tenant.menu_sections' } });
    expect(audit).toHaveLength(2);

    // Ordinary members cannot change it, and another organisation is untouched.
    const member = await inviteMember(app, owner, 'member');
    await api(member).put('/tenants/current/menu-sections', { leads: true, accounts: true }).expect(403);
    expect((await api(other).get('/tenants/current/menu-sections').expect(200)).body).toEqual({ leads: false, accounts: false });
    await api(owner).put('/tenants/current/menu-sections', { leads: 'yes' }).expect(400);
  });
});
