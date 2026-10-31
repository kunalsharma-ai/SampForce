import type { INestApplication } from '@nestjs/common';
import { forecastPeriod, quarterPeriod } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Enhancement feature 10: forecast planning. Settings, win history, targets and gaps, risks and trends. */
describe('forecast planning', () => {
  let app: INestApplication;
  let u: TestUser;
  const h = () => api(u);
  const q = quarterPeriod(undefined);
  let stages: { id: string; name: string; category: string; probability: number }[];
  let open: { id: string; probability: number };
  let second: { id: string; probability: number };
  let rep: TestUser & { userId: string };

  beforeAll(async () => {
    app = await startApp();
    u = await registerUser(app, 'Plan Co');
    rep = await inviteMember(app, u, 'member');
    stages = (await h().get('/pipelines').expect(200)).body[0].stages;
    const opens = stages.filter((s) => s.category === 'OPEN');
    open = opens[0]!;
    second = opens[1]!;
    const won = stages.find((s) => s.category === 'WON')!;
    const lost = stages.find((s) => s.category === 'LOST')!;
    // History: four deals passed through the first stage this quarter; three were won, one lost.
    for (let i = 0; i < 4; i++) {
      const d = (await h().post('/deals', { name: `History ${i}`, amount: 1000, stageId: open.id, expectedCloseDate: q.start }).expect(201)).body;
      if (i < 3) await h().post(`/deals/${d.id}/move`, { stageId: won.id }).expect(200);
      else await h().post(`/deals/${d.id}/move`, { stageId: lost.id, lossReason: 'Price' }).expect(200);
    }
    await h().post('/deals', { name: 'Open in first stage', amount: 10000, stageId: open.id, expectedCloseDate: q.start }).expect(201);
    await h().post('/deals', { name: 'Own probability', amount: 20000, probability: 65, stageId: open.id, expectedCloseDate: q.start }).expect(201);
    await h().post('/deals', { name: 'Second stage', amount: 4000, stageId: second.id, expectedCloseDate: q.start }).expect(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts from the default assumptions and only managers change them', async () => {
    const s = (await h().get('/forecast/settings').expect(200)).body;
    expect(s).toMatchObject({ method: 'stage', commitThreshold: 70, bestCaseThreshold: 30, historyMonths: 12, minSample: 10, updatedBy: null });
    await api(rep).put('/forecast/settings', { ...s, commitThreshold: 50 }).expect(403);
    await h().put('/forecast/settings', { method: 'stage', commitThreshold: 30, bestCaseThreshold: 40, historyMonths: 12, minSample: 10 }).expect(400);
  });

  it('uses the stage win history when the sample is large enough, and never overrides a deal probability', async () => {
    let plan = (await h().get('/forecast/plan').expect(200)).body;
    const rate = plan.stageRates.find((r: { stageId: string }) => r.stageId === open.id);
    expect(rate).toMatchObject({ won: 3, lost: 1, rate: 75, usable: false });
    expect(plan.probabilitySources).toEqual({ deal: 1, stage: 2, history: 0 });

    const saved = (await h().put('/forecast/settings', { method: 'history', commitThreshold: 70, bestCaseThreshold: 30, historyMonths: 12, minSample: 3 }).expect(200)).body;
    expect(saved.updatedBy).not.toBeNull();
    plan = (await h().get('/forecast/plan').expect(200)).body;
    expect(plan.probabilitySources).toEqual({ deal: 1, stage: 1, history: 1 });
    const f = (await h().get('/forecast').expect(200)).body;
    const line = (n: string) => f.lines.find((l: { name: string }) => l.name === n);
    expect(line('Open in first stage')).toMatchObject({ probability: 75, probabilitySource: 'history', category: 'commit' });
    expect(line('Own probability')).toMatchObject({ probability: 65, probabilitySource: 'deal', category: 'best_case' });
    expect(line('Second stage')).toMatchObject({ probability: second.probability, probabilitySource: 'stage' });
    expect(f.method).toBe('historical-win-rate-v1');

    const audit = await asTenant(u.tenantId, (tx) => tx.auditLog.findFirst({ where: { action: 'forecast.settings_changed' } }));
    expect(audit).not.toBeNull();
  });

  it('moves deals between categories when managers change the thresholds, and snapshots still recompute exactly', async () => {
    await h().put('/forecast/settings', { method: 'history', commitThreshold: 60, bestCaseThreshold: 20, historyMonths: 12, minSample: 3 }).expect(200);
    const f = (await h().get('/forecast').expect(200)).body;
    expect(f.assumptions).toEqual({ commit: 60, bestCase: 20 });
    expect(f.lines.find((l: { name: string }) => l.name === 'Own probability').category).toBe('commit');
    const s = (await h().post('/forecast/snapshots', { label: 'After change' }).expect(201)).body;
    expect(s.assumptions).toEqual({ commit: 60, bestCase: 20 });
    expect((await h().get(`/forecast/snapshots/${s.id}/verify`).expect(200)).body.matches).toBe(true);
  });

  it('compares the forecast with targets, derives month and year targets, and shows owners with only a target', async () => {
    await h().put('/analytics/targets', { period: q.label, userId: null, amount: 60000 }).expect(200);
    await h().put('/analytics/targets', { period: q.label, userId: rep.userId, amount: 9000 }).expect(200);
    const plan = (await h().get('/forecast/plan').expect(200)).body;
    expect(plan.target).toEqual({ amount: 60000, source: 'set' });
    expect(plan.totals.won).toBe(3000);
    expect(plan.attainment).toBe(5);
    expect(plan.gap.worst).toBe(57000);
    expect(plan.gap.base).toBeCloseTo(60000 - plan.totals.base, 2);
    expect(plan.coverage).toBeCloseTo((10000 + 20000 + 4000) / 57000, 2);
    const repRow = plan.byOwner.find((o: { owner: { id: string } | null }) => o.owner?.id === rep.userId);
    expect(repRow).toMatchObject({ target: { amount: 9000, source: 'set' }, gap: 9000, attainment: 0 });

    const month = `${q.start.slice(0, 7)}`;
    const m = (await h().get(`/forecast/plan?period=${month}`).expect(200)).body;
    expect(m.period).toEqual(forecastPeriod(month));
    expect(m.target).toEqual({ amount: 20000, source: 'share_of_quarter' });
    const y = (await h().get(`/forecast/plan?period=${q.start.slice(0, 4)}`).expect(200)).body;
    expect(y.period.granularity).toBe('year');
    expect(y.target).toEqual({ amount: 60000, source: 'from_parts' });
    await h().put('/analytics/targets', { period: q.start.slice(0, 4), userId: null, amount: 250000 }).expect(200);
    expect((await h().get(`/forecast/plan?period=${q.start.slice(0, 4)}`).expect(200)).body.target).toEqual({ amount: 250000, source: 'set' });
    await h().get('/forecast/plan?period=2026-13').expect(400);
  });

  it('lists risks in the period: overdue close dates and deals with no recent activity', async () => {
    const plan = (await h().get('/forecast/plan').expect(200)).body;
    expect(plan.risks.stale.count).toBe(3);
    expect(plan.risks.stale.deals[0]).toMatchObject({ name: 'Own probability', detail: 'No activity logged' });
    if (new Date().toISOString().slice(0, 10) > q.start) expect(plan.risks.overdue.count).toBe(3);
    expect(plan.risks.highRisk.count).toBe(0);
  });

  it('shows trends with win rate, loss reasons and forecast accuracy only for finished periods', async () => {
    const t = (await h().get('/forecast/trends?granularity=quarter&count=4').expect(200)).body;
    expect(t.points).toHaveLength(4);
    const last = t.points.at(-1);
    expect(last).toMatchObject({ period: q.label, won: 3000, wonCount: 3, lostCount: 1, winRate: 75 });
    expect(last.forecastAtStart).not.toBeNull();
    expect(last.errorPercent).toBeNull();
    expect(t.topLossReasons).toEqual([{ reason: 'Price', count: 1 }]);
    await h().get('/forecast/trends?granularity=week').expect(400);
  });

  it('keeps plans and settings private to the workspace', async () => {
    const other = await registerUser(app, 'Other plan');
    const p = (await api(other).get('/forecast/plan').expect(200)).body;
    expect(p.totals.dealCount).toBe(0);
    expect(p.target.amount).toBeNull();
    expect((await api(other).get('/forecast/settings').expect(200)).body.method).toBe('stage');
  });
});
