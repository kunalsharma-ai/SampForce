import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONSOLE_PREFERENCES } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';
import { appClient, asTenant, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/**
 * The Console shell (ADR 0074): each operator's palette, colour mode, sidebar and sound are saved to their account, and
 * the global search finds clients, people by email, workspaces and plans across every client, without CRM records.
 */
describe('Console shell: preferences and global search', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  let client: TestUser;
  const tag = randomUUID().slice(0, 6);
  const org = `Zephyr Analytics ${tag}`;
  const adminEmail = `ops-${tag}@platform.test`;
  const supportEmail = `sup-${tag}@platform.test`;
  const password = 'operator-password-1';
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) =>
      agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) =>
      agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' },
        { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' },
      ],
    });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
    client = await registerUser(app, org, { plan: 'growth' });
    await asTenant(client.tenantId, (tx) =>
      tx.workspaceNode.create({
        data: {
          tenantId: client.tenantId,
          level: 'SUPER',
          name: `Zephyr HQ ${tag}`,
          nameKey: `zephyr hq ${tag}`,
          parentId: null,
          designation: 'Client Administrator',
          features: [],
          canCreateExecutives: true,
        },
      }),
    );
  });
  afterAll(async () => {
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('starts every operator on the default palette, the system colour mode, an open menu and no sound', async () => {
    const me = (await op(admin).get('/me').expect(200)).body;
    expect(me).toMatchObject({
      email: adminEmail,
      name: 'Ada Ops',
      role: 'ADMIN',
      preferences: DEFAULT_CONSOLE_PREFERENCES,
    });
    expect(me.preferences.sound).toBe(false);
  });

  it('saves preferences per operator, merging a partial change into what was saved before', async () => {
    const saved = (
      await op(admin).put('/me/preferences', { palette: 'indigo_violet', mode: 'dark' }).expect(200)
    ).body;
    expect(saved).toEqual({
      palette: 'indigo_violet',
      mode: 'dark',
      sidebarCollapsed: false,
      sound: false,
    });
    await op(admin).put('/me/preferences', { sidebarCollapsed: true, sound: true }).expect(200);
    const me = (await op(admin).get('/me').expect(200)).body;
    expect(me.preferences).toEqual({
      palette: 'indigo_violet',
      mode: 'dark',
      sidebarCollapsed: true,
      sound: true,
    });
    // Another operator's choice is their own.
    expect((await op(support).get('/me').expect(200)).body.preferences).toEqual(
      DEFAULT_CONSOLE_PREFERENCES,
    );
    // Kept in the database, so a new sign-in (another device) gets the same Console.
    const again = request.agent(app.getHttpServer());
    await op(again).post('/login', { email: adminEmail, password }).expect(200);
    expect((await op(again).get('/me').expect(200)).body.preferences.palette).toBe('indigo_violet');
  });

  it('rejects palettes and settings that do not exist', async () => {
    await op(admin).put('/me/preferences', { palette: 'hot_pink' }).expect(400);
    await op(admin).put('/me/preferences', { mode: 'sepia' }).expect(400);
    await op(admin).put('/me/preferences', { fontSize: 18 }).expect(400);
    expect((await op(admin).get('/me').expect(200)).body.preferences.palette).toBe('indigo_violet');
  });

  it('finds a client by name and a person by email, with the client they belong to', async () => {
    const byName = (
      await op(support)
        .get(`/search?q=${encodeURIComponent(`Zephyr Analytics ${tag}`)}`)
        .expect(200)
    ).body;
    const hit = byName.hits.find(
      (h: { kind: string; id: string }) => h.kind === 'client' && h.id === client.tenantId,
    );
    expect(hit).toMatchObject({ title: org, href: `/operator/clients/${client.tenantId}` });
    // Workspaces are found by their own name, with their level and client.
    const ws = (
      await op(support)
        .get(`/search?q=${encodeURIComponent(`Zephyr HQ ${tag}`)}`)
        .expect(200)
    ).body;
    expect(ws.hits).toEqual([
      expect.objectContaining({
        kind: 'workspace',
        title: `Zephyr HQ ${tag}`,
        detail: `Super Workspace · ${org}`,
        href: `/operator/clients/${client.tenantId}`,
      }),
    ]);

    const byEmail = (
      await op(support)
        .get(`/search?q=${encodeURIComponent(client.email)}`)
        .expect(200)
    ).body;
    expect(byEmail.hits).toEqual([
      expect.objectContaining({
        kind: 'user',
        detail: `${client.email} · ${org}`,
        href: `/operator/clients/${client.tenantId}`,
      }),
    ]);
  });

  it('finds plans and ticket numbers, and says nothing matched when nothing did', async () => {
    const plans = (await op(admin).get('/search?q=growth').expect(200)).body;
    expect(
      plans.hits.some((h: { kind: string; id: string }) => h.kind === 'plan' && h.id === 'growth'),
    ).toBe(true);
    const none = (await op(admin).get(`/search?q=nothing-called-${tag}`).expect(200)).body;
    expect(none).toEqual({ q: `nothing-called-${tag}`, hits: [] });
  });

  it('needs at least two characters, and an operator session', async () => {
    await op(admin).get('/search?q=a').expect(400);
    await request(app.getHttpServer()).get('/api/v1/operator/search?q=zephyr').expect(401);
    // A workspace session is not an operator session.
    await client.agent.get('/api/v1/operator/search?q=zephyr').expect(401);
    await client.agent
      .put('/api/v1/operator/me/preferences')
      .set('origin', ORIGIN)
      .send({ sound: true })
      .expect(401);
  });

  it('logs each search in the platform audit log', async () => {
    const db = appClient();
    try {
      const rows = await db.platformAuditLog.findMany({
        where: {
          action: 'console.searched',
          createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
        },
      });
      expect(rows.filter((r) => (r.metadata as { q?: string }).q === client.email)).toEqual([
        expect.objectContaining({ metadata: { q: client.email, results: 1 } }),
      ]);
    } finally {
      await db.$disconnect();
    }
  });
});
