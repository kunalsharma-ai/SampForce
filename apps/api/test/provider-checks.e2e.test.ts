import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { type FinderFixture, startFinderFixture } from './fixtures/finder-fixture';
import { api, appClient, ORIGIN, registerUser, startApp } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

/** A stand-in for Deepgram's GET /v1/projects, which lists the key's projects and bills nothing. */
async function startDeepgramProjects(): Promise<{ url: string; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Token deepgram-test-key') return res.writeHead(401).end(JSON.stringify({ err_code: 'INVALID_AUTH' }));
    if (req.method === 'GET' && req.url === '/v1/projects') return res.writeHead(200).end(JSON.stringify({ projects: [{ project_id: 'p1', name: 'Test project' }] }));
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise((r) => server.close(() => r())) };
}

const clearChecks = async () => {
  const db = appClient();
  await db.platformSetting.deleteMany({ where: { key: { startsWith: 'provider_check:' } } });
  await db.$disconnect();
};

describe('operator provider setup and live checks (stand-ins)', () => {
  let finder: FinderFixture;
  let deepgram: Awaited<ReturnType<typeof startDeepgramProjects>>;
  let restore: () => void;
  const apps: INestApplication[] = [];
  const adminEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;
  const supportEmail = `sup-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';

  async function boot(env: Record<string, string | undefined>) {
    const undo = setEnv(env);
    const app = await startApp();
    undo();
    apps.push(app);
    const signIn = async (email: string) => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password }).expect(200);
      return {
        get: (url: string) => agent.get(`/api/v1/operator${url}`),
        post: (url: string) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send({}),
      };
    };
    return { app, admin: await signIn(adminEmail), support: await signIn(supportEmail) };
  }

  beforeAll(async () => {
    finder = await startFinderFixture();
    deepgram = await startDeepgramProjects();
    restore = setEnv({
      OPERATOR_JWT_SECRET: 'operator-secret-that-is-at-least-32-chars',
      APOLLO_API_BASE_URL: `${finder.url}/apollo`,
      HUNTER_API_BASE_URL: `${finder.url}/hunter`,
      DEEPGRAM_API_BASE_URL: deepgram.url,
    });
    await clearChecks();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    await clearChecks();
    await finder.close();
    await deepgram.close();
    restore();
  });

  it('lists which secrets are set by name only, and refuses a check before the key is set', async () => {
    const { admin, support } = await boot({ APOLLO_API_KEY: undefined, HUNTER_API_KEY: 'hunter-test-key', DEEPGRAM_API_KEY: undefined });
    const rows = (await support.get('/providers').expect(200)).body as { key: string; state: string; env: { name: string; set: boolean }[]; checkable: boolean; appStatus: string }[];
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(rows.map((r) => r.key)).toEqual(['apollo', 'hunter', 'deepgram', 'google', 'microsoft', 'slack', 'zoom', 'docusign', 'anthropic', 'smtp']);
    expect(by.apollo).toMatchObject({ state: 'not_configured', checkable: true, appStatus: 'Mock Mode: labelled sample people', env: [{ name: 'APOLLO_API_KEY', set: false, required: true }] });
    expect(by.hunter).toMatchObject({ state: 'configured', env: [{ name: 'HUNTER_API_KEY', set: true }] });
    expect(by.google!.checkable).toBe(false);
    // Values never leave the server, only whether each one is set.
    expect(JSON.stringify(rows)).not.toContain('hunter-test-key');

    expect((await admin.post('/providers/apollo/check').expect(400)).body.error.code).toBe('NOT_CONFIGURED');
    await admin.post('/providers/google/check').expect(400);
    // Support operators can look but not run checks.
    await support.post('/providers/hunter/check').expect(403);
    expect(finder.hunterCalls).toEqual([]);
  });

  it('stores a refused key as a failed check, audited, and a good key as verified', async () => {
    const bad = await boot({ APOLLO_API_KEY: 'wrong-key', HUNTER_API_KEY: 'wrong-key', DEEPGRAM_API_KEY: 'wrong-key' });
    const hunter = (await bad.admin.post('/providers/hunter/check').expect(200)).body;
    expect(hunter).toMatchObject({ state: 'failed', lastCheck: { ok: false, by: adminEmail, stale: false, message: 'Hunter rejected the API key (401). Check HUNTER_API_KEY.' } });
    expect((await bad.admin.post('/providers/deepgram/check').expect(200)).body.lastCheck.message).toBe('Deepgram rejected the API key. Check DEEPGRAM_API_KEY.');
    expect((await bad.admin.post('/providers/apollo/check').expect(200)).body.state).toBe('failed');
    const log = (await bad.admin.get('/audit-log').expect(200)).body as { action: string; metadata: { provider?: string; ok?: boolean } }[];
    expect(log.filter((l) => l.action === 'provider.checked').map((l) => [l.metadata.provider, l.metadata.ok])).toEqual(expect.arrayContaining([['hunter', false], ['deepgram', false], ['apollo', false]]));

    const good = await boot({ APOLLO_API_KEY: 'apollo-test-key', HUNTER_API_KEY: 'hunter-test-key', DEEPGRAM_API_KEY: 'deepgram-test-key' });
    // The failed checks were made with other keys, so they no longer decide the state.
    const before = (await good.support.get('/providers').expect(200)).body as { key: string; state: string; lastCheck: { stale: boolean } }[];
    expect(before.find((r) => r.key === 'hunter')).toMatchObject({ state: 'configured', lastCheck: { stale: true } });

    expect((await good.admin.post('/providers/hunter/check').expect(200)).body).toMatchObject({ state: 'verified', lastCheck: { ok: true, message: 'Key accepted (Free plan). Verifications this month: 3 of 50.' } });
    expect((await good.admin.post('/providers/deepgram/check').expect(200)).body).toMatchObject({ state: 'verified', lastCheck: { message: 'Key accepted (1 project).' } });
    expect(finder.hunterCalls.at(-1)).toBe('/hunter/account?api_key');
    expect(deepgram.calls.at(-1)).toBe('GET /v1/projects');
  });

  it('a successful Apollo check moves workspaces from Pending Configuration to Connected, only for that key', async () => {
    const good = await boot({ APOLLO_API_KEY: 'apollo-test-key' });
    const owner = await registerUser(good.app, 'Provider Check Ltd');
    expect((await api(owner).get('/prospects/settings').expect(200)).body.providers.apollo.mode).toBe('pending');
    const res = (await good.admin.post('/providers/apollo/check').expect(200)).body;
    expect(res).toMatchObject({ state: 'verified', appStatus: 'Connected in every workspace', lastCheck: { message: 'People search answered with 0 results.' } });
    // One search for one result, and nothing revealed.
    expect(finder.apolloCalls.at(-1)).toBe('/apollo/mixed_people/api_search');
    expect(finder.apolloCalls).not.toContain('/apollo/people/bulk_match');
    expect((await api(owner).get('/prospects/settings').expect(200)).body.providers.apollo.mode).toBe('live');

    // With another key set, the old check does not count.
    const other = await boot({ APOLLO_API_KEY: 'a-different-apollo-key' });
    const owner2 = await registerUser(other.app, 'Provider Check Two');
    expect((await api(owner2).get('/prospects/settings').expect(200)).body.providers.apollo.mode).toBe('pending');
  });
});
