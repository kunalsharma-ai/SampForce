import type { INestApplication } from '@nestjs/common';
import { MAX_PINNED, MAX_RECENT } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, appClient, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Design spec Part 3: favourites, recent pages and sidebar layout persist per person in each workspace. */
describe('personal navigation', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Nav Co');
    other = await registerUser(app, 'Elsewhere Nav');
    member = await inviteMember(app, owner, 'member');
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts empty', async () => {
    const res = await api(owner).get('/me/navigation').expect(200);
    expect(res.body).toEqual({ pinned: [], recent: [], moduleOrder: [], hiddenModules: [] });
  });

  it('saves pins, order and hidden modules, removing duplicates and never hiding Settings', async () => {
    const pin = { href: '/app/deals', label: 'Deals', kind: 'module' };
    const res = await api(owner)
      .patch('/me/navigation', {
        pinned: [pin, pin, { href: '/app/reports?tab=win-rate', label: 'Win rate', kind: 'report' }],
        moduleOrder: ['deals', 'leads', 'deals'],
        hiddenModules: ['meetings', 'settings'],
      })
      .expect(200);
    expect(res.body.pinned).toHaveLength(2);
    expect(res.body.moduleOrder).toEqual(['deals', 'leads']);
    expect(res.body.hiddenModules).toEqual(['meetings']);

    // A partial update leaves the other fields alone.
    await api(owner).patch('/me/navigation', { hiddenModules: [] }).expect(200);
    const after = (await api(owner).get('/me/navigation').expect(200)).body;
    expect(after.pinned.map((p: { href: string }) => p.href)).toEqual(['/app/deals', '/app/reports?tab=win-rate']);
    expect(after.moduleOrder).toEqual(['deals', 'leads']);
    expect(after.hiddenModules).toEqual([]);
  });

  it('accepts only DealFlow pages as links', async () => {
    for (const href of ['https://evil.example', '//evil.example', '/app//evil', '/app/../login', 'javascript:alert(1)', '/apps', '/app/x\\y']) {
      await api(owner).patch('/me/navigation', { pinned: [{ href, label: 'x', kind: 'page' }] }).expect(400);
      await api(owner).post('/me/navigation/visits', { href, label: 'x', kind: 'page' }).expect(400);
    }
    await api(owner).patch('/me/navigation', {}).expect(400);
    await api(owner).patch('/me/navigation', { moduleOrder: ['Deals!'] }).expect(400);
    await api(owner).patch('/me/navigation', { extra: true }).expect(400);
    const tooMany = Array.from({ length: MAX_PINNED + 1 }, (_, i) => ({ href: `/app/page-${i}`, label: `P${i}`, kind: 'page' }));
    await api(owner).patch('/me/navigation', { pinned: tooMany }).expect(400);
  });

  it('records visits newest first, moves a repeat visit to the front and keeps the most recent few', async () => {
    await api(owner).post('/me/navigation/visits', { href: '/app/leads', label: 'Leads', kind: 'module' }).expect(200);
    await api(owner).post('/me/navigation/visits', { href: '/app/quotes', label: 'Quotes', kind: 'module' }).expect(200);
    const res = await api(owner).post('/me/navigation/visits', { href: '/app/leads', label: 'Leads', kind: 'module' }).expect(200);
    expect(res.body.recent.map((r: { href: string }) => r.href)).toEqual(['/app/leads', '/app/quotes']);
    expect(Date.parse(res.body.recent[0].visitedAt)).toBeGreaterThan(Date.now() - 60_000);

    for (let i = 0; i < MAX_RECENT + 3; i++) {
      await api(owner).post('/me/navigation/visits', { href: `/app/page-${i}`, label: `Page ${i}`, kind: 'page' }).expect(200);
    }
    const full = (await api(owner).get('/me/navigation').expect(200)).body;
    expect(full.recent).toHaveLength(MAX_RECENT);
    expect(full.recent[0].href).toBe(`/app/page-${MAX_RECENT + 2}`);
    // Pins are untouched by visits.
    expect(full.pinned).toHaveLength(2);

    const cleared = await api(owner).del('/me/navigation/visits').expect(200);
    expect(cleared.body.recent).toEqual([]);
    expect(cleared.body.pinned).toHaveLength(2);
  });

  it('keeps each person’s navigation private, even inside the same workspace', async () => {
    expect((await api(member).get('/me/navigation').expect(200)).body.pinned).toEqual([]);
    expect((await api(other).get('/me/navigation').expect(200)).body.pinned).toEqual([]);
    await api(member).post('/me/navigation/visits', { href: '/app/tasks', label: 'Tasks', kind: 'module' }).expect(200);
    expect((await api(owner).get('/me/navigation').expect(200)).body.recent).toEqual([]);
  });

  it('the database refuses rows outside the current person even if the app asked for them', async () => {
    const db = appClient();
    try {
      // No tenant or user set on the connection: forced RLS hides every row.
      expect(await db.workspaceNavigation.count()).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });
});
