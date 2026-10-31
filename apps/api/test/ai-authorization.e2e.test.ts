import type { INestApplication } from '@nestjs/common';
import { withDbContext } from '@dealflow/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture, text, toolUse } from './fixtures/ai-fixture';
import { api, appClient, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Acceptance test 6: AI actions respect authorization. */
describe('AI actions respect authorization', () => {
  let app: INestApplication;
  let fixture: AiFixture;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let viewer: TestUser & { userId: string };
  let other: TestUser;
  let leadId: string;
  let dealId: string;

  const setMemberRole = (permissions: (perms: string[]) => string[]) =>
    asTenant(owner.tenantId, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { tenantId: owner.tenantId, key: 'member' } });
      await tx.role.update({ where: { id: role.id }, data: { permissions: permissions(role.permissions) } });
    });
  let memberPermissions: string[];

  beforeAll(async () => {
    fixture = await createAiFixture();
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_API_BASE_URL = fixture.url;
    app = await startApp();
    owner = await registerUser(app, 'Authz A');
    other = await registerUser(app, 'Authz B');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    rep = await inviteMember(app, owner, 'member');
    viewer = await inviteMember(app, owner, 'viewer');
    memberPermissions = await asTenant(owner.tenantId, async (tx) => (await tx.role.findFirstOrThrow({ where: { tenantId: owner.tenantId, key: 'member' } })).permissions);
    leadId = (await api(owner).post('/leads', { fullName: 'Lena Locked', email: 'lena@buyer.test' }).expect(201)).body.lead.id;
    dealId = (await api(owner).post('/deals', { name: 'Guarded deal', amount: 9000 }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
  });
  beforeEach(async () => {
    fixture.use(null);
    await setMemberRole(() => memberPermissions);
  });

  it('keeps roles without ai:use out of every AI route', async () => {
    const v = api(viewer);
    await v.get('/ai/status').expect(403);
    await v.post('/ai/copilot', { question: 'hi' }).expect(403);
    await v.post(`/ai/leads/${leadId}/qualify`).expect(403);
    await v.post(`/ai/deals/${dealId}/analyse`).expect(403);
    await api(rep).patch('/ai/settings', { enabled: false }).expect(403);
    await api(rep).get('/ai/usage').expect(403);
    await api(rep).post('/ai/workflows/draft', { description: 'When a lead arrives, create a task' }).expect(403);
  });

  it('offers only tools the role allows, and never any prohibited ones', async () => {
    await setMemberRole((p) => p.filter((x) => !['deals:write', 'activities:write', 'deals:read'].includes(x)));
    await api(rep).post('/ai/copilot', { question: 'hello' }).expect(200);
    const offered = fixture.requests.at(-1)!.body.tools!.map((t) => t.name).sort();
    // Read-only intelligence tools come with dashboard:read; deals_at_risk needs deals:read, which this role lost.
    expect(offered).toEqual(['get_record', 'list_tasks', 'my_next_actions', 'record_intelligence', 'sales_insights', 'search_records']);
    const everything = new Set(fixture.requests.flatMap((r) => r.body.tools?.map((t) => t.name) ?? []));
    for (const name of everything) expect(name).toMatch(/^(search_records|get_record|list_deals|pipeline_summary|list_tasks|propose_create_task|propose_log_note|propose_move_deal_stage|my_next_actions|sales_insights|record_intelligence|deals_at_risk)$/);
  });

  it('refuses a tool the model was not offered, and proposes nothing', async () => {
    await setMemberRole((p) => p.filter((x) => x !== 'activities:write'));
    let step = 0;
    fixture.use(() => (++step === 1 ? toolUse('propose_create_task', { title: 'Sneaky', due_in_days: null, related_type: null, related_id: null }) : text('Done.')));
    const res = (await api(rep).post('/ai/copilot', { question: 'make a task' }).expect(200)).body;
    expect(res.actions).toEqual([]);
    const result = JSON.stringify(fixture.requests.at(-1)!.body.messages.at(-1));
    expect(result).toContain('is_error');
    expect(result).toContain('Your role does not allow propose_create_task (activities:write)');
  });

  it('reads only record types the role can read', async () => {
    await setMemberRole((p) => p.filter((x) => x !== 'leads:read'));
    let step = 0;
    fixture.use(() => (++step === 1 ? toolUse('get_record', { type: 'lead', id: leadId }) : text('ok')));
    await api(rep).post('/ai/copilot', { question: 'show Lena' }).expect(200);
    const result = JSON.stringify(fixture.requests.at(-1)!.body.messages.at(-1));
    expect(result).toContain('Your role does not allow this (leads:read)');
    expect(result).not.toContain('lena@buyer.test');
  });

  it('re-checks the role when a proposal is confirmed', async () => {
    const res = (await api(rep).post('/ai/copilot', { question: 'Create a task for Lena Locked' }).expect(200)).body;
    expect(res.actions).toHaveLength(1);
    await setMemberRole((p) => p.filter((x) => x !== 'activities:write'));
    const denied = await api(rep).post(`/ai/copilot/runs/${res.runId}/actions/${res.actions[0].id}`, { decision: 'confirm' }).expect(403);
    expect(denied.body.error.message).toMatch(/no longer allows/);
    const tasks = (await api(owner).get(`/tasks?scope=all&leadId=${leadId}`).expect(200)).body;
    expect(tasks).toHaveLength(0);
  });

  it('lets only the person who asked decide, and never across workspaces', async () => {
    const res = (await api(rep).post('/ai/copilot', { question: 'Create a task for Lena Locked' }).expect(200)).body;
    const url = `/ai/copilot/runs/${res.runId}/actions/${res.actions[0].id}`;
    await api(owner).post(url, { decision: 'confirm' }).expect(404);
    await api(other).post(url, { decision: 'confirm' }).expect(404);
    await api(other).get(`/ai/copilot/conversations/${res.conversationId}`).expect(200).expect([]);
    await api(rep).post(url, { decision: 'dismiss' }).expect(200);
    const tasks = (await api(owner).get(`/tasks?scope=all&leadId=${leadId}`).expect(200)).body;
    expect(tasks).toHaveLength(0);
  });

  it('cannot reach another workspace’s records through tools or agents', async () => {
    let step = 0;
    fixture.use(() => (++step === 1 ? toolUse('get_record', { type: 'deal', id: dealId }) : text('ok')));
    await api(other).post('/ai/copilot', { question: 'show that deal' }).expect(200);
    const result = JSON.stringify(fixture.requests.at(-1)!.body.messages.at(-1));
    expect(result).toContain('Deal not found');
    expect(result).not.toContain('Guarded deal');
    await api(other).post(`/ai/deals/${dealId}/analyse`).expect(404);
    await api(other).post(`/ai/leads/${leadId}/qualify`).expect(404);
    const rec = (await api(owner).post(`/ai/deals/${dealId}/analyse`).expect(200)).body;
    await api(other).post(`/ai/recommendations/${rec.id}/accept`, {}).expect(404);
    await api(other).get(`/ai/runs/${rec.id}`).expect(404);
  });

  it('needs the agent’s own permission as well as ai:use', async () => {
    await setMemberRole((p) => p.filter((x) => x !== 'leads:write'));
    await api(rep).post(`/ai/leads/${leadId}/qualify`).expect(403);
  });

  it('keeps every AI table isolated by tenant, and metering append-only', async () => {
    const db = appClient();
    try {
      for (const t of ['ai_settings', 'ai_runs', 'ai_usage', 'ai_recommendations']) {
        const mine = await withDbContext(db, { tenantId: owner.tenantId }, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t}`));
        const theirs = await withDbContext(db, { tenantId: other.tenantId }, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t} WHERE tenant_id = $1::uuid`, owner.tenantId));
        const none = await withDbContext(db, {}, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t}`));
        expect(Number(mine[0]!.n), t).toBeGreaterThan(0);
        expect(Number(theirs[0]!.n), t).toBe(0);
        expect(Number(none[0]!.n), t).toBe(0);
      }
      const scan = (t: string) =>
        withDbContext(db, {}, async (tx) => {
          await tx.$executeRawUnsafe("SELECT set_config('app.worker_scan', 'on', true)");
          return Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t}`))[0]!.n);
        });
      expect(await scan('ai_runs')).toBeGreaterThan(0);
      expect(await scan('ai_usage')).toBe(0);
      expect(await scan('ai_recommendations')).toBe(0);
      await expect(withDbContext(db, { tenantId: owner.tenantId }, (tx) => tx.aiUsage.deleteMany({}))).rejects.toThrow(/permission denied/);
      await expect(withDbContext(db, { tenantId: owner.tenantId }, (tx) => tx.aiUsage.updateMany({ data: { credits: 0 } }))).rejects.toThrow(/permission denied/);
      await expect(
        withDbContext(db, { tenantId: other.tenantId }, (tx) => tx.aiSettings.update({ where: { tenantId: owner.tenantId }, data: { enabled: false } })),
      ).rejects.toThrow();
    } finally {
      await db.$disconnect();
    }
  });
});
