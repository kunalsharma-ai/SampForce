import type { INestApplication } from '@nestjs/common';
import type { DealForecast, DealHistoryItem, DealRow, PriorityDeal } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient, withDbContext } from '@dealflow/database';
import { api, appClient, inviteMember, registerUser, startApp, type TestUser } from './helpers';
import { priorityScore } from '../src/crm/deals.service';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Design spec Part 5: deal priority, health on cards, priority/forecast/calendar views and the panel's history tab. */
describe('Pipeline views and deal panel', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    db = appClient();
    owner = await registerUser(app, 'Views Org');
    other = await registerUser(app, 'Other Views Org');
    rep = await inviteMember(app, owner, 'member');
    const make = async (name: string, amount: number, expectedCloseDate: string | null, extra: Record<string, unknown> = {}) => {
      const res = await api(owner).post('/deals', { name, amount, expectedCloseDate, ...extra }).expect(201);
      ids[name] = res.body.id;
      return res.body as DealRow;
    };
    await make('Overdue big', 90_000, ymd(-5));
    await make('Closing soon', 20_000, ymd(3), { priority: 'HIGH' });
    await make('Next quarter', 40_000, ymd(100));
    await make('Undated', 5_000, null, { ownerId: rep.userId });
    await make('Calm', 10_000, ymd(45), { priority: 'LOW' });
    await withDbContext(db, { tenantId: owner.tenantId }, async (tx) => {
      await tx.dealHealthScore.create({ data: { dealId: ids['Calm']!, tenantId: owner.tenantId, health: 82, risk: 'low', signals: [], computedAt: new Date() } });
      await tx.dealHealthScore.create({ data: { dealId: ids['Next quarter']!, tenantId: owner.tenantId, health: 31, risk: 'high', signals: [], computedAt: new Date() } });
    });
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('stores priority, returns health on each deal, and records priority changes', async () => {
    const d = (await api(owner).get(`/deals/${ids['Next quarter']}`).expect(200)).body as DealRow;
    expect(d.priority).toBeNull();
    expect(d.health).toMatchObject({ score: 31, risk: 'high' });
    const updated = (await api(owner).patch(`/deals/${ids['Next quarter']}`, { priority: 'MEDIUM' }).expect(200)).body as DealRow;
    expect(updated.priority).toBe('MEDIUM');
    await api(owner).patch(`/deals/${ids['Next quarter']}`, { priority: 'URGENT' }).expect(400);
    const cleared = (await api(owner).patch(`/deals/${ids['Next quarter']}`, { priority: null }).expect(200)).body as DealRow;
    expect(cleared.priority).toBeNull();

    const history = (await api(rep).get(`/deals/${ids['Next quarter']}/history`).expect(200)).body as DealHistoryItem[];
    expect(history.map((h) => h.action)).toEqual(['deal.updated', 'deal.updated', 'deal.created']);
    expect(history[0]!.changes).toEqual({ priority: { from: 'MEDIUM', to: null } });
    expect(history[0]!.actorName).toBeTruthy();
    await api(other).get(`/deals/${ids['Next quarter']}/history`).expect(404);
  });

  it('filters the list by close date range and sorts by priority', async () => {
    const res = (await api(owner).get(`/deals?closeFrom=${ymd(0)}&closeTo=${ymd(60)}&sort=expectedCloseDate&order=asc`).expect(200)).body;
    expect(res.items.map((d: DealRow) => d.name)).toEqual(['Closing soon', 'Calm']);
    await api(owner).get('/deals?closeFrom=tomorrow').expect(400);
    const byPriority = (await api(owner).get('/deals?sort=-priority,name&pageSize=2').expect(200)).body;
    expect(byPriority.items.map((d: DealRow) => d.priority)).toEqual(['HIGH', 'LOW']);
  });

  it('ranks open deals with reasons in the priority view', async () => {
    const ranked = (await api(owner).get('/deals/priority').expect(200)).body as PriorityDeal[];
    // Overdue big 10+30+30=70, Closing soon 10+25+7+15=57, Next quarter 40+0+13=53, Undated 10+5+2=17, Calm 0+0+3=3.
    expect(ranked.map((r) => [r.deal.name, r.score])).toEqual([['Overdue big', 70], ['Closing soon', 57], ['Next quarter', 53], ['Undated', 17], ['Calm', 3]]);
    expect(ranked[0]!.reasons).toEqual(expect.arrayContaining(['Not scored yet', 'Close date passed 5 days ago', 'One of the largest open deals']));
    expect(ranked[2]!.reasons[0]).toBe('Critical: health 31');
    expect(ranked[1]!.reasons).toEqual(['Not scored yet', 'Closes in 3 days', 'Marked high priority']);
    const mine = (await api(rep).get('/deals/priority?ownerId=me').expect(200)).body as PriorityDeal[];
    expect(mine.map((r) => r.deal.name)).toEqual(['Undated']);
    expect((await api(other).get('/deals/priority').expect(200)).body).toEqual([]);
  });

  it('groups open deals by close month in the forecast view', async () => {
    const f = (await api(owner).get('/deals/forecast').expect(200)).body as DealForecast;
    const by = Object.fromEntries(f.buckets.map((b) => [b.key, b]));
    expect(f.buckets[0]!.key).toBe('overdue');
    expect(f.buckets).toHaveLength(9);
    expect(by.overdue).toMatchObject({ count: 1, value: 90_000 });
    expect(by.undated).toMatchObject({ count: 1, value: 5_000 });
    expect(f.buckets.reduce((s, b) => s + b.count, 0)).toBe(5);
    // Weighted value uses each deal's effective probability (the first stage's, here).
    const p = by.overdue!.deals[0]!.effectiveProbability;
    expect(by.overdue!.weighted).toBeCloseTo((90_000 * p) / 100, 2);
  });

  it('scores deterministically', () => {
    const base = { amount: 100, expectedCloseDate: null, priority: null, health: null } as unknown as DealRow;
    const today = Date.UTC(2026, 10, 1);
    expect(priorityScore(base, 100, today)).toEqual({ score: 10 + 5 + 30, reasons: ['Not scored yet', 'No close date', 'One of the largest open deals'] });
    expect(priorityScore({ ...base, amount: 0, expectedCloseDate: '2026-11-01', health: { score: 90, risk: 'low', computedAt: '' } }, 100, today)).toEqual({ score: 25, reasons: ['Closes today'] });
  });
});
