import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { ProviderKeysService } from '../src/common/provider-keys';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { type BillingFixture, startBillingFixture } from './fixtures/billing-fixture';
import { DOCUSIGN_APP, startDocusignFixture } from './fixtures/docusign-fixture';
import { type ProviderFixture, startProviderFixture } from './fixtures/provider-fixture';
import { type SmtpFixture, startSmtpFixture } from './fixtures/smtp-fixture';
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
  await db.platformSetting.deleteMany({ where: { OR: [{ key: { startsWith: 'provider_check:' } }, { key: { startsWith: 'env_import:' } }] } });
  await db.$disconnect();
};

type Field = { name: string; set: boolean; source: string; hint: string | null; secret: boolean; updatedBy: string | null };
type Row = { key: string; state: string; configured: boolean; env: Field[]; lastCheck: { ok: boolean; message: string; stale: boolean } | null };

/** Every env var a provider here might read: unset for the whole suite so only what a test sets is in play. */
const UNSET = Object.fromEntries(
  ['ANTHROPIC_API_KEY', 'SMTP_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET',
    'DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET', 'ZAPIER_INVITE_URL', 'APOLLO_API_KEY', 'HUNTER_API_KEY', 'DEEPGRAM_API_KEY', 'ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS'].map((k) => [k, undefined]),
);

