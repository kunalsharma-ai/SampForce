import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { type BillingFixture, startBillingFixture } from './fixtures/billing-fixture';
import { DOCUSIGN_APP, startDocusignFixture } from './fixtures/docusign-fixture';
import { type ProviderFixture, startProviderFixture } from './fixtures/provider-fixture';
import { SLACK_CLIENT, type SlackFixture, startSlackFixture } from './fixtures/slack-fixture';
import { type SmtpFixture, startSmtpFixture } from './fixtures/smtp-fixture';
import { startZoomFixture, ZOOM_APP } from './fixtures/zoom-fixture';
import { api, appClient, ORIGIN, registerUser, startApp } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const clean = async () => {
  const db = appClient();
  await db.platformSecret.deleteMany({});
  await db.platformSetting.deleteMany({ where: { key: { startsWith: 'provider_check:' } } });
  await db.$disconnect();
};

type Field = { name: string; set: boolean; source: string; hint: string | null; secret: boolean; updatedBy: string | null };
type Row = { key: string; state: string; configured: boolean; env: Field[]; lastCheck: { ok: boolean; message: string; stale: boolean } | null };

/** Every env var a provider here might read: unset for the whole suite so only what a test sets is in play. */
const UNSET = Object.fromEntries(
  ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'SMTP_URL', 'MAIL_FROM', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET',
    'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET', 'ZAPIER_INVITE_URL', 'APOLLO_API_KEY', 'HUNTER_API_KEY', 'DEEPGRAM_API_KEY', 'ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS'].map((k) => [k, undefined]),
);

