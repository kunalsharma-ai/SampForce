import type { INestApplication } from '@nestjs/common';
import type { DealHealthRow, DealHealthSummary, InsightFeed, NextActionList, RecordIntelligence, TimelinePage } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DealHealthService } from '../src/intelligence/deal-health.service';
import { api, appClient, asTenant, inviteMember, ownerClient, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Enhancement Phase 1: deal health monitor, next best actions, the 360° timeline and the insights feed. */
describe('sales intelligence', () => {
  let app: INestApplication;
  let owner: TestUser;
  let ownerId: string;
  let other: TestUser;
  let openStage: string;
  let riskyDeal: string;
  const admin = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Signals Co');
    other = await registerUser(app, 'Elsewhere Co');
    ownerId = (await api(owner).get('/auth/me').expect(200)).body.user.id;
    const stages = (await api(owner).get('/pipelines').expect(200)).body[0].stages as { id: string; category: string }[];
    openStage = stages.find((s) => s.category === 'OPEN')!.id;
    // No contact, close date passed, nothing logged, no task: 100 - 25 - 25 - 10 - 5 = 35, high risk.
    riskyDeal = (await api(owner).post('/deals', { name: 'Quiet Renewal', amount: 5000, stageId: openStage, expectedCloseDate: ymd(-3) }).expect(201)).body.id;
    // A healthy one: recent activity, an open task, a contact, a future close date.
    const contact = (await api(owner).post('/contacts', { firstName: 'Hana', lastName: 'Healthy', email: 'hana@buyer.test' }).expect(201)).body.id;
    const fine = (await api(owner).post('/deals', { name: 'Busy Expansion', amount: 8000, stageId: openStage, expectedCloseDate: ymd(20), contactId: contact }).expect(201)).body.id;
    await api(owner).post('/activities', { type: 'CALL', subject: 'Scoping call', opportunityId: fine }).expect(201);
    await api(owner).post('/tasks', { title: 'Send pricing', opportunityId: fine, dueAt: new Date(Date.now() + 2 * DAY).toISOString() }).expect(201);
  });

  afterAll(async () => {
    await admin.$disconnect();
    await app.close();
  });

  it('scores every open deal, alerts the owner once, and publishes an automation event', async () => {
    const summary = (await api(owner).post('/deal-health/refresh').expect(200)).body as DealHealthSummary;
    expect(summary.counts).toEqual({ low: 1, medium: 0, high: 1 });
    expect(summary.unscored).toBe(0);

    const high = (await api(owner).get('/deal-health?risk=high').expect(200)).body as DealHealthRow[];
    expect(high).toHaveLength(1);
    expect(high[0]!.deal.name).toBe('Quiet Renewal');
    expect(high[0]!.health).toBe(35);
    expect(high[0]!.signals.map((s) => s.key).sort()).toEqual(['close_date_passed', 'no_activity', 'no_contact', 'no_next_step']);

    // Second sweep: still high, no second alert.
    await app.get(DealHealthService).sweep(true);
    const notes = (await api(owner).get('/notifications').expect(200)).body.items as { type: string; link: string }[];
    expect(notes.filter((n) => n.type === 'deal.health_dropped')).toHaveLength(1);
    const events = await asTenant(owner.tenantId, (tx) => tx.domainEvent.findMany({ where: { type: 'deal.health_dropped' } }));
    expect(events.map((e) => e.entityId)).toEqual([riskyDeal]);

    // A task and a logged call lift it out of high risk; the alert resets so a later drop alerts again.
    await api(owner).post('/tasks', { title: 'Call the buyer', opportunityId: riskyDeal, dueAt: new Date(Date.now() + DAY).toISOString() }).expect(201);
    await api(owner).post('/activities', { type: 'CALL', subject: 'Checked in', opportunityId: riskyDeal }).expect(201);
    await api(owner).post('/deal-health/refresh').expect(200);
    const detail = (await api(owner).get(`/deals/${riskyDeal}/health`).expect(200)).body;
    // 100 - 25 (close date passed) - 5 (no contact) = 70.
    expect(detail.current).toMatchObject({ health: 70, risk: 'low' });
    expect(detail.history).toHaveLength(1);
    const stored = await asTenant(owner.tenantId, (tx) => tx.dealHealthScore.findUnique({ where: { dealId: riskyDeal } }));
    expect(stored?.alertedAt).toBeNull();
  });

  it('keeps deal health inside the workspace', async () => {
    await api(other).get(`/deals/${riskyDeal}/health`).expect(404);
    expect((await api(other).get('/deal-health').expect(200)).body).toEqual([]);
    const o = await asTenant(other.tenantId, (tx) => tx.dealHealthScore.count());
    expect(o).toBe(0);
  });

  it('ranks next best actions with reasons, turns one into a task, and remembers dismissals', async () => {
    const lead = (await api(owner).post('/leads', { fullName: 'Nia New', email: 'nia@buyer.test' }).expect(201)).body.lead.id as string;
    await admin.lead.update({ where: { id: lead }, data: { createdAt: new Date(Date.now() - 3 * DAY) } });
    const overdueTask = (await api(owner).post('/tasks', { title: 'Overdue follow-up', dueAt: new Date(Date.now() - 2 * DAY).toISOString() }).expect(201)).body.id;

    const list = (await api(owner).get('/next-actions').expect(200)).body as NextActionList;
    const kinds = list.items.map((i) => i.kind);
    expect(kinds).toContain('overdue_task');
    expect(kinds).toContain('new_lead_untouched');
    expect(kinds).toContain('close_date_passed');
    // Sorted by priority; one item per record.
    expect(list.items.map((i) => i.priority)).toEqual([...list.items.map((i) => i.priority)].sort((a, b) => b - a));
    expect(new Set(list.items.map((i) => `${i.record.type}:${i.record.id}`)).size).toBe(list.items.length);
    const overdue = list.items.find((i) => i.kind === 'overdue_task')!;
    expect(overdue.record.id).toBe(overdueTask);
    expect(overdue.reason).toMatch(/Overdue by 2 days/);

    const newLead = list.items.find((i) => i.kind === 'new_lead_untouched')!;
    const { taskId } = (await api(owner).post('/next-actions/accept', { key: newLead.key, title: 'Call Nia', dueInDays: 0 }).expect(200)).body;
    const task = (await api(owner).get(`/tasks?scope=mine`).expect(200)).body.find((t: { id: string }) => t.id === taskId);
    expect(task.title).toBe('Call Nia');
    await api(owner).post('/next-actions/accept', { key: newLead.key, title: 'Again', dueInDays: 0 }).expect(400);

    await api(owner).post('/next-actions/dismiss', { key: overdue.key, days: 3 }).expect(200);
    const after = (await api(owner).get('/next-actions').expect(200)).body as NextActionList;
    expect(after.items.find((i) => i.key === overdue.key)).toBeUndefined();
    expect(after.items.find((i) => i.key === newLead.key)).toBeUndefined();
    expect(after.dismissed).toBe(2);
    expect(after.outcomes).toEqual({ accepted30: 1, tasksDone: 0, engaged: 0, dismissed30: 1 });
    // The accepted suggestion led somewhere: the task got done and the lead saw new activity.
    await api(owner).patch(`/tasks/${taskId}`, { status: 'DONE' }).expect(200);
    await api(owner).post('/activities', { type: 'CALL', subject: 'Spoke to Nia', leadId: lead }).expect(201);
    expect(((await api(owner).get('/next-actions').expect(200)).body as NextActionList).outcomes).toEqual({ accepted30: 1, tasksDone: 1, engaged: 1, dismissed30: 1 });

    // A record page asks for that record's actions, whoever owns it; the risky deal shows up there.
    const focused = (await api(owner).get(`/next-actions?recordType=deal&recordId=${riskyDeal}`).expect(200)).body as NextActionList;
    expect(focused.outcomes).toBeNull();
    expect(focused.items.length).toBeGreaterThan(0);
    expect(focused.items.every((i) => i.record.type === 'deal' && i.record.id === riskyDeal)).toBe(true);
    await api(owner).get(`/next-actions?recordType=widget&recordId=${riskyDeal}`).expect(400);

    // Dismissals are personal.
    const member = await inviteMember(app, owner, 'member');
    const { withDbContext } = await import('@dealflow/database');
    const db = appClient();
    try {
      expect(await withDbContext(db, { tenantId: owner.tenantId, userId: member.userId }, (tx) => tx.nextActionDecision.count())).toBe(0);
      expect(await withDbContext(db, { tenantId: owner.tenantId, userId: ownerId }, (tx) => tx.nextActionDecision.count())).toBe(2);
    } finally {
      await db.$disconnect();
    }
    expect(((await api(member).get('/next-actions').expect(200)).body as NextActionList).items).toEqual([]);
  });

  it('merges a company timeline from its contacts, deals and activity, newest first', async () => {
    const company = (await api(owner).post('/companies', { name: 'Timeline Ltd' }).expect(201)).body.id;
    const contact = (await api(owner).post('/contacts', { firstName: 'Tom', lastName: 'Line', email: 'tom@timeline.test', companyId: company }).expect(201)).body.id;
    const deal = (await api(owner).post('/deals', { name: 'Timeline pilot', amount: 1200, stageId: openStage, companyId: company, contactId: contact }).expect(201)).body.id;
    await api(owner).post('/activities', { type: 'NOTE', subject: 'Met Tom at the expo', contactId: contact, occurredAt: new Date(Date.now() - 2 * DAY).toISOString() }).expect(201);
    await api(owner).post('/activities', { type: 'CALL', subject: 'Pilot scoping', opportunityId: deal }).expect(201);

    const page = (await api(owner).get(`/timeline/company/${company}`).expect(200)).body as TimelinePage;
    const titles = page.items.map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(['Call: Pilot scoping', 'Note: Met Tom at the expo', 'Timeline Ltd was added', 'Started in ' + titles.find((t) => t.startsWith('Started in '))!.slice(11)]));
    expect(page.items.map((i) => i.at)).toEqual([...page.items.map((i) => i.at)].sort().reverse());
    const note = page.items.find((i) => i.title === 'Note: Met Tom at the expo')!;
    expect(note.about).toEqual({ type: 'contact', id: contact, name: 'Tom Line' });
    expect(note.actor?.id).toBe(ownerId);

    // Paging and kind filters.
    const first = (await api(owner).get(`/timeline/company/${company}?limit=2`).expect(200)).body as TimelinePage;
    expect(first.items).toHaveLength(2);
    const second = (await api(owner).get(`/timeline/company/${company}?limit=2&before=${encodeURIComponent(first.nextBefore!)}`).expect(200)).body as TimelinePage;
    expect(second.items.every((i) => i.at < first.nextBefore!)).toBe(true);
    const onlyNotes = (await api(owner).get(`/timeline/contact/${contact}?kinds=activity`).expect(200)).body as TimelinePage;
    expect(onlyNotes.items.map((i) => i.kind)).toEqual(['activity']);
    await api(owner).get(`/timeline/contact/${contact}?kinds=nonsense`).expect(400);

    await api(other).get(`/timeline/company/${company}`).expect(404);
    await api(owner).get(`/timeline/widget/${company}`).expect(400);
  });

  it('gives a record its engagement, buying signals, senior people and account value', async () => {
    const company = (await api(owner).post('/companies', { name: 'Signals Account' }).expect(201)).body.id;
    const vp = (await api(owner).post('/contacts', { firstName: 'Vera', lastName: 'Vp', jobTitle: 'VP Sales', companyId: company }).expect(201)).body.id;
    await api(owner).post('/contacts', { firstName: 'Ian', lastName: 'Intern', jobTitle: 'Intern', companyId: company }).expect(201);
    await api(owner).post('/deals', { name: 'Signals pilot', amount: 3000, stageId: openStage, companyId: company, contactId: vp }).expect(201);
    await api(owner).post('/activities', { type: 'CALL', subject: 'Intro', contactId: vp }).expect(201);

    const intel = (await api(owner).get(`/intelligence/company/${company}`).expect(200)).body as RecordIntelligence;
    expect(intel.engagement.last30).toBeGreaterThanOrEqual(1);
    expect(intel.decisionMakers!.map((m) => m.name)).toEqual(['Vera Vp']);
    expect(intel.account).toMatchObject({ companyId: company, companyName: 'Signals Account', openPipeline: 3000, wonTotal: 0, wonDeals: 0 });
    const contactView = (await api(owner).get(`/intelligence/contact/${vp}`).expect(200)).body as RecordIntelligence;
    expect(contactView.account?.companyId).toBe(company);
    await api(other).get(`/intelligence/company/${company}`).expect(404);
  });

  it('summarises the week with numbers that come from records', async () => {
    const feed = (await api(owner).get('/insights?scope=mine').expect(200)).body as InsightFeed;
    const keys = feed.items.map((i) => i.key);
    expect(keys).toContain('pipeline_created');
    expect(keys).toContain('close_date_passed');
    const created = feed.items.find((i) => i.key === 'pipeline_created')!;
    // Quiet Renewal 5,000 + Busy Expansion 8,000 + Timeline pilot 1,200 + Signals pilot 3,000, all in the default currency.
    expect(created.metric).toEqual({ current: 17200, previous: 0, unit: 'money' });
    expect(feed.items[0]!.tone).toBe('attention');
    const team = (await api(other).get('/insights?scope=team').expect(200)).body as InsightFeed;
    expect(team.items.find((i) => i.key === 'pipeline_created')!.metric!.current).toBe(0);
  });
});
