import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, registerUser, startApp, type TestUser } from './helpers';

describe('core CRM', () => {
  let app: INestApplication;
  let u: TestUser;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await startApp();
    u = await registerUser(app, 'CRM Co', { plan: 'free' });
    http = api(u);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('companies and contacts', () => {
    it('creates, lists, updates and soft-deletes with counts', async () => {
      const company = (await http.post('/companies', { name: 'Acme Corp', domain: 'acme.test', country: 'us' }).expect(201)).body;
      expect(company.country).toBe('US');
      const contact = (await http.post('/contacts', { firstName: 'Ada', lastName: 'Lovelace', email: 'ADA@acme.test', companyId: company.id }).expect(201)).body;
      expect(contact.email).toBe('ada@acme.test');
      expect(contact.company).toEqual({ id: company.id, name: 'Acme Corp' });

      const got = (await http.get(`/companies/${company.id}`).expect(200)).body;
      expect(got.contactCount).toBe(1);

      const list = (await http.get('/contacts?q=lovelace').expect(200)).body;
      expect(list.items.map((c: { id: string }) => c.id)).toEqual([contact.id]);

      await http.patch(`/contacts/${contact.id}`, { jobTitle: 'CTO' }).expect(200);
      await http.del(`/contacts/${contact.id}`).expect(204);
      await http.get(`/contacts/${contact.id}`).expect(404);
    });

    it('rejects a company that is its own parent and invalid input', async () => {
      const c = (await http.post('/companies', { name: 'Loop Ltd' }).expect(201)).body;
      await http.patch(`/companies/${c.id}`, { parentCompanyId: c.id }).expect(400);
      const bad = await http.post('/contacts', { firstName: '', email: 'nope' }).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('leads', () => {
    it('flags duplicates on create and merges them', async () => {
      const first = (await http.post('/leads', { fullName: 'Grace Hopper', email: 'grace@navy.test', tags: ['a'] }).expect(201)).body;
      expect(first.duplicates).toEqual([]);
      const second = (await http.post('/leads', { fullName: 'G. Hopper', email: 'Grace@navy.test', phone: '+1 555 0100', tags: ['b'] }).expect(201)).body;
      expect(second.duplicates).toEqual([expect.objectContaining({ id: first.lead.id, reason: 'email', entity: 'lead' })]);

      const merged = (await http.post(`/leads/${first.lead.id}/merge`, { duplicateId: second.lead.id }).expect(200)).body;
      expect(merged.phone).toBe('+1 555 0100');
      expect(merged.tags.sort()).toEqual(['a', 'b']);
      await http.get(`/leads/${second.lead.id}`).expect(404);
    });

    it('refuses unqualified leads and converts others into a contact, company and deal', async () => {
      const lead = (await http.post('/leads', { fullName: 'Katherine Johnson', companyName: 'Orbit Inc', email: 'kj@orbit.test', estimatedValue: 12000 }).expect(201)).body.lead;
      await http.patch(`/leads/${lead.id}`, { status: 'UNQUALIFIED' }).expect(200);
      const refused = await http.post(`/leads/${lead.id}/convert`, {}).expect(400);
      expect(refused.body.error.code).toBe('LEAD_UNQUALIFIED');

      await http.patch(`/leads/${lead.id}`, { status: 'QUALIFIED' }).expect(200);
      await http.post('/activities', { type: 'CALL', subject: 'Discovery call', leadId: lead.id }).expect(201);
      const result = (await http.post(`/leads/${lead.id}/convert`, { createDeal: true }).expect(200)).body;
      expect(result.contactId).toBeTruthy();
      expect(result.companyId).toBeTruthy();
      expect(result.opportunityId).toBeTruthy();

      const contact = (await http.get(`/contacts/${result.contactId}`).expect(200)).body;
      expect(contact).toMatchObject({ firstName: 'Katherine', lastName: 'Johnson', company: { name: 'Orbit Inc' } });
      const deal = (await http.get(`/deals/${result.opportunityId}`).expect(200)).body;
      expect(deal).toMatchObject({ amount: 12000, status: 'OPEN', sourceLeadId: lead.id });
      const acts = (await http.get(`/activities?contactId=${result.contactId}`).expect(200)).body;
      expect(acts.items.map((a: { subject: string }) => a.subject)).toContain('Discovery call');

      const after = await http.patch(`/leads/${lead.id}`, { fullName: 'Changed' }).expect(409);
      expect(after.body.error.code).toBe('LEAD_CONVERTED');
      await http.post(`/leads/${lead.id}/convert`, {}).expect(409);
    });

    it('assigns a lead only to a member of the workspace', async () => {
      const lead = (await http.post('/leads', { fullName: 'Assign Me' }).expect(201)).body.lead;
      const me = (await http.get('/auth/me').expect(200)).body;
      await http.post(`/leads/${lead.id}/assign`, { ownerId: me.user.id }).expect(200);
      await http.post(`/leads/${lead.id}/assign`, { ownerId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    });
  });

  describe('pipelines and deals', () => {
    it('serves the default pipeline board and moves deals between stages', async () => {
      const pipelines = (await http.get('/pipelines').expect(200)).body;
      const pipeline = pipelines.find((p: { isDefault: boolean }) => p.isDefault);
      const open = pipeline.stages.filter((s: { category: string }) => s.category === 'OPEN');
      const won = pipeline.stages.find((s: { category: string }) => s.category === 'WON');
      const lost = pipeline.stages.find((s: { category: string }) => s.category === 'LOST');

      const deal = (await http.post('/deals', { name: 'Big deal', amount: 5000 }).expect(201)).body;
      expect(deal.stage.id).toBe(open[0].id);

      await http.post(`/deals/${deal.id}/move`, { stageId: open[1].id }).expect(200);
      const board = (await http.get('/deals/board').expect(200)).body;
      const col = board.columns.find((c: { stage: { id: string } }) => c.stage.id === open[1].id);
      expect(col.deals.map((d: { id: string }) => d.id)).toContain(deal.id);
      expect(col.value).toBeGreaterThanOrEqual(5000);

      const noReason = await http.post(`/deals/${deal.id}/move`, { stageId: lost.id }).expect(400);
      expect(noReason.body.error.details[0].path).toBe('lossReason');
      const lostDeal = (await http.post(`/deals/${deal.id}/move`, { stageId: lost.id, lossReason: 'Budget cut' }).expect(200)).body;
      expect(lostDeal).toMatchObject({ status: 'LOST', lossReason: 'Budget cut' });
      expect(lostDeal.closedAt).toBeTruthy();

      const reopened = (await http.post(`/deals/${deal.id}/move`, { stageId: won.id }).expect(200)).body;
      expect(reopened.status).toBe('WON');

      await http.patch(`/deals/${deal.id}`, { stageId: open[0].id }).expect(400);
      const logs = (await http.get('/audit-logs?limit=100').expect(200)).body;
      expect(logs.items.some((l: { action: string; entityId: string }) => l.action === 'deal.stage_changed' && l.entityId === deal.id)).toBe(true);
    });

    it('enforces the plan pipeline limit on the free plan', async () => {
      const res = await http
        .post('/pipelines', {
          name: 'Partners',
          stages: [
            { name: 'Talk', probability: 10 },
            { name: 'Won', probability: 100, category: 'WON' },
            { name: 'Lost', probability: 0, category: 'LOST' },
          ],
        })
        .expect(403);
      expect(res.body.error.code).toBe('PLAN_LIMIT');
    });

    it('refuses to delete a stage that still has deals', async () => {
      const [pipeline] = (await http.get('/pipelines').expect(200)).body;
      const deal = (await http.post('/deals', { name: 'Stage keeper' }).expect(201)).body;
      const stages = pipeline.stages.filter((s: { id: string }) => s.id !== deal.stage.id);
      const res = await http.put(`/pipelines/${pipeline.id}`, { name: pipeline.name, stages }).expect(409);
      expect(res.body.error.code).toBe('STAGE_IN_USE');
    });

    it('clones and bulk-reassigns deals', async () => {
      const deal = (await http.post('/deals', { name: 'Template deal', amount: 100 }).expect(201)).body;
      const clone = (await http.post(`/deals/${deal.id}/clone`).expect(201)).body;
      expect(clone.name).toContain('Template deal');
      const me = (await http.get('/auth/me').expect(200)).body;
      const res = (await http.post('/deals/bulk-update', { ids: [deal.id, clone.id], ownerId: me.user.id }).expect(200)).body;
      expect(res.updated).toBe(2);
    });
  });

  describe('custom fields', () => {
    it('validates values against the definitions', async () => {
      await http.post('/custom-fields', { entity: 'LEAD', key: 'tier', label: 'Tier', type: 'SELECT', options: ['Gold', 'Silver'] }).expect(201);
      await http.post('/custom-fields', { entity: 'LEAD', key: 'seats', label: 'Seats', type: 'NUMBER' }).expect(201);
      const dupe = await http.post('/custom-fields', { entity: 'LEAD', key: 'tier', label: 'Tier again', type: 'TEXT' }).expect(409);
      expect(dupe.body.error.code).toBe('DUPLICATE_KEY');

      const ok = (await http.post('/leads', { fullName: 'Custom', customFields: { tier: 'Gold', seats: '25' } }).expect(201)).body.lead;
      expect(ok.customFields).toEqual({ tier: 'Gold', seats: 25 });
      const bad = await http.post('/leads', { fullName: 'Custom', customFields: { tier: 'Bronze', unknown: 1 } }).expect(400);
      expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['customFields.tier', 'customFields.unknown']);
    });
  });

  describe('activities, tasks and search', () => {
    it('requires a related record for an activity', async () => {
      await http.post('/activities', { type: 'NOTE', subject: 'Orphan' }).expect(400);
    });

    it('lists my open tasks with an overdue flag and completes them', async () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const task = (await http.post('/tasks', { title: 'Send proposal', dueAt: past }).expect(201)).body;
      expect(task.overdue).toBe(true);
      const mine = (await http.get('/tasks?scope=mine').expect(200)).body;
      expect(mine.map((t: { id: string }) => t.id)).toContain(task.id);
      const done = (await http.patch(`/tasks/${task.id}`, { status: 'DONE' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'DONE', overdue: false });
      expect(done.completedAt).toBeTruthy();
      const doneList = (await http.get('/tasks?status=DONE').expect(200)).body;
      expect(doneList.map((t: { id: string }) => t.id)).toContain(task.id);
    });

    it('searches across record types, treating wildcards literally', async () => {
      await http.post('/companies', { name: 'Zephyr Analytics' }).expect(201);
      await http.post('/leads', { fullName: 'Zephyr Lead' }).expect(201);
      const hits = (await http.get('/search?q=zephyr').expect(200)).body;
      expect(hits.map((h: { entity: string }) => h.entity).sort()).toEqual(['company', 'lead']);
      const wild = (await http.get('/search?q=%25%25').expect(200)).body;
      expect(wild).toEqual([]);
    });
  });
});
