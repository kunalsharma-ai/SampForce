import type { INestApplication } from '@nestjs/common';
import { DASHBOARD_PRESETS } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient, withDbContext } from '@dealflow/database';
import { api, appClient, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;

/** Design spec Part 4: Command Center filters, charts and personal layouts. */
describe('Command Center filters, charts and layout', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser;
  let ownerId: string;

  beforeAll(async () => {
    app = await startApp();
    db = appClient();
    owner = await registerUser(app, 'Charts Org');
    other = await registerUser(app, 'Elsewhere Charts');
    rep = await inviteMember(app, owner, 'member');
    ownerId = (await api(owner).get('/auth/me').expect(200)).body.user.id;
    const now = Date.now();
    await withDbContext(db, { tenantId: owner.tenantId }, async (tx) => {
      const tenantId = owner.tenantId;
      const pipeline = await tx.pipeline.findFirstOrThrow({ where: { tenantId }, include: { stages: true } });
      const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!.id;
      const base = { tenantId, pipelineId: pipeline.id, currency: 'USD' };
      const deals = [
        { ...base, name: 'Owner won', stageId: stage('Closed Won'), amount: 30_000, status: 'WON' as const, ownerId, createdAt: new Date(now - 20 * DAY), closedAt: new Date(now - 3 * DAY) },
        { ...base, name: 'Rep won', stageId: stage('Closed Won'), amount: 10_000, status: 'WON' as const, ownerId: rep.userId, createdAt: new Date(now - 15 * DAY), closedAt: new Date(now - 10 * DAY) },
        { ...base, name: 'Rep lost', stageId: stage('Closed Lost'), amount: 4_000, status: 'LOST' as const, ownerId: rep.userId, lossReason: 'Price', createdAt: new Date(now - 12 * DAY), closedAt: new Date(now - 2 * DAY) },
        { ...base, name: 'Rep open', stageId: stage('Proposal'), amount: 8_000, ownerId: rep.userId, createdAt: new Date(now - 5 * DAY) },
        { ...base, name: 'Owner open', stageId: stage('Qualification'), amount: 2_000, ownerId, createdAt: new Date(now - 1 * DAY) },
        { ...base, name: 'Old win', stageId: stage('Closed Won'), amount: 50_000, status: 'WON' as const, ownerId, createdAt: new Date(now - 200 * DAY), closedAt: new Date(now - 120 * DAY) },
      ];
      for (const d of deals) await tx.opportunity.create({ data: d });
      const lost = await tx.opportunity.findFirstOrThrow({ where: { tenantId, name: 'Rep lost' } });
      // The lost deal went through Qualification and Discovery first.
      await tx.dealStageEvent.createMany({
        data: [
          { tenantId, opportunityId: lost.id, pipelineId: pipeline.id, toStageId: stage('Qualification') },
          { tenantId, opportunityId: lost.id, pipelineId: pipeline.id, fromStageId: stage('Qualification'), toStageId: stage('Discovery') },
          { tenantId, opportunityId: lost.id, pipelineId: pipeline.id, fromStageId: stage('Discovery'), toStageId: stage('Closed Lost') },
        ],
      });
      await tx.task.createMany({
        data: [
          { tenantId, title: 'Overdue', assigneeId: rep.userId, dueAt: new Date(now - DAY) },
          { tenantId, title: 'Soon', assigneeId: rep.userId, dueAt: new Date(now + 2 * DAY) },
          { tenantId, title: 'Later', assigneeId: ownerId, dueAt: new Date(now + 20 * DAY) },
        ],
      });
      const q = Math.floor(new Date(now).getUTCMonth() / 3) + 1;
      await tx.salesTarget.create({ data: { tenantId, period: `${new Date(now).getUTCFullYear()}-Q${q}`, amount: 80_000 } });
    });
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  const kpi = (body: { kpis: { key: string; value: number | null }[] }, key: string) => body.kpis.find((k) => k.key === key)?.value;

  it('adds win rate, velocity and task KPIs, and filters by owner and period', async () => {
    const all = (await api(owner).get('/dashboard/summary').expect(200)).body;
    expect(kpi(all, 'closedWonRevenue')).toBe(40_000);
    expect(kpi(all, 'winRate')).toBeCloseTo(2 / 3, 4);
    expect(kpi(all, 'overdueTasks')).toBe(1);
    expect(kpi(all, 'upcomingTasks')).toBe(1);
    expect(kpi(all, 'salesVelocity')).toBeGreaterThan(0);

    const mine = (await api(rep).get('/dashboard/summary?ownerId=me').expect(200)).body;
    expect(kpi(mine, 'closedWonRevenue')).toBe(10_000);
    expect(kpi(mine, 'winRate')).toBe(0.5);
    expect(kpi(mine, 'pipelineValue')).toBe(8_000);
    expect(kpi(mine, 'overdueTasks')).toBe(1);

    const year = (await api(owner).get('/dashboard/summary?period=365d').expect(200)).body;
    expect(kpi(year, 'closedWonRevenue')).toBe(90_000);
    await api(owner).get('/dashboard/summary?period=2y').expect(400);
    await api(owner).get('/dashboard/summary?ownerId=bob').expect(400);
  });

  it('returns chart series: revenue trend, stage conversion, win/loss, team, risk and goal', async () => {
    const c = (await api(owner).get('/dashboard/charts?period=30d').expect(200)).body;
    expect(c.currency).toBe('USD');
    expect(c.revenueTrend.length).toBeGreaterThanOrEqual(5);
    expect(c.revenueTrend.reduce((s: number, p: { won: number }) => s + p.won, 0)).toBe(40_000);

    const st = c.stageConversion.stages as { name: string; reached: number; conversion: number | null }[];
    expect(st.map((s) => s.name)).toEqual(['Qualification', 'Discovery', 'Proposal', 'Negotiation', 'Closed Won']);
    // Five deals created in the period: 2 won (passed everything), lost reached Discovery, open in Proposal and Qualification.
    expect(st.map((s) => s.reached)).toEqual([5, 4, 3, 2, 2]);
    expect(st[1]!.conversion).toBeCloseTo(0.8, 4);

    expect(c.winLoss).toMatchObject({ won: 40_000, wonCount: 2, lost: 4_000, lostCount: 1, lossReasons: [{ reason: 'Price', count: 1 }] });
    expect(c.team.map((t: { userId: string; won: number; openValue: number }) => [t.userId, t.won, t.openValue])).toEqual([
      [ownerId, 30_000, 2_000],
      [rep.userId, 10_000, 8_000],
    ]);
    expect(c.risk.find((r: { risk: string }) => r.risk === 'unscored')).toMatchObject({ count: 2, value: 10_000 });
    expect(c.goal).toMatchObject({ target: 80_000 });
    expect(c.goal.attainment).toBeCloseTo(c.goal.won / 80_000, 4);

    const repView = (await api(rep).get('/dashboard/charts?ownerId=me').expect(200)).body;
    expect(repView.team).toHaveLength(1);
    expect(repView.winLoss.wonCount).toBe(1);
    // No personal target is set for the rep.
    expect(repView.goal).toBeNull();
  });

  it('keeps each workspace’s numbers separate', async () => {
    const c = (await api(other).get('/dashboard/charts').expect(200)).body;
    expect(c.winLoss.wonCount).toBe(0);
    expect(c.team).toEqual([]);
    expect(c.goal).toBeNull();
  });

  it('saves a personal layout, fills in widgets it does not name, and resets', async () => {
    expect((await api(owner).get('/me/dashboard-layout').expect(200)).body).toEqual({ layout: null });
    const exec = DASHBOARD_PRESETS.executive;
    const partial = { ...exec, preset: 'custom', widgets: exec.widgets.slice(0, 3) };
    const saved = (await api(owner).put('/me/dashboard-layout', partial).expect(200)).body.layout;
    expect(saved.widgets.slice(0, 3)).toEqual(exec.widgets.slice(0, 3));
    expect(saved.widgets).toHaveLength(exec.widgets.length);
    expect(saved.widgets.slice(3).every((w: { hidden: boolean }) => w.hidden)).toBe(true);
    expect((await api(rep).get('/me/dashboard-layout').expect(200)).body.layout).toBeNull();

    await api(owner).put('/me/dashboard-layout', { ...partial, widgets: [{ id: 'kpis', size: 'full' }, { id: 'kpis', size: 'half' }] }).expect(400);
    await api(owner).put('/me/dashboard-layout', { ...partial, widgets: [{ id: 'globe3d', size: 'full' }] }).expect(400);
    await api(owner).del('/me/dashboard-layout').expect(200);
    expect((await api(owner).get('/me/dashboard-layout').expect(200)).body.layout).toBeNull();
  });
});
