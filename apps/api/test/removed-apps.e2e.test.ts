import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { type Prisma, removeChatAndMeetingApps, withoutChatSteps } from '@dealflow/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/** Slack, Microsoft Teams and Zoom were removed on 2026-11-27. Data they left behind is cleared on the next set-up. */
describe('removed Slack, Teams and Zoom apps', () => {
  let app: INestApplication;
  let owner: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Removed Apps Co', { plan: 'growth' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('no longer lists or serves them', async () => {
    const keys = (await api(owner).get('/apps').expect(200)).body.map((a: { key: string }) => a.key);
    expect(keys).not.toContain('slack');
    expect(keys).not.toContain('teams');
    expect(keys).not.toContain('zoom');
    expect(keys).toContain('docusign');
    await api(owner).post('/apps/slack/connect').expect(404);
    await api(owner).get('/apps/zoom/meetings').expect(404);
    await api(owner).get('/apps/teams/channels').expect(404);
  });

  it('refuses a new "Post to Slack or Teams" step', async () => {
    await api(owner)
      .post('/workflows', {
        name: 'Chat flow',
        definition: { trigger: { event: 'lead.created' }, start: 'a', nodes: [{ id: 'a', type: 'action', action: { type: 'post_to_chat', app: 'slack', text: 'Hi' }, next: null }] },
      })
      .expect(400);
  });

  it('takes chat steps out of a workflow and rewires the arrows around them', () => {
    const out = withoutChatSteps({
      start: 'c1',
      nodes: [
        { id: 'c1', type: 'action', action: { type: 'post_to_chat' }, next: 'cond' },
        { id: 'cond', type: 'condition', onTrue: 'c2', onFalse: 'note' },
        { id: 'c2', type: 'action', action: { type: 'post_to_chat' }, next: 'note' },
        { id: 'note', type: 'action', action: { type: 'log_note' }, next: 'wait' },
        { id: 'wait', type: 'delay', next: 'c3' },
        { id: 'c3', type: 'action', action: { type: 'post_to_chat' }, next: null },
      ],
    });
    expect(out?.definition.start).toBe('cond');
    expect(out?.definition.nodes.map((n) => n.id)).toEqual(['cond', 'note']);
    expect(out?.definition.nodes.find((n) => n.id === 'cond')).toMatchObject({ onTrue: 'note', onFalse: 'note' });
    // The wait had only the removed step after it, so it goes too.
    expect(out?.definition.nodes.find((n) => n.id === 'note')).toMatchObject({ next: null });
    expect(out?.removed.get('c1')).toBe('cond');
    expect(out?.removed.get('wait')).toBeNull();
    expect(withoutChatSteps({ start: 'n', nodes: [{ id: 'n', type: 'action', action: { type: 'log_note' }, next: null }] })).toBeNull();
  });

  it('clears what the removed apps left in the database, so the rest still loads', async () => {
    const h = api(owner);
    const wf = (
      await h
        .post('/workflows', {
          name: 'Old chat flow',
          definition: { trigger: { event: 'lead.created' }, start: 'n', nodes: [{ id: 'n', type: 'action', action: { type: 'log_note', subject: 'New lead' }, next: null }] },
        })
        .expect(201)
    ).body as { id: string };
    const db = ownerClient();
    try {
      const now = new Date();
      // What an older version of SampForce stored: a Slack connection and event, a Zoom meeting, a plan override, a
      // console key, and a workflow whose first step posted to Slack.
      const connId = randomUUID();
      await db.$runCommandRaw({
        insert: 'app_connections',
        documents: [{ _id: connId, tenant_id: owner.tenantId, provider: 'SLACK', external_account_id: 'T1', account_name: 'Old Slack', scopes: [], credentials_encrypted: 'v1.x.y.z', settings: {}, status: 'CONNECTED', connected_by_id: randomUUID(), created_at: now, updated_at: now }],
      });
      await db.$runCommandRaw({ insert: 'app_events', documents: [{ _id: randomUUID(), tenant_id: owner.tenantId, connection_id: connId, provider: 'SLACK', kind: 'message.sent', ok: true, summary: 'Posted', created_at: now }] });
      await db.$runCommandRaw({ insert: 'zoom_meetings', documents: [{ _id: randomUUID(), tenant_id: owner.tenantId, zoom_meeting_id: '1', topic: 'Old' }] });
      await db.$runCommandRaw({ insert: 'tenant_feature_overrides', documents: [{ _id: randomUUID(), tenant_id: owner.tenantId, feature: 'zoom', enabled: true, reason: 'old', updated_by: 'op', updated_at: now }] });
      await db.$runCommandRaw({ insert: 'platform_secrets', documents: [{ _id: 'SLACK_CLIENT_SECRET', value_enc: 'v1.x.y.z', fingerprint: 'abc', updated_at: now }] });
      const version = await db.workflowVersion.findFirstOrThrow({ where: { workflowId: wf.id } });
      const old = {
        trigger: { event: 'lead.created' },
        start: 'chat',
        nodes: [
          { id: 'chat', type: 'action', action: { type: 'post_to_chat', app: 'slack', channelId: null, channelName: null, text: 'New lead' }, next: 'n' },
          { id: 'n', type: 'action', action: { type: 'log_note', subject: 'New lead' }, next: null },
        ],
      };
      await db.workflowVersion.update({ where: { id: version.id }, data: { definition: old as Prisma.InputJsonObject } });

      await removeChatAndMeetingApps(db);
      await removeChatAndMeetingApps(db); // idempotent

      const count = async (collection: string, filter: Prisma.InputJsonObject) =>
        ((await db.$runCommandRaw({ count: collection, query: filter })) as { n: number }).n;
      expect(await count('app_connections', { tenant_id: owner.tenantId, provider: { $in: ['SLACK', 'TEAMS', 'ZOOM'] } })).toBe(0);
      expect(await count('app_events', { tenant_id: owner.tenantId, provider: { $in: ['SLACK', 'TEAMS', 'ZOOM'] } })).toBe(0);
      expect(await count('tenant_feature_overrides', { tenant_id: owner.tenantId, feature: 'zoom' })).toBe(0);
      expect(await count('platform_secrets', { _id: 'SLACK_CLIENT_SECRET' })).toBe(0);
      const collections = (await db.$runCommandRaw({ listCollections: 1, filter: { name: 'zoom_meetings' }, nameOnly: true })) as { cursor: { firstBatch: unknown[] } };
      expect(collections.cursor.firstBatch).toHaveLength(0);
      expect(await count('plans', { 'entitlements.features': { $in: ['slack', 'teams', 'zoom'] } })).toBe(0);

      const after = await db.workflowVersion.findUniqueOrThrow({ where: { id: version.id } });
      expect(after.definition).toMatchObject({ start: 'n', nodes: [{ id: 'n' }] });
    } finally {
      await db.$disconnect();
    }
    // The apps list and the workflow both load again.
    await h.get('/apps').expect(200);
    const loaded = (await h.get(`/workflows/${wf.id}`).expect(200)).body as { definition?: { start: string } };
    expect(JSON.stringify(loaded)).not.toContain('post_to_chat');
  });
});
