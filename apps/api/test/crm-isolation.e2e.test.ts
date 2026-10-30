import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, registerUser, startApp, type TestUser } from './helpers';

/**
 * Every CRM resource is checked from a second tenant: reads, lists, updates and deletes of
 * tenant A's ids must behave as "not found", and B may not link its records to A's ids.
 */
describe('CRM tenant isolation', () => {
  let app: INestApplication;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let ua: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    ua = await registerUser(app, 'Iso A');
    a = api(ua);
    b = api(await registerUser(app, 'Iso B'));
    ids.company = (await a.post('/companies', { name: 'Secret Co' }).expect(201)).body.id;
    ids.contact = (await a.post('/contacts', { firstName: 'Secret', companyId: ids.company }).expect(201)).body.id;
    ids.lead = (await a.post('/leads', { fullName: 'Secret Lead', email: 'secret@a.test' }).expect(201)).body.lead.id;
    const deal = (await a.post('/deals', { name: 'Secret Deal', companyId: ids.company }).expect(201)).body;
    ids.deal = deal.id;
    ids.pipeline = deal.pipeline.id;
    ids.stage = deal.stage.id;
    ids.activity = (await a.post('/activities', { type: 'NOTE', subject: 'Secret note', leadId: ids.lead }).expect(201)).body.id;
    ids.task = (await a.post('/tasks', { title: 'Secret task', leadId: ids.lead }).expect(201)).body.id;
    ids.field = (await a.post('/custom-fields', { entity: 'LEAD', key: 'secret', label: 'Secret', type: 'TEXT' }).expect(201)).body.id;
    ids.user = (await a.get('/auth/me').expect(200)).body.user.id;
  });
  afterAll(async () => {
    await app.close();
  });

  const resources = [
    ['companies', 'company', { name: 'x' }],
    ['contacts', 'contact', { firstName: 'x' }],
    ['leads', 'lead', { fullName: 'x' }],
    ['deals', 'deal', { name: 'x' }],
  ] as const;

  for (const [path, key, patch] of resources) {
    it(`hides ${path} from another tenant`, async () => {
      await b.get(`/${path}/${ids[key]}`).expect(404);
      await b.patch(`/${path}/${ids[key]}`, patch).expect(404);
      await b.del(`/${path}/${ids[key]}`).expect(404);
      const list = (await b.get(`/${path}`).expect(200)).body;
      expect(list.items.map((r: { id: string }) => r.id)).not.toContain(ids[key]);
      await a.get(`/${path}/${ids[key]}`).expect(200);
    });
  }

  it('hides pipelines, stages, the board and deal moves', async () => {
    const pipelines = (await b.get('/pipelines').expect(200)).body;
    expect(pipelines.map((p: { id: string }) => p.id)).not.toContain(ids.pipeline);
    await b.get(`/deals/board?pipelineId=${ids.pipeline}`).expect(404);
    await b.put(`/pipelines/${ids.pipeline}`, { name: 'x', stages: [{ name: 'W', probability: 100, category: 'WON' }, { name: 'L', probability: 0, category: 'LOST' }] }).expect(404);
    await b.del(`/pipelines/${ids.pipeline}`).expect(404);
    await b.post(`/deals/${ids.deal}/move`, { stageId: ids.stage }).expect(404);
    await b.post(`/deals/${ids.deal}/clone`).expect(404);
    const bulk = (await b.post('/deals/bulk-update', { ids: [ids.deal], stageId: ids.stage })).body;
    expect(bulk.updated ?? 0).toBe(0);
  });

  it('hides activities, tasks and custom fields', async () => {
    const acts = (await b.get(`/activities?leadId=${ids.lead}`).expect(200)).body;
    expect(acts.items).toEqual([]);
    await b.del(`/activities/${ids.activity}`).expect(404);
    const tasks = (await b.get('/tasks?scope=all').expect(200)).body;
    expect(tasks.map((t: { id: string }) => t.id)).not.toContain(ids.task);
    await b.patch(`/tasks/${ids.task}`, { status: 'DONE' }).expect(404);
    await b.del(`/tasks/${ids.task}`).expect(404);
    const fields = (await b.get('/custom-fields').expect(200)).body;
    expect(fields).toEqual([]);
    await b.del(`/custom-fields/${ids.field}`).expect(404);
    await b.post('/leads', { fullName: 'x', customFields: { secret: 'y' } }).expect(400);
  });

  it('refuses links to another tenant’s ids', async () => {
    const expectRef = async (res: { body: { error: { code: string; details: { path: string }[] } } }, path: string) => {
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.map((d) => d.path)).toContain(path);
    };
    await expectRef(await b.post('/contacts', { firstName: 'x', companyId: ids.company }).expect(400), 'companyId');
    await expectRef(await b.post('/companies', { name: 'x', parentCompanyId: ids.company }).expect(400), 'parentCompanyId');
    await expectRef(await b.post('/deals', { name: 'x', contactId: ids.contact }).expect(400), 'contactId');
    await expectRef(await b.post('/deals', { name: 'x', ownerId: ids.user }).expect(400), 'ownerId');
    await b.post('/deals', { name: 'x', pipelineId: ids.pipeline }).expect(400);
    await expectRef(await b.post('/activities', { type: 'NOTE', subject: 'x', opportunityId: ids.deal }).expect(400), 'opportunityId');
    await expectRef(await b.post('/tasks', { title: 'x', leadId: ids.lead }).expect(400), 'leadId');
    await expectRef(await b.post('/tasks', { title: 'x', assigneeId: ids.user }).expect(400), 'ownerId');
    const own = (await b.post('/leads', { fullName: 'Mine' }).expect(201)).body.lead.id;
    await expectRef(await b.post(`/leads/${own}/merge`, { duplicateId: ids.lead }).expect(400), 'duplicateId');
    await b.post(`/leads/${own}/convert`, { companyId: ids.company }).expect(400);
  });

  it('keeps search, duplicate detection and export inside the tenant', async () => {
    const hits = (await b.get('/search?q=secret').expect(200)).body;
    expect(hits).toEqual([]);
    const created = (await b.post('/leads', { fullName: 'Secret Lead', email: 'secret@a.test' }).expect(201)).body;
    expect(created.duplicates).toEqual([]);
    const csv = (await b.get('/exports/leads').expect(200)).text;
    expect(csv).not.toContain(ids.lead);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3); // header + "Mine" + the new lead
  });
});
