import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ownerClient, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/*
 * Notification Center (ADR 0075): one store read by the bell, the home dashboard and each section, at every workspace
 * level. Real notifications from real actions (a manager assigning a task), the summary per section, live waiting,
 * section read marks, mark unread, history paging, personal sound preferences, and that nobody reads another
 * person's notifications.
 */

describe('notification center', () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let executive: TestUser & { userId: string; workspaceId: string };
  let other: TestUser;
  const db = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    superAdmin = await registerUser(app, 'Notification Center Co');
    manager = await workspacePerson(app, superAdmin, 'MANAGER', 'Rahul Sharma');
    await api(superAdmin).put(`/workspaces/${manager.workspaceId}/permissions`, { canCreateExecutives: true }).expect(200);
    executive = await workspacePerson(app, manager, 'EXECUTIVE', 'Priya Sharma');
    other = await registerUser(app, 'Someone Else Ltd');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('a task a manager assigns reaches the executive in the Tasks section, the summary and the bell', async () => {
    const before = (await api(executive).get('/notifications/summary').expect(200)).body;
    const task = (await api(manager).post('/assigned-tasks', { title: 'Call the new research leads', priority: 'HIGH', workspaceId: executive.workspaceId }).expect(201)).body;

    const summary = (await api(executive).get('/notifications/summary').expect(200)).body;
    expect(summary.unread).toBe(before.unread + 1);
    expect(summary.bySection.tasks).toBe((before.bySection.tasks ?? 0) + 1);
    expect(new Date(summary.latestAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const inTasks = (await api(executive).get('/notifications?section=tasks').expect(200)).body;
    const n = inTasks.items.find((i: { type: string }) => i.type === 'task.assigned');
    expect(n).toMatchObject({ section: 'tasks', readAt: null, title: expect.stringContaining('Call the new research leads') });
    expect(n.link).toContain('/app/tasks');
    // The same row is the one the bell lists, and nothing of it leaks to the manager who sent it.
    expect((await api(executive).get('/notifications?filter=unread').expect(200)).body.items.map((i: { id: string }) => i.id)).toContain(n.id);
    expect((await api(manager).get('/notifications').expect(200)).body.items.map((i: { id: string }) => i.id)).not.toContain(n.id);
    expect((await api(executive).get('/notifications?section=leads').expect(200)).body.items.map((i: { id: string }) => i.id)).not.toContain(n.id);
    expect(task.id).toBeTruthy();
  });

  it('waits for something new and answers as soon as it arrives', async () => {
    const { latestAt } = (await api(executive).get('/notifications/summary').expect(200)).body;
    // Nothing new: the call is held for the time asked, then answers with the same summary.
    const t0 = Date.now();
    const quiet = (await api(executive).get(`/notifications/wait?after=${encodeURIComponent(latestAt)}&wait=2`).expect(200)).body;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
    expect(quiet.latestAt).toBe(latestAt);

    // Something new while waiting: the held call answers early with it.
    const t1 = Date.now();
    const waiting = api(executive).get(`/notifications/wait?after=${encodeURIComponent(latestAt)}&wait=15`).then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    await api(manager).post('/assigned-tasks', { title: 'Send the revised quote', workspaceId: executive.workspaceId }).expect(201);
    const live = await waiting;
    expect(live.status).toBe(200);
    expect(Date.now() - t1).toBeLessThan(10_000);
    expect(new Date(live.body.latestAt).getTime()).toBeGreaterThan(new Date(latestAt).getTime());
  });

  it('marks one section read, puts one back to unread, and pages through the history', async () => {
    const tasks = (await api(executive).get('/notifications?section=tasks&filter=unread').expect(200)).body.items;
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    const res = (await api(executive).post('/notifications/read', { section: 'tasks' }).expect(200)).body;
    expect(res.updated).toBe(tasks.length);
    const after = (await api(executive).get('/notifications/summary').expect(200)).body;
    expect(after.bySection.tasks).toBeUndefined();

    await api(executive).post(`/notifications/${tasks[0].id}/unread`).expect(200);
    expect((await api(executive).get('/notifications/summary').expect(200)).body.bySection.tasks).toBe(1);
    // Someone else cannot touch it.
    expect((await api(manager).post(`/notifications/${tasks[0].id}/unread`).expect(200)).body.updated).toBe(0);
    expect((await api(other).post('/notifications/read', { ids: [tasks[0].id] }).expect(200)).body.updated).toBe(0);
    expect((await api(executive).get('/notifications/summary').expect(200)).body.bySection.tasks).toBe(1);

    const page1 = (await api(executive).get('/notifications?limit=1').expect(200)).body;
    expect(page1.items).toHaveLength(1);
    expect(page1.next).toBeTruthy();
    const page2 = (await api(executive).get(`/notifications?limit=1&before=${encodeURIComponent(page1.next)}`).expect(200)).body;
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
  });

  it('counts older notifications without a stored section by the page they open, and action-required ones', async () => {
    const id = randomUUID();
    await db.notification.create({
      data: { id, tenantId: executive.tenantId, userId: executive.userId, type: 'custom.legacy', title: 'Old lead notice', link: '/app/leads?view=mine', actionRequired: true, priority: 'URGENT', readAt: null },
    });
    const summary = (await api(executive).get('/notifications/summary').expect(200)).body;
    expect(summary.bySection.leads).toBe(1);
    expect(summary.actionRequired).toBeGreaterThanOrEqual(1);
    expect(summary.important).toBeGreaterThanOrEqual(1);
    const leads = (await api(executive).get('/notifications?section=leads').expect(200)).body.items;
    expect(leads.map((n: { id: string }) => n.id)).toEqual([id]);
    expect(leads[0].section).toBe('leads');
    expect((await api(executive).get('/notifications?filter=action').expect(200)).body.items.map((n: { id: string }) => n.id)).toContain(id);
    expect((await api(executive).get(`/notifications?link=${encodeURIComponent('/app/leads?view=mine')}`).expect(200)).body.items.map((n: { id: string }) => n.id)).toEqual([id]);
    await api(executive).post('/notifications/read', { ids: 'all' }).expect(200);
    expect((await api(executive).get('/notifications/summary').expect(200)).body).toMatchObject({ unread: 0, actionRequired: 0, bySection: {} });
  });

  it('keeps each person’s sound preferences, with safe defaults', async () => {
    expect((await api(manager).get('/notifications/preferences').expect(200)).body).toEqual({ sound: true, volume: 40, mutedSound: [], desktop: false });
    const saved = (await api(manager).put('/notifications/preferences', { sound: true, volume: 25, mutedSound: ['deal_won', 'other', 'deal_won'], desktop: true }).expect(200)).body;
    expect(saved).toEqual({ sound: true, volume: 25, mutedSound: ['deal_won', 'other'], desktop: true });
    // Personal: the executive keeps the defaults.
    expect((await api(executive).get('/notifications/preferences').expect(200)).body.volume).toBe(40);
    await api(manager).put('/notifications/preferences', { sound: true, volume: 250, mutedSound: [], desktop: false }).expect(400);
    await api(manager).put('/notifications/preferences', { sound: true, volume: 20, mutedSound: ['not_a_category'], desktop: false }).expect(400);
    expect((await api(manager).get('/notifications/preferences').expect(200)).body.volume).toBe(25);
  });
});