describe('provider keys entered in the operator console (stand-ins)', () => {
  let slack: SlackFixture;
  let ai: AiFixture;
  let smtp: SmtpFixture;
  let google: ProviderFixture;
  let billing: BillingFixture;
  let zoom: Awaited<ReturnType<typeof startZoomFixture>>;
  let docusign: Awaited<ReturnType<typeof startDocusignFixture>>;
  let restore: () => void;
  const apps: INestApplication[] = [];
  const adminEmail = `keys-${randomUUID().slice(0, 8)}@platform.test`;
  const supportEmail = `keys-sup-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';

  async function boot(env: Record<string, string | undefined> = {}) {
    const undo = setEnv(env);
    const app = await startApp();
    undo();
    apps.push(app);
    const signIn = async (email: string) => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password }).expect(200);
      return {
        get: (url: string) => agent.get(`/api/v1/operator${url}`),
        post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
      };
    };
    return { app, admin: await signIn(adminEmail), support: await signIn(supportEmail) };
  }
  const row = async (ops: Awaited<ReturnType<typeof boot>>['admin'], key: string) => ((await ops.get('/providers').expect(200)).body as Row[]).find((r) => r.key === key)!;
  const field = (r: Row, name: string) => r.env.find((f) => f.name === name)!;

  beforeAll(async () => {
    [slack, ai, smtp, google, billing, zoom, docusign] = await Promise.all([startSlackFixture(), createAiFixture(), startSmtpFixture(), startProviderFixture(), startBillingFixture(), startZoomFixture(), startDocusignFixture()]);
    restore = setEnv({
      ...UNSET,
      OPERATOR_JWT_SECRET: 'operator-secret-that-is-at-least-32-chars',
      SLACK_AUTH_BASE_URL: slack.url, SLACK_API_BASE_URL: `${slack.url}/api`,
      AI_API_BASE_URL: ai.url,
      GOOGLE_TOKEN_URL: `${google.url}/google/token`, MICROSOFT_LOGIN_BASE_URL: `${google.url}/ms`,
      ZOOM_AUTH_BASE_URL: zoom.url, STRIPE_API_BASE_URL: billing.url, RAZORPAY_API_BASE_URL: billing.url,
      PROVIDER_KEYS_REFRESH_SECONDS: '1',
    });
    await clean();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Kay Keys', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sue Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    await clean();
    await Promise.all([slack.close(), ai.close(), smtp.close(), google.close(), billing.close(), zoom.close(), docusign.close()]);
    restore();
  });

  it('saves keys sealed, shows them masked, logs each change by fingerprint, and the app uses them at once', async () => {
    const { app, admin, support } = await boot();
    const owner = await registerUser(app, 'Keys Live Ltd');
    const before = ((await api(owner).get('/apps').expect(200)).body as { key: string; state: string }[]).find((a) => a.key === 'slack')!;
    expect(before.state).toBe('pending_configuration');
    expect(field(await row(admin, 'slack'), 'SLACK_CLIENT_SECRET')).toMatchObject({ set: false, source: 'missing', hint: null, secret: true });

    // Support operators can look, not change.
    await support.post('/providers/slack/keys', { values: { SLACK_CLIENT_ID: 'x' } }).expect(403);

    const saved = (await admin.post('/providers/slack/keys', { values: { SLACK_CLIENT_ID: ` ${SLACK_CLIENT.id} `, SLACK_CLIENT_SECRET: SLACK_CLIENT.secret } }).expect(200)).body as Row;
    expect(saved).toMatchObject({ state: 'configured', configured: true });
    expect(field(saved, 'SLACK_CLIENT_SECRET')).toMatchObject({ set: true, source: 'console', hint: SLACK_CLIENT.secret.slice(-4), updatedBy: adminEmail });
    // Values never come back, from either endpoint.
    for (const body of [saved, (await support.get('/providers').expect(200)).body]) {
      expect(JSON.stringify(body)).not.toContain(SLACK_CLIENT.secret);
      expect(JSON.stringify(body)).not.toContain(SLACK_CLIENT.id);
    }
    // Sealed at rest.
    const db = appClient();
    const stored = await db.platformSecret.findUnique({ where: { name: 'SLACK_CLIENT_SECRET' } });
    await db.$disconnect();
    expect(stored!.valueEnc.startsWith('v1.')).toBe(true);
    expect(stored!.valueEnc).not.toContain(SLACK_CLIENT.secret);

    const log = (await admin.get('/audit-log').expect(200)).body as { action: string; operator: { email: string }; metadata: Record<string, unknown> }[];
    const sets = log.filter((l) => l.action === 'provider_key.set' && l.metadata.provider === 'slack' && l.operator.email === adminEmail);
    expect(sets.map((l) => l.metadata.name).sort()).toEqual(['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET']);
    expect(sets[0]!.operator.email).toBe(adminEmail);
    expect(sets.every((l) => /^[0-9a-f]{12}$/.test(String(l.metadata.fingerprint)))).toBe(true);
    expect(JSON.stringify(log)).not.toContain(SLACK_CLIENT.secret);

    // No restart: the same running app now offers Slack and sends the new client id to Slack.
    const after = ((await api(owner).get('/apps').expect(200)).body as { key: string; state: string; missingConfig: string[] }[]).find((a) => a.key === 'slack')!;
    expect(after.state).not.toBe('pending_configuration');
    expect(after.missingConfig).toEqual([]);
    const { url } = (await api(owner).post('/apps/slack/connect', {}).expect(200)).body as { url: string };
    expect(new URL(url).searchParams.get('client_id')).toBe(SLACK_CLIENT.id);

    // Test connection with the console keys, then with a wrong secret.
    expect((await admin.post('/providers/slack/check').expect(200)).body).toMatchObject({ state: 'verified', lastCheck: { ok: true, stale: false } });
    await admin.post('/providers/slack/keys', { values: { SLACK_CLIENT_SECRET: 'not-the-right-secret' } }).expect(200);
    expect((await row(admin, 'slack')).state).toBe('configured'); // a new key makes the old test stale
    expect((await admin.post('/providers/slack/check').expect(200)).body).toMatchObject({ state: 'failed', lastCheck: { ok: false, message: 'Slack refused the client ID or secret (invalid_client_id).' } });
  });

  it('removing a console value falls back to the environment variable; non-secrets are shown in full', async () => {
    const { admin } = await boot({ SLACK_CLIENT_ID: 'env-slack-client-id', SLACK_CLIENT_SECRET: 'env-slack-client-secret' });
    // Left from the previous test: the console value wins over the environment.
    expect(field(await row(admin, 'slack'), 'SLACK_CLIENT_SECRET')).toMatchObject({ source: 'console', hint: 'cret' });
    const cleared = (await admin.post('/providers/slack/keys', { values: { SLACK_CLIENT_ID: null, SLACK_CLIENT_SECRET: null } }).expect(200)).body as Row;
    expect(field(cleared, 'SLACK_CLIENT_SECRET')).toMatchObject({ source: 'environment', set: true, hint: 'cret', updatedBy: null });
    expect(field(cleared, 'SLACK_CLIENT_ID')).toMatchObject({ source: 'environment', hint: 't-id' });
    const log = (await admin.get('/audit-log').expect(200)).body as { action: string; metadata: Record<string, unknown> }[];
    expect(log.filter((l) => l.action === 'provider_key.cleared').map((l) => l.metadata.name)).toEqual(expect.arrayContaining(['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET']));

    const mail = (await admin.post('/providers/smtp/keys', { values: { MAIL_FROM: 'SampForce <no-reply@dealflow.test>' } }).expect(200)).body as Row;
    expect(field(mail, 'MAIL_FROM')).toMatchObject({ secret: false, hint: 'SampForce <no-reply@dealflow.test>' });
  });

  it('refuses values the environment variable would refuse, keys of another provider, and unknown providers', async () => {
    const { admin } = await boot();
    const bad = (await admin.post('/providers/smtp/keys', { values: { SMTP_URL: 'http://mail.example.com' } }).expect(400)).body;
    expect(bad.error).toMatchObject({ code: 'VALIDATION_FAILED', message: 'SMTP_URL must start with smtp:// or smtps://' });
    expect((await admin.post('/providers/slack/keys', { values: { HUNTER_API_KEY: 'k' } }).expect(400)).body.error.message).toBe('Slack does not use HUNTER_API_KEY.');
    await admin.post('/providers/slack/keys', { values: { ENCRYPTION_KEY: 'k'.repeat(40) } }).expect(400);
    await admin.post('/providers/slack/keys', { values: { SLACK_CLIENT_ID: 'line\nbreak' } }).expect(400);
    await admin.post('/providers/slack/keys', { values: {} }).expect(400);
    await admin.post('/providers/zapier/keys', { values: { ZAPIER_INVITE_URL: 'not a url' } }).expect(400);
    await admin.post('/providers/nope/keys', { values: { X_Y: 'a' } }).expect(400);
    // Nothing was stored by any refused request.
    const db = appClient();
    expect(await db.platformSecret.count({ where: { name: { in: ['SMTP_URL', 'ZAPIER_INVITE_URL', 'ENCRYPTION_KEY'] } } })).toBe(0);
    await db.$disconnect();
  });

  it('another running process (worker, second replica) picks up a change within the refresh interval', async () => {
    const one = await boot();
    const two = await boot();
    const owner = await registerUser(two.app, 'Keys Replica Ltd');
    const status = async () => ((await api(owner).get('/ai/status').expect(200)).body as { provider: { configured: boolean } }).provider.configured;
    expect(await status()).toBe(false);
    await one.admin.post('/providers/anthropic/keys', { values: { ANTHROPIC_API_KEY: 'sk-ant-console-key-0001' } }).expect(200);
    let seen = false;
    for (let i = 0; i < 30 && !seen; i++) {
      seen = await status();
      if (!seen) await sleep(200);
    }
    expect(seen).toBe(true);
    // And its connection test (GET /v1/models: no tokens used) passes from the other process too.
    expect((await two.admin.post('/providers/anthropic/check').expect(200)).body).toMatchObject({ state: 'verified', lastCheck: { message: expect.stringContaining('claude-opus-5-5 is available') } });
    await one.admin.post('/providers/anthropic/keys', { values: { ANTHROPIC_API_KEY: 'sk-ant-bad-console-key' } }).expect(200);
    expect((await one.admin.post('/providers/anthropic/check').expect(200)).body.lastCheck.message).toBe('Anthropic refused the API key (401). Check ANTHROPIC_API_KEY.');
  });

  it('system email starts working as soon as SMTP is saved, and the SMTP test signs in without sending', async () => {
    const { app, admin } = await boot();
    const owner = await registerUser(app, 'Keys Mail Ltd');
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/request').set('origin', ORIGIN).send({ email: owner.email }).expect(503);
    const down = await closedPort();
    await admin.post('/providers/smtp/keys', { values: { SMTP_URL: `smtp://mailer:pa55-w0rd-secret@127.0.0.1:${down}`, MAIL_FROM: 'SampForce <no-reply@dealflow.test>' } }).expect(200);
    const failed = (await admin.post('/providers/smtp/check').expect(200)).body as Row;
    expect(failed.state).toBe('failed');
    expect(failed.lastCheck!.message).toContain('ECONNREFUSED');
    // The SMTP URL holds the password: it is never echoed back, in the row or the log.
    expect(JSON.stringify(failed)).not.toContain('pa55-w0rd-secret');
    expect(JSON.stringify((await admin.get('/audit-log').expect(200)).body)).not.toContain('pa55-w0rd-secret');

    await admin.post('/providers/smtp/keys', { values: { SMTP_URL: smtp.url } }).expect(200);
    const sent = smtp.messages.length;
    expect((await admin.post('/providers/smtp/check').expect(200)).body).toMatchObject({ state: 'verified', lastCheck: { message: 'The email service accepted the connection and sign-in. No email was sent.' } });
    expect(smtp.messages.length).toBe(sent);
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/request').set('origin', ORIGIN).send({ email: owner.email }).expect(202);
    for (let i = 0; i < 25 && smtp.messages.length === sent; i++) await sleep(100);
    expect(smtp.messages.at(-1)!.to).toEqual([owner.email]);
  });

  it('connection tests for Google, Microsoft, Zoom, DocuSign, Stripe, Razorpay and Zapier', async () => {
    // Tests are limited to 10 a minute per operator session, so this spreads them over a few running apps.
    let admin = (await boot({ DOCUSIGN_AUTH_BASE_URL: docusign.url })).admin;
    let used = 0;
    const check = async (key: string, values: Record<string, string>) => {
      if (++used % 9 === 0) admin = (await boot({ DOCUSIGN_AUTH_BASE_URL: docusign.url })).admin;
      await admin.post(`/providers/${key}/keys`, { values }).expect(200);
      return ((await admin.post(`/providers/${key}/check`).expect(200)).body as Row).lastCheck!;
    };
    expect(await check('google', { GOOGLE_CLIENT_ID: 'g-client', GOOGLE_CLIENT_SECRET: 'g-secret' })).toMatchObject({ ok: true, message: 'Google accepted the client ID and secret (the test code was refused, as expected). Nothing was connected.' });
    expect(await check('google', { GOOGLE_CLIENT_SECRET: 'g-wrong-secret' })).toMatchObject({ ok: false, message: 'Google refused the client ID or secret (invalid_client): The OAuth client was not found..' });
    expect(await check('microsoft', { MICROSOFT_CLIENT_ID: 'm-client', MICROSOFT_CLIENT_SECRET: 'm-secret', MICROSOFT_TENANT: 'contoso.onmicrosoft.com' })).toMatchObject({ ok: true });
    expect(await check('zoom', { ZOOM_CLIENT_ID: ZOOM_APP.id, ZOOM_CLIENT_SECRET: ZOOM_APP.secret })).toMatchObject({ ok: true });
    expect(await check('zoom', { ZOOM_CLIENT_SECRET: 'zoom-wrong' })).toMatchObject({ ok: false, message: 'Zoom refused the client ID or secret (invalid_client): Invalid client_id or client_secret.' });
    expect(await check('docusign', { DOCUSIGN_INTEGRATION_KEY: DOCUSIGN_APP.key, DOCUSIGN_SECRET_KEY: DOCUSIGN_APP.secret })).toMatchObject({ ok: true });
    expect(await check('docusign', { DOCUSIGN_SECRET_KEY: 'ds-wrong' })).toMatchObject({ ok: false });
    expect(await check('stripe', { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toMatchObject({ ok: true, message: 'Key accepted (test mode). Nothing was charged.' });
    expect(await check('stripe', { STRIPE_SECRET_KEY: 'sk_test_wrong' })).toMatchObject({ ok: false, message: 'Stripe refused the secret key (401). Check STRIPE_SECRET_KEY.' });
    expect(await check('razorpay', { RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'rzp_fixture_secret', RAZORPAY_WEBHOOK_SECRET: 'w' })).toMatchObject({ ok: true, message: 'Keys accepted (test mode). Nothing was charged.' });
    expect(await check('zapier', { ZAPIER_INVITE_URL: `${ai.url}/health` })).toMatchObject({ ok: true, message: 'The invite link opens (HTTP 200).' });
    expect(await check('zapier', { ZAPIER_INVITE_URL: `${ai.url}/missing-invite` })).toMatchObject({ ok: false });
    // A test with keys missing is refused before any call.
    expect((await admin.post('/providers/hunter/check').expect(400)).body.error).toMatchObject({ code: 'NOT_CONFIGURED', message: "Add HUNTER_API_KEY first, here or in the deployment's secrets." });
  });

  it('follows the key-rotation runbook: old-key values still open, reseal-secrets moves them to the new key', async () => {
    await clean(); // earlier tests sealed values with the development key
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    const first = await boot({ ENCRYPTION_KEY: oldKey });
    await first.admin.post('/providers/hunter/keys', { values: { HUNTER_API_KEY: 'hunter-rotation-key-1234' } }).expect(200);

    // Step 1 of the runbook: new key, old key as previous. The value still opens.
    const rotating = await boot({ ENCRYPTION_KEY: newKey, ENCRYPTION_KEY_PREVIOUS: oldKey });
    expect(field(await row(rotating.admin, 'hunter'), 'HUNTER_API_KEY')).toMatchObject({ source: 'console', hint: '1234' });
    // Without the old key it cannot be opened, so it is skipped (never used half-decrypted) and the page says missing.
    const lost = await boot({ ENCRYPTION_KEY: newKey });
    expect(field(await row(lost.admin, 'hunter'), 'HUNTER_API_KEY')).toMatchObject({ source: 'missing', set: false });

    // Step 2: re-seal, then the previous key can go.
    // --only keeps the drill to this table: other suites leave values sealed with the development key.
    execFileSync('node', ['-r', '@swc-node/register', 'scripts/reseal-secrets.ts', '--only=platform_secrets'], { cwd: process.cwd(), env: { ...process.env, ENCRYPTION_KEY: newKey, ENCRYPTION_KEY_PREVIOUS: oldKey }, stdio: 'pipe' });
    const after = await boot({ ENCRYPTION_KEY: newKey });
    expect(field(await row(after.admin, 'hunter'), 'HUNTER_API_KEY')).toMatchObject({ source: 'console', hint: '1234' });
  }, 60_000);
});
