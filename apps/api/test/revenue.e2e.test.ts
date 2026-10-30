import type { INestApplication } from '@nestjs/common';
import { quarterPeriod } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SuccessService } from '../src/revenue/success.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Revenue analytics with exact numbers, exchange rates, targets, and rule-based customer health. */
describe('revenue analytics and customer success', () => {
  let app: INestApplication;
  let owner: TestUser;
  let ownerId: string;
  let member: TestUser & { userId: string };
  let other: TestUser;
  let base: string;
  let foreign: string;
  const period = quarterPeriod(undefined);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Revenue Co');
    other = await registerUser(app, 'Elsewhere Co');
    member = await inviteMember(app, owner, 'member');
    const o = api(owner);
    const me = (await o.get('/auth/me').expect(200)).body;
    ownerId = me.user.id;
    base = (await o.get('/tenants/current').expect(200)).body.defaultCurrency;
    foreign = base === 'EUR' ? 'GBP' : 'EUR';
    const third = base === 'JPY' ? 'CHF' : 'JPY';
    const stages = (await o.get('/pipelines').expect(200)).body[0].stages as { id: string; category: string }[];
    const open = stages.find((s) => s.category === 'OPEN')!;
    const won = stages.find((s) => s.category === 'WON')!;
    const lost = stages.find((s) => s.category === 'LOST')!;
    const deal = async (body: object, to?: { stageId: string; lossReason?: string }, as: TestUser = owner) => {
      const d = (await api(as).post('/deals', { stageId: open.id, ...body }).expect(201)).body;
      if (to) await api(as).post(`/deals/${d.id}/move`, to).expect(200);
      return d.id as string;
    };
    await deal({ name: 'Big win', amount: 10000 }, { stageId: won.id });
    await deal({ name: 'Foreign win', amount: 1000, currency: foreign }, { stageId: won.id });
    await deal({ name: 'No rate win', amount: 500, currency: third }, { stageId: won.id });
    await deal({ name: 'Member win', amount: 2000 }, { stageId: won.id }, member);
    await deal({ name: 'Lost on price', amount: 4000 }, { stageId: lost.id, lossReason: 'Price' });
    await deal({ name: 'Open in quarter', amount: 3000, expectedCloseDate: period.start });
  });
  afterAll(async () => {
    await app.close();
  });

  it('only catalogue managers set exchange rates, never for the base currency', async () => {
    await api(member).put('/analytics/exchange-rates', { currency: foreign, rate: 1.1, effectiveDate: ymd(0) }).expect(403);
    await api(owner).put('/analytics/exchange-rates', { currency: base, rate: 2, effectiveDate: ymd(0) }).expect(409);
    await api(owner).put('/analytics/exchange-rates', { currency: foreign, rate: 1.5, effectiveDate: ymd(-10) }).expect(200);
    await api(owner).put('/analytics/exchange-rates', { currency: foreign, rate: 1.1, effectiveDate: ymd(0) }).expect(200);
    const r = (await api(member).get('/analytics/exchange-rates').expect(200)).body;
    expect(r.base).toBe(base);
    expect(r.rates.map((x: { rate: number }) => x.rate)).toEqual([1.1, 1.5]);
  });

  it('sets team and per-person targets', async () => {
    await api(member).put('/analytics/targets', { period: period.label, userId: null, amount: 1 }).expect(403);
    await api(owner).put('/analytics/targets', { period: period.label, userId: null, amount: 20000 }).expect(200);
    await api(owner).put('/analytics/targets', { period: period.label, userId: ownerId, amount: 8000 }).expect(200);
    await api(owner).put('/analytics/targets', { period: period.label, userId: ownerId, amount: 10000 }).expect(200);
    const t = (await api(owner).get(`/analytics/targets?period=${period.label}`).expect(200)).body;
    expect(t.map((x: { user: { id: string } | null; amount: number }) => [x.user?.id ?? null, x.amount]).sort()).toEqual([[null, 20000], [ownerId, 10000]].sort());
  });

  it('computes exact quarter figures and reports what it could not convert', async () => {
    const a = (await api(owner).get(`/analytics/revenue?period=${period.label}`).expect(200)).body;
    expect(a.currency).toBe(base);
    // 10000 + 1000 × 1.1 (latest rate) + 2000; the deal with no rate is left out and counted.
    expect(a.won).toMatchObject({ total: 13100, deals: 3, avgDealSize: 4366.67 });
    expect(a.closed).toEqual({ won: 3, lost: 1, winRate: 75 });
    expect(a.excluded).toEqual({ noExchangeRate: 1 });
    expect(a.lossReasons).toEqual([{ reason: 'Price', deals: 1, amount: 4000 }]);
    expect(a.byMonth).toHaveLength(3);
    expect(a.byMonth.reduce((s: number, m: { won: number }) => s + m.won, 0)).toBe(13100);
    const mine = a.byOwner.find((o: { owner: { id: string } | null }) => o.owner?.id === ownerId);
    expect(mine).toMatchObject({ won: 11100, deals: 2, lost: 1, target: 10000, attainment: 111 });
    const theirs = a.byOwner.find((o: { owner: { id: string } | null }) => o.owner?.id === member.userId);
    expect(theirs).toMatchObject({ won: 2000, deals: 1, target: null, attainment: null });
    expect(a.target).toEqual({ amount: 20000, attainment: 65.5, openInPeriod: 3000, coverage: 0.43 });
    expect(a.velocity.openDeals).toBe(1);
    expect(a.bySource).toEqual([{ source: 'Direct or unknown', won: 13100, deals: 3 }]);
  });

  it('keeps analytics inside the workspace', async () => {
    const a = (await api(other).get(`/analytics/revenue?period=${period.label}`).expect(200)).body;
    expect(a.won.total).toBe(0);
    expect((await api(other).get('/analytics/targets').expect(200)).body).toEqual([]);
  });

  describe('customer health', () => {
    beforeAll(async () => {
      const o = api(owner);
      ids.company = (await o.post('/companies', { name: 'Initech' }).expect(201)).body.id;
      const c = (await o.post('/contracts', { name: 'Initech annual', companyId: ids.company, value: 12000, startDate: ymd(-345), endDate: ymd(20) }).expect(201)).body;
      ids.contract = c.id;
      await o.post(`/contracts/${c.id}/sign`, { signedBy: 'Bill L', signedAt: ymd(-345), method: 'wet_ink' }).expect(200);
    });

    it('scores health from explained signals', async () => {
      const c = (await api(member).get(`/success/customers/${ids.company}`).expect(200)).body;
      // No activity (−30) and a renewal within 30 days with none started (−25).
      expect(c.health.score).toBe(45);
      expect(c.health.band).toBe('watch');
      expect(c.health.signals.map((s: { key: string }) => s.key)).toEqual(['no_activity', 'renewal_30']);
      expect(c).toMatchObject({ activeContracts: 1, contractValue: 12000, nextRenewal: { contractId: ids.contract, daysToEnd: 20 } });
      await api(member).get(`/success/customers/${(await api(owner).post('/companies', { name: 'Prospect only' }).expect(201)).body.id}`).expect(404);
    });

    it('alerts the owner once when a customer becomes at risk, and recovers', async () => {
      const esc = (await api(member).post('/success/escalations', { companyId: ids.company, title: 'Outage complaints', severity: 'HIGH', ownerId }).expect(201)).body;
      const list = (await api(owner).get('/success/customers').expect(200)).body;
      expect(list[0]).toMatchObject({ company: { id: ids.company }, openEscalations: 1, health: { score: 25, band: 'at_risk' } });
      await app.get(SuccessService).sweep(true);
      await api(owner).get('/success/customers').expect(200);
      const alerts = ((await api(owner).get('/notifications').expect(200)).body.items as { type: string; link: string }[]).filter((n) => n.type === 'customer.churn_risk');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.link).toBe(`/app/customer-success?company=${ids.company}`);

      await api(member).post(`/success/escalations/${esc.id}/resolve`, { resolution: 'Fixed the integration' }).expect(200);
      await api(member).post(`/success/escalations/${esc.id}/resolve`, { resolution: 'again' }).expect(409);
      await api(owner).post(`/contracts/${ids.contract}/renew`).expect(200);
      await api(owner).post('/activities', { type: 'CALL', subject: 'QBR', companyId: ids.company }).expect(201);
      const after = (await api(owner).get(`/success/customers/${ids.company}`).expect(200)).body;
      expect(after.health).toMatchObject({ score: 100, band: 'healthy', signals: [] });
      const stored = await asTenant(owner.tenantId, (tx) => tx.companyHealth.findUniqueOrThrow({ where: { companyId: ids.company } }));
      expect(stored.alertedAt).toBeNull();
    });

    it('viewers can read but not open escalations; other workspaces see nothing', async () => {
      await api(other).get(`/success/customers/${ids.company}`).expect(404);
      expect((await api(other).get('/success/escalations').expect(200)).body).toEqual([]);
      await api(other).post('/success/escalations', { companyId: ids.company, title: 'x' }).expect(400);
    });
  });
});