describe('provider keys entered in the operator console (stand-ins)', () => {
  let ai: AiFixture;
  let smtp: SmtpFixture;
  let google: ProviderFixture;
  let billing: BillingFixture;
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
    [ai, smtp, google, billing, docusign] = await Promise.all([createAiFixture(), startSmtpFixture(), startProviderFixture(), startBillingFixture(), startDocusignFixture()]);
    restore = setEnv({
      ...UNSET,
      OPERATOR_JWT_SECRET: 'operator-secret-that-is-at-least-32-chars',
      AI_API_BASE_URL: ai.url,
      GOOGLE_TOKEN_URL: `${google.url}/google/token`, MICROSOFT_LOGIN_BASE_URL: `${google.url}/ms`,
      STRIPE_API_BASE_URL: billing.url, RAZORPAY_API_BASE_URL: billing.url,
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
    await Promise.all([ai.close(), smtp.close(), google.close(), billing.close(), docusign.close()]);
    restore();
  });

  it('saves keys sealed, shows them masked, logs each change by fingerprint, and the app uses them at once', async () => {
    const { app, admin, support } = await boot({ DOCUSIGN_AUTH_BASE_URL: docusign.url });
    const owner = await registerUser(app, 'Keys Live Ltd');
    const before = ((await api(owner).get('/apps').expect(200)).body as { key: string; state: string }[]).find((a) => a.key === 'docusign')!;
    expect(before.state).toBe('pending_configuration');
    expect(field(await row(admin, 'docusign'), 'DOCUSIGN_SECRET_KEY')).toMatchObject({ set: false, source: 'missing', hint: null, secret: true });

    // Support operators can look, not change.
    await support.post('/providers/docusign/keys', { values: { DOCUSIGN_INTEGRATION_KEY: 'x' } }).expect(403);

    const saved = (await admin.post('/providers/docusign/keys', { values: { DOCUSIGN_INTEGRATION_KEY: ` ${DOCUSIGN_APP.key} `, DOCUSIGN_SECRET_KEY: DOCUSIGN_APP.secret } }).expect(200)).body as Row;
    expect(saved).toMatchObject({ state: 'configured', configured: true });
    expect(field(saved, 'DOCUSIGN_SECRET_KEY')).toMatchObject({ set: true, source: 'console', hint: DOCUSIGN_APP.secret.slice(-4), updatedBy: adminEmail });
    // Values never come back, from either endpoint.
    for (const body of [saved, (await support.get('/providers').expect(200)).body]) {
      expect(JSON.stringify(body)).not.toContain(DOCUSIGN_APP.secret);
      expect(JSON.stringify(body)).not.toContain(DOCUSIGN_APP.key);
    }
    // Sealed at rest.
    const db = appClient();
    const stored = await db.platformSecret.findUnique({ where: { name: 'DOCUSIGN_SECRET_KEY' } });
    await db.$disconnect();
    expect(stored!.valueEnc.startsWith('v1.')).toBe(true);
    expect(stored!.valueEnc).not.toContain(DOCUSIGN_APP.secret);

    const log = (await admin.get('/audit-log').expect(200)).body as { action: string; operator: { email: string }; metadata: Record<string, unknown> }[];
    const sets = log.filter((l) => l.action === 'provider_key.set' && l.metadata.provider === 'docusign' && l.operator.email === adminEmail);
    expect(sets.map((l) => l.metadata.name).sort()).toEqual(['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY']);
    expect(sets[0]!.operator.email).toBe(adminEmail);
    expect(sets.every((l) => /^[0-9a-f]{12}$/.test(String(l.metadata.fingerprint)))).toBe(true);
    expect(JSON.stringify(log)).not.toContain(DOCUSIGN_APP.secret);

    // No restart: the same running app now offers DocuSign and sends the new integration key to DocuSign.
    const after = ((await api(owner).get('/apps').expect(200)).body as { key: string; state: string; missingConfig: string[] }[]).find((a) => a.key === 'docusign')!;
    expect(after.state).not.toBe('pending_configuration');
    expect(after.missingConfig).toEqual([]);
    const { url } = (await api(owner).post('/apps/docusign/connect', {}).expect(200)).body as { url: string };
    expect(new URL(url).searchParams.get('client_id')).toBe(DOCUSIGN_APP.key);

    // Test connection with the console keys, then with a wrong secret.
    expect((await admin.post('/providers/docusign/check').expect(200)).body).toMatchObject({ state: 'verified', lastCheck: { ok: true, stale: false } });
    await admin.post('/providers/docusign/keys', { values: { DOCUSIGN_SECRET_KEY: 'not-the-right-secret' } }).expect(200);
    expect((await row(admin, 'docusign')).state).toBe('configured'); // a new key makes the old test stale
    expect((await admin.post('/providers/docusign/check').expect(200)).body).toMatchObject({ state: 'failed', lastCheck: { ok: false, message: 'DocuSign refused the client ID or secret (invalid_client).' } });
  });

  it('removing a console value falls back to the environment variable; non-secrets are shown in full', async () => {
    const { admin } = await boot({ DOCUSIGN_INTEGRATION_KEY: 'env-docusign-client-id', DOCUSIGN_SECRET_KEY: 'env-docusign-client-secret' });
    // Left from the previous test: the console value wins over the environment.
    expect(field(await row(admin, 'docusign'), 'DOCUSIGN_SECRET_KEY')).toMatchObject({ source: 'console', hint: 'cret' });
    const cleared = (await admin.post('/providers/docusign/keys', { values: { DOCUSIGN_INTEGRATION_KEY: null, DOCUSIGN_SECRET_KEY: null } }).expect(200)).body as Row;
    expect(field(cleared, 'DOCUSIGN_SECRET_KEY')).toMatchObject({ source: 'environment', set: true, hint: 'cret', updatedBy: null });
    expect(field(cleared, 'DOCUSIGN_INTEGRATION_KEY')).toMatchObject({ source: 'environment', hint: 't-id' });
    const log = (await admin.get('/audit-log').expect(200)).body as { action: string; metadata: Record<string, unknown> }[];
    expect(log.filter((l) => l.action === 'provider_key.cleared').map((l) => l.metadata.name)).toEqual(expect.arrayContaining(['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY']));

    const mail = (await admin.post('/providers/smtp/keys', { values: { MAIL_FROM: 'SampForce <no-reply@dealflow.test>', SMTP_URL: null } }).expect(200)).body as Row;
    expect(field(mail, 'MAIL_FROM')).toMatchObject({ secret: false, hint: 'SampForce <no-reply@dealflow.test>' });
  });

  it('refuses values the environment variable would refuse, keys of another provider, and unknown providers', async () => {
    const { admin } = await boot();
    const bad = (await admin.post('/providers/smtp/keys', { values: { SMTP_URL: 'http://mail.example.com' } }).expect(400)).body;
    expect(bad.error).toMatchObject({ code: 'VALIDATION_FAILED', message: 'SMTP_URL must start with smtp:// or smtps://' });
    // A password with # in it, not escaped, is caught on save with the fix (a Zoho-style address in the user name is fine).
    const hash = (await admin.post('/providers/smtp/keys', { values: { SMTP_URL: 'smtps://user%40example.com:pa#ss@smtppro.zoho.in:465' } }).expect(400)).body;
    expect(hash.error.message).toMatch(/%23/);
    const port = (await admin.post('/providers/smtp/keys', { values: { SMTP_URL: 'smtps://user%40example.com:pass@smtppro.zoho.in:587' } }).expect(400)).body;
    expect(port.error.message).toMatch(/Port 587 uses STARTTLS/);
    expect((await admin.post('/providers/docusign/keys', { values: { HUNTER_API_KEY: 'k' } }).expect(400)).body.error.message).toBe('DocuSign does not use HUNTER_API_KEY.');
    await admin.post('/providers/docusign/keys', { values: { ENCRYPTION_KEY: 'k'.repeat(40) } }).expect(400);
    await admin.post('/providers/docusign/keys', { values: { DOCUSIGN_INTEGRATION_KEY: 'line\nbreak' } }).expect(400);
    await admin.post('/providers/docusign/keys', { values: {} }).expect(400);
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
    expect((await admin.post('/providers/smtp/check').expect(200)).body).toMatchObject({ state: 'verified', lastCheck: { message: expect.stringMatching(/^Connected to 127\.0\.0\.1 port \d+ \(STARTTLS when offered\)\. No email was sent\.$/) } });
    expect(smtp.messages.length).toBe(sent);
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/request').set('origin', ORIGIN).send({ email: owner.email }).expect(202);
    for (let i = 0; i < 25 && smtp.messages.length === sent; i++) await sleep(100);
    expect(smtp.messages.at(-1)!.to).toEqual([owner.email]);
  });

  it('takes the email service as separate host, port, SSL/TLS, user and password settings, like Nodemailer', async () => {
    const { app, admin } = await boot();
    const owner = await registerUser(app, 'Keys Mail Fields Ltd');
    const port = String(new URL(smtp.url).port);
    // Only the sender: not enough yet.
    const half = (await admin.post('/providers/smtp/keys', { values: { MAIL_FROM: 'SampForce <no-reply@dealflow.test>', SMTP_URL: null } }).expect(200)).body as Row;
    expect(half.state).toBe('not_configured');
    expect((await admin.post('/providers/smtp/check').expect(400)).body.error.message).toBe('Add the SMTP server (or an SMTP URL) first.');

    // SSL/TLS switched on against a server that only speaks plain SMTP and STARTTLS: the test says which switch is wrong.
    await admin.post('/providers/smtp/keys', { values: { SMTP_HOST: '127.0.0.1', SMTP_PORT: port, SMTP_SECURE: 'true', SMTP_USER: 'sales@dealflow.test', SMTP_PASSWORD: 'app-specific-secret-9x9x' } }).expect(200);
    const wrong = (await admin.post('/providers/smtp/check').expect(200)).body as Row;
    expect(wrong.state).toBe('failed');
    expect(wrong.lastCheck!.message).toMatch(/did not start an encrypted connection the expected way.*Port 465 needs SSL\/TLS on/);
    expect(JSON.stringify(wrong)).not.toContain('app-specific-secret-9x9x');

    // Off, and without sign-in (the stand-in has none): verified, and system email goes out through it.
    await admin.post('/providers/smtp/keys', { values: { SMTP_SECURE: 'false', SMTP_USER: null, SMTP_PASSWORD: null } }).expect(200);
    const ok = (await admin.post('/providers/smtp/check').expect(200)).body as Row;
    expect(ok).toMatchObject({ state: 'verified', lastCheck: { message: `Connected to 127.0.0.1 port ${port} (STARTTLS when offered). No email was sent.` } });
    const sent = smtp.messages.length;
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/request').set('origin', ORIGIN).send({ email: owner.email }).expect(202);
    for (let i = 0; i < 25 && smtp.messages.length === sent; i++) await sleep(100);
    expect(smtp.messages.at(-1)!.to).toEqual([owner.email]);
  });

  it('connection tests for Google, Microsoft, DocuSign, Stripe, Razorpay and Zapier', async () => {
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
    expect(await check('docusign', { DOCUSIGN_INTEGRATION_KEY: DOCUSIGN_APP.key, DOCUSIGN_SECRET_KEY: DOCUSIGN_APP.secret })).toMatchObject({ ok: true });
    expect(await check('docusign', { DOCUSIGN_SECRET_KEY: 'ds-wrong' })).toMatchObject({ ok: false });
    expect(await check('stripe', { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toMatchObject({ ok: true, message: 'Key accepted (test mode). Nothing was charged.' });
    expect(await check('stripe', { STRIPE_SECRET_KEY: 'sk_test_wrong' })).toMatchObject({ ok: false, message: 'Stripe refused the secret key (401). Check STRIPE_SECRET_KEY.' });
    expect(await check('razorpay', { RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'rzp_fixture_secret', RAZORPAY_WEBHOOK_SECRET: 'w' })).toMatchObject({ ok: true, message: 'Keys accepted (test mode). Nothing was charged.' });
    expect(await check('zapier', { ZAPIER_INVITE_URL: `${ai.url}/health` })).toMatchObject({ ok: true, message: 'The invite link opens (HTTP 200).' });
    expect(await check('zapier', { ZAPIER_INVITE_URL: `${ai.url}/missing-invite` })).toMatchObject({ ok: false });
    // A test with keys missing is refused before any call.
    expect((await admin.post('/providers/hunter/check').expect(400)).body.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'Add HUNTER_API_KEY first.' });
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
  it('production: keys live only in the database; old environment values are copied in once and then ignored (ADR 0059)', async () => {
    await clean();
    const prodKey = randomBytes(32).toString('base64');
    const production = { NODE_ENV: 'production', ALLOW_INSECURE_COOKIES: 'true', ENCRYPTION_KEY: prodKey, ALLOW_PRIVATE_NETWORK_TARGETS: undefined };
    const oldServer = { ...production, DOCUSIGN_INTEGRATION_KEY: 'env-docusign-client-id', DOCUSIGN_SECRET_KEY: 'env-docusign-client-secret-wxyz', PRICING_PUBLISHED: 'true', MICROSOFT_TENANT: 'common' };

    // A server installed before ADR 0059 starts with keys in its settings file: they are copied into the database.
    const first = await boot(oldServer);
    const dsRow = await row(first.admin, 'docusign');
    expect(field(dsRow, 'DOCUSIGN_SECRET_KEY')).toMatchObject({ source: 'console', imported: true, set: true, hint: 'wxyz', updatedBy: null });
    expect(field(dsRow, 'DOCUSIGN_INTEGRATION_KEY')).toMatchObject({ source: 'console', imported: true });
    expect(field(await row(first.admin, 'checkout'), 'PRICING_PUBLISHED')).toMatchObject({ source: 'console', imported: true, hint: 'true' });
    // A value equal to the built-in default is not copied: the default applies anyway.
    expect(field(await row(first.admin, 'microsoft'), 'MICROSOFT_TENANT')).toMatchObject({ source: 'default' });
    const db = appClient();
    const stored = await db.platformSecret.findUniqueOrThrow({ where: { name: 'DOCUSIGN_SECRET_KEY' } });
    expect(stored.valueEnc).not.toContain('env-docusign-client-secret'); // sealed with ENCRYPTION_KEY
    expect(stored.updatedById).toBeNull();
    const imports = await db.platformAuditLog.findMany({ where: { action: 'provider_key.imported' } });
    expect(imports.map((l) => (l.metadata as { name: string }).name)).toEqual(expect.arrayContaining(['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY', 'PRICING_PUBLISHED']));
    expect(JSON.stringify(imports)).not.toContain('env-docusign-client-secret');
    // The app really uses the database value: DocuSign is set up for workspaces.
    const owner = await registerUser(first.app, 'Keys Prod Ltd');
    expect(((await api(owner).get('/apps').expect(200)).body as { key: string; state: string }[]).find((a) => a.key === 'docusign')!.state).not.toBe('pending_configuration');

    // Removing a key in the console removes it: the environment value is not a fallback in production.
    const cleared = (await first.admin.post('/providers/docusign/keys', { values: { DOCUSIGN_SECRET_KEY: null } }).expect(200)).body as Row;
    expect(field(cleared, 'DOCUSIGN_SECRET_KEY')).toMatchObject({ source: 'missing', set: false });
    expect(((await api(owner).get('/apps').expect(200)).body as { key: string; state: string }[]).find((a) => a.key === 'docusign')!.state).toBe('pending_configuration');

    // A restart with the same settings file does not bring the removed key back.
    const restarted = await boot(oldServer);
    expect(field(await row(restarted.admin, 'docusign'), 'DOCUSIGN_SECRET_KEY')).toMatchObject({ source: 'missing', set: false });
    expect(field(await row(restarted.admin, 'docusign'), 'DOCUSIGN_INTEGRATION_KEY')).toMatchObject({ source: 'console', imported: true });

    // A key typed into the console is not overwritten by a different value left in the file.
    await restarted.admin.post('/providers/docusign/keys', { values: { DOCUSIGN_SECRET_KEY: 'console-docusign-secret-1234' } }).expect(200);
    const again = await boot({ ...oldServer, DOCUSIGN_SECRET_KEY: 'another-env-docusign-secret-5678' });
    expect(field(await row(again.admin, 'docusign'), 'DOCUSIGN_SECRET_KEY')).toMatchObject({ source: 'console', imported: false, hint: '1234', updatedBy: adminEmail });

    // A brand-new install has nothing in its settings file: everything is entered in the console, nothing comes from env.
    await clean();
    const fresh = await boot(production);
    expect(field(await row(fresh.admin, 'docusign'), 'DOCUSIGN_SECRET_KEY')).toMatchObject({ source: 'missing', set: false });
    expect(field(await row(fresh.admin, 'checkout'), 'PRICING_PUBLISHED')).toMatchObject({ source: 'default' });

    // The API and the worker start at the same moment: both import, exactly one row is written, neither fails.
    await clean();
    const keys = first.app.get(ProviderKeysService);
    const [a, b] = await Promise.all([keys.importFromEnvironment(), keys.importFromEnvironment()]);
    expect([...a, ...b].filter((n) => n === 'DOCUSIGN_SECRET_KEY')).toHaveLength(1);
    expect(await db.platformSecret.count({ where: { name: 'DOCUSIGN_SECRET_KEY' } })).toBe(1);
    await db.$disconnect();
    await clean(); // the rest of the suite runs outside production with the development key
  }, 60_000);
});
