import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Segments with consent-aware export, hosted lead forms and campaign attribution. */
describe('marketing', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let other: TestUser;
  const ids: Record<string, string> = {};
  const pub = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Marketing Co');
    other = await registerUser(app, 'Other Co');
    member = await inviteMember(app, owner, 'member');
    const o = api(owner);
    const mk = async (body: object) => (await o.post('/leads', body).expect(201)).body.lead.id as string;
    ids.inDe = await mk({ fullName: 'Anna Opted', email: 'anna@de.test', country: 'DE', marketingConsent: 'OPTED_IN', tags: ['webinar'] });
    ids.outDe = await mk({ fullName: 'Bert Out', email: 'bert@de.test', country: 'DE', marketingConsent: 'OPTED_OUT', tags: ['webinar'] });
    ids.unkDe = await mk({ fullName: 'Carl Unknown', email: 'carl@de.test', country: 'DE', tags: ['webinar'] });
    ids.inFr = await mk({ fullName: 'Dora France', email: 'dora@fr.test', country: 'FR', marketingConsent: 'OPTED_IN' });
  });
  afterAll(async () => {
    await app.close();
  });

  describe('segments', () => {
    const rules = { match: 'all', rules: [{ field: 'country', op: 'eq', value: 'DE' }, { field: 'tags', op: 'has', value: 'webinar' }] };

    it('previews matching leads with consent counts', async () => {
      const p = (await api(member).post('/segments/preview', { entity: 'lead', rules }).expect(200)).body;
      expect(p).toMatchObject({ total: 3, optedIn: 1, optedOut: 1 });
      const any = (await api(member).post('/segments/preview', { entity: 'lead', rules: { match: 'any', rules: [{ field: 'country', op: 'eq', value: 'FR' }, { field: 'marketingConsent', op: 'eq', value: 'OPTED_OUT' }] } }).expect(200)).body;
      expect(any.sample.map((s: { name: string }) => s.name).sort()).toEqual(['Bert Out', 'Dora France']);
    });

    it('rejects rules that do not fit the field', async () => {
      const res = await api(owner).post('/segments', { name: 'Bad', entity: 'lead', rules: { match: 'all', rules: [{ field: 'country', op: 'gte', value: 3 }, { field: 'nope', op: 'eq', value: 'x' }] } }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('only marketing managers save segments; export never includes opted-out people', async () => {
      await api(member).post('/segments', { name: 'DE webinar', entity: 'lead', rules }).expect(403);
      const s = (await api(owner).post('/segments', { name: 'DE webinar', entity: 'lead', rules }).expect(201)).body;
      ids.segment = s.id;
      await api(member).get(`/segments/${s.id}/export`).expect(403);

      const optedIn = await api(owner).get(`/segments/${s.id}/export`).expect(200);
      expect(optedIn.headers['content-type']).toContain('text/csv');
      expect(optedIn.text).toContain('anna@de.test');
      expect(optedIn.text).not.toContain('carl@de.test');
      expect(optedIn.text).not.toContain('bert@de.test');

      const all = await api(owner).get(`/segments/${s.id}/export?optedInOnly=false`).expect(200);
      expect(all.text).toContain('carl@de.test');
      expect(all.text).not.toContain('bert@de.test');

      const audit = (await api(owner).get('/audit-logs?limit=20').expect(200)).body.items as { action: string; metadata: { rows: number; optedInOnly: boolean } }[];
      expect(audit.filter((a) => a.action === 'segment.exported').map((a) => [a.metadata.rows, a.metadata.optedInOnly])).toEqual([
        [2, false],
        [1, true],
      ]);
    });

    it('segments are invisible to other workspaces', async () => {
      await api(other).get(`/segments/${ids.segment}/preview`).expect(404);
      expect((await api(other).get('/segments').expect(200)).body).toEqual([]);
    });
  });

  describe('hosted forms', () => {
    beforeAll(async () => {
      ids.campaign = (await api(owner).post('/campaigns', { name: 'Autumn webinar', channel: 'webinar', status: 'ACTIVE', budget: 1000, utmCampaign: 'autumn-24' }).expect(201)).body.id;
      const form = (
        await api(owner)
          .post('/forms', {
            name: 'Webinar sign-up',
            title: 'Join the webinar',
            fields: [
              { key: 'fullName', label: 'Name', required: true },
              { key: 'email', label: 'Email', required: true },
              { key: 'message', label: 'Questions', required: false },
            ],
            consentText: 'Send me product news by email. I can unsubscribe at any time.',
            campaignId: ids.campaign,
          })
          .expect(201)
      ).body;
      ids.form = form.id;
      ids.token = form.publicToken;
    });

    it('serves only what the public page needs', async () => {
      const view = (await pub().get(`/api/v1/public/forms/${ids.token}`).expect(200)).body;
      expect(Object.keys(view).sort()).toEqual(['consentText', 'fields', 'intro', 'title']);
      await pub().get('/api/v1/public/forms/not-a-real-token-123').expect(404);
    });

    it('creates a lead with recorded consent, a note and campaign link', async () => {
      const res = await pub()
        .post(`/api/v1/public/forms/${ids.token}`)
        .set('x-forwarded-for', '203.0.113.10')
        .send({ fullName: 'Erin Visitor', email: 'Erin@Visitor.test', message: 'Is there a recording?', consent: true })
        .expect(200);
      expect(res.body.message).toMatch(/Thank you/);
      const leads = (await api(owner).get('/leads?q=erin@visitor.test').expect(200)).body.items as { id: string; marketingConsent: string; consentSource: string; campaignId: string; email: string }[];
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({ email: 'erin@visitor.test', marketingConsent: 'OPTED_IN', consentSource: 'form:Webinar sign-up', campaignId: ids.campaign });
      ids.formLead = leads[0]!.id;
      const subs = (await api(owner).get(`/forms/${ids.form}/submissions`).expect(200)).body;
      expect(subs[0]).toMatchObject({ leadId: ids.formLead, consent: true });
      expect(subs[0].data.consentText).toMatch(/product news/);
      expect(subs[0].data).not.toHaveProperty('ip');
    });

    it('repeat submissions update the open lead instead of duplicating it; unticked consent is not consent', async () => {
      await pub().post(`/api/v1/public/forms/${ids.token}`).set('x-forwarded-for', '203.0.113.11').send({ fullName: 'Frank New', email: 'frank@new.test' }).expect(200);
      await pub().post(`/api/v1/public/forms/${ids.token}`).set('x-forwarded-for', '203.0.113.11').send({ fullName: 'Frank New', email: 'frank@new.test', consent: false }).expect(200);
      const leads = (await api(owner).get('/leads?q=frank@new.test').expect(200)).body.items as { marketingConsent: string }[];
      expect(leads).toHaveLength(1);
      expect(leads[0]!.marketingConsent).toBe('UNKNOWN');
    });

    it('validates fields, traps bots and limits each address', async () => {
      const bad = await pub().post(`/api/v1/public/forms/${ids.token}`).set('x-forwarded-for', '203.0.113.12').send({ fullName: '', email: 'nope' }).expect(400);
      expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'fullName']);
      await pub().post(`/api/v1/public/forms/${ids.token}`).set('x-forwarded-for', '203.0.113.12').send({ fullName: 'Bot', email: 'bot@spam.test', website: 'http://spam' }).expect(400);
      for (let i = 0; i < 5; i++) {
        await pub().post(`/api/v1/public/forms/${ids.token}`).set('x-forwarded-for', '203.0.113.13').send({ fullName: `Flood ${i}`, email: `flood${i}@spam.test` }).expect(200);
      }
      const limited = await pub().post(`/api/v1/public/forms/${ids.token}`).set('x-forwarded-for', '203.0.113.13').send({ fullName: 'Flood 6', email: 'flood6@spam.test' }).expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
    });

    it('a deactivated form stops accepting submissions', async () => {
      const form = (await api(owner).get('/forms').expect(200)).body[0];
      await api(owner).put(`/forms/${ids.form}`, { name: form.name, title: form.title, fields: form.fields, consentText: form.consentText, active: false }).expect(200);
      await pub().get(`/api/v1/public/forms/${ids.token}`).expect(404);
      await pub().post(`/api/v1/public/forms/${ids.token}`).send({ fullName: 'Late', email: 'late@x.test' }).expect(404);
    });

    it('stored submissions cannot be edited by the app role', async () => {
      await expect(asTenant(owner.tenantId, (tx) => tx.formSubmission.updateMany({ where: { formId: ids.form }, data: { consent: true } }))).rejects.toThrow(/permission denied/);
    });
  });

  describe('campaign attribution', () => {
    it('counts leads from the form and by UTM value, and their converted deals', async () => {
      const o = api(owner);
      await o.post('/leads', { fullName: 'Gina Utm', email: 'gina@utm.test', campaignSource: 'Autumn-24', estimatedValue: 4000 }).expect(201);
      const gina = (await o.get('/leads?q=gina@utm.test').expect(200)).body.items[0];
      await o.patch(`/leads/${gina.id}`, { status: 'QUALIFIED' }).expect(200);
      const conv = (await o.post(`/leads/${gina.id}/convert`, { createDeal: true }).expect(200)).body;
      const won = (await o.get('/pipelines').expect(200)).body[0].stages.find((s: { category: string }) => s.category === 'WON');
      await o.post(`/deals/${conv.opportunityId}/move`, { stageId: won.id }).expect(200);

      const c = (await o.get(`/campaigns/${ids.campaign}`).expect(200)).body;
      // Erin, Frank and the five flood submissions came through the form; Gina carries the UTM value.
      expect(c.results).toMatchObject({ leads: 8, converted: 1, deals: 1, won: 4000, wonDeals: 1, pipeline: 0, costPerLead: 125, returnOnSpend: 4, otherCurrencyDeals: 0 });
      await api(member).post('/campaigns', { name: 'Nope', channel: 'other' }).expect(403);
      await api(other).get(`/campaigns/${ids.campaign}`).expect(404);
    });
  });
});
