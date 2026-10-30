import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { startProviderFixture, providerEnv, type ProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, registerUser, startApp, type TestUser } from './helpers';

/**
 * Acceptance test 7: mailbox and calendar sync. Runs the real Google and Microsoft adapters over
 * HTTP against a local fixture that mimics the provider APIs.
 */
describe('email and calendar integrations', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let user: TestUser;
  let http: ReturnType<typeof api>;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    user = await registerUser(app, 'Mailers');
    http = api(user);
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** Runs the OAuth round trip the browser would do: connect URL, provider redirect, callback. */
  async function connect(provider: 'google' | 'microsoft') {
    const { url } = (await http.post(`/integrations/${provider}/connect`).expect(200)).body;
    const auth = new URL(url);
    expect(auth.searchParams.get('client_id')).toMatch(/^fixture-/);
    expect(auth.searchParams.get('redirect_uri')).toBe(`http://localhost:3000/api/v1/integrations/${provider}/callback`);
    const state = auth.searchParams.get('state')!;
    const res = await http.get(`/integrations/${provider}/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    return { state, location: res.headers.location as string };
  }

  it('reports providers and connects Google through OAuth', async () => {
    const before = (await http.get('/integrations').expect(200)).body;
    expect(before.map((p: { provider: string; configured: boolean; connection: unknown }) => [p.provider, p.configured, p.connection])).toEqual([
      ['GOOGLE', true, null],
      ['MICROSOFT', true, null],
    ]);
    const { location, state } = await connect('google');
    expect(location).toBe('http://localhost:3000/app/integrations?connected=google');

    const after = (await http.get('/integrations').expect(200)).body.find((p: { provider: string }) => p.provider === 'GOOGLE');
    expect(after.connection).toMatchObject({ accountEmail: 'rep@seller.test', status: 'CONNECTED' });

    // Tokens are stored encrypted.
    const row = await asTenant(user.tenantId, (tx) => tx.integrationConnection.findFirstOrThrow({ where: { provider: 'GOOGLE' } }));
    expect(row.credentialsEncrypted).toMatch(/^v1\./);
    expect(row.credentialsEncrypted).not.toContain('rt-1');

    // A state issued to one person cannot complete a connection for someone else.
    const other = await registerUser(app, 'Mail Thief');
    const res = await api(other).get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    expect(res.headers.location).toContain('error=oauth_state_invalid');
    // A provider-side refusal also lands back on the page with a reason.
    const denied = await http.get('/integrations/google/callback?error=access_denied').expect(302);
    expect(denied.headers.location).toContain('error=access_denied');
  });

  it('syncs only mail and meetings that involve known contacts and leads', async () => {
    const contact = (await http.post('/contacts', { firstName: 'Cara', lastName: 'Client', email: 'cara@buyer.test' }).expect(201)).body;
    const lead = (await http.post('/leads', { fullName: 'Leo Lead', email: 'leo@prospect.test' }).expect(201)).body.lead;
    const now = Date.now();
    fixture.state.gmailMessages.push(
      { id: 'g1', from: 'cara@buyer.test', to: 'rep@seller.test', subject: 'Re: pricing', body: 'Can we talk Tuesday?', internalDate: now - 3_600_000 },
      { id: 'g2', from: 'rep@seller.test', to: 'Leo <leo@prospect.test>', subject: 'Intro', body: 'Nice to meet you', internalDate: now - 1_800_000, labels: ['SENT'] },
      { id: 'g3', from: 'friend@personal.test', to: 'rep@seller.test', subject: 'Dinner?', body: 'Private', internalDate: now - 600_000 },
    );
    fixture.state.googleEvents.push(
      { id: 'e1', summary: 'Pricing call', start: { dateTime: new Date(now + 86_400_000).toISOString() }, end: { dateTime: new Date(now + 90_000_000).toISOString() }, attendees: [{ email: 'Cara@Buyer.test' }, { email: 'rep@seller.test' }] },
      { id: 'e2', summary: 'Dentist', start: { dateTime: new Date(now + 86_400_000).toISOString() }, end: { dateTime: new Date(now + 90_000_000).toISOString() }, attendees: [] },
    );

    expect((await http.post('/integrations/google/sync').expect(200)).body).toEqual({ emails: 2, meetings: 1 });

    const forContact = (await http.get(`/emails?contactId=${contact.id}`).expect(200)).body;
    expect(forContact).toHaveLength(1);
    expect(forContact[0]).toMatchObject({ direction: 'INBOUND', from: 'cara@buyer.test', subject: 'Re: pricing', provider: 'GOOGLE' });
    expect((await http.get(`/emails/${forContact[0].id}`).expect(200)).body.bodyText).toBe('Can we talk Tuesday?');
    expect((await http.get(`/emails?leadId=${lead.id}`).expect(200)).body[0]).toMatchObject({ direction: 'OUTBOUND', subject: 'Intro' });
    expect((await http.get('/emails').expect(200)).body.map((e: { subject: string }) => e.subject)).not.toContain('Dinner?');

    const meetings = (await http.get('/meetings').expect(200)).body;
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({ title: 'Pricing call', contactIds: [contact.id] });

    // Re-syncing is idempotent and continues from the cursor.
    expect((await http.post('/integrations/google/sync').expect(200)).body).toEqual({ emails: 0, meetings: 1 });
    expect((await http.get('/emails').expect(200)).body).toHaveLength(2);
  });

  it('sends email from the connected mailbox and logs it on the record', async () => {
    const contact = (await http.post('/contacts', { firstName: 'Sid', email: 'sid@buyer.test' }).expect(201)).body;
    const sent = (await http.post('/emails/send', { to: 'Sid@Buyer.test', subject: 'Proposal', body: 'Attached is our proposal.' }).expect(201)).body;
    expect(sent).toMatchObject({ direction: 'OUTBOUND', to: ['sid@buyer.test'], contactId: contact.id, provider: 'GOOGLE' });
    const raw = JSON.parse(fixture.state.sent.at(-1)!.body).raw as string;
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: sid@buyer.test');
    expect(mime).toContain('Subject: Proposal');
    const activities = (await http.get(`/activities?contactId=${contact.id}`).expect(200)).body.items;
    expect(activities[0]).toMatchObject({ type: 'EMAIL', subject: 'Proposal' });

    // Header injection through the subject is neutralised.
    await http.post('/emails/send', { to: 'sid@buyer.test', subject: 'Hi\r\nBcc: victim@x.test', body: 'x' }).expect(201);
    const mime2 = Buffer.from(JSON.parse(fixture.state.sent.at(-1)!.body).raw, 'base64url').toString('utf8');
    expect(mime2).not.toMatch(/^Bcc:/m);
  });

  it('connects Microsoft 365, syncs the inbox and calendar, and sends via Graph', async () => {
    const now = Date.now();
    fixture.state.graphMessages.push({
      id: 'm1',
      conversationId: 'c1',
      subject: 'Outlook hello',
      bodyPreview: 'Hello from Outlook',
      body: { content: 'Hello from Outlook' },
      from: { emailAddress: { address: 'cara@buyer.test' } },
      toRecipients: [{ emailAddress: { address: 'rep@seller.test' } }],
      receivedDateTime: new Date(now - 60_000).toISOString(),
    });
    fixture.state.graphEvents.push({
      id: 'ev1',
      subject: 'Teams sync',
      start: { dateTime: new Date(now + 3_600_000).toISOString().replace('Z', '') },
      end: { dateTime: new Date(now + 7_200_000).toISOString().replace('Z', '') },
      attendees: [{ emailAddress: { address: 'cara@buyer.test' } }],
      isCancelled: false,
    });
    const { location } = await connect('microsoft');
    expect(location).toContain('connected=microsoft');
    expect((await http.post('/integrations/microsoft/sync').expect(200)).body).toEqual({ emails: 1, meetings: 1 });
    const meeting = (await http.get('/meetings').expect(200)).body.find((m: { title: string }) => m.title === 'Teams sync');
    expect(new Date(meeting.startsAt).getTime()).toBeCloseTo(now + 3_600_000, -3);
    expect(meeting.provider).toBe('MICROSOFT');
  });

  it('marks the connection for reconnection when the provider revokes access', async () => {
    fixture.state.revoked = true;
    // Force a token refresh so the revoked refresh token is used.
    await asTenant(user.tenantId, async (tx) => {
      const c = await tx.integrationConnection.findFirstOrThrow({ where: { provider: 'GOOGLE' } });
      await tx.integrationConnection.update({ where: { id: c.id }, data: { nextSyncAt: new Date(Date.now() - 1000) } });
    });
    const res = await http.post('/integrations/google/sync').expect(409);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
    const status = (await http.get('/integrations').expect(200)).body.find((p: { provider: string }) => p.provider === 'GOOGLE');
    expect(status.connection).toMatchObject({ status: 'ERROR', lastError: expect.stringMatching(/Reconnect/) });
    const inbox = (await http.get('/notifications').expect(200)).body;
    expect(inbox.items.some((n: { type: string }) => n.type === 'integration.error')).toBe(true);
    // The worker leaves a connection in error alone until the person reconnects.
    expect((await app.get(WorkerService).tick()).syncs).toBe(0);
    fixture.state.revoked = false;

    await http.del('/integrations/google').expect(204);
    const gone = (await http.get('/integrations').expect(200)).body.find((p: { provider: string }) => p.provider === 'GOOGLE');
    expect(gone.connection).toBeNull();
    // Synced history stays on the records.
    expect((await http.get('/emails').expect(200)).body.length).toBeGreaterThan(0);
    await http.post('/emails/send', { to: 'x@y.test', subject: 's', body: 'b' }).expect(201); // Microsoft is still connected
  });

  it('enforces the daily send cap and isolates mail between workspaces', async () => {
    const other = await registerUser(app, 'Mail Outsider');
    const o = api(other);
    expect((await o.get('/emails').expect(200)).body).toEqual([]);
    expect((await o.get('/meetings').expect(200)).body).toEqual([]);
    const mine = (await http.get('/emails').expect(200)).body[0];
    await o.get(`/emails/${mine.id}`).expect(404);
    await o.post('/emails/send', { to: 'a@b.test', subject: 's', body: 'b' }).expect(409);
    const status = (await o.get('/integrations').expect(200)).body;
    expect(status.every((p: { connection: unknown }) => p.connection === null)).toBe(true);

    await asTenant(user.tenantId, async (tx) => {
      const c = await tx.integrationConnection.findFirstOrThrow({ where: { provider: 'MICROSOFT' } });
      await tx.emailMessage.createMany({
        data: Array.from({ length: 200 }, (_, i) => ({
          tenantId: user.tenantId, connectionId: c.id, providerMessageId: `bulk-${i}`, direction: 'OUTBOUND' as const,
          fromAddress: 'rep@seller.test', toAddresses: ['x@y.test'], ccAddresses: [], subject: 'bulk', sentAt: new Date(),
        })),
      });
    });
    const capped = await http.post('/emails/send', { to: 'x@y.test', subject: 's', body: 'b' }).expect(429);
    expect(capped.body.error.code).toBe('SEND_LIMIT_REACHED');
  });
});

describe('integrations without provider credentials', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('says what is missing instead of pretending to connect', async () => {
    const user = await registerUser(app, 'Unconfigured');
    const status = (await api(user).get('/integrations').expect(200)).body;
    expect(status[0]).toMatchObject({ provider: 'GOOGLE', configured: false, missingConfig: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] });
    const res = await api(user).post('/integrations/google/connect').expect(409);
    expect(res.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    await api(user).post('/integrations/yahoo/connect').expect(400);
  });
});
