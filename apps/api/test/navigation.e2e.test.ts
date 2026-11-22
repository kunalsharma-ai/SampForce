import type { INestApplication } from '@nestjs/common';
import { eraseRecentPageHistory } from '@dealflow/database';
import { MAX_PINNED } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, appClient, inviteMember, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/** Design spec Part 3: favourites and sidebar layout persist per person in each workspace. Visited pages are never recorded. */
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
    expect(res.body).toEqual({ pinned: [], moduleOrder: [], hiddenModules: [] });
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

  it('accepts only SampForce pages as links', async () => {
    for (const href of ['https://evil.example', '//evil.example', '/app//evil', '/app/../login', 'javascript:alert(1)', '/apps', '/app/x\\y']) {
      await api(owner).patch('/me/navigation', { pinned: [{ href, label: 'x', kind: 'page' }] }).expect(400);
    }
    await api(owner).patch('/me/navigation', {}).expect(400);
    await api(owner).patch('/me/navigation', { moduleOrder: ['Deals!'] }).expect(400);
    await api(owner).patch('/me/navigation', { extra: true }).expect(400);
    const tooMany = Array.from({ length: MAX_PINNED + 1 }, (_, i) => ({ href: `/app/page-${i}`, label: `P${i}`, kind: 'page' }));
    await api(owner).patch('/me/navigation', { pinned: tooMany }).expect(400);
  });

  it('does not record visited pages in any workspace', async () => {
    // The old endpoints are gone, so nothing can write or read page history.
    await api(owner).post('/me/navigation/visits', { href: '/app/leads', label: 'Leads', kind: 'module' }).expect(404);
    await api(owner).del('/me/navigation/visits').expect(404);
    const nav = (await api(owner).get('/me/navigation').expect(200)).body;
    expect(nav).not.toHaveProperty('recent');
    expect(nav.pinned).toHaveLength(2);

    const db = ownerClient();
    try {
      const raw = (await db.$runCommandRaw({ find: 'workspace_navigation', filter: { tenant_id: owner.tenantId } })) as {
        cursor: { firstBatch: Record<string, unknown>[] };
      };
      expect(raw.cursor.firstBatch.length).toBeGreaterThan(0);
      for (const doc of raw.cursor.firstBatch) expect(doc).not.toHaveProperty('recent');
    } finally {
      await db.$disconnect();
    }
  });

  it('set-up erases page history stored before it was removed, and leaves pins alone', async () => {
    const db = ownerClient();
    try {
      const filter = { tenant_id: owner.tenantId };
      const old = [{ href: '/app/marketplace', label: 'Marketplace', kind: 'module', visitedAt: new Date().toISOString() }];
      await db.$runCommandRaw({ update: 'workspace_navigation', updates: [{ q: filter, u: { $set: { recent: old } } }] });
      await eraseRecentPageHistory(db);
      await eraseRecentPageHistory(db); // idempotent
      const raw = (await db.$runCommandRaw({ find: 'workspace_navigation', filter })) as { cursor: { firstBatch: Record<string, unknown>[] } };
      expect(raw.cursor.firstBatch[0]).not.toHaveProperty('recent');
      expect((await api(owner).get('/me/navigation').expect(200)).body.pinned).toHaveLength(2);
    } finally {
      await db.$disconnect();
    }
  });

  it('keeps each person’s navigation private, even inside the same workspace', async () => {
    expect((await api(member).get('/me/navigation').expect(200)).body.pinned).toEqual([]);
    expect((await api(other).get('/me/navigation').expect(200)).body.pinned).toEqual([]);
    await api(member).patch('/me/navigation', { pinned: [{ href: '/app/tasks', label: 'Tasks', kind: 'module' }] }).expect(200);
    expect((await api(owner).get('/me/navigation').expect(200)).body.pinned.map((p: { href: string }) => p.href)).not.toContain('/app/tasks');
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
