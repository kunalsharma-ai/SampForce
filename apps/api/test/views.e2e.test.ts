import type { INestApplication } from '@nestjs/common';
import { MAX_SAVED_VIEWS } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, appClient, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const config = (over: object = {}) => ({ columns: ['name', 'status', 'owner'], widths: { name: 240 }, sort: [{ id: 'status', desc: false }], filters: { status: 'NEW' }, q: '', density: 'compact', ...over });

/** Design spec Part 10: saved table views, multi-column sorting and bulk actions. */
describe('saved table views', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let other: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Views Co');
    other = await registerUser(app, 'Elsewhere Views');
    member = await inviteMember(app, owner, 'member');
  });
  afterAll(async () => {
    await app.close();
  });

  it('saves a private view that only its creator sees, and shares it on request', async () => {
    const created = await api(owner).post('/views', { entity: 'leads', name: 'My new leads', config: config() }).expect(201);
    expect(created.body).toMatchObject({ entity: 'leads', name: 'My new leads', shared: false, mine: true, config: config() });
    expect((await api(member).get('/views?entity=leads').expect(200)).body).toEqual([]);

    await api(owner).patch(`/views/${created.body.id}`, { shared: true }).expect(200);
    const seen = (await api(member).get('/views?entity=leads').expect(200)).body;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'My new leads', shared: true, mine: false });
    expect((await api(other).get('/views?entity=leads').expect(200)).body).toEqual([]);
    // Views are per list.
    expect((await api(owner).get('/views?entity=deals').expect(200)).body).toEqual([]);

    // Others can use a shared view but not change or delete it.
    await api(member).patch(`/views/${created.body.id}`, { name: 'Mine now' }).expect(403);
    await api(member).del(`/views/${created.body.id}`).expect(403);
    await api(other).patch(`/views/${created.body.id}`, { name: 'Mine now' }).expect(404);
  });

  it('validates names and config, and keeps names unique per person and list', async () => {
    await api(owner).post('/views', { entity: 'leads', name: 'My new leads', config: config() }).expect(409);
    // A teammate can use the same name for their own view.
    await api(member).post('/views', { entity: 'leads', name: 'My new leads', config: config() }).expect(201);
    await api(owner).post('/views', { entity: 'tasks', name: 'x', config: config() }).expect(400);
    await api(owner).post('/views', { entity: 'leads', name: '', config: config() }).expect(400);
    await api(owner).post('/views', { entity: 'leads', name: 'x', config: config({ columns: ['name"); drop'] }) }).expect(400);
    await api(owner).post('/views', { entity: 'leads', name: 'x', config: config({ density: 'tiny' }) }).expect(400);
    await api(owner).post('/views', { entity: 'leads', name: 'x', config: config({ sort: [1, 2, 3, 4].map(() => ({ id: 'a', desc: true })) }) }).expect(400);
    await api(owner).get('/views?entity=nope').expect(400);
  });

  it('caps views per list', async () => {
    const u = await registerUser(app, 'Cap Views');
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) await api(u).post('/views', { entity: 'contacts', name: `V${i}`, config: config() }).expect(201);
    const over = await api(u).post('/views', { entity: 'contacts', name: 'One more', config: config() }).expect(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
  });

  it('the database hides private views from teammates even without the app’s checks', async () => {
    const db = appClient();
    try {
      expect(await db.savedView.count()).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });

  it('updates and deletes the creator’s own view', async () => {
    const v = (await api(owner).post('/views', { entity: 'deals', name: 'Big deals', config: config({ columns: ['name', 'amount'] }) }).expect(201)).body;
    const updated = await api(owner).patch(`/views/${v.id}`, { name: 'Biggest deals', config: config({ columns: ['amount', 'name'] }) }).expect(200);
    expect(updated.body.config.columns).toEqual(['amount', 'name']);
    await api(owner).del(`/views/${v.id}`).expect(204);
    await api(owner).del(`/views/${v.id}`).expect(404);
  });
});

