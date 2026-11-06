import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { stripeSignature } from './fixtures/billing-fixture';
import { DOCUSIGN_APP } from './fixtures/docusign-fixture';
import { signZoomEvent, ZOOM_APP } from './fixtures/zoom-fixture';
import { api, appClient, ORIGIN, registerUser, startApp } from './helpers';

/**
 * Everything an integration needs is set up in the operator console (ADR 0053): settings that used to be
 * environment-only, the setup guide and its URLs, webhook receipts, and the short list that stays on the server.
 */

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

const PUBLIC = 'https://crm.dealflow.test';

const clean = async () => {
  const db = appClient();
  await db.platformSecret.deleteMany({});
  await db.platformSetting.deleteMany({ where: { OR: [{ key: { startsWith: 'provider_check:' } }, { key: { startsWith: 'webhook_receipt:' } }] } });
  await db.$disconnect();
};

type Field = { name: string; set: boolean; source: string; hint: string | null; secret: boolean; input: string };
type Row = {
  key: string; state: string; checkable: boolean; configured: boolean; appStatus: string; env: Field[];
  setup: { consoleUrl: string | null; steps: string[]; urls: { label: string; url: string; where: string }[] };
  webhook: { state: string; lastVerified: { event: string } | null; lastRejected: { reason: string } | null } | null;
};

const UNSET = Object.fromEntries(
  ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET',
    'ZOOM_WEBHOOK_SECRET_TOKEN', 'DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY', 'DOCUSIGN_CONNECT_HMAC_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ONLINE_PAYMENTS_ENABLED', 'STRIPE_PRICES', 'RAZORPAY_PLANS', 'STRIPE_AUTOMATIC_TAX', 'PRICING_PUBLISHED', 'SALES_CONTACT_EMAIL', 'AI_MODEL',
    'ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS'].map((k) => [k, undefined]),
);

