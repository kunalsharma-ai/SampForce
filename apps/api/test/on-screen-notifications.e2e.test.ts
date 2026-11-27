import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { api, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/*
 * On-screen notifications (Kunal's spec section 9): the events they show reach the right people, with a type the
 * browser can draw the right card for, and each person's pop-up preferences are kept (older apps that do not send
 * them leave them as they were).
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser & { userId: string }> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
}

type Note = { type: string; title: string; link: string | null; priority: string };
const notes = async (u: TestUser): Promise<Note[]> => (await api(u).get('/notifications?limit=100').expect(200)).body.items as Note[];

describe('on-screen notifications', () => {
  let app: INestApplication;
  let worker: WorkerService;
  let superAdmin: TestUser;
  let manager: TestUser & { userId: string };
  let executive: TestUser & { userId: string };
  let otherExecutive: TestUser & { userId: string };
  let outsider: TestUser;
  let executiveWorkspace: string;

  beforeAll(async () => {
    app = await startApp();
    worker = app.get(WorkerService);
    superAdmin = await registerUser(app, 'Pop-up Research');
    const m = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'West Team', person: { inviteEmail: `west.${Date.now()}@client.test` } }).expect(201)).body;
    manager = await acceptInvite(app, m.inviteUrl, 'Meera Manager');
    await api(superAdmin).put(`/workspaces/${m.id}/permissions`, { canCreateExecutives: true }).expect(200);
    const e = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Kunal Exec', person: { inviteEmail: `kunal.${Date.now()}@client.test` } }).expect(201)).body;
    executiveWorkspace = e.id;
    executive = await acceptInvite(app, e.inviteUrl, 'Kunal Exec');
    const e2 = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Amit Exec', person: { inviteEmail: `amit.${Date.now()}@client.test` } }).expect(201)).body;
    otherExecutive = await acceptInvite(app, e2.inviteUrl, 'Amit Exec');
    outsider = await registerUser(app, 'Another Pop-up Org');
  });
  afterAll(async () => app.close());

  it('tells the manager and the Super Workspace when an executive adds a company, a contact and a deal', async () => {
    const company = (await api(executive).post('/companies', { name: 'Ipsos Pop-up Panel' }).expect(201)).body as { id: string };
    await api(executive).post('/contacts', { firstName: 'Nina', lastName: 'Rao', email: 'nina@ipsos-popup.test', companyId: company.id }).expect(201);
    await api(executive).post('/deals', { name: 'Ipsos brand tracker', amount: 5000, currency: 'USD', companyId: company.id, customFields: {} }).expect(201);
    await worker.drain();

    for (const watcher of [manager, superAdmin]) {
      const mine = await notes(watcher);
      expect(mine.find((n) => n.type === 'company.created')).toMatchObject({ title: 'Kunal Exec added the company Ipsos Pop-up Panel', priority: 'LOW' });
      expect(mine.find((n) => n.type === 'contact.created')?.title).toBe('Kunal Exec added the contact Nina Rao');
      expect(mine.find((n) => n.type === 'deal.created')?.title).toBe('Kunal Exec created the deal Ipsos brand tracker');
      expect(mine.find((n) => n.type === 'company.created')!.link).toContain(company.id);
    }
    // Never the person who did it, never a teammate at the same level, never another organisation.
    for (const u of [executive, otherExecutive, outsider]) expect((await notes(u)).some((n) => n.type.endsWith('.created'))).toBe(false);
  });

  it('tells nobody about the Super Workspace’s own new records, since nobody is above it', async () => {
    const before = (await notes(manager)).length;
    await api(superAdmin).post('/companies', { name: 'Top Level Co' }).expect(201);
    await worker.drain();
    expect((await notes(manager)).length).toBe(before);
  });

  it('gives a finished task its own type, so it shows as "Task completed"', async () => {
    const task = (await api(manager).post('/assigned-tasks', { title: 'Create 20 companies', workspaceId: executiveWorkspace }).expect(201)).body as { id: string };
    expect((await notes(executive)).find((n) => n.type === 'task.assigned')?.title).toBe('New task: Create 20 companies');
    await api(executive).post(`/assigned-tasks/${task.id}/progress`, { progress: 'IN_PROGRESS' }).expect(200);
    await api(executive).patch(`/assigned-tasks/${task.id}`, { status: 'DONE' }).expect(200);
    const told = await notes(manager);
    expect(told.find((n) => n.type === 'task.in_progress')?.title).toBe('Task in progress: Create 20 companies');
    expect(told.find((n) => n.type === 'task.completed')?.title).toBe('Task completed: Create 20 companies');
  });

  it('keeps each person’s pop-up preferences, with defaults, and leaves them alone when an older app saves', async () => {
    const start = (await api(executive).get('/notifications/preferences').expect(200)).body;
    expect(start).toEqual({ sound: true, volume: 40, mutedSound: [], desktop: false, popups: true, popupSeconds: 6, mutedPopups: [] });

    const saved = (await api(executive).put('/notifications/preferences', { ...start, popupSeconds: 12, mutedPopups: ['records_created', 'team_status'] }).expect(200)).body;
    expect(saved).toMatchObject({ popups: true, popupSeconds: 12, mutedPopups: ['records_created', 'team_status'] });

    // The phone app (before pop-ups) sends only the sound fields: the pop-up choices stay.
    const older = (await api(executive).put('/notifications/preferences', { sound: false, volume: 30, mutedSound: [], desktop: false }).expect(200)).body;
    expect(older).toMatchObject({ sound: false, volume: 30, popups: true, popupSeconds: 12, mutedPopups: ['records_created', 'team_status'] });

    await api(executive).put('/notifications/preferences', { ...older, popups: false }).expect(200);
    expect((await api(executive).get('/notifications/preferences').expect(200)).body.popups).toBe(false);

    // Out of range or unknown categories are refused.
    await api(executive).put('/notifications/preferences', { ...older, popupSeconds: 1 }).expect(400);
    await api(executive).put('/notifications/preferences', { ...older, mutedPopups: ['nope'] }).expect(400);
    // They are the person's own: someone else's stay at the defaults.
    expect((await api(manager).get('/notifications/preferences').expect(200)).body).toMatchObject({ popups: true, popupSeconds: 6 });
  });
});
