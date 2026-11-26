import type { INestApplication } from '@nestjs/common';
import type { AchievementPage, AchievementRow, AchievementSettingsView, AchievementSummary, SampbidxTransferRow } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SBX, startSampbidxFixture, type SampbidxFixture } from './fixtures/sampbidx-fixture';
import { api, inviteMember, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Achievements and celebrations (ADR 0090): each is recorded once, only after the business change it celebrates is
 * confirmed, handed to one browser tab once (a refresh never replays it), and kept in the person's history.
 */
describe('achievements', () => {
  let app: INestApplication;
  let sbx: SampbidxFixture;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let wonStageId: string;
  let openStageId: string;
  const db = ownerClient();
  let n = 0;

  const claim = async (u: TestUser) => (await api(u).post('/achievements/claim', {}).expect(200)).body as AchievementRow[];
  const history = async (u: TestUser) => ((await api(u).get('/achievements?limit=100').expect(200)).body as AchievementPage).items;
  const kinds = (rows: AchievementRow[]) => rows.map((r) => r.kind).sort();
  const company = async (u: TestUser & { userId: string }, name: string, extra: Record<string, unknown> = { website: `https://${name.toLowerCase().replace(/[^a-z]/g, '')}.example` }) =>
    (await api(u).post('/companies', { name, ownerId: u.userId, ...extra }).expect(201)).body as { id: string };

  beforeAll(async () => {
    sbx = await startSampbidxFixture();
    app = await startApp();
    owner = await registerUser(app, 'Celebration Research');
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    const pipeline = ((await api(owner).get('/pipelines').expect(200)).body as { isDefault: boolean; stages: { id: string; category: string }[] }[]).find((p) => p.isDefault)!;
    wonStageId = pipeline.stages.find((s) => s.category === 'WON')!.id;
    openStageId = pipeline.stages.find((s) => s.category === 'OPEN')!.id;
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
    await sbx.close();
  });

  it('starts with celebrations on, sound off, and nothing earned', async () => {
    const s = (await api(rep).get('/achievements/settings').expect(200)).body as AchievementSettingsView;
    expect(s).toMatchObject({ enabled: true, style: 'EXPRESSIVE', sound: false, reduceMotion: false, mutedCategories: [], dailyLeadTarget: null, assigned: { dailyLeads: null } });
    expect(await claim(rep)).toEqual([]);
    expect(await history(rep)).toEqual([]);
    await api(rep).put('/achievements/settings', { sound: 'loud' }).expect(400);
    await api(rep).put('/achievements/settings', { unknown: true }).expect(400);
  });

  it('celebrates a company converted into a deal once, and a refresh or a second win never repeats it', async () => {
    const c = await company(rep, 'Northwind Panels');
    await api(rep).post('/deals', { name: 'Northwind tracker', amount: 4200, currency: 'USD', companyId: c.id, stageId: openStageId, customFields: {} }).expect(201);
    const won = (await api(rep).post(`/companies/${c.id}/won`).expect(200)).body as { deal: { id: string } };

    const got = await claim(rep);
    // The conversion, and the first won deal as a milestone.
    expect(kinds(got)).toEqual(['DEALS_WON_MILESTONE', 'DEAL_CONVERTED']);
    const conv = got.find((a) => a.kind === 'DEAL_CONVERTED')!;
    expect(conv).toMatchObject({ category: 'deals', level: 'MAJOR', link: `/app/deals/${won.deal.id}`, details: { companyName: 'Northwind Panels', dealName: 'Northwind tracker', amount: 4200, currency: 'USD' } });
    expect(conv.details.stage).toBeTruthy();
    expect(got.find((a) => a.kind === 'DEALS_WON_MILESTONE')!.details).toMatchObject({ count: 1 });

    // Refreshing the page claims again: nothing comes back, but the history keeps both, marked shown.
    expect(await claim(rep)).toEqual([]);
    const h = await history(rep);
    expect(h).toHaveLength(2);
    expect(h.every((a) => a.shownAt)).toBe(true);
    expect((await api(rep).get(`/achievements/${conv.id}`).expect(200)).body).toMatchObject({ id: conv.id, kind: 'DEAL_CONVERTED' });

    // Winning it again, or editing the deal, records nothing new.
    await api(rep).post(`/companies/${c.id}/won`).expect(200);
    await api(rep).patch(`/deals/${won.deal.id}`, { name: 'Northwind tracker (renamed)' }).expect(200);
    expect(await history(rep)).toHaveLength(2);

    // Nobody else sees it.
    await api(other).get(`/achievements/${conv.id}`).expect(404);
    expect(await history(other)).toEqual([]);
  });

  it('hands each pop-up to one browser tab only', async () => {
    const c = await company(rep, 'Fabrikam Survey Labs');
    await api(rep).post(`/companies/${c.id}/won`).expect(200);
    const [a, b] = await Promise.all([claim(rep), claim(rep)]);
    expect([...a, ...b].filter((x) => x.kind === 'DEAL_CONVERTED')).toHaveLength(1);
  });

  it('celebrates an RFQ only after SampBidx confirms it, never on a failed send, and once per RFQ', async () => {
    const ip = `198.51.100.${++n}`;
    await owner.agent.post('/api/v1/apps/sampbidx/keys').set('origin', ORIGIN).set('x-forwarded-for', ip).send({ baseUrl: `${sbx.url}/api`, apiKey: SBX.key }).expect(200);
    const res = (await api(rep).post('/company-leads', { company: { name: 'Acme Panels', country: 'IN', ownerId: rep.userId }, employees: [{ firstName: 'Priya', lastName: 'Nair', emails: [{ value: 'priya@acmepanels.example' }] }] }).expect(201)).body;
    const rfq = (await api(rep).post('/rfqs', { companyId: res.company.id, contactId: res.employeeIds[0], projectName: 'India B2B IT decision makers' }).expect(201)).body as { id: string; number: string };
    await api(rep).patch(`/rfqs/${rfq.id}`, { methodology: 'Online survey', market: 'IN', sampleSize: 400, loi: 15, ir: 20, cpi: 12.5, deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }).expect(200);
    await claim(rep);

    // SampBidx is down: the transfer fails, so nothing is celebrated or recorded.
    sbx.failNext(1);
    const failed = (await api(rep).post('/apps/sampbidx/transfers/rfq', { rfqId: rfq.id }).expect(200)).body as SampbidxTransferRow;
    expect(failed.delivery).toBe('FAILED');
    expect(await claim(rep)).toEqual([]);
    expect((await history(rep)).some((a) => a.kind === 'RFQ_SUBMITTED')).toBe(false);

    // The retry goes through: now it counts, with SampBidx's own reference.
    const sent = (await api(rep).post(`/apps/sampbidx/transfers/${failed.id}/retry`, {}).expect(200)).body as SampbidxTransferRow;
    expect(sent.delivery).toBe('SENT');
    const got = await claim(rep);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'RFQ_SUBMITTED', category: 'rfqs', link: `/app/rfqs?open=${rfq.id}`, details: { rfqNumber: rfq.number, rfqTitle: 'India B2B IT decision makers', companyName: 'Acme Panels', destination: 'SampBidx', reference: sent.remoteId } });

    // Sending the same RFQ again is not a second achievement.
    await api(rep).post('/apps/sampbidx/transfers/rfq', { rfqId: rfq.id, resend: true }).expect(200);
    expect((await history(rep)).filter((a) => a.kind === 'RFQ_SUBMITTED')).toHaveLength(1);
  });

  it('gives a small effect for an important task and a bigger one when every task due today is done', async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const plain = (await api(other).post('/tasks', { title: 'Tidy notes', dueAt: soon, assigneeId: other.userId }).expect(201)).body;
    const high = (await api(other).post('/tasks', { title: 'Call the client back', priority: 'HIGH', dueAt: soon, assigneeId: other.userId }).expect(201)).body;

    // An ordinary task gets nothing.
    await api(other).patch(`/tasks/${plain.id}`, { status: 'DONE' }).expect(200);
    expect(await claim(other)).toEqual([]);

    // The high-priority one is the last due today: both the small check and the "all done" celebration.
    await api(other).patch(`/tasks/${high.id}`, { status: 'DONE' }).expect(200);
    const got = await claim(other);
    expect(kinds(got)).toEqual(['ALL_TASKS_DONE', 'TASK_IMPORTANT']);
    expect(got.find((a) => a.kind === 'TASK_IMPORTANT')).toMatchObject({ level: 'ROUTINE', details: { taskTitle: 'Call the client back', priority: 'HIGH' } });
    expect(got.find((a) => a.kind === 'ALL_TASKS_DONE')).toMatchObject({ level: 'DAILY', details: { tasksDone: 2, onTime: true } });

    // Reopening and finishing it again records nothing new.
    await api(other).patch(`/tasks/${high.id}`, { status: 'OPEN' }).expect(200);
    await api(other).patch(`/tasks/${high.id}`, { status: 'DONE' }).expect(200);
    expect(await claim(other)).toEqual([]);
    expect(await history(other)).toHaveLength(2);
  });

  it('tracks the daily lead target with 25, 50 and 75 percent milestones, counting only valid, new companies', async () => {
    const lead = await inviteMember(app, owner, 'member');
    await api(lead).put('/achievements/settings', { dailyLeadTarget: 4 }).expect(200);

    await company(lead, 'Alpha Insights');
    expect((await claim(lead)).map((a) => [a.kind, a.details.percent])).toEqual([['LEAD_MILESTONE', 25]]);

    // Incomplete (no website, email, phone or LinkedIn) and repeated companies do not count.
    await company(lead, 'Bare Name Only', {});
    await company(other, 'Zeta Fieldwork', { domain: 'zetafield.example' });
    await company(lead, 'Zeta Fieldwork Copy', { domain: 'zetafield.example' });
    await company(lead, 'Alpha Insights', { website: 'https://alpha-again.example' });
    expect(await claim(lead)).toEqual([]);
    let summary = (await api(lead).get('/achievements/summary').expect(200)).body as AchievementSummary;
    expect(summary.leads.today).toMatchObject({ target: 4, targetSource: 'PERSONAL', actual: 1, percent: 25, remaining: 3, notCounted: 3 });

    await company(lead, 'Beta Panels');
    expect((await claim(lead)).map((a) => a.details.percent)).toEqual([50]);
    await company(lead, 'Gamma Field');
    expect((await claim(lead)).map((a) => a.details.percent)).toEqual([75]);
    await company(lead, 'Delta Research');
    const done = await claim(lead);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ kind: 'LEAD_TARGET', level: 'DAILY', details: { period: 'DAY', target: 4, actual: 4, percent: 100, remaining: 0 } });

    // Raising the target moves the milestones with it: 4 of 8 is 50 percent.
    await api(lead).put('/achievements/settings', { dailyLeadTarget: 8 }).expect(200);
    await company(lead, 'Epsilon Data');
    expect((await claim(lead)).map((a) => [a.kind, a.details.percent, a.details.target])).toEqual([['LEAD_MILESTONE', 50, 8]]);
    summary = (await api(lead).get('/achievements/summary').expect(200)).body as AchievementSummary;
    expect(summary.totals.dailyLeadTargets).toBe(1);
    expect(summary.badges.find((b) => b.key === 'quota-reached')).toMatchObject({ progress: 1, goal: 1 });
    expect(summary.badges.find((b) => b.key === 'quota-reached')!.earnedAt).toBeTruthy();
  });

  it('celebrates a personal monthly sales target and a major deal from the won deal itself', async () => {
    const seller = await inviteMember(app, owner, 'member');
    await api(seller).put('/achievements/settings', { monthlyRevenueTarget: 10_000, majorDealAmount: 8000 }).expect(200);
    const small = (await api(seller).post('/deals', { name: 'Small wave', amount: 3000, currency: 'USD', stageId: openStageId, customFields: {} }).expect(201)).body;
    await api(seller).post(`/deals/${small.id}/move`, { stageId: wonStageId }).expect(200);
    expect(kinds(await claim(seller))).toEqual(['DEALS_WON_MILESTONE']);

    const big = (await api(seller).post('/deals', { name: 'National tracker', amount: 9000, currency: 'USD', stageId: openStageId, customFields: {} }).expect(201)).body;
    await api(seller).post(`/deals/${big.id}/move`, { stageId: wonStageId }).expect(200);
    const got = await claim(seller);
    expect(kinds(got)).toEqual(['MAJOR_DEAL', 'SALES_TARGET']);
    expect(got.find((a) => a.kind === 'SALES_TARGET')).toMatchObject({ level: 'MAJOR', details: { metric: 'REVENUE', period: 'MONTH', target: 10_000, actual: 12_000, targetSource: 'PERSONAL' } });
    expect(got.find((a) => a.kind === 'MAJOR_DEAL')).toMatchObject({ level: 'EXCEPTIONAL', details: { amount: 9000, dealName: 'National tracker' } });

    // Reopening and winning the deal again does not repeat any of them.
    await api(seller).post(`/deals/${big.id}/move`, { stageId: openStageId }).expect(200);
    await api(seller).post(`/deals/${big.id}/move`, { stageId: wonStageId }).expect(200);
    expect(await claim(seller)).toEqual([]);
  });

  it('keeps achievements in the history but shows no pop-up for a switched-off category or when celebrations are off', async () => {
    const quiet = await inviteMember(app, owner, 'member');
    await api(quiet).put('/achievements/settings', { mutedCategories: ['deals', 'deals'] }).expect(200);
    expect(((await api(quiet).get('/achievements/settings').expect(200)).body as AchievementSettingsView).mutedCategories).toEqual(['deals']);
    const c = await company(quiet, 'Quiet Co');
    await api(quiet).post(`/companies/${c.id}/won`).expect(200);
    expect(kinds(await claim(quiet))).toEqual(['DEALS_WON_MILESTONE']);
    expect(kinds(await history(quiet))).toEqual(['DEALS_WON_MILESTONE', 'DEAL_CONVERTED']);
    expect((await history(quiet)).find((a) => a.kind === 'DEAL_CONVERTED')!.celebrate).toBe(false);

    await api(quiet).put('/achievements/settings', { enabled: false, mutedCategories: [] }).expect(200);
    const t = (await api(quiet).post('/tasks', { title: 'Board pack', priority: 'HIGH', assigneeId: quiet.userId }).expect(201)).body;
    await api(quiet).patch(`/tasks/${t.id}`, { status: 'DONE' }).expect(200);
    expect(await claim(quiet)).toEqual([]);
    expect((await history(quiet)).some((a) => a.kind === 'TASK_IMPORTANT')).toBe(true);
  });

  it('recognises a steady working day without rewarding overwork or counting breaks against it', async () => {
    const steady = await inviteMember(app, owner, 'member');
    const day = async (hours: number, opts: { away?: boolean } = {}) => {
      await api(steady).post('/availability/check-in', {}).expect(200);
      const s = await db.workSession.findFirstOrThrow({ where: { userId: steady.userId, checkedOutAt: null } });
      const start = new Date(Date.now() - hours * 3_600_000);
      // A planned 30-minute lunch break.
      await db.workSession.update({ where: { id: s.id }, data: { checkedInAt: start, breaks: [{ start: new Date(start.getTime() + 3_600_000).toISOString(), end: new Date(start.getTime() + 5_400_000).toISOString() }] } });
      if (opts.away) await db.availabilityEvent.create({ data: { tenantId: owner.tenantId, userId: steady.userId, sessionId: s.id, kind: 'AWAY_ENDED', status: 'WORKING', at: new Date() } });
      await api(steady).post('/availability/check-out', {}).expect(200);
      return s.id;
    };
    // Twelve hours is overwork: never rewarded.
    const long = await day(12);
    expect(await claim(steady)).toEqual([]);
    // An unplanned interruption (Away) means no recognition.
    await db.workSession.update({ where: { id: long }, data: { checkedInAt: new Date(Date.now() - 86_400_000) } });
    await day(6, { away: true });
    expect(await claim(steady)).toEqual([]);
    // A steady six-hour day with a lunch break is recognised, once.
    await day(6);
    const got = await claim(steady);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'CONSISTENCY', category: 'consistency', details: { breaks: 1, breakMinutes: 30 } });
    expect(got[0]!.details.workedMinutes).toBeGreaterThanOrEqual(5 * 60);
    await day(6);
    expect(await claim(steady)).toEqual([]);
  });

  it('logs coming back from automatic Away as an unplanned interruption', async () => {
    const p = await inviteMember(app, owner, 'member');
    await api(p).post('/availability/check-in', {}).expect(200);
    const s = await db.workSession.findFirstOrThrow({ where: { userId: p.userId, checkedOutAt: null } });
    await db.workSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date(Date.now() - 20 * 60_000) } });
    await api(p).post('/availability/beat', {}).expect(200);
    expect(await db.availabilityEvent.count({ where: { sessionId: s.id, kind: 'AWAY_ENDED' } })).toBe(1);
    await api(p).post('/availability/beat', {}).expect(200);
    expect(await db.availabilityEvent.count({ where: { sessionId: s.id, kind: 'AWAY_ENDED' } })).toBe(1);
  });

  it('pages through the history newest first and filters by category', async () => {
    const all = await history(rep);
    const first = (await api(rep).get('/achievements?limit=2').expect(200)).body as AchievementPage;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (await api(rep).get(`/achievements?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`).expect(200)).body as AchievementPage;
    expect([...first.items, ...second.items].map((a) => a.id)).toEqual(all.slice(0, 4).map((a) => a.id));
    const rfqs = (await api(rep).get('/achievements?category=rfqs').expect(200)).body as AchievementPage;
    expect(rfqs.items.every((a) => a.category === 'rfqs')).toBe(true);
    await request(app.getHttpServer()).get('/api/v1/achievements').expect(401);
  });
});
