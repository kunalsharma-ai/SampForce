import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../src/auth/password.service';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { createOpenAiFixture, type OpenAiFixture } from './fixtures/openai-fixture';
import { startSmtpFixture, type SmtpFixture } from './fixtures/smtp-fixture';
import { api, appClient, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/**
 * A workspace's own AI keys or AI server and its own email server (ADR 0068): entered under Integrations, sealed in
 * the database, used before the deployment's shared providers, and free of AI credits.
 */

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

/** A port nothing listens on. */
async function deadPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const AI_NAMES = ['ANTHROPIC_API_KEY', 'AI_MODEL', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'GROQ_MODEL', 'OPENROUTER_API_KEY', 'MISTRAL_API_KEY', 'CUSTOM_AI_BASE_URL', 'CUSTOM_AI_API_KEY', 'CUSTOM_AI_MODEL', 'AI_PROVIDER_ORDER', 'SMTP_URL', 'MAIL_FROM'];

describe('a workspace’s own AI and email servers (ADR 0068)', () => {
  let claude: AiFixture;
  let compat: OpenAiFixture;
  let restore: () => void;
  let app: INestApplication;
  let u: TestUser;
  let operator: (p: string, b: object) => request.Test;
  const opEmail = `own-${randomUUID().slice(0, 8)}@platform.test`;
  const h = () => api(u);
  const usage = () => asTenant(u.tenantId, (tx) => tx.aiUsage.findMany({ where: { tenantId: u.tenantId }, orderBy: { createdAt: 'asc' } }));
  const ask = () => h().post('/ai/copilot', { question: 'How does this quarter’s pipeline look?' });

  beforeAll(async () => {
    claude = await createAiFixture();
    compat = await createOpenAiFixture();
    restore = setEnv({
      ...Object.fromEntries(AI_NAMES.map((k) => [k, undefined])),
      OPERATOR_JWT_SECRET: 'operator-secret-that-is-at-least-32-chars',
      PROVIDER_KEYS_REFRESH_SECONDS: '1',
      AI_API_BASE_URL: claude.url,
      OPENAI_API_BASE_URL: compat.url, GEMINI_API_BASE_URL: compat.url, GROQ_API_BASE_URL: compat.url, OPENROUTER_API_BASE_URL: compat.url, MISTRAL_API_BASE_URL: compat.url,
    });
    const db = appClient();
    await db.platformSecret.deleteMany({});
    await db.platformOperator.create({ data: { email: opEmail, name: 'Own Ops', passwordHash: await new PasswordService().hash('operator-password-1'), role: 'ADMIN' } });
    await db.$disconnect();
    app = await startApp();
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: opEmail, password: 'operator-password-1' }).expect(200);
    operator = (p, b) => agent.post(`/api/v1/operator${p}`).set('origin', ORIGIN).send(b);
    u = await registerUser(app, 'Own Servers Co');
    const pipelines = (await h().get('/pipelines').expect(200)).body;
    const stage = pipelines[0].stages.find((s: { category: string }) => s.category === 'OPEN');
    await h().post('/deals', { name: 'Atlas renewal', amount: 40000, stageId: stage.id, probability: 50, expectedCloseDate: new Date().toISOString().slice(0, 10) }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    const db = appClient();
    await db.platformSecret.deleteMany({});
    await db.$disconnect();
    await claude.close();
    await compat.close();
    restore();
  });

  beforeEach(() => {
    claude.use(null);
    compat.use(null);
    compat.failWith(null);
  });

  it('is for workspace admins only', async () => {
    const member = await inviteMember(app, u, 'member');
    await api(member).get('/own-servers/ai').expect(403);
    await api(member).put('/own-servers/email', { host: 'smtp.example.com', port: 587, security: 'starttls', fromAddress: 'a@example.com' }).expect(403);
  });

  it('answers through the workspace’s own free key when the deployment has no AI provider, at no AI credit cost', async () => {
    expect((await h().get('/ai/status').expect(200)).body.provider).toMatchObject({ configured: false });
    await ask().expect(503);

    await h().put('/own-servers/ai', { providers: [{ kind: 'gemini' }], useShared: true }).expect(400);
    const saved = (await h().put('/own-servers/ai', { providers: [{ kind: 'groq', apiKey: 'gsk_workspace_own_key_9q9q' }], useShared: true }).expect(200)).body;
    expect(saved).toMatchObject({ configured: true, useShared: true, sharedAvailable: false, providers: [{ kind: 'groq', name: 'Groq', model: 'llama-3.3-70b-versatile', keyHint: '9q9q', hasKey: true }] });
    expect(JSON.stringify(saved)).not.toContain('gsk_workspace_own_key');
    const row = await asTenant(u.tenantId, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: u.tenantId, provider: 'AI' } } }));
    expect(JSON.stringify(row)).not.toContain('gsk_workspace_own_key'); // sealed

    const status = (await h().get('/ai/status').expect(200)).body;
    expect(status.provider).toMatchObject({ configured: true, name: 'Groq (your workspace)', model: 'llama-3.3-70b-versatile' });
    expect(status.agents.every((a: { available: boolean }) => a.available)).toBe(true);

    const before = compat.requests.length;
    const res = (await ask().expect(200)).body;
    expect(res).toMatchObject({ status: 'SUCCEEDED', toolsUsed: ['pipeline_summary'] });
    const sent = compat.requests.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((r) => r.headers.authorization === 'Bearer gsk_workspace_own_key_9q9q')).toBe(true);
    const rows = (await usage()).slice(-sent.length);
    expect(rows.every((r) => r.provider === 'own:groq' && r.credits === 0 && r.status === 'ok')).toBe(true);

    const tested = (await h().post('/own-servers/ai/groq/test').expect(200)).body;
    expect(tested).toMatchObject({ ok: true });
    expect(tested.message).toMatch(/Groq answered with llama-3.3-70b-versatile/);
    expect((await h().get('/own-servers/ai').expect(200)).body.providers[0].lastOkAt).toBeTruthy();
  });

  it('keeps a saved key when it is not typed again, and tries an own AI server first, moving on when it is down', async () => {
    const down = await deadPort();
    await h().put('/own-servers/ai', { providers: [{ kind: 'custom_ai', model: 'llama3.1' }, { kind: 'groq' }], useShared: true }).expect(400); // needs an address
    const saved = (await h().put('/own-servers/ai', { providers: [{ kind: 'custom_ai', baseUrl: `http://127.0.0.1:${down}/v1`, model: 'llama3.1' }, { kind: 'groq' }], useShared: true }).expect(200)).body;
    expect(saved.providers.map((p: { kind: string }) => p.kind)).toEqual(['custom_ai', 'groq']);
    expect(saved.providers[1]).toMatchObject({ keyHint: '9q9q', hasKey: true });
    expect(saved.providers[0]).toMatchObject({ hasKey: false, baseUrl: `http://127.0.0.1:${down}/v1`, model: 'llama3.1' });

    const status = (await h().get('/ai/status').expect(200)).body.provider;
    expect(status).toMatchObject({ name: 'Own AI server (OpenAI-compatible) (your workspace)', fallbacks: [{ name: 'Groq (your workspace)' }] });

    const before = compat.requests.length;
    expect((await ask().expect(200)).body.status).toBe('SUCCEEDED');
    expect(compat.requests.length).toBeGreaterThan(before); // Groq answered
    await new Promise((r) => setTimeout(r, 200));
    const own = (await h().get('/own-servers/ai').expect(200)).body;
    expect(own.providers[0].lastError.message).toMatch(/^Your AI server could not be reached at 127\.0\.0\.1 port \d+ \(ECONNREFUSED\)/);

    const tested = (await h().post('/own-servers/ai/custom_ai/test').expect(200)).body;
    expect(tested).toMatchObject({ ok: false });
    expect(tested.message).toMatch(/ECONNREFUSED/);
  });

  it('falls back to the shared providers (which use AI credits) only when the workspace allows it', async () => {
    await operator('/providers/anthropic/keys', { values: { ANTHROPIC_API_KEY: 'sk-ant-shared-deployment-key' } }).expect(200);
    try {
      await h().put('/own-servers/ai', { providers: [{ kind: 'groq' }], useShared: true }).expect(200);
      const st = (await h().get('/ai/status').expect(200)).body.provider;
      expect(st).toMatchObject({ name: 'Groq (your workspace)', fallbacks: [{ name: 'Anthropic Claude', model: 'claude-opus-5-5' }] });
      expect((await h().get('/own-servers/ai').expect(200)).body.sharedAvailable).toBe(true);

      compat.failWith(401);
      const claudeBefore = claude.requests.length;
      expect((await ask().expect(200)).body.status).toBe('SUCCEEDED');
      expect(claude.requests.length).toBeGreaterThan(claudeBefore);
      const last = (await usage()).at(-1)!;
      expect(last.provider).toBe('anthropic');
      expect(last.credits).toBeGreaterThan(0);

      // Without the shared providers, a failing own key fails the request and the shared key is never used.
      await h().put('/own-servers/ai', { providers: [{ kind: 'groq', apiKey: 'gsk_second_workspace_key_2b2b' }], useShared: false }).expect(200);
      expect((await h().get('/ai/status').expect(200)).body.provider.fallbacks).toEqual([]);
      const claudeNow = claude.requests.length;
      const failed = (await ask()).body;
      expect(failed.status ?? failed.error?.code).not.toBe('SUCCEEDED');
      expect(claude.requests.length).toBe(claudeNow);
    } finally {
      await operator('/providers/anthropic/keys', { values: { ANTHROPIC_API_KEY: null } }).expect(200);
    }
  });

  it('keeps AI running on the workspace’s own key when the month’s AI credits are used up', async () => {
    await h().put('/own-servers/ai', { providers: [{ kind: 'groq' }], useShared: true }).expect(200);
    await asTenant(u.tenantId, (tx) => tx.aiSettings.update({ where: { tenantId: u.tenantId }, data: { monthlyCreditCap: 0 } }));
    try {
      expect((await ask().expect(200)).body.status).toBe('SUCCEEDED');
      expect((await usage()).at(-1)).toMatchObject({ provider: 'own:groq', credits: 0 });
      await h().del('/own-servers/ai').expect(200);
      expect((await h().get('/own-servers/ai').expect(200)).body).toMatchObject({ configured: false, providers: [] });
      expect((await ask().expect(503)).body.error.code).toBe('AI_NOT_CONFIGURED');
    } finally {
      await asTenant(u.tenantId, (tx) => tx.aiSettings.update({ where: { tenantId: u.tenantId }, data: { monthlyCreditCap: null } }));
    }
  });

  describe('email', () => {
    let own: SmtpFixture;
    let shared: SmtpFixture;
    const slug = `own-mail-${Date.now().toString(36)}`;
    let companyId: string;
    const invite = async (email: string) =>
      (await h().post('/portal/users', { companyId, email, name: email.split('@')[0], role: 'viewer' }).expect(201)).body as { emailed: boolean };

    beforeAll(async () => {
      own = await startSmtpFixture();
      shared = await startSmtpFixture();
      const s = (await h().get('/portal/settings').expect(200)).body;
      const body = { ...s, slug, enabled: true, title: 'Own mail projects' };
      delete body.url;
      delete body.updatedAt;
      await h().put('/portal/settings', body).expect(200);
      companyId = (await h().post('/companies', { name: 'Mail Buyer' }).expect(201)).body.id;
    });
    afterAll(async () => {
      await own.close().catch(() => undefined);
      await shared.close();
    });

    it('checks the server before saving it, and explains why it could not be reached', async () => {
      const down = await deadPort();
      const refused = (await h().put('/own-servers/email', { host: '127.0.0.1', port: down, security: 'none', fromAddress: 'sales@ownmail.test' }).expect(400)).body;
      expect(refused.error.message).toMatch(/^The email server could not be reached at 127\.0\.0\.1 port \d+ \(ECONNREFUSED\)/);
      expect((await h().get('/own-servers/email').expect(200)).body).toMatchObject({ configured: false, sharedAvailable: false });
    });

    it('sends the workspace’s portal invitations through its own server, even with no shared email service', async () => {
      const port = Number(new URL(own.url).port);
      const saved = (await h().put('/own-servers/email', { host: '127.0.0.1', port, security: 'none', username: '', fromAddress: 'sales@ownmail.test', fromName: 'Own Servers Sales' }).expect(200)).body;
      expect(saved).toMatchObject({ configured: true, host: '127.0.0.1', port, security: 'none', fromAddress: 'sales@ownmail.test', fromName: 'Own Servers Sales', hasPassword: false });
      expect(saved.lastOkAt).toBeTruthy();

      expect((await invite('buyer-one@mailbuyer.test')).emailed).toBe(true);
      const mail = own.messages.at(-1)!;
      expect(mail.to).toEqual(['buyer-one@mailbuyer.test']);
      expect(mail.from).toBe('sales@ownmail.test');
      expect(mail.raw).toMatch(/From: "?Own Servers Sales"? <sales@ownmail\.test>/);

      const test = (await h().post('/own-servers/email/test').expect(200)).body;
      expect(test).toMatchObject({ ok: true });
      expect(own.messages.at(-1)!.to).toEqual([u.email]);
    });

    it('falls back to the shared email service when the workspace’s own server is down', async () => {
      await operator('/providers/smtp/keys', { values: { SMTP_URL: shared.url, MAIL_FROM: 'SampForce <no-reply@dealflow.test>' } }).expect(200);
      try {
        await own.close();
        expect((await invite('buyer-two@mailbuyer.test')).emailed).toBe(true);
        expect(shared.messages.at(-1)!.to).toEqual(['buyer-two@mailbuyer.test']);
        await new Promise((r) => setTimeout(r, 200));
        const st = (await h().get('/own-servers/email').expect(200)).body;
        expect(st.sharedAvailable).toBe(true);
        expect(st.lastError.message).toMatch(/ECONNREFUSED/);

        await h().del('/own-servers/email').expect(200);
        expect((await h().get('/own-servers/email').expect(200)).body.configured).toBe(false);
      } finally {
        await operator('/providers/smtp/keys', { values: { SMTP_URL: null, MAIL_FROM: null } }).expect(200);
      }
    });
  });
});
