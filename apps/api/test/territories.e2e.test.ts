import type { INestApplication } from '@nestjs/common';
import type { DealRow, PipelineRow, TerritoryRow, TerritoryView } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, registerUser, startApp, type TestUser } from './helpers';
import { quarterStart } from '../src/crm/territories.service';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Design spec Part 5 territory view (ADR 0049): territories by country, and pipeline per territory. */
describe('Sales territories', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let other: TestUser;
  let ownerId: string;
  const company: Record<string, string> = {};
  const deal: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Territory Org');
    other = await registerUser(app, 'Other Territory Org');
    member = await inviteMember(app, owner, 'member');
    ownerId = (await api(owner).get('/auth/me').expect(200)).body.user.id;
    for (const [name, country] of [['Berlin GmbH', 'DE'], ['Paris SA', 'FR'], ['Mumbai Ltd', 'IN'], ['Tokyo KK', 'JP'], ['Nowhere Inc', null]] as const) {
      company[name] = (await api(owner).post('/companies', { name, country }).expect(201)).body.id;
    }
    const make = async (name: string, amount: number, companyName: string | null, extra: Record<string, unknown> = {}) => {
      const res = await api(owner).post('/deals', { name, amount, companyId: companyName ? company[companyName] : null, ...extra }).expect(201);
      deal[name] = (res.body as DealRow).id;
    };
    await make('Berlin expansion', 50_000, 'Berlin GmbH', { expectedCloseDate: ymd(-3) });
    await make('Paris pilot', 20_000, 'Paris SA', { ownerId: member.userId, expectedCloseDate: ymd(20) });
    await make('Paris euro deal', 9_000, 'Paris SA', { currency: 'EUR' });
    await make('Mumbai rollout', 30_000, 'Mumbai Ltd');
    await make('Tokyo study', 7_000, 'Tokyo KK');
    await make('Loose deal', 1_000, null);
    await make('No country deal', 2_000, 'Nowhere Inc');
    await make('Berlin renewal', 15_000, 'Berlin GmbH');
    await make('Paris lost', 4_000, 'Paris SA');
    const pipeline = ((await api(owner).get('/pipelines').expect(200)).body as PipelineRow[])[0]!;
    const won = pipeline.stages.find((s) => s.category === 'WON')!;
    const lost = pipeline.stages.find((s) => s.category === 'LOST')!;
    await api(owner).post(`/deals/${deal['Berlin renewal']}/move`, { stageId: won.id }).expect(200);
    await api(owner).post(`/deals/${deal['Paris lost']}/move`, { stageId: lost.id, lossReason: 'Budget' }).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('lets administrators define territories by country, and keeps each country in one territory', async () => {
    const dach = (await api(owner).post('/territories', { name: 'DACH', description: 'German-speaking Europe', countries: ['de', 'AT', 'CH'], managerId: member.userId }).expect(201)).body as TerritoryRow;
    expect(dach).toMatchObject({ name: 'DACH', countries: ['AT', 'CH', 'DE'], manager: { id: member.userId } });
    const west = (await api(owner).post('/territories', { name: 'Western Europe', countries: ['FR', 'BE'] }).expect(201)).body as TerritoryRow;
    await api(owner).post('/territories', { name: 'India', countries: ['IN'] }).expect(201);

    const clash = await api(owner).post('/territories', { name: 'Europe', countries: ['FR', 'DE', 'ES'] }).expect(409);
    expect(clash.body.error.code).toBe('COUNTRY_TAKEN');
    expect(clash.body.error.message).toBe('DE, FR already belong to DACH, Western Europe. A country can be in one territory only.');
    // Names are unique regardless of case.
    expect((await api(owner).post('/territories', { name: 'dach', countries: [] }).expect(409)).body.error.code).toBe('NAME_TAKEN');
    const spare = (await api(owner).post('/territories', { name: 'Spare', countries: [] }).expect(201)).body as TerritoryRow;
    await api(owner).post('/territories', { name: 'Bad', countries: ['DEU'] }).expect(400);
    await api(owner).post('/territories', { name: 'Twice', countries: ['ES', 'ES'] }).expect(400);
    await api(owner).post('/territories', { name: 'Ghost manager', managerId: '00000000-0000-4000-8000-000000000000' }).expect(400);

    // Moving a country between territories: remove it from one, then add it to the other.
    await api(owner).patch(`/territories/${west.id}`, { countries: ['FR', 'BE', 'CH'] }).expect(409);
    await api(owner).patch(`/territories/${dach.id}`, { countries: ['DE', 'AT'] }).expect(200);
    const moved = (await api(owner).patch(`/territories/${west.id}`, { countries: ['FR', 'BE', 'CH'], description: 'France and Benelux' }).expect(200)).body as TerritoryRow;
    expect(moved.countries).toEqual(['BE', 'CH', 'FR']);

    // Members can read territories but not change them; other workspaces see none of them.
    const listed = (await api(member).get('/territories').expect(200)).body as TerritoryRow[];
    expect(listed.map((t) => t.name)).toEqual(['DACH', 'India', 'Spare', 'Western Europe']);
    await api(member).post('/territories', { name: 'Rogue', countries: ['JP'] }).expect(403);
    await api(member).patch(`/territories/${dach.id}`, { name: 'Mine' }).expect(403);
    expect((await api(other).get('/territories').expect(200)).body).toEqual([]);
    await api(other).patch(`/territories/${dach.id}`, { name: 'Stolen' }).expect(404);
    await api(other).del(`/territories/${dach.id}`).expect(404);

    await api(owner).del(`/territories/${spare.id}`).expect(204);

    const audit = (await api(owner).get('/audit-logs?limit=100').expect(200)).body;
    const actions = (audit.items as { action: string; entityType: string | null }[]).filter((a) => a.entityType === 'territory').map((a) => a.action);
    expect(actions.filter((a) => a === 'territory.created')).toHaveLength(4);
    expect(actions).toContain('territory.updated');
    expect(actions).toContain('territory.deleted');
  });

  it('summarises open pipeline and this quarter’s results per territory', async () => {
    const view = (await api(owner).get('/deals/territories').expect(200)).body as TerritoryView;
    expect(view.currency).toBe('USD');
    expect(view.closedSince).toBe(quarterStart(new Date()).toISOString().slice(0, 10));
    const by = Object.fromEntries(view.territories.map((t) => [t.territory!.name, t]));
    expect(Object.keys(by)).toEqual(['DACH', 'India', 'Western Europe']);

    expect(by['DACH']).toMatchObject({ openCount: 1, openValue: 50_000, overdueCount: 1, wonCount: 1, wonValue: 15_000, lostCount: 0 });
    expect(by['DACH']!.territory!.manager?.id).toBe(member.userId);
    expect(by['DACH']!.deals.map((d) => d.name)).toEqual(['Berlin expansion']);
    // The euro deal is counted but not added to dollar values.
    expect(by['Western Europe']).toMatchObject({ openCount: 2, openValue: 20_000, otherCurrencyCount: 1, overdueCount: 0, lostCount: 1 });
    expect(by['Western Europe']!.deals.map((d) => d.name)).toEqual(['Paris pilot', 'Paris euro deal']);
    expect(by['Western Europe']!.owners.map((o) => [o.owner?.id, o.count]).sort()).toEqual([[member.userId, 1], [ownerId, 1]].sort());
    expect(by['India']).toMatchObject({ openCount: 1, openValue: 30_000 });
    // Weighted value uses each deal's effective probability.
    expect(by['India']!.weightedValue).toBeCloseTo((30_000 * by['India']!.deals[0]!.effectiveProbability) / 100, 2);

    expect(view.unassigned).toMatchObject({ territory: null, openCount: 3, noCompany: 1, noCountry: 1, uncoveredCountries: [{ country: 'JP', count: 1 }] });
    expect(view.unassigned.deals.map((d) => d.name)).toEqual(['Tokyo study', 'No country deal', 'Loose deal']);
  });

  it('follows the company: changing its country moves its deals to another territory', async () => {
    await api(owner).patch(`/companies/${company['Tokyo KK']}`, { country: 'IN' }).expect(200);
    const view = (await api(owner).get('/deals/territories').expect(200)).body as TerritoryView;
    const india = view.territories.find((t) => t.territory?.name === 'India')!;
    expect(india.deals.map((d) => d.name)).toEqual(['Mumbai rollout', 'Tokyo study']);
    expect(view.unassigned.uncoveredCountries).toEqual([]);
  });

  it('filters by owner, and deleting a territory returns its deals to unassigned', async () => {
    const mine = (await api(member).get('/deals/territories?ownerId=me').expect(200)).body as TerritoryView;
    expect(mine.territories.flatMap((t) => t.deals.map((d) => d.name))).toEqual(['Paris pilot']);
    expect(mine.unassigned.openCount).toBe(0);

    const india = ((await api(owner).get('/territories').expect(200)).body as TerritoryRow[]).find((t) => t.name === 'India')!;
    await api(owner).del(`/territories/${india.id}`).expect(204);
    const view = (await api(owner).get('/deals/territories').expect(200)).body as TerritoryView;
    expect(view.territories.map((t) => t.territory!.name)).toEqual(['DACH', 'Western Europe']);
    expect(view.unassigned.uncoveredCountries).toEqual([{ country: 'IN', count: 2 }]);
    expect((await api(other).get('/deals/territories').expect(200)).body).toMatchObject({ territories: [], unassigned: { openCount: 0 } });
  });

  it('computes the quarter start in UTC', () => {
    expect(quarterStart(new Date('2026-11-01T10:00:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(quarterStart(new Date('2026-03-31T23:59:00Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
