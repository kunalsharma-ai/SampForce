import type { INestApplication } from '@nestjs/common';
import { quarterPeriod } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { api, registerUser, startApp, type TestUser } from './helpers';

/** Forecasting: exact totals from fixtures, reproducible snapshots (acceptance test 9) and comparisons. */
describe('forecasting', () => {
  let app: INestApplication;
  let fixture: AiFixture;
  let u: TestUser;
  const h = () => api(u);
  const period = quarterPeriod(undefined);
  const inQuarter = period.start;
  let stages: { id: string; name: string; category: string; probability: number }[];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    fixture = await createAiFixture();
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_API_BASE_URL = fixture.url;
    app = await startApp();
    u = await registerUser(app, 'Forecast Co');
    stages = (await h().get('/pipelines').expect(200)).body[0].stages;
    const open = stages.find((s) => s.category === 'OPEN')!;
    const won = stages.find((s) => s.category === 'WON')!;
    const mk = async (key: string, body: object) => (ids[key] = (await h().post('/deals', { stageId: open.id, expectedCloseDate: inQuarter, ...body }).expect(201)).body.id);
    await mk('commit', { name: 'Commit deal', amount: 20000, probability: 80 });
    await mk('best', { name: 'Best deal', amount: 10000, probability: 50 });
    await mk('pipe', { name: 'Pipe deal', amount: 5000, probability: 10 });
    await mk('won', { name: 'Won deal', amount: 7000, probability: 90 });
    await h().post(`/deals/${ids.won}/move`, { stageId: won.id }).expect(200);
    await mk('eur', { name: 'Euro deal', amount: 99999, currency: 'EUR', probability: 90 });
    await h().post('/deals', { name: 'No date deal', amount: 4444, stageId: open.id, probability: 90 }).expect(201);
    await mk('later', { name: 'Next year deal', amount: 3333, probability: 90, expectedCloseDate: '2099-01-15' });
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
  });

  it('computes exact quarter totals and says what it left out', async () => {
    const f = (await h().get('/forecast').expect(200)).body;
    expect(f.period).toEqual({ ...period, granularity: 'quarter' });
    expect(f.totals).toEqual({
      won: 7000, commit: 20000, bestCase: 10000, pipeline: 5000, weighted: 16000 + 5000 + 500,
      worst: 7000, base: 28500, best: 37000, dealCount: 4,
    });
    expect(f.excluded).toEqual({ otherCurrency: 1, noCloseDate: 1 });
    expect(f.lines.map((l: { name: string; category: string }) => `${l.name}:${l.category}`)).toEqual(['Commit deal:commit', 'Best deal:best_case', 'Won deal:won', 'Pipe deal:pipeline']);
    expect(f.byOwner).toHaveLength(1);
  });

  it('snapshots are reproducible from their stored lines', async () => {
    const s = (await h().post('/forecast/snapshots', { label: 'Monday' }).expect(201)).body;
    expect(s.totals.base).toBe(28500);
    const v = (await h().get(`/forecast/snapshots/${s.id}/verify`).expect(200)).body;
    expect(v.matches).toBe(true);
    expect(v.recomputed).toEqual(v.stored);
  });

  it('lists deal-level changes between snapshots and explains them from the recorded data', async () => {
    const [first] = (await h().get('/forecast/snapshots').expect(200)).body;
    await h().patch(`/deals/${ids.commit}`, { amount: 25000 }).expect(200);
    await h().post(`/deals/${ids.best}/move`, { stageId: stages.find((s) => s.category === 'WON')!.id }).expect(200);
    const second = (await h().post('/forecast/snapshots', {}).expect(201)).body;
    const cmp = (await h().get(`/forecast/compare?from=${first.id}&to=${second.id}`).expect(200)).body;
    expect(cmp.changes.map((c: { name: string; kind: string }) => `${c.name}:${c.kind}`).sort()).toEqual(['Best deal:won', 'Commit deal:amount'].sort());
    expect(cmp.delta).toEqual({ won: 10000, weighted: 4000 - 5000, base: 9000, best: 5000 });

    const explained = (await h().post('/ai/forecast/explain', { from: first.id, to: second.id }).expect(200)).body;
    expect(explained.explanation).toContain('9000');
    expect(explained.explanationUnavailable).toBeNull();
  });

  it('keeps snapshots immutable and private to the workspace', async () => {
    const other = await registerUser(app, 'Other forecast');
    const [s] = (await h().get('/forecast/snapshots').expect(200)).body;
    await api(other).get(`/forecast/snapshots/${s.id}/verify`).expect(404);
    expect((await api(other).get('/forecast/snapshots').expect(200)).body).toEqual([]);
  });
});
