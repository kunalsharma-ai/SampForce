import type { INestApplication } from '@nestjs/common';
import { DEFAULT_APPEARANCE, MAX_SAVED_THEMES } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/** Design spec Part 2: theme engine settings persist per person, with an optional workspace default. */
describe('appearance preferences and saved themes', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let other: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Theme Co');
    other = await registerUser(app, 'Elsewhere Theme');
    member = await inviteMember(app, owner, 'member');
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts from the SampForce default when nothing is saved', async () => {
    const res = await api(owner).get('/me/preferences').expect(200);
    expect(res.body).toEqual({ appearance: DEFAULT_APPEARANCE, source: 'default', workspaceDefault: null, updatedAt: null });
  });

  it('saves the person’s settings to the database and returns them on the next read', async () => {
    const mine = { ...DEFAULT_APPEARANCE, themeId: 'emerald', mode: 'light', density: 'compact', radius: 6, motion: 'minimal' };
    const saved = await api(owner).put('/me/preferences/appearance', mine).expect(200);
    expect(saved.body.source).toBe('user');
    expect(saved.body.appearance).toEqual(mine);

    const db = ownerClient();
    try {
      const me = (await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } };
      const row = await db.userPreference.findUniqueOrThrow({ where: { userId: me.user.id } });
      expect(row.appearance).toMatchObject({ themeId: 'emerald', density: 'compact' });
    } finally {
      await db.$disconnect();
    }
    expect((await api(owner).get('/me/preferences').expect(200)).body.appearance).toEqual(mine);
  });

  it('rejects settings outside the schema', async () => {
    await api(owner).put('/me/preferences/appearance', { ...DEFAULT_APPEARANCE, themeId: 'neon' }).expect(400);
    await api(owner).put('/me/preferences/appearance', { ...DEFAULT_APPEARANCE, glass: 400 }).expect(400);
    await api(owner).put('/me/preferences/appearance', { ...DEFAULT_APPEARANCE, primary: 'url(javascript:1)' }).expect(400);
    await api(owner).put('/me/preferences/appearance', { ...DEFAULT_APPEARANCE, extra: true }).expect(400);
    await api(owner).put('/me/preferences/appearance', { themeId: 'rose' }).expect(400);
  });

  it('one person’s settings never change another’s', async () => {
    expect((await api(member).get('/me/preferences').expect(200)).body.source).toBe('default');
    expect((await api(other).get('/me/preferences').expect(200)).body.source).toBe('default');
  });

  it('applies the workspace default to members who have not chosen their own, and only admins can set it', async () => {
    const brand = { ...DEFAULT_APPEARANCE, themeId: 'pearl', mode: 'light' };
    await api(member).put('/tenants/current/appearance', brand).expect(403);
    const set = await api(owner).put('/tenants/current/appearance', brand).expect(200);
    expect(set.body.workspaceDefault).toEqual(brand);
    // The owner keeps their own choice.
    expect(set.body.appearance.themeId).toBe('emerald');

    const forMember = (await api(member).get('/me/preferences').expect(200)).body;
    expect(forMember).toMatchObject({ source: 'workspace', appearance: brand });
    // Another workspace is unaffected.
    expect((await api(other).get('/me/preferences').expect(200)).body.source).toBe('default');

    const audit = (await api(owner).get('/audit-logs?limit=20').expect(200)).body as { items: { action: string }[] };
    expect(audit.items.map((a) => a.action)).toContain('tenant.appearance_default_set');
  });

  it('resetting forgets the person’s own settings and falls back to the workspace default', async () => {
    const res = await api(owner).del('/me/preferences/appearance').expect(200);
    expect(res.body).toMatchObject({ source: 'workspace', appearance: { themeId: 'pearl' }, updatedAt: null });
    await api(member).del('/tenants/current/appearance').expect(403);
    const cleared = await api(owner).del('/tenants/current/appearance').expect(200);
    expect(cleared.body).toMatchObject({ source: 'default', workspaceDefault: null });
  });

  it('keeps named custom themes per person, updates by name, and enforces the limit', async () => {
    const settings = { ...DEFAULT_APPEARANCE, themeId: 'custom', primary: '#FF5A1F', backgroundDark: '#1A0B2E' };
    const created = (await api(owner).post('/me/themes', { name: 'Launch week', settings }).expect(201)).body;
    expect(created).toMatchObject({ name: 'Launch week', settings });

    const updated = (await api(owner).post('/me/themes', { name: 'Launch week', settings: { ...settings, radius: 4 } }).expect(201)).body;
    expect(updated.id).toBe(created.id);
    expect(updated.settings.radius).toBe(4);

    expect((await api(member).get('/me/themes').expect(200)).body).toEqual([]);
    await api(member).del(`/me/themes/${created.id}`).expect(404);

    for (let i = 1; i < MAX_SAVED_THEMES; i++) await api(owner).post('/me/themes', { name: `Theme ${i}`, settings }).expect(201);
    const over = await api(owner).post('/me/themes', { name: 'One too many', settings }).expect(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');

    await api(owner).del(`/me/themes/${created.id}`).expect(204);
    const list = (await api(owner).get('/me/themes').expect(200)).body as { name: string }[];
    expect(list).toHaveLength(MAX_SAVED_THEMES - 1);
    expect(list.map((t) => t.name)).not.toContain('Launch week');
  });

  it('requires a signed-in person', async () => {
    const anon = (await import('supertest')).default(app.getHttpServer());
    await anon.get('/api/v1/me/preferences').expect(401);
  });
});
