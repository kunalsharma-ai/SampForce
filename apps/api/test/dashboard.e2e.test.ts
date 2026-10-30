import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient, withDbContext } from '@dealflow/database';
import { appClient, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;

describe('Command Center KPIs', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let u: TestUser;

  beforeAll(async () => {
    app = await startApp();
    db = appClient();
    u = await registerUser(app, 'Metrics Org');
    const now = Date.now();
    await withDbContext(db, { tenantId: u.tenantId }, async (tx) => {
      const tenantId = u.tenantId;
      const pipeline = await tx.pipeline.findFirstOrThrow({ where: { tenantId }, include: { stages: true } });
      const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!.id;
      const base = { tenantId, pipelineId: pipeline.id };
      await tx.opportunity.createMany({
        data: [
          { ...base, stageId: stage('Proposal'), name: 'Open 50%', amount: 10_000, currency: 'USD' },
          { ...base, stageId: stage('Qualification'), name: 'Open override 80%', amount: 5_000, currency: 'USD', probability: 80 },
          { ...base, stageId: stage('Closed Won'), name: 'Won', amount: 20_000, currency: 'USD', status: 'WON',
            createdAt: new Date(now - 25 * DAY), closedAt: new Date(now - 5 * DAY) },
          { ...base, stageId: stage('Closed Lost'), name: 'Lost', amount: 7_000, currency: 'USD', status: 'LOST', closedAt: new Date(now - 2 * DAY) },
          { ...base, stageId: stage('Proposal'), name: 'Other currency', amount: 99_999, currency: 'EUR' },
        ],
      });
      await tx.lead.createMany({
        data: [
          { tenantId, fullName: 'L1', status: 'NEW' },
          { tenantId, fullName: 'L2', status: 'QUALIFIED' },
          { tenantId, fullName: 'L3', status: 'CONVERTED', convertedAt: new Date() },
          { tenantId, fullName: 'L4 old', status: 'NEW', createdAt: new Date(now - 90 * DAY) },
          { tenantId, fullName: 'Deleted', deletedAt: new Date() },
        ],
      });
      await tx.activity.create({ data: { tenantId, type: 'CALL', subject: 'Discovery call' } });
    });
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  const kpi = (body: { kpis: { key: string; value: number | null }[] }, key: string) =>
    body.kpis.find((k) => k.key === key)?.value;

  it('computes KPIs from live data', async () => {
    const { body } = await u.agent.get('/api/v1/dashboard/summary').expect(200);
    expect(body.currency).toBe('USD');
    expect(kpi(body, 'totalLeads')).toBe(4);
    expect(kpi(body, 'newLeads')).toBe(3);
    expect(kpi(body, 'qualifiedLeads')).toBe(1);
    expect(kpi(body, 'conversionRate')).toBeCloseTo(1 / 3, 4);
    expect(kpi(body, 'activeOpportunities')).toBe(2);
    expect(kpi(body, 'pipelineValue')).toBe(15_000);
    expect(kpi(body, 'weightedPipelineValue')).toBe(9_000);
    expect(kpi(body, 'closedWonRevenue')).toBe(20_000);
    expect(kpi(body, 'averageDealSize')).toBe(20_000);
    expect(kpi(body, 'averageSalesCycleDays')).toBeCloseTo(20, 0);
    expect(kpi(body, 'revenueGrowth')).toBeNull();
    expect(kpi(body, 'activitiesCompleted')).toBe(1);
  });

  it('reports modules that have not shipped as unavailable rather than zero', async () => {
    const { body } = await u.agent.get('/api/v1/dashboard/summary').expect(200);
    const ai = body.kpis.find((k: { key: string }) => k.key === 'aiAssistedActivities');
    expect(ai.value).toBeNull();
    expect(ai.availableFrom).toMatch(/Phase 4/);
  });

  it('summarises the default pipeline by stage', async () => {
    const { body } = await u.agent.get('/api/v1/dashboard/summary').expect(200);
    expect(body.pipeline.name).toBe('Sales Pipeline');
    expect(body.pipeline.stages.map((s: { name: string }) => s.name)).toEqual([
      'Qualification', 'Discovery', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost',
    ]);
    const proposal = body.pipeline.stages.find((s: { name: string }) => s.name === 'Proposal');
    expect(proposal).toMatchObject({ dealCount: 1, value: 10_000 });
    expect(body.recentActivity[0].summary).toBe('created the workspace');
  });

  it('is reproducible for the same data', async () => {
    const one = await u.agent.get('/api/v1/dashboard/summary').expect(200);
    const two = await u.agent.get('/api/v1/dashboard/summary').expect(200);
    const strip = (b: { kpis: unknown }) => JSON.stringify(b.kpis);
    expect(strip(one.body)).toBe(strip(two.body));
  });
});
