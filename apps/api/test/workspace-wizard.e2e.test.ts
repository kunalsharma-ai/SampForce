import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Workspace redesign W5: the creation wizard's fields (department, description, access level, status, the person's
 * name and phone, executives moved into a new manager's team) and one email, one role: an address that already works
 * in a workspace of the organisation, or has a pending invitation to one, cannot be given another. Checked as the
 * person types (email-check) and again when the workspace is created.
 */

type Person = TestUser & { userId: string };

describe('workspace creation wizard', () => {
  let app: INestApplication;
  let owner: TestUser;
  let manager: Person;
  let managerId: string;
  let exec: Person;
  let execId: string;
  const db = ownerClient();

  async function accept(inviteUrl: string, password = 'a-long-password-1', name?: string): Promise<Person> {
    const agent = request.agent(app.getHttpServer());
    const token = inviteUrl.split('/invite/')[1]!;
    await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, password, ...(name ? { name } : { name: 'Someone' }) }).expect(200);
    const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
    return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
  }

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Wizard Traders');
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 4 } });
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('creates a Manager Workspace with every wizard field, switched off until it is reactivated', async () => {
    const created = (
      await api(owner)
        .post('/workspaces', {
          level: 'MANAGER',
          name: 'North India',
          department: 'Field Sales',
          designation: 'Regional Sales Manager',
          description: 'Delhi, Punjab and Haryana accounts',
          accessLevel: 'OWN',
          status: 'DEACTIVATED',
          person: { inviteEmail: 'rahul@wizard.test', name: 'Rahul Sharma', phone: '+91 98765 43210' },
        })
        .expect(201)
    ).body;
    expect(created).toMatchObject({ name: 'North India', department: 'Field Sales', description: 'Delhi, Punjab and Haryana accounts', accessLevel: 'OWN', designation: 'Regional Sales Manager', pendingInvites: ['rahul@wizard.test'] });
    expect(created.deactivatedAt).toBeTruthy();
    managerId = created.id;

    // The accept page is pre-filled with the name the inviter typed; the phone goes on the new account.
    const token = (created.inviteUrl as string).split('/invite/')[1]!;
    expect((await request(app.getHttpServer()).get(`/api/v1/auth/invitations/${token}`).expect(200)).body).toMatchObject({ email: 'rahul@wizard.test', name: 'Rahul Sharma', hasAccount: false });
    manager = await accept(created.inviteUrl, 'a-long-password-1', 'Rahul Sharma');
    expect((await db.user.findUniqueOrThrow({ where: { id: manager.userId } })).phone).toBe('+91 98765 43210');
    expect((await api(manager).get('/auth/me').expect(200)).body.restriction).toBe('workspace_deactivated');
    await api(owner).post(`/workspaces/${managerId}/reactivate`).expect(200);
    expect((await api(manager).get('/auth/me').expect(200)).body.restriction).toBeUndefined();

    expect((await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Bad Phone', person: { inviteEmail: 'p@wizard.test', phone: 'call me' } }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Bad Access', accessLevel: 'OWN' }).expect(400)).body.error.code).toBe('INVALID_SETTING');
  });

  it('says, while the email is typed, when it already holds a role or has a pending invitation', async () => {
    expect((await api(owner).get('/workspaces/email-check?email=new.person@wizard.test').expect(200)).body).toEqual({ available: true });
    expect((await api(owner).get(`/workspaces/email-check?email=${encodeURIComponent(' Rahul@Wizard.test ')}`).expect(200)).body).toEqual({
      available: false,
      code: 'EMAIL_IN_WORKSPACE',
      message: 'This email is already the Manager of North India. One email can hold only one role in your organisation.',
    });
    expect((await api(owner).get(`/workspaces/email-check?email=${encodeURIComponent(owner.email)}`).expect(200)).body).toMatchObject({ available: false, code: 'EMAIL_IN_WORKSPACE', message: expect.stringContaining('member of the Super Workspace') });

    const exe = (await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Asha Field', parentId: managerId, person: { inviteEmail: 'asha@wizard.test', name: 'Asha Verma' } }).expect(201)).body;
    execId = exe.id;
    expect((await api(owner).get('/workspaces/email-check?email=asha@wizard.test').expect(200)).body).toEqual({
      available: false,
      code: 'EMAIL_INVITED',
      message: 'This email already has a pending invitation to Asha Field. Withdraw that invitation first.',
    });
    await api(owner).get('/workspaces/email-check?email=not-an-email').expect(400);
    exec = await accept(exe.inviteUrl, 'a-long-password-1', 'Asha Verma');
    // An executive creates no workspaces, so it cannot probe emails either.
    expect((await api(exec).get('/workspaces/email-check?email=x@wizard.test').expect(403)).body.error.code).toBe('WORKSPACE_CREATE_FORBIDDEN');
  });

  it('refuses a second role for the same email on the server too, never replacing a pending invitation silently', async () => {
    const taken = await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Second Rahul', person: { inviteEmail: 'rahul@wizard.test' } }).expect(409);
    expect(taken.body.error).toMatchObject({ code: 'EMAIL_IN_WORKSPACE', message: expect.stringContaining('the Manager of North India') });
    // Nothing was created.
    expect(await db.workspaceNode.count({ where: { tenantId: owner.tenantId, name: 'Second Rahul' } })).toBe(0);

    await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Pending One', person: { inviteEmail: 'pending@wizard.test' } }).expect(201);
    expect((await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Pending Two', person: { inviteEmail: 'pending@wizard.test' } }).expect(409)).body.error.code).toBe('EMAIL_INVITED');
    // The team page's invite cannot move a pending workspace invitation elsewhere either.
    expect((await api(owner).post('/tenants/current/invitations', { email: 'pending@wizard.test', roleKey: 'member' }).expect(409)).body.error.code).toBe('EMAIL_INVITED');
  });

  it('a manager with the Standard access level sees only its own records; Team adds its executives’', async () => {
    await api(exec).post('/leads', { fullName: 'Asha Lead' }).expect(201);
    const lead = await db.lead.findFirstOrThrow({ where: { tenantId: owner.tenantId, fullName: 'Asha Lead' } });
    await api(manager).get(`/leads/${lead.id}`).expect(404);
    const row = (await api(owner).patch(`/workspaces/${managerId}`, { accessLevel: 'TEAM' }).expect(200)).body;
    expect(row.accessLevel).toBe('TEAM');
    await api(manager).get(`/leads/${lead.id}`).expect(200);
    expect((await api(owner).patch(`/workspaces/${execId}`, { accessLevel: 'OWN' }).expect(400)).body.error.code).toBe('INVALID_SETTING');
  });

  it('a new manager can take existing Executive Workspaces into its team', async () => {
    const solo = (await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Solo Exec' }).expect(201)).body;
    const south = (await api(owner).post('/workspaces', { level: 'MANAGER', name: 'South India', executiveIds: [solo.id] }).expect(201)).body;
    expect((await db.workspaceNode.findUniqueOrThrow({ where: { id: solo.id } })).parentId).toBe(south.id);
    expect(south.accessLevel).toBe('TEAM');
    expect((await api(owner).post('/workspaces', { level: 'MANAGER', name: 'West India', executiveIds: [managerId] }).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'Exec Taker', executiveIds: [solo.id] }).expect(400)).body.error.code).toBe('INVALID_SETTING');
  });
});
