import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppsService } from '../src/apps/apps.service';
import { WorkerService } from '../src/worker/worker.service';
import { startTeamsFixture, type TeamsFixture } from './fixtures/teams-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

describe('Microsoft Teams app (Workflows stand-in)', () => {
  let app: INestApplication;
  let teams: TeamsFixture;
  let owner: TestUser;
  let worker: WorkerService;
  let salesId: string;
  let winsId: string;

  const teamsStatus = async (user: TestUser) => ((await api(user).get('/apps').expect(200)).body as { key: string }[]).find((a) => a.key === 'teams') as unknown as { state: string; connection: { lastError: string | null; settings: { channels: { id: string; lastError: string | null }[] } } };

  beforeAll(async () => {
    teams = await startTeamsFixture();
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Teams Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
  });

  afterAll(async () => {
    await app.close();
    await teams.close();
  });

  it('starts not connected, needs no deployment secret, and is not an OAuth app', async () => {
    expect(await teamsStatus(owner)).toMatchObject({ key: 'teams', name: 'Microsoft Teams', state: 'not_connected', missingConfig: [], connection: null });
    expect((await api(owner).post('/apps/teams/connect', {}).expect(400)).body.error.code).toBe('NOT_OAUTH');
  });

  it('adds a channel only after Teams accepts a welcome card; the URL is sealed and never returned', async () => {
    const member = await inviteMember(app, owner, 'member');
    await api(member).post('/apps/teams/channels', { name: 'Sales', webhookUrl: teams.flowUrl('sales-flow') }).expect(403);

    // A deleted flow is refused and nothing is saved.
    const refused = await api(owner).post('/apps/teams/channels', { name: 'Old', webhookUrl: teams.flowUrl('deleted-flow') }).expect(400);
    expect(refused.body.error.message).toContain('no longer accepts messages');
    expect((await teamsStatus(owner)).state).toBe('not_connected');

    const added = (await api(owner).post('/apps/teams/channels', { name: 'Sales', webhookUrl: teams.flowUrl('sales-flow') }).expect(200)).body;
    expect(teams.cards.at(-1)).toMatchObject({ flow: 'sales-flow', text: expect.stringContaining('DealFlow is connected to Sales') });
    expect(added).toMatchObject({ state: 'connected', connection: { accountName: 'Microsoft Teams', settings: { channels: [{ name: 'Sales', lastError: null }] } } });
    salesId = added.connection.settings.channels[0].id;
    expect(added.connection.settings.defaultChannelId).toBe(salesId);
    expect(JSON.stringify(added)).not.toContain('sales-flow');

    const second = (await api(owner).post('/apps/teams/channels', { name: 'Deal wins', webhookUrl: teams.flowUrl('wins-flow') }).expect(200)).body;
    winsId = second.connection.settings.channels[1].id;
    expect(second.connection.settings.defaultChannelId).toBe(salesId);
    const dupe = await api(owner).post('/apps/teams/channels', { name: 'Again', webhookUrl: teams.flowUrl('wins-flow') }).expect(400);
    expect(dupe.body.error.message).toContain('already added as "Deal wins"');

    const row = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirstOrThrow({ where: { tenantId: owner.tenantId, provider: 'TEAMS' } }));
    expect(row.credentialsEncrypted).toMatch(/^v1\./);
    expect(row.credentialsEncrypted).not.toContain('flow');
    expect(JSON.stringify(row.settings)).not.toContain('flow');
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action: { in: ['app.connected', 'app.channel_added'] } } }));
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain('sig=');
    expect((await api(owner).get('/apps/teams/channels').expect(200)).body.map((c: { name: string }) => c.name)).toEqual(['Sales', 'Deal wins']);
  });

  it('sets the default channel and sends a test message', async () => {
    await api(owner).put('/apps/teams/settings', { defaultChannelId: 'tc_000000000000' }).expect(400);
    await api(owner).put('/apps/teams/settings', { defaultChannelId: winsId }).expect(200);
    expect((await api(owner).post('/apps/teams/test', {}).expect(200)).body).toEqual({ channel: 'Deal wins' });
    expect(teams.cards.at(-1)).toMatchObject({ flow: 'wins-flow', text: 'DealFlow test message. Workflow updates will appear here.' });
    expect((await api(owner).get('/apps/teams/events').expect(200)).body[0]).toMatchObject({ kind: 'message.sent', ok: true, summary: 'Posted to Deal wins (test message)' });
  });

  it('a workflow posts an Adaptive Card with record values escaped and a link back to the record', async () => {
    const http = api(owner);
    const wf = (
      await http
        .post('/workflows', {
          name: 'Lead to Teams',
          definition: {
            trigger: { event: 'lead.created' },
            start: 'post',
            nodes: [{ id: 'post', type: 'action', action: { type: 'post_to_chat', app: 'teams', channelId: salesId, channelName: 'Sales', text: 'New lead {{record.fullName}}' }, next: null }],
          },
        })
        .expect(201)
    ).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    const lead = (await http.post('/leads', { fullName: 'Grace [click](https://evil.example)' }).expect(201)).body.lead;
    await worker.drain();
    const run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run.status).toBe('SUCCEEDED');
    expect(teams.cards.at(-1)).toEqual({ flow: 'sales-flow', text: 'New lead Grace [click] (https://evil.example)', actions: [{ type: 'Action.OpenUrl', title: 'Open in DealFlow', url: `http://localhost:3000/app/leads/${lead.id}` }] });
    expect((await http.get('/apps/teams/events').expect(200)).body[0]).toMatchObject({ kind: 'message.sent', entityType: 'lead', entityId: lead.id });
  });

  it('a deleted flow marks that channel and the app; a later success clears it', async () => {
    teams.gone.add('wins-flow');
    const r = await api(owner).post('/apps/teams/test', { channelId: winsId }).expect(400);
    expect(r.body.error.message).toContain('no longer accepts messages');
    const s = await teamsStatus(owner);
    expect(s.state).toBe('error');
    expect(s.connection.lastError).toContain('Deal wins:');
    expect(s.connection.settings.channels.find((c: { id: string }) => c.id === winsId)?.lastError).toContain('no longer accepts');
    // Another channel working does not hide the broken one.
    await api(owner).post('/apps/teams/test', { channelId: salesId }).expect(200);
    expect((await teamsStatus(owner)).state).toBe('error');
    teams.gone.delete('wins-flow');
    await api(owner).post('/apps/teams/test', { channelId: winsId }).expect(200);
    expect(await teamsStatus(owner)).toMatchObject({ state: 'connected', connection: { lastError: null } });
  });

  it('removing channels moves the default, and removing the last one disconnects', async () => {
    const after = (await api(owner).del(`/apps/teams/channels/${winsId}`).expect(200)).body;
    expect(after.connection.settings).toMatchObject({ defaultChannelId: salesId, channels: [{ id: salesId }] });
    // The test endpoint is rate limited (5 a minute), so these go through the service workflow steps use.
    const post = (channelId: string | null) => app.get(AppsService).postToTeams(owner.tenantId, { channelId, message: { text: 'x', link: null }, actorUserId: null, source: 'workflow' });
    await expect(post(winsId)).rejects.toThrow('That Teams channel was removed');
    const last = (await api(owner).del(`/apps/teams/channels/${salesId}`).expect(200)).body;
    expect(last).toMatchObject({ state: 'not_connected', connection: null });
    await expect(post(null)).rejects.toThrow('Microsoft Teams is not connected');
  });
});
