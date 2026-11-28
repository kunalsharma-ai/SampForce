import type { INestApplication } from '@nestjs/common';
import type { DealRow, DealsSummary, Page } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient, withDbContext } from '@dealflow/database';
import { api, appClient, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Deals redesign (ADR 0096): dashboard numbers, new deal fields, archive, duplicate guard and bulk edits. */
describe('Deals redesign', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser;
  let companyId: string;
  let stages: { id: string; name: string; category: string }[];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    db = appClient();
    owner = await registerUser(app, 'Deals Redesign Org');
    other = await registerUser(app, 'Other Redesign Org');
    rep = await inviteMember(app, owner, 'member');
    companyId = (await api(owner).post('/companies', { name: 'Globex Research' }).expect(201)).body.id;
    const pipelines = (await api(owner).get('/pipelines').expect(200)).body as { isDefault: boolean; stages: typeof stages }[];
    stages = pipelines.find((p) => p.isDefault)!.stages;
    const make = async (name: string, amount: number, extra: Record<string, unknown> = {}) => {
      const res = await api(owner).post('/deals', { name, amount, ...extra }).expect(201);
      ids[name] = res.body.id;
      return res.body as DealRow;
    };
    await make('Alpha', 10_000, { companyId, expectedCloseDate: ymd(5), priority: 'HIGH' });
    await make('Beta', 20_000, { companyId, expectedCloseDate: ymd(-3) });
    await make('Gamma', 30_000, { ownerId: rep.userId });
    await make('Won one', 40_000, { stageId: stages.find((s) => s.category === 'WON')!.id });
    await api(owner).post('/deals', { name: 'Lost one', amount: 1_000 }).expect(201).then((r) => (ids['Lost one'] = r.body.id));
    await api(owner).post(`/deals/${ids['Lost one']}/move`, { stageId: stages.find((s) => s.category === 'LOST')!.id, lossReason: 'Budget' }).expect(200);
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('adds up the dashboard from real deals', async () => {
    const s = (await api(owner).get('/deals/summary').expect(200)).body as DealsSummary;
    expect(s.total).toEqual({ count: 5, value: 101_000 });
    expect(s.open).toMatchObject({ count: 3, value: 60_000 });
    expect(s.won).toEqual({ count: 1, value: 40_000 });
    expect(s.lost).toEqual({ count: 1, value: 1_000 });
    expect(s.conversionRate).toBe(50);
    expect(s.averageWon).toBe(40_000);
    expect(s.averageOpen).toBe(20_000);
    expect(s.createdThisMonth.count).toBe(5);
    expect(s.closedThisMonth.count).toBe(2);
    expect(s.overdue).toEqual({ count: 1, value: 20_000 });
    expect(s.closingNext30Days).toEqual({ count: 1, value: 10_000 });
    expect(s.noCloseDate).toBe(1);
    expect(s.priorities).toEqual({ HIGH: 1, MEDIUM: 0, LOW: 0, NONE: 2 });
    expect(s.upcoming.map((u) => u.name)).toEqual(['Alpha']);
    expect(s.upcoming[0]!.company?.name).toBe('Globex Research');
    expect(s.byCompany.find((c) => c.ref?.id === companyId)).toMatchObject({ ref: { id: companyId, name: 'Globex Research' }, open: { count: 2, value: 30_000 } });
    expect(s.byOwner.find((o) => o.ref?.id === rep.userId)).toMatchObject({ open: { count: 1, value: 30_000 } });
    expect(s.stages.reduce((n, st) => n + st.count, 0)).toBe(5);
    expect(s.trend).toHaveLength(6);
    expect(s.trend[5]).toMatchObject({ created: 5, won: 1, lost: 1, wonValue: 40_000 });
    // A date range that ends before today leaves out this month's created, won and lost deals.
    const past = (await api(owner).get(`/deals/summary?from=2020-01-01&to=2020-12-31`).expect(200)).body as DealsSummary;
    expect(past.created.count).toBe(0);
    expect(past.won.count).toBe(0);
    expect(past.conversionRate).toBeNull();
    expect(past.open.count).toBe(3);
    // Owner filter and tenant isolation.
    const mine = (await api(rep).get('/deals/summary?ownerId=me').expect(200)).body as DealsSummary;
    expect(mine.open).toMatchObject({ count: 1, value: 30_000 });
    expect(((await api(other).get('/deals/summary').expect(200)).body as DealsSummary).total.count).toBe(0);
    await api(owner).get('/deals/summary?from=yesterday').expect(400);
  });

  it('stores source, products and notes, links an RFQ and books a follow-up', async () => {
    const rfq = (await api(owner).post('/rfqs', { companyId, projectName: 'Germany B2B panel' }).expect(201)).body as { id: string; number: string };
    const created = (await api(owner)
      .post('/deals', { name: 'Delta', amount: 5_000, companyId, source: 'Referral', products: ['Online panel', ' Online panel ', 'CATI'], notes: 'Wants a June start', rfqId: rfq.id, nextFollowUpAt: ymd(2) })
      .expect(201)).body as DealRow;
    ids.Delta = created.id;
    expect(created).toMatchObject({ source: 'Referral', products: ['Online panel', 'CATI'], notes: 'Wants a June start', archivedAt: null });
    await api(owner).post('/activities', { type: 'CALL', subject: 'Intro call', opportunityId: created.id }).expect(201);
    const got = (await api(owner).get(`/deals/${created.id}`).expect(200)).body as DealRow;
    expect(got.rfq).toEqual({ id: rfq.id, number: rfq.number, projectName: 'Germany B2B panel' });
    expect(got.nextFollowUp).toMatchObject({ title: 'Follow up: Delta' });
    expect(got.nextFollowUp!.dueAt!.slice(0, 10)).toBe(ymd(2));
    expect(got.lastActivityAt).toBeTruthy();
    expect(got.sampbidx).toBeNull();
    // The board cards carry the same extras.
    const board = (await api(owner).get('/deals/board').expect(200)).body as { columns: { deals: DealRow[] }[] };
    const card = board.columns.flatMap((c) => c.deals).find((d) => d.id === created.id)!;
    expect(card.rfq?.id).toBe(rfq.id);
    expect(card.nextFollowUp?.title).toBe('Follow up: Delta');
    // Booking the same date again does not add a second task; unlinking the RFQ works.
    await api(owner).patch(`/deals/${created.id}`, { nextFollowUpAt: ymd(2), rfqId: null, products: [] }).expect(200);
    const after = (await api(owner).get(`/deals/${created.id}`).expect(200)).body as DealRow;
    expect(after.rfq).toBeNull();
    expect(after.products).toEqual([]);
    const tasks = await withDbContext(db, { tenantId: owner.tenantId }, (tx) => tx.task.count({ where: { opportunityId: created.id } }));
    expect(tasks).toBe(1);
    // An RFQ of another company cannot be linked.
    const otherCo = (await api(owner).post('/companies', { name: 'Initech' }).expect(201)).body.id;
    const otherRfq = (await api(owner).post('/rfqs', { companyId: otherCo, projectName: 'US consumers' }).expect(201)).body.id;
    await api(owner).patch(`/deals/${created.id}`, { rfqId: otherRfq }).expect(400);
  });

  it('stops an accidental duplicate deal unless confirmed', async () => {
    const dup = await api(owner).post('/deals', { name: '  alpha ', amount: 1, companyId }).expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_DEAL');
    expect(dup.body.error.details[0].existing.id).toBe(ids.Alpha);
    // Another company, or confirmed, is fine.
    await api(owner).post('/deals', { name: 'Alpha', amount: 1 }).expect(201);
    const forced = (await api(owner).post('/deals', { name: 'Alpha', amount: 1, companyId, allowDuplicate: true }).expect(201)).body as DealRow;
    await api(owner).del(`/deals/${forced.id}`).expect(204);
  });

  it('archives and restores deals, one or many', async () => {
    const archived = (await api(owner).post(`/deals/${ids.Gamma}/archive`).expect(200)).body as DealRow;
    expect(archived.archivedAt).toBeTruthy();
    const list = (await api(owner).get('/deals?pageSize=100').expect(200)).body as Page<DealRow>;
    expect(list.items.map((d) => d.id)).not.toContain(ids.Gamma);
    const archive = (await api(owner).get('/deals?archived=true').expect(200)).body as Page<DealRow>;
    expect(archive.items.map((d) => d.id)).toEqual([ids.Gamma]);
    const board = (await api(owner).get('/deals/board').expect(200)).body as { columns: { deals: DealRow[]; total: number }[] };
    expect(board.columns.flatMap((c) => c.deals).map((d) => d.id)).not.toContain(ids.Gamma);
    expect(((await api(owner).get('/deals/summary').expect(200)).body as DealsSummary).open.count).toBe(4); // Alpha, Beta, Delta and the second Alpha with no company
    expect((await api(owner).post(`/deals/${ids.Gamma}/restore`).expect(200)).body.archivedAt).toBeNull();
    await api(other).post(`/deals/${ids.Gamma}/archive`).expect(404);

    await api(owner).post('/deals/bulk-update', { ids: [ids.Alpha, ids.Beta], archived: true }).expect(200);
    expect(((await api(owner).get('/deals?archived=true').expect(200)).body as Page<DealRow>).total).toBe(2);
    await api(owner).post('/deals/bulk-update', { ids: [ids.Alpha, ids.Beta], archived: false }).expect(200);
  });

  it('changes many deals at once', async () => {
    const two = [ids.Alpha!, ids.Beta!];
    await api(owner).post('/deals/bulk-update', { ids: two }).expect(400);
    await api(owner).post('/deals/bulk-update', { ids: two, priority: 'LOW', expectedCloseDate: ymd(20), probability: 35 }).expect(200);
    for (const id of two) {
      const d = (await api(owner).get(`/deals/${id}`).expect(200)).body as DealRow;
      expect(d).toMatchObject({ priority: 'LOW', expectedCloseDate: ymd(20), probability: 35, effectiveProbability: 35 });
    }
    // Moving to a lost stage needs a reason, which applies to every deal.
    const lost = stages.find((s) => s.category === 'LOST')!.id;
    await api(owner).post('/deals/bulk-update', { ids: two, stageId: lost }).expect(400);
    await api(owner).post('/deals/bulk-update', { ids: two, stageId: lost, lossReason: 'Went with a competitor' }).expect(200);
    const d = (await api(owner).get(`/deals/${ids.Alpha}`).expect(200)).body as DealRow;
    expect(d).toMatchObject({ status: 'LOST', lossReason: 'Went with a competitor' });
    await api(owner).post('/deals/bulk-update', { ids: two, priority: null, expectedCloseDate: null }).expect(200);
    expect(((await api(owner).get(`/deals/${ids.Beta}`).expect(200)).body as DealRow).priority).toBeNull();
    // Another workspace's deals are refused.
    await api(other).post('/deals/bulk-update', { ids: two, priority: 'HIGH' }).expect(400);
  });
});