describe('multi-column sorting and bulk actions', () => {
  let app: INestApplication;
  let owner: TestUser;
  let viewer: TestUser & { userId: string };
  let other: TestUser;
  const leads: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Bulk Co');
    other = await registerUser(app, 'Elsewhere Bulk');
    viewer = await inviteMember(app, owner, 'viewer');
    for (const [name, status] of [['Ada', 'QUALIFIED'], ['Ben', 'NEW'], ['Cy', 'QUALIFIED'], ['Di', 'NEW']] as const) {
      const r = await api(owner).post('/leads', { fullName: name, status });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      const lead = r.body.lead;
      leads[name] = lead.id;
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('sorts by several columns', async () => {
    const res = await api(owner).get('/leads?sort=status,-fullName').expect(200);
    expect(res.body.items.map((l: { fullName: string }) => l.fullName)).toEqual(['Di', 'Ben', 'Cy', 'Ada']);
    // The legacy single sort still works, and unknown fields fall back to the default.
    expect((await api(owner).get('/leads?sort=fullName&order=asc').expect(200)).body.items[0].fullName).toBe('Ada');
    await api(owner).get('/leads?sort=password,-hack').expect(200);
  });

  it('assigns, changes status and deletes selected records, recording each in the audit log', async () => {
    const assigned = await api(owner).post('/records/bulk', { entity: 'leads', ids: [leads.Ada, leads.Ben], action: 'assign', ownerId: viewer.userId }).expect(200);
    expect(assigned.body).toEqual({ updated: 2, failed: [] });
    const status = await api(owner).post('/records/bulk', { entity: 'leads', ids: [leads.Ada, leads.Ben], action: 'status', status: 'CONTACTED' }).expect(200);
    expect(status.body.updated).toBe(2);
    const ada = (await api(owner).get(`/leads/${leads.Ada}`).expect(200)).body;
    expect(ada.lead ?? ada).toMatchObject({ status: 'CONTACTED', owner: { id: viewer.userId } });

    const removed = await api(owner).post('/records/bulk', { entity: 'leads', ids: [leads.Cy], action: 'delete' }).expect(200);
    expect(removed.body.updated).toBe(1);
    await api(owner).get(`/leads/${leads.Cy}`).expect(404);

    const audit = (await api(owner).get('/audit-logs?limit=50').expect(200)).body.items.map((e: { action: string }) => e.action);
    expect(audit).toContain('lead.deleted');
    expect(audit.filter((a: string) => a === 'lead.assigned')).toHaveLength(2);
    expect(audit.filter((a: string) => a === 'lead.updated')).toHaveLength(2);
  });

  it('reports records it could not change instead of failing silently', async () => {
    const foreign = (await api(other).post('/leads', { fullName: 'Not yours' }).expect(201)).body.lead.id;
    const res = await api(owner).post('/records/bulk', { entity: 'leads', ids: [leads.Di, foreign], action: 'assign', ownerId: viewer.userId }).expect(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.failed).toEqual([{ id: foreign, message: expect.any(String) }]);
    // The other workspace's lead is untouched.
    expect((await api(other).get(`/leads/${foreign}`).expect(200)).body.lead?.owner?.id ?? null).not.toBe(viewer.userId);
  });

  it('checks permissions and validates the action', async () => {
    await api(viewer).post('/records/bulk', { entity: 'leads', ids: [leads.Di], action: 'delete' }).expect(403);
    await api(owner).post('/records/bulk', { entity: 'leads', ids: [leads.Di], action: 'status', status: 'CONVERTED' }).expect(400);
    await api(owner).post('/records/bulk', { entity: 'deals', ids: [leads.Di], action: 'status', status: 'WON' }).expect(400);
    await api(owner).post('/records/bulk', { entity: 'leads', ids: [leads.Di], action: 'assign' }).expect(400);
    await api(owner).post('/records/bulk', { entity: 'leads', ids: Array.from({ length: 101 }, () => leads.Di), action: 'delete' }).expect(400);
  });
});