describe('integrations set up entirely from the operator console', () => {
  let ai: AiFixture;
  let restore: () => void;
  let app: INestApplication;
  let admin: { get: (u: string) => request.Test; post: (u: string, b?: object) => request.Test };
  let support: typeof admin;
  const adminEmail = `setup-${randomUUID().slice(0, 8)}@platform.test`;
  const supportEmail = `setup-sup-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';
  const http = () => request(app.getHttpServer());
  const rows = async () => (await admin.get('/providers').expect(200)).body as Row[];
  const row = async (key: string) => (await rows()).find((r) => r.key === key)!;
  const field = (r: Row, name: string) => r.env.find((f) => f.name === name)!;
  const urlOf = (r: Row, label: string) => r.setup.urls.find((u) => u.label === label)!.url;

  beforeAll(async () => {
    ai = await createAiFixture();
    restore = setEnv({ ...UNSET, OPERATOR_JWT_SECRET: 'operator-secret-that-is-at-least-32-chars', PUBLIC_WEB_URL: PUBLIC, AI_API_BASE_URL: ai.url, PROVIDER_KEYS_REFRESH_SECONDS: '1' });
    await clean();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Ada Setup', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
    app = await startApp();
    const signIn = async (email: string) => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password }).expect(200);
      return { get: (u: string) => agent.get(`/api/v1/operator${u}`), post: (u: string, b: object = {}) => agent.post(`/api/v1/operator${u}`).set('origin', ORIGIN).send(b) };
    };
    admin = await signIn(adminEmail);
    support = await signIn(supportEmail);
  });

  afterAll(async () => {
    await app?.close();
    await clean();
    await ai.close();
    restore();
  });

  it('every provider has a setup guide, and each URL to paste is the one SampForce actually sends', async () => {
    const all = await rows();
    for (const r of all) expect(r.setup.steps.length, r.key).toBeGreaterThan(0);
    const sent = async (key: string, values: Record<string, string>, connect: string) => {
      await admin.post(`/providers/${key}/keys`, { values }).expect(200);
      const owner = await registerUser(app, `Guide ${key}`);
      const { url } = (await api(owner).post(connect, {}).expect(200)).body as { url: string };
      return new URL(url).searchParams.get('redirect_uri');
    };
    expect(await sent('slack', { SLACK_CLIENT_ID: 'slack-guide-id', SLACK_CLIENT_SECRET: 'slack-guide-secret' }, '/apps/slack/connect')).toBe(urlOf(all.find((r) => r.key === 'slack')!, 'Redirect URL'));
    expect(await sent('zoom', { ZOOM_CLIENT_ID: 'zoom-guide-id', ZOOM_CLIENT_SECRET: 'zoom-guide-secret' }, '/apps/zoom/connect')).toBe(urlOf(all.find((r) => r.key === 'zoom')!, 'OAuth redirect URL'));
    expect(await sent('docusign', { DOCUSIGN_INTEGRATION_KEY: 'ds-guide-key', DOCUSIGN_SECRET_KEY: 'ds-guide-secret' }, '/apps/docusign/connect')).toBe(urlOf(all.find((r) => r.key === 'docusign')!, 'Redirect URI'));
    expect(await sent('google', { GOOGLE_CLIENT_ID: 'g-guide-id', GOOGLE_CLIENT_SECRET: 'g-guide-secret' }, '/integrations/google/connect')).toBe(urlOf(all.find((r) => r.key === 'google')!, 'Authorised redirect URI'));
    expect(await sent('microsoft', { MICROSOFT_CLIENT_ID: 'm-guide-id', MICROSOFT_CLIENT_SECRET: 'm-guide-secret' }, '/integrations/microsoft/connect')).toBe(urlOf(all.find((r) => r.key === 'microsoft')!, 'Redirect URI (Web)'));
    // Every URL is on the deployment's public address, and each webhook URL is a real route (it answers, not 404 "no route").
    for (const r of all) for (const u of r.setup.urls) expect(u.url.startsWith(`${PUBLIC}/api/v1/`), u.url).toBe(true);
    for (const r of all.filter((x) => x.webhook)) {
      const path = new URL(r.setup.urls.at(-1)!.url).pathname;
      const res = await http().post(path).set('content-type', 'application/json').send('{}');
      expect(res.body?.error?.message ?? '', `${r.key} ${path}`).not.toMatch(/Cannot POST/);
    }
  });

  it('checkout switches, price ids, pricing page settings and the AI model are changed from the console, without a restart', async () => {
    const pricing = async () => (await http().get('/api/v1/public/pricing').expect(200)).body as { published: boolean; salesContact: string | null; onlinePayments: boolean; plans: { code: string; buyOnline: boolean }[] };
    const checkout = await row('checkout');
    expect(checkout).toMatchObject({ checkable: false, appStatus: expect.stringContaining('Offline invoices only') });
    expect(field(checkout, 'ONLINE_PAYMENTS_ENABLED')).toMatchObject({ input: 'switch', source: 'default', hint: 'false', secret: false });
    expect(await pricing()).toMatchObject({ published: false, salesContact: null, onlinePayments: false });

    // Support operators can read the settings but not change them; nothing to test for a group of settings.
    await support.post('/providers/checkout/keys', { values: { ONLINE_PAYMENTS_ENABLED: 'true' } }).expect(403);
    await admin.post('/providers/checkout/check').expect(400);

    // Bad values are refused with the reason, and nothing is stored.
    const bad = (await admin.post('/providers/checkout/keys', { values: { ONLINE_PAYMENTS_ENABLED: 'yes', STRIPE_PRICES: 'launch=price_1', SALES_CONTACT_EMAIL: 'not-an-email' } }).expect(400)).body.error;
    expect(bad.details.map((d: { path: string }) => d.path).sort()).toEqual(['values.ONLINE_PAYMENTS_ENABLED', 'values.SALES_CONTACT_EMAIL', 'values.STRIPE_PRICES']);
    expect(bad.details.find((d: { path: string }) => d.path === 'values.STRIPE_PRICES').message).toContain('Use plan:MONTH=id');

    // Stripe keys plus a price for Launch, then online payments on: Launch can be bought online straight away.
    await admin.post('/providers/stripe/keys', { values: { STRIPE_SECRET_KEY: 'sk_test_console_checkout', STRIPE_WEBHOOK_SECRET: 'whsec_console_checkout_1' } }).expect(200);
    const on = (await admin.post('/providers/checkout/keys', { values: { ONLINE_PAYMENTS_ENABLED: '1', STRIPE_PRICES: 'launch:MONTH=price_launch_m,launch:YEAR=price_launch_y', PRICING_PUBLISHED: 'true', SALES_CONTACT_EMAIL: 'sales@dealflow.test' } }).expect(200)).body as Row;
    expect(field(on, 'ONLINE_PAYMENTS_ENABLED')).toMatchObject({ source: 'console', hint: 'true' }); // "1" is stored as "true"
    expect(on.appStatus).toBe('Online checkout with Stripe, and offline invoices');
    const live = await pricing();
    expect(live).toMatchObject({ published: true, salesContact: 'sales@dealflow.test', onlinePayments: true });
    expect(live.plans.find((p) => p.code === 'launch')!.buyOnline).toBe(true);
    expect(live.plans.find((p) => p.code === 'growth')!.buyOnline).toBe(false); // no price set for it
    const owner = await registerUser(app, 'Checkout Console Ltd');
    const overview = (await api(owner).get('/billing').expect(200)).body as { providers: Record<string, boolean> };
    expect(overview.providers).toMatchObject({ STRIPE: true, RAZORPAY: false });

    // Off again: back to offline invoices only.
    await admin.post('/providers/checkout/keys', { values: { ONLINE_PAYMENTS_ENABLED: 'false' } }).expect(200);
    expect((await pricing()).onlinePayments).toBe(false);
    expect(((await api(owner).get('/billing').expect(200)).body as { providers: Record<string, boolean> }).providers.STRIPE).toBe(false);
    const log = (await admin.get('/audit-log').expect(200)).body as { action: string; metadata: Record<string, unknown> }[];
    expect(log.find((l) => l.action === 'provider_key.set' && l.metadata.name === 'ONLINE_PAYMENTS_ENABLED')!.metadata.value).toBe('false');

    // The AI model: shown with its default, changed from the console, and used by the next request at once.
    const anth = await row('anthropic');
    expect(field(anth, 'AI_MODEL')).toMatchObject({ source: 'default', hint: 'claude-opus-5-5', input: 'text' });
    await admin.post('/providers/anthropic/keys', { values: { ANTHROPIC_API_KEY: 'sk-ant-console-model-0001', AI_MODEL: 'claude-sonnet-5-5' } }).expect(200);
    const status = (await api(owner).get('/ai/status').expect(200)).body as { provider: { configured: boolean; model: string } };
    expect(status.provider).toMatchObject({ configured: true, model: 'claude-sonnet-5-5' });
    // Removing the console value falls back to the default.
    await admin.post('/providers/anthropic/keys', { values: { AI_MODEL: null } }).expect(200);
    expect(((await api(owner).get('/ai/status').expect(200)).body as { provider: { model: string } }).provider.model).toBe('claude-opus-5-5');
  });

  it('shows whether signed webhooks arrive: waiting, verified, stale after the secret changes, and refused', async () => {
    // Stripe keys are left from the previous test (whsec_console_checkout_1).
    expect((await row('stripe')).webhook).toMatchObject({ state: 'waiting', lastVerified: null, lastRejected: null });
    const body = JSON.stringify({ id: `evt_console_${Date.now()}`, type: 'customer.created', data: { object: { id: 'cus_1' } } });
    await http().post('/api/v1/billing/webhooks/stripe').set('content-type', 'application/json').set('stripe-signature', stripeSignature(body, undefined, 'whsec_console_checkout_1')).send(body).expect(200);
    expect((await row('stripe')).webhook).toMatchObject({ state: 'verified', lastVerified: { event: 'customer.created' } });

    // A new signing secret: the old receipt no longer proves anything.
    await admin.post('/providers/stripe/keys', { values: { STRIPE_WEBHOOK_SECRET: 'whsec_console_checkout_2' } }).expect(200);
    expect((await row('stripe')).webhook!.state).toBe('stale');
    // An event signed with the old secret is refused, and the console says why.
    await http().post('/api/v1/billing/webhooks/stripe').set('content-type', 'application/json').set('stripe-signature', stripeSignature(body, undefined, 'whsec_console_checkout_1')).send(body).expect(400);
    expect((await row('stripe')).webhook).toMatchObject({ state: 'rejected', lastRejected: { reason: 'The signature did not match the webhook signing secret.' } });

    // Zoom checks the event URL when it is saved in Zoom: that signed check alone turns the status green.
    await admin.post('/providers/zoom/keys', { values: { ZOOM_WEBHOOK_SECRET_TOKEN: ZOOM_APP.webhookSecret } }).expect(200);
    const z = signZoomEvent({ event: 'endpoint.url_validation', payload: { plainToken: 'plain-token-1' } });
    const res = await http().post('/api/v1/apps/zoom/events').set(z.headers).send(z.raw).expect(200);
    expect(res.body).toMatchObject({ plainToken: 'plain-token-1' });
    expect((await row('zoom')).webhook).toMatchObject({ state: 'verified', lastVerified: { event: 'endpoint.url_validation' } });

    // DocuSign: an event with the wrong HMAC is refused and shown as such. Nothing about the body is kept.
    await admin.post('/providers/docusign/keys', { values: { DOCUSIGN_CONNECT_HMAC_KEY: DOCUSIGN_APP.hmac } }).expect(200);
    await http().post('/api/v1/apps/docusign/events').set('content-type', 'application/json').set('x-docusign-signature-1', 'bm90LXRoZS1yaWdodC1zaWduYXR1cmU=').send('{"event":"envelope-sent","data":{"envelopeId":"secret-envelope"}}').expect(401);
    const ds = await row('docusign');
    expect(ds.webhook).toMatchObject({ state: 'rejected', lastRejected: { reason: 'The signature did not match the Connect HMAC key.' } });
    const db = appClient();
    const stored = await db.platformSetting.findMany({ where: { key: { startsWith: 'webhook_receipt:' } } });
    await db.$disconnect();
    expect(JSON.stringify(stored)).not.toContain('secret-envelope');
    expect(JSON.stringify(stored)).not.toContain('whsec_console_checkout');
    // Providers without webhooks have no webhook status.
    expect((await row('hunter')).webhook).toBeNull();
  });

  it('lists the few settings that stay on the server, with why, and never their secret values', async () => {
    const list = (await support.get('/deployment').expect(200)).body as { name: string; set: boolean; value: string | null; why: string }[];
    expect(list.map((d) => d.name)).toEqual(['DATABASE_URL', 'ENCRYPTION_KEY', 'JWT_ACCESS_SECRET', 'OPERATOR_JWT_SECRET', 'PUBLIC_WEB_URL', 'WEB_ORIGINS']);
    expect(list.find((d) => d.name === 'DATABASE_URL')).toMatchObject({ set: true, value: null });
    expect(list.find((d) => d.name === 'PUBLIC_WEB_URL')).toMatchObject({ set: true, value: PUBLIC });
    expect(list.every((d) => d.why.length > 20)).toBe(true);
    const raw = JSON.stringify(list);
    expect(raw).not.toContain('dealflow_app_dev');
    expect(raw).not.toContain(process.env.JWT_ACCESS_SECRET!);
    expect(raw).not.toContain('operator-secret-that-is-at-least-32-chars');
    // None of them can be saved from the console.
    for (const name of ['DATABASE_URL', 'PUBLIC_WEB_URL', 'OPERATOR_JWT_SECRET']) await admin.post('/providers/checkout/keys', { values: { [name]: 'x' } }).expect(400);
  });
});
