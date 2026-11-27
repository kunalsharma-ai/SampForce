import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Deleting every record a list shows at once, beyond each list's page or cap (ADR 0096). */
describe('delete all on every other list', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let companyId: string;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Delete All Co');
    http = api(owner);
    companyId = (await http.post('/companies', { name: 'Sweep Panels' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  const audits = (entityType: string) =>
    asTenant(owner.tenantId, (tx) => tx.auditLog.count({ where: { tenantId: owner.tenantId, action: 'records.bulk_delete', entityType } }));

  it('deletes every RFQ the register shows, on every page, and only those', async () => {
    for (let i = 0; i < 105; i++) await http.post('/rfqs', { companyId, projectName: `Sweep study ${i}` }).expect(201);
    await http.post('/rfqs', { companyId, projectName: 'Keeper study' }).expect(201);
    expect((await http.get('/rfqs?q=sweep').expect(200)).body.total).toBe(105);
    expect((await http.post('/rfqs/delete-all/count', { query: { q: 'sweep' } }).expect(200)).body).toEqual({ count: 105 });

    // A password is required, and a stale count changes nothing.
    expect((await http.post('/rfqs/delete-all', { query: { q: 'sweep' }, expected: 105 }).expect(403)).body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    expect((await http.postConfirmed('/rfqs/delete-all', { query: { q: 'sweep' }, expected: 100 }).expect(409)).body.error.code).toBe('SELECTION_CHANGED');
    expect((await http.get('/rfqs?q=sweep').expect(200)).body.total).toBe(105);

    expect((await http.postConfirmed('/rfqs/delete-all', { query: { q: 'sweep' }, expected: 105 }).expect(200)).body).toEqual({ updated: 105, failed: [] });
    expect((await http.get('/rfqs?q=sweep').expect(200)).body.total).toBe(0);
    expect((await http.get('/rfqs?q=keeper').expect(200)).body.total).toBe(1);
    expect(await audits('rfqs')).toBe(1);
    // A bad filter is refused before anything is deleted.
    await http.postConfirmed('/rfqs/delete-all', { query: { status: 'NOT_A_STATUS' }, expected: 1 }).expect(400);
  }, 120_000);

  it('deletes every task past the list cap of 200 (seen 200 at a time), and every activity on every page', async () => {
    // Through the API, as people add them (205: past the task list's cap of 200).
    for (let i = 0; i < 205; i++) await http.post('/tasks', { title: `Sweep task ${i}` }).expect(201);
    const done = (await http.post('/tasks', { title: 'Done task' }).expect(201)).body.id as string;
    await http.patch(`/tasks/${done}`, { status: 'DONE' }).expect(200);
    // The count shown before confirming is every match, not the 200 the list shows.
    const open = (await http.post('/tasks/delete-all/count', { query: { scope: 'mine', status: 'OPEN' } }).expect(200)).body.count as number;
    expect((await http.get('/tasks?scope=mine&status=OPEN').expect(200)).body).toHaveLength(200);
    const tasksRes = await http.postConfirmed('/tasks/delete-all', { query: { scope: 'mine', status: 'OPEN' }, expected: open });
    expect(tasksRes.status, JSON.stringify(tasksRes.body)).toBe(200);
    expect(tasksRes.body.updated).toBe(open);
    expect(open).toBeGreaterThanOrEqual(205);
    expect((await http.get('/tasks?scope=mine&status=OPEN').expect(200)).body).toHaveLength(0);
    expect((await http.get('/tasks?scope=mine&status=DONE').expect(200)).body).toHaveLength(1);

    for (let i = 0; i < 105; i++) await http.post('/activities', { type: 'NOTE', subject: `Sweep note ${i}`, companyId }).expect(201);
    const total = (await http.get(`/activities?companyId=${companyId}`).expect(200)).body.total as number;
    expect(total).toBeGreaterThanOrEqual(105);
    const actRes = await http.postConfirmed('/activities/delete-all', { query: { companyId }, expected: total });
    expect(actRes.status, JSON.stringify(actRes.body)).toBe(200);
    expect(actRes.body.updated).toBe(total);
    expect((await http.get(`/activities?companyId=${companyId}`).expect(200)).body.total).toBe(0);
    expect(await audits('tasks')).toBe(1);
    expect(await audits('activities')).toBe(1);
  }, 120_000);

  it('deletes every follow-up in the chosen category, every quote draft and every meeting note', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    for (let i = 0; i < 6; i++) await http.post('/follow-ups', { companyId, type: 'CALL', title: `Sweep call ${i}`, dueAt: tomorrow }).expect(201);
    const upcoming = (await http.get('/follow-ups?scope=mine&bucket=upcoming').expect(200)).body as unknown[];
    expect(upcoming.length).toBeGreaterThanOrEqual(6);
    const res = await http.postConfirmed('/follow-ups/delete-all', { query: { scope: 'mine', bucket: 'upcoming' }, expected: upcoming.length }).expect(200);
    expect(res.body.updated).toBe(upcoming.length);
    expect((await http.get('/follow-ups?scope=mine&bucket=upcoming').expect(200)).body).toHaveLength(0);

    const pipeline = ((await http.get('/pipelines').expect(200)).body as { isDefault: boolean; stages: { id: string; category: string }[] }[]).find((p) => p.isDefault)!;
    const stageId = pipeline.stages.find((s) => s.category === 'OPEN')!.id;
    await http.post('/catalog/price-books', { name: 'Standard USD', currency: 'USD', isDefault: true }).expect(201);
    for (let i = 0; i < 3; i++) {
      const deal = (await http.post('/deals', { name: `Sweep deal ${i}`, amount: 1000, currency: 'USD', stageId, customFields: {} }).expect(201)).body.id as string;
      const qr = await http.post('/quotes', { opportunityId: deal });
      expect(qr.status, JSON.stringify(qr.body)).toBe(201);
    }
    const quotes = (await http.get('/quotes').expect(200)).body as unknown[];
    expect((await http.postConfirmed('/quotes/delete-all', { query: {}, expected: quotes.length }).expect(200)).body).toEqual({ updated: quotes.length, failed: [] });
    expect((await http.get('/quotes').expect(200)).body).toHaveLength(0);

    for (let i = 0; i < 4; i++) await http.post('/meeting-records', { title: `Sweep meeting ${i}` }).expect(201);
    const meetings = (await http.get('/meeting-records').expect(200)).body as unknown[];
    expect((await http.postConfirmed('/meeting-records/delete-all', { query: {}, expected: meetings.length }).expect(200)).body.updated).toBe(meetings.length);
    expect((await http.get('/meeting-records').expect(200)).body).toHaveLength(0);
  }, 120_000);

  it('needs write access, and never reaches another workspace', async () => {
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).postConfirmed('/rfqs/delete-all', { query: {}, expected: 1 }).expect(403);
    await api(viewer).postConfirmed('/tasks/delete-all', { query: { scope: 'all', status: 'DONE' }, expected: 1 }).expect(403);

    const other = await registerUser(app, 'Other Delete Co');
    // The other workspace has no RFQs: our one RFQ is neither counted nor deleted.
    await api(other).postConfirmed('/rfqs/delete-all', { query: {}, expected: 1 }).expect(409);
    expect((await http.get('/rfqs?q=keeper').expect(200)).body.total).toBe(1);
  }, 60_000);
});
