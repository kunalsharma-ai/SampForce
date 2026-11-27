import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@dealflow/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RevenueRecordsService } from '../src/crm/revenue-records.service';
import { api, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/**
 * A workspace with hundreds of companies and won deals (performance work, 2026-11-26). The screens below used to read
 * these records one at a time, or count the contacts and deals of every company in the workspace, and failed with a
 * transaction time-out on large workspaces. These tests pin down that the batched reads give the same answers.
 */
describe('large workspace reads', () => {
  let app: INestApplication;
  let u: TestUser;
  let db: PrismaClient;
  const h = () => api(u);
  const COMPANIES = 240;
  let won: string[] = [];
  let openDeals: string[] = [];
  let firstCompany: string;

  beforeAll(async () => {
    app = await startApp();
    u = await registerUser(app, 'Big Co');
    db = ownerClient();
    const tenantId = u.tenantId;
    const owner = (await db.membership.findFirstOrThrow({ where: { tenantId } })).userId;
    const pipeline = await db.pipeline.findFirstOrThrow({ where: { tenantId }, include: { stages: true } });
    const openStage = pipeline.stages.find((s) => s.category === 'OPEN')!;
    const wonStage = pipeline.stages.find((s) => s.category === 'WON')!;
    const now = Date.now();
    const companies = Array.from({ length: COMPANIES }, (_, i) => ({ id: randomUUID(), tenantId, name: `Big Company ${i}`, ownerId: owner, createdById: owner, createdAt: new Date(now - i * 60_000), deletedAt: null }));
    firstCompany = companies[0]!.id;
    await db.company.createMany({ data: companies });
    // Two contacts per company, plus one deleted contact that must not be counted.
    await db.contact.createMany({
      data: companies.flatMap((c, i) => [
        { tenantId, companyId: c.id, firstName: 'A', lastName: String(i), ownerId: owner, deletedAt: null },
        { tenantId, companyId: c.id, firstName: 'B', lastName: String(i), ownerId: owner, deletedAt: null },
        { tenantId, companyId: c.id, firstName: 'Gone', lastName: String(i), ownerId: owner, deletedAt: new Date() },
      ]),
    });
    // Every company has one won deal and one open deal; even companies have a second open deal.
    const deals = companies.flatMap((c, i) => [
      { id: randomUUID(), tenantId, companyId: c.id, name: `Won ${i}`, amount: 1000 + i, currency: 'USD', status: 'WON' as const, pipelineId: pipeline.id, stageId: wonStage.id, ownerId: owner, closedAt: new Date(now - i * 3_600_000), deletedAt: null },
      { id: randomUUID(), tenantId, companyId: c.id, name: `Open ${i}`, amount: 500, currency: 'USD', status: 'OPEN' as const, pipelineId: pipeline.id, stageId: openStage.id, ownerId: owner, deletedAt: null },
      ...(i % 2 === 0 ? [{ id: randomUUID(), tenantId, companyId: c.id, name: `Open extra ${i}`, amount: 250, currency: 'USD', status: 'OPEN' as const, pipelineId: pipeline.id, stageId: openStage.id, ownerId: owner, deletedAt: null }] : []),
    ]);
    await db.opportunity.createMany({ data: deals });
    won = deals.filter((d) => d.status === 'WON').map((d) => d.id);
    openDeals = deals.filter((d) => d.status === 'OPEN').map((d) => d.id);
    await db.dealStageEvent.createMany({ data: deals.map((d) => ({ tenantId, opportunityId: d.id, pipelineId: pipeline.id, toStageId: d.stageId, occurredAt: new Date(now - 86_400_000) })) });
    await db.activity.createMany({ data: openDeals.map((id) => ({ tenantId, opportunityId: id, type: 'CALL' as const, subject: 'Call', occurredAt: new Date(now - 2 * 86_400_000), ownerId: owner, deletedAt: null })) });
    RevenueRecordsService.invalidate(tenantId);
  }, 120_000);
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('counts contacts and open deals for the page shown, and lists Accounts from won deals', async () => {
    const page = (await h().get('/companies?page=1&pageSize=25&sort=-createdAt').expect(200)).body;
    expect(page.total).toBe(COMPANIES);
    const first = page.items.find((c: { id: string }) => c.id === firstCompany);
    expect(first).toMatchObject({ contactCount: 2, openDealCount: 2 });
    const odd = page.items.find((c: { name: string }) => c.name === 'Big Company 1');
    expect(odd).toMatchObject({ contactCount: 2, openDealCount: 1 });

    const accounts = (await h().get('/companies?page=1&pageSize=25&status=customer').expect(200)).body;
    expect(accounts.total).toBe(COMPANIES);
    const one = (await h().get(`/companies/${firstCompany}`).expect(200)).body;
    expect(one).toMatchObject({ contactCount: 2, openDealCount: 2 });

    // A company whose only won deal is reopened is no longer an account.
    await db.opportunity.update({ where: { id: won[0]! }, data: { status: 'OPEN' } });
    expect((await h().get('/companies?page=1&pageSize=25&status=customer').expect(200)).body.total).toBe(COMPANIES - 1);
    await db.opportunity.update({ where: { id: won[0]! }, data: { status: 'WON' } });
  });

  it('reconciles every won deal into revenue records in one dashboard read, and changes nothing the second time', async () => {
    await h().get('/workspace-dashboard?period=QUARTER').expect(200);
    const records = await db.revenueRecord.findMany({ where: { tenantId: u.tenantId, voidedAt: null } });
    expect(records).toHaveLength(won.length);
    const credits = await db.revenueCredit.count({ where: { tenantId: u.tenantId, voided: false } });
    expect(credits).toBeGreaterThanOrEqual(won.length);
    const firstIds = new Set(records.map((r) => r.id));

    RevenueRecordsService.invalidate(u.tenantId);
    await h().get('/workspace-dashboard?period=QUARTER').expect(200);
    const again = await db.revenueRecord.findMany({ where: { tenantId: u.tenantId, voidedAt: null } });
    expect(new Set(again.map((r) => r.id))).toEqual(firstIds);
    expect(await db.revenueCredit.count({ where: { tenantId: u.tenantId, voided: false } })).toBe(credits);

    // A deal that is no longer won has its record and credits voided on the next full reconcile.
    await db.opportunity.update({ where: { id: won[1]! }, data: { status: 'LOST' } });
    RevenueRecordsService.invalidate(u.tenantId);
    await h().get('/workspace-dashboard?period=QUARTER').expect(200);
    const voided = await db.revenueRecord.findFirstOrThrow({ where: { tenantId: u.tenantId, opportunityId: won[1]! } });
    expect(voided.voidedAt).not.toBeNull();
    expect(await db.revenueCredit.count({ where: { tenantId: u.tenantId, recordId: voided.id, voided: false } })).toBe(0);
  });

  it('forecast plan reads win history and risks for every deal', async () => {
    const plan = (await h().get('/forecast/plan').expect(200)).body;
    expect(plan.stageRates.length).toBeGreaterThan(0);
    expect(plan.risks.stale.count).toBe(0);
  });

  it('rescoring deal health stores every open deal once a day and only moves the score time when nothing changed', async () => {
    const first = (await h().post('/deal-health/refresh').expect(200)).body;
    expect(first.unscored).toBe(0);
    const scored = await db.dealHealthScore.count({ where: { tenantId: u.tenantId } });
    expect(scored).toBe(openDeals.length);
    const daily = await db.dealHealthDaily.count({ where: { tenantId: u.tenantId } });
    expect(daily).toBe(openDeals.length);
    const before = await db.dealHealthScore.findFirstOrThrow({ where: { tenantId: u.tenantId } });

    await new Promise((r) => setTimeout(r, 20));
    await h().post('/deal-health/refresh').expect(200);
    expect(await db.dealHealthDaily.count({ where: { tenantId: u.tenantId } })).toBe(daily);
    const after = await db.dealHealthScore.findUniqueOrThrow({ where: { dealId: before.dealId } });
    expect(after.health).toBe(before.health);
    expect(after.computedAt.getTime()).toBeGreaterThan(before.computedAt.getTime());
  });
});
