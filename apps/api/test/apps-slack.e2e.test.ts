import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { SLACK_CLIENT, type SlackFixture, startSlackFixture } from './fixtures/slack-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

describe('Slack without app credentials', () => {
  it('shows Pending Configuration and refuses to connect', async () => {
    const restore = setEnv({ SLACK_CLIENT_ID: undefined, SLACK_CLIENT_SECRET: undefined });
    const app = await startApp();
    try {
      const owner = await registerUser(app, 'No Slack Ltd');
      const apps = (await api(owner).get('/apps').expect(200)).body;
      expect(apps[0]).toEqual(expect.objectContaining({ key: 'slack', state: 'pending_configuration', missingConfig: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'], connection: null }));
      expect((await api(owner).post('/apps/slack/connect', {}).expect(409)).body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    } finally {
      await app.close();
      restore();
    }
  });
});

describe('Slack app (stand-in)', () => {
  let app: INestApplication;
  let slack: SlackFixture;
  let owner: TestUser;
  let worker: WorkerService;
  let restore: () => void;

  const connect = async (user: TestUser) => {
    const { url } = (await api(user).post('/apps/slack/connect', {}).expect(200)).body as { url: string };
    const u = new URL(url);
    expect(u.pathname).toBe('/oauth/v2/authorize');
    expect(u.searchParams.get('scope')).toBe('chat:write,chat:write.public,channels:read,groups:read');
    return api(user).get(`/apps/slack/callback?code=good-code&state=${encodeURIComponent(u.searchParams.get('state')!)}`).expect(302);
  };

  beforeAll(async () => {
    slack = await startSlackFixture();
    restore = setEnv({ SLACK_CLIENT_ID: SLACK_CLIENT.id, SLACK_CLIENT_SECRET: SLACK_CLIENT.secret, SLACK_AUTH_BASE_URL: slack.url, SLACK_API_BASE_URL: `${slack.url}/api` });
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Slack Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
  });

  afterAll(async () => {
    await app.close();
    await slack.close();
    restore();
  });

  it('only admins connect; the token is stored sealed and proved with auth.test', async () => {
    const member = await inviteMember(app, owner, 'member');
    await api(member).post('/apps/slack/connect', {}).expect(403);
    expect((await api(member).get('/apps').expect(200)).body[0].state).toBe('not_connected');

    // A state from another session is refused.
    const other = await registerUser(app, 'Other Slack');
    const { url } = (await api(other).post('/apps/slack/connect', {}).expect(200)).body;
    const stolen = new URL(url).searchParams.get('state')!;
    const bad = await api(owner).get(`/apps/slack/callback?code=good-code&state=${encodeURIComponent(stolen)}`).expect(302);
    expect(bad.headers.location).toContain('app_error=oauth_state_invalid');

    const res = await connect(owner);
    expect(res.headers.location).toMatch(/\/app\/integrations\?app=slack&app_connected=1$/);
    expect(slack.calls).toEqual(expect.arrayContaining(['/api/oauth.v2.access', '/api/auth.test']));
    const status = (await api(owner).get('/apps').expect(200)).body[0];
    expect(status).toMatchObject({ state: 'connected', connection: { accountName: 'Acme Sales', externalAccountId: 'T0ACME', lastError: null } });
    const row = await asTenant(owner.tenantId, (tx) => tx.appConnection.findFirstOrThrow({ where: { tenantId: owner.tenantId } }));
    expect(row.credentialsEncrypted).toMatch(/^v1\./);
    expect(row.credentialsEncrypted).not.toContain('xoxb');
    expect(JSON.stringify(status)).not.toContain('xoxb');
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { action: 'app.connected' } }));
    expect(audit.metadata).toMatchObject({ app: 'slack', account: 'Acme Sales' });
  });

  it('lists channels, saves a default channel and posts a test message', async () => {
    const channels = (await api(owner).get('/apps/slack/channels').expect(200)).body;
    expect(channels.map((c: { name: string }) => c.name)).toEqual(['deal-wins', 'leadership', 'sales']);
    await api(owner).put('/apps/slack/settings', { defaultChannelId: 'not-a-channel', defaultChannelName: 'x' }).expect(400);
    const saved = (await api(owner).put('/apps/slack/settings', { defaultChannelId: 'C0SALES', defaultChannelName: 'sales' }).expect(200)).body;
    expect(saved.connection.settings).toEqual({ defaultChannelId: 'C0SALES', defaultChannelName: 'sales' });
    await api(owner).post('/apps/slack/test', {}).expect(200);
    expect(slack.posts.at(-1)).toMatchObject({ channel: 'C0SALES', text: 'SampForce is connected. Workflow messages will appear here.' });
    const events = (await api(owner).get('/apps/slack/events').expect(200)).body;
    expect(events[0]).toMatchObject({ kind: 'message.sent', ok: true, summary: 'Posted to #sales (test message)' });
  });

  it('a workflow posts to Slack with record values escaped and a link back to the record', async () => {
    const http = api(owner);
    const wf = (
      await http
        .post('/workflows', {
          name: 'Big lead to Slack',
          definition: {
            trigger: { event: 'lead.created' },
            start: 'post',
            nodes: [{ id: 'post', type: 'action', action: { type: 'post_to_chat', app: 'slack', channelId: 'C0WINS', channelName: 'deal-wins', text: 'New lead {{record.fullName}} from {{record.companyName}}' }, next: null }],
          },
        })
        .expect(201)
    ).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    const lead = (await http.post('/leads', { fullName: 'Ada <@here> Lovelace', companyName: 'Engines & Co' }).expect(201)).body.lead;
    await worker.drain();
    const run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run).toMatchObject({ status: 'SUCCEEDED' });
    const post = slack.posts.at(-1)!;
    expect(post.channel).toBe('C0WINS');
    expect(post.text).toBe(`New lead Ada &lt;@here&gt; Lovelace from Engines &amp; Co\n<http://localhost:3000/app/leads/${lead.id}|Open in SampForce>`);
    const events = (await http.get('/apps/slack/events').expect(200)).body;
    expect(events[0]).toMatchObject({ kind: 'message.sent', ok: true, entityType: 'lead', entityId: lead.id });
  });

  it('records failures, and marks the connection when Slack revokes the token', async () => {
    const http = api(owner);
    const r = await http.post('/apps/slack/test', { channelId: 'C0GONE' }).expect(400);
    expect(r.body.error.message).toContain('could not find that channel');
    expect((await http.get('/apps/slack/events').expect(200)).body[0]).toMatchObject({ kind: 'message.failed', ok: false });

    for (const p of slack.posts) slack.revoked.add(p.token);
    const gone = await http.post('/apps/slack/test', {}).expect(400);
    expect(gone.body.error.message).toContain('Reconnect Slack');
    expect((await http.get('/apps').expect(200)).body[0]).toMatchObject({ state: 'error', connection: { lastError: expect.stringContaining('Reconnect Slack') } });

    // Reconnecting clears the error and keeps the default channel.
    await connect(owner);
    expect((await http.get('/apps').expect(200)).body[0]).toMatchObject({ state: 'connected', connection: { settings: { defaultChannelId: 'C0SALES' } } });
  });

  it('a step without a connection fails with a clear message, and disconnect revokes the token', async () => {
    const http = api(owner);
    await http.del('/apps/slack').expect(204);
    expect(slack.calls.at(-1)).toBe('/api/auth.revoke');
    expect((await http.get('/apps').expect(200)).body[0]).toMatchObject({ state: 'not_connected', connection: null });
    const wf = (
      await http
        .post('/workflows', {
          name: 'Slack after disconnect',
          definition: { trigger: { event: 'lead.created' }, start: 'post', nodes: [{ id: 'post', type: 'action', action: { type: 'post_to_chat', text: 'Hello' }, next: null }] },
        })
        .expect(201)
    ).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    await http.post('/leads', { fullName: 'After Disconnect' }).expect(201);
    await worker.drain();
    const run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run.status).toBe('FAILED');
    expect(JSON.stringify(run)).toContain('Slack is not connected');
  });
});
