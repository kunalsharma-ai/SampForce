import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

/** Enhancement feature 13: churn-risk signals, trends, filters, follow-up schedule and the Retention Advisor. */
describe('customer churn prediction', () => {
  let app: INestApplication;
  let ai: AiFixture;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let viewer: TestUser;
  let other: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ai = await createAiFixture();
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_API_BASE_URL = ai.url;
    app = await startApp();
    owner = await registerUser(app, 'Churn Co');
    other = await registerUser(app, 'Elsewhere Churn');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'professional', seats: 10 } }));
    member = await inviteMember(app, owner, 'member');
    viewer = await inviteMember(app, owner, 'viewer');
    const o = api(owner);
    ids.owner = (await o.get('/auth/me').expect(200)).body.user.id;
    ids.company = (await o.post('/companies', { name: 'Globex' }).expect(201)).body.id;
    ids.otherCompany = (await o.post('/companies', { name: 'Hooli' }).expect(201)).body.id;
    ids.contact = (await o.post('/contacts', { firstName: 'Hank', lastName: 'Scorpio', companyId: ids.company }).expect(201)).body.id;
    ids.strayContact = (await o.post('/contacts', { firstName: 'Gavin', lastName: 'Belson', companyId: ids.otherCompany }).expect(201)).body.id;
    const c = (await o.post('/contracts', { name: 'Globex annual', companyId: ids.company, value: 24000, startDate: ymd(-320), endDate: ymd(45) }).expect(201)).body;
    await o.post(`/contracts/${c.id}/sign`, { signedBy: 'Hank S', signedAt: ymd(-320), method: 'wet_ink' }).expect(200);
    // Four touches 35 to 50 days ago and none since: quiet for 30+ days and engagement falling.
    for (const d of [-35, -40, -45, -50]) await o.post('/activities', { type: 'CALL', subject: `Check-in ${d}`, companyId: ids.company, occurredAt: iso(d) }).expect(201);
    const stages = (await o.get('/pipelines').expect(200)).body[0].stages as { id: string; category: string }[];
    const deal = (await o.post('/deals', { name: 'Globex expansion', amount: 8000, stageId: stages.find((s) => s.category === 'OPEN')!.id, companyId: ids.company }).expect(201)).body;
    await o.post(`/deals/${deal.id}/move`, { stageId: stages.find((s) => s.category === 'LOST')!.id, lossReason: 'Budget' }).expect(200);
    await asTenant(owner.tenantId, (tx) => tx.portalRequest.create({ data: { tenantId: owner.tenantId, companyId: ids.company!, number: 1, subject: 'Export keeps timing out', category: 'support', createdAt: new Date(Date.now() - 6 * DAY) } }));
  });
  afterAll(async () => {
    await app.close();
    await ai.close();
    for (const k of ['ANTHROPIC_API_KEY', 'AI_API_BASE_URL']) delete process.env[k];
  });

  it('adds engagement, deal history and portal requests to the explained score, with a retention plan', async () => {
    const c = (await api(member).get(`/success/customers/${ids.company}`).expect(200)).body;
    expect(c.health.signals.map((s: { key: string }) => s.key)).toEqual(['quiet_30', 'renewal_60', 'declining_engagement', 'open_requests', 'lost_deal']);
    expect(c.health).toMatchObject({ score: 40, band: 'watch' });
    expect(c.engagement).toMatchObject({ last30: 0, previous30: 4, trend: 'declining', lastInboundAt: null });
    expect(c.deals).toEqual({ won: 0, open: 0, lost90: 1 });
    expect(c.openRequests).toBe(1);
    expect(c.history).toEqual([{ day: ymd(0), score: 40 }]);
    expect(c.plan.actions.map((a: { key: string }) => a.key)).toEqual(['requests', 'check_in', 'loss_review', 'review', 'renewal']);
    expect(c.plan.cadence).toMatchObject({ everyDays: 14, touches: 3 });
  });

  it('filters customers by churn risk and owner', async () => {
    const o = api(owner);
    expect((await o.get('/success/customers?band=watch').expect(200)).body.map((r: { company: { id: string } }) => r.company.id)).toEqual([ids.company]);
    expect((await o.get('/success/customers?band=at_risk').expect(200)).body).toEqual([]);
    expect((await o.get(`/success/customers?ownerId=${member.userId}`).expect(200)).body).toEqual([]);
    expect((await o.get(`/success/customers?ownerId=${ids.owner}`).expect(200)).body).toHaveLength(1);
    await o.get('/success/customers?band=critical').expect(400);
  });

  it('shows daily risk counts and the biggest falls', async () => {
    await asTenant(owner.tenantId, (tx) => tx.companyHealthDaily.create({ data: { tenantId: owner.tenantId, companyId: ids.company!, day: new Date(`${ymd(-20)}T00:00:00Z`), score: 90, band: 'healthy' } }));
    const t = (await api(member).get('/success/trends?days=30').expect(200)).body;
    expect(t.days[0]).toEqual({ day: ymd(-20), high: 0, medium: 0, low: 1, averageScore: 90 });
    expect(t.days.at(-1)).toEqual({ day: ymd(0), high: 0, medium: 1, low: 0, averageScore: 40 });
    expect(t.movers).toEqual([{ company: { id: ids.company, name: 'Globex' }, from: 90, to: 40, band: 'watch' }]);
    await api(member).get('/success/trends?days=7').expect(400);
    expect((await api(other).get('/success/trends').expect(200)).body).toEqual({ days: [], movers: [] });
  });

  it('creates only the follow-ups the manager confirms, at 09:00 their time', async () => {
    const m = api(member);
    const body = { contactId: ids.contact, timezoneOffsetMinutes: -330, items: [{ title: 'Answer the export request', dueDate: ymd(1) }, { title: 'Renewal call', dueDate: ymd(15) }] };
    const res = (await m.post(`/success/customers/${ids.company}/follow-ups`, body).expect(201)).body;
    expect(res.created.map((t: { title: string; dueAt: string }) => [t.title, t.dueAt])).toEqual([
      ['Answer the export request', `${ymd(1)}T03:30:00.000Z`],
      ['Renewal call', `${ymd(15)}T03:30:00.000Z`],
    ]);
    const tasks = (await m.get('/tasks').expect(200)).body as { title: string; contactId: string | null; priority: string }[];
    expect(tasks.find((t) => t.title === 'Renewal call')).toMatchObject({ contactId: ids.contact, priority: 'NORMAL' });
    const noContact = (await m.post(`/success/customers/${ids.company}/follow-ups`, { contactId: null, items: [{ title: 'Internal review', dueDate: ymd(2) }] }).expect(201)).body;
    expect(noContact.created[0].title).toBe('Internal review (Globex)');
    await m.post(`/success/customers/${ids.company}/follow-ups`, { ...body, contactId: ids.strayContact }).expect(400);
    await api(viewer).post(`/success/customers/${ids.company}/follow-ups`, body).expect(403);
    await api(other).post(`/success/customers/${ids.company}/follow-ups`, { ...body, contactId: null }).expect(404);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { action: 'customer.follow_ups_created', entityId: ids.company } }));
    expect(audit).toHaveLength(2);
  });

  it('the Retention Advisor writes a briefing from the facts and creates nothing', async () => {
    const before = ((await api(member).get('/tasks').expect(200)).body as unknown[]).length;
    const b = (await api(member).post(`/success/customers/${ids.company}/retention-brief`).expect(200)).body;
    expect(b.summary).toMatch(/^Globex has medium churn risk \(\d+\/100\)/);
    expect(b.steps.length).toBeGreaterThan(0);
    expect(b.talkingPoints[0]).toMatch(/^Ask about:/);
    expect(((await api(member).get('/tasks').expect(200)).body as unknown[]).length).toBe(before);
    const run = await asTenant(owner.tenantId, (tx) => tx.aiRun.findFirst({ where: { agent: 'retention_advisor' }, orderBy: { createdAt: 'desc' } }));
    expect(run).toMatchObject({ status: 'SUCCEEDED', entityType: 'company', entityId: ids.company });
    await api(viewer).post(`/success/customers/${ids.company}/retention-brief`).expect(403);
    await api(other).post(`/success/customers/${ids.company}/retention-brief`).expect(404);
  });
});
