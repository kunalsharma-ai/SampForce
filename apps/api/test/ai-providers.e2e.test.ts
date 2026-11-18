import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { createOpenAiFixture, type OpenAiFixture } from './fixtures/openai-fixture';
import { api, appClient, asTenant, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/**
 * AI providers besides Anthropic, entered in the operator console and kept in the database, with a fallback order
 * (ADR 0067). Every OpenAI-compatible provider is played by one local stand-in that answers with the same rule set as
 * the Claude fixture, so Copilot's tool loop and the structured agents run end to end through the OpenAI adapter.
 */

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

const AI_NAMES = ['ANTHROPIC_API_KEY', 'AI_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GROQ_API_KEY', 'GROQ_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL',
  'MISTRAL_API_KEY', 'MISTRAL_MODEL', 'CUSTOM_AI_BASE_URL', 'CUSTOM_AI_API_KEY', 'CUSTOM_AI_MODEL', 'AI_PROVIDER_ORDER'];

const clean = async () => {
  const db = appClient();
  await db.platformSecret.deleteMany({});
  await db.platformSetting.deleteMany({ where: { OR: [{ key: { startsWith: 'provider_check:' } }, { key: { startsWith: 'ai_provider_health:' } }] } });
  await db.$disconnect();
};

type Row = {
  key: string; name: string; group: string | null; state: string; configured: boolean; appStatus: string;
  env: { name: string; source: string; hint: string | null }[];
  lastCheck: { ok: boolean; message: string } | null;
  ai: { enabled: boolean; position: number | null; model: string | null; health: { lastOkAt: string | null; lastFailure: { kind: string; message: string } | null; coolingUntil: string | null } | null } | null;
};

describe('AI providers besides Anthropic, with fallback (ADR 0067)', () => {
  let claude: AiFixture;
  let compat: OpenAiFixture;
  let restore: () => void;
  let app: INestApplication;
  let u: TestUser;
  let admin: { get: (u: string) => request.Test; post: (u: string, b?: object) => request.Test };
  const email = `ai-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';
  const h = () => api(u);
  const rows = async () => (await admin.get('/providers').expect(200)).body as Row[];
  const row = async (key: string) => (await rows()).find((r) => r.key === key)!;
  const usage = () => asTenant(u.tenantId, (tx) => tx.aiUsage.findMany({ where: { tenantId: u.tenantId }, orderBy: { createdAt: 'asc' } }));
  const askPipeline = () => h().post('/ai/copilot', { question: 'How does this quarter’s pipeline look?' }).expect(200);

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
    await clean();
    const db = appClient();
    await db.platformOperator.create({ data: { email, name: 'Ada AI', passwordHash: await new PasswordService().hash(password), role: 'ADMIN' } });
    await db.$disconnect();
    app = await startApp();
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password }).expect(200);
    admin = { get: (p: string) => agent.get(`/api/v1/operator${p}`), post: (p: string, b: object = {}) => agent.post(`/api/v1/operator${p}`).set('origin', ORIGIN).send(b) };
    u = await registerUser(app, 'Free AI Co');
    await asTenant(u.tenantId, (tx) => tx.subscription.update({ where: { tenantId: u.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    const pipelines = (await h().get('/pipelines').expect(200)).body;
    const stage = pipelines[0].stages.find((s: { category: string }) => s.category === 'OPEN');
    await h().post('/deals', { name: 'Atlas renewal', amount: 40000, stageId: stage.id, probability: 50, expectedCloseDate: new Date().toISOString().slice(0, 10) }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await clean();
    await claude.close();
    await compat.close();
    restore();
  });

  beforeEach(() => {
    claude.use(null);
    compat.use(null);
    compat.failWith(null);
  });

  it('lists every AI provider together in the console, none of them configured yet', async () => {
    const all = await rows();
    const ai = all.filter((r) => r.group === 'ai').map((r) => r.key);
    expect(ai).toEqual(['ai_routing', 'anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'mistral', 'custom_ai']);
    expect((await row('ai_routing')).appStatus).toBe('No AI provider has keys, so AI features say they are not configured');
    expect((await row('gemini')).ai).toMatchObject({ enabled: true, position: null, model: 'gemini-2.5-flash', health: null });
    const status = (await h().get('/ai/status').expect(200)).body;
    expect(status.provider).toMatchObject({ configured: false, fallbacks: [] });
    expect(status.provider.note).toMatch(/Google Gemini, Groq, OpenRouter, Mistral/);
  });

  it('runs Copilot and structured agents on a free Groq key saved in the console, with no Anthropic key', async () => {
    const saved = (await admin.post('/providers/groq/keys', { values: { GROQ_API_KEY: 'gsk_console_groq_key_0001' } }).expect(200)).body as Row;
    expect(saved).toMatchObject({ configured: true, appStatus: 'Answers AI requests first', ai: { position: 1 } });
    expect(saved.env.find((f) => f.name === 'GROQ_API_KEY')).toMatchObject({ source: 'console', hint: '0001' });
    const stored = await appClient().platformSecret.findUnique({ where: { name: 'GROQ_API_KEY' } });
    expect(stored?.valueEnc).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain('gsk_console_groq_key_0001'); // sealed in the database

    const status = (await h().get('/ai/status').expect(200)).body;
    expect(status.provider).toMatchObject({ configured: true, name: 'Groq', model: 'llama-3.3-70b-versatile', fallbacks: [] });

    const before = compat.requests.length;
    const res = (await askPipeline()).body;
    expect(res).toMatchObject({ status: 'SUCCEEDED', toolsUsed: ['pipeline_summary'] });
    expect(res.answer).toMatch(/weighted open pipeline 20000/);
    const sent = compat.requests.slice(before);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.headers.authorization).toBe('Bearer gsk_console_groq_key_0001');
    expect(sent[0]!.body).toMatchObject({ model: 'llama-3.3-70b-versatile', max_completion_tokens: expect.any(Number) });
    expect(sent[0]!.body.messages[0]!.role).toBe('system');
    expect(sent[0]!.body.tools!.map((t) => t.function.name)).toContain('pipeline_summary');
    // The second call carries the tool call and its result in chat-completions form.
    const second = sent[1]!.body.messages;
    expect(second.find((m) => m.role === 'assistant')?.tool_calls?.[0]?.function.name).toBe('pipeline_summary');
    expect(second.find((m) => m.role === 'tool')?.content).toContain('weighted');

    // A structured agent: Groq gets json_object plus the schema in the prompt, and the answer is validated as usual.
    const lead = (await h().post('/leads', { fullName: 'Quinn Q', email: 'q@buyer.test', jobTitle: 'Head of Ops', companyName: 'Buyer', estimatedValue: 15000, source: 'Website' }).expect(201)).body.lead;
    const rec = (await h().post(`/ai/leads/${lead.id}/qualify`).expect(200)).body;
    expect(rec.payload).toMatchObject({ grade: 'C', summary: 'Grade C lead scoring 48 from 6 signals.', summaryUnavailable: null });
    const last = compat.requests.at(-1)!.body;
    expect(last.response_format).toEqual({ type: 'json_object' });
    expect(last.messages[0]!.content).toContain('It must match this JSON schema');

    const rowsNow = await usage();
    expect(rowsNow.map((r) => r.provider)).toEqual(['groq', 'groq', 'groq']);
    expect(rowsNow.every((r) => r.status === 'ok' && r.model === 'llama-3.3-70b-versatile')).toBe(true);
  });

  it('falls back to the next provider when the first is rate limited, rests it, and shows why in the console', async () => {
    await admin.post('/providers/anthropic/keys', { values: { ANTHROPIC_API_KEY: 'sk-ant-console-fallback-01' } }).expect(200);
    const routing = (await admin.post('/providers/ai_routing/keys', { values: { AI_PROVIDER_ORDER: 'anthropic, groq' } }).expect(200)).body as Row;
    expect(routing.env[0]).toMatchObject({ source: 'console', hint: 'anthropic,groq' });
    expect(routing.appStatus).toBe('Anthropic Claude answers first, then Groq');
    expect((await h().get('/ai/status').expect(200)).body.provider).toMatchObject({ name: 'Anthropic Claude', fallbacks: [{ name: 'Groq', model: 'llama-3.3-70b-versatile' }] });

    // Anthropic's free quota is used up: Copilot still answers, from Groq.
    claude.use(() => ({ content: [], status: 429 }));
    const claudeBefore = claude.requests.length;
    const groqBefore = compat.requests.length;
    const res = (await askPipeline()).body;
    expect(res.status).toBe('SUCCEEDED');
    expect(res.answer).toMatch(/weighted open pipeline 20000/);
    expect(claude.requests.length - claudeBefore).toBe(2); // one try plus the SDK's single retry, then it moves on
    expect(compat.requests.length - groqBefore).toBe(2); // both calls of the tool loop
    const recent = (await usage()).slice(-2);
    expect(recent.map((r) => r.provider)).toEqual(['groq', 'groq']);

    // Anthropic rests now, so the next request goes straight to Groq without waiting on it.
    const again = claude.requests.length;
    await askPipeline();
    expect(claude.requests.length).toBe(again);

    await new Promise((r) => setTimeout(r, 300)); // health is written in the background
    const anth = await row('anthropic');
    expect(anth.ai!.health).toMatchObject({ lastFailure: { kind: 'rate_limited' }, coolingUntil: expect.any(String) });
    expect(Date.parse(anth.ai!.health!.coolingUntil!)).toBeGreaterThan(Date.now() + 30_000);
    expect((await row('groq')).ai!.health).toMatchObject({ lastOkAt: expect.any(String) });
  });

  it('keeps going through several free keys and reports every failure only when all of them fail', async () => {
    await admin.post('/providers/gemini/keys', { values: { GEMINI_API_KEY: 'AIza-console-gemini-key-01' } }).expect(200);
    await admin.post('/providers/ai_routing/keys', { values: { AI_PROVIDER_ORDER: 'groq,gemini' } }).expect(200);
    expect((await row('anthropic')).appStatus).toBe('Switched off in "AI providers and fallback order"');
    expect((await row('gemini')).appStatus).toBe('Fallback 1 of 1: answers when the providers before it are busy or failing');

    // Both stand-ins share one server; a 503 for everything means every provider fails.
    compat.failWith(503);
    const failed = (await h().post('/ai/copilot', { question: 'How does this quarter’s pipeline look?' })).body;
    expect(failed.status).toBe('FAILED');
    await new Promise((r) => setTimeout(r, 300));
    for (const key of ['groq', 'gemini']) {
      expect((await row(key)).ai!.health!.lastFailure, key).toMatchObject({ kind: 'unavailable', message: expect.stringMatching(/answered 503: upstream error/) });
    }
    const errors = (await usage()).filter((r) => r.status === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);

    // Groq is rate limited with Retry-After, Gemini answers (with the Gemini key) once the outage is over.
    compat.failWith(null);
    await new Promise((r) => setTimeout(r, 50));
    await admin.post('/providers/ai_routing/keys', { values: { AI_PROVIDER_ORDER: 'gemini,groq' } }).expect(200);
    const before = compat.requests.length;
    await askPipeline();
    const sent = compat.requests.slice(before);
    expect(sent.every((r) => r.headers.authorization === 'Bearer AIza-console-gemini-key-01')).toBe(true);
    expect(sent[0]!.body).toMatchObject({ model: 'gemini-2.5-flash', max_tokens: expect.any(Number) });
  });

  it('refuses an order that names unknown or repeated providers, and goes back to the built-in order on request', async () => {
    const bad = (await admin.post('/providers/ai_routing/keys', { values: { AI_PROVIDER_ORDER: 'groq,chatgpt' } }).expect(400)).body.error;
    expect(bad.details[0]).toMatchObject({ path: 'values.AI_PROVIDER_ORDER', message: expect.stringContaining('Unknown AI provider "chatgpt"') });
    await admin.post('/providers/ai_routing/keys', { values: { AI_PROVIDER_ORDER: 'groq,groq' } }).expect(400);
    const reset = (await admin.post('/providers/ai_routing/keys', { values: { AI_PROVIDER_ORDER: null } }).expect(200)).body as Row;
    expect(reset.env[0]!.source).toBe('missing');
    // Built-in order, as the console lists them: Anthropic, OpenAI, Gemini, Groq, OpenRouter, Mistral, self-hosted.
    expect(reset.appStatus).toBe('Anthropic Claude answers first, then Google Gemini, then Groq');
    await admin.post('/providers/ai_routing/check').expect(400);
  });

  it('tests each provider key with a free call, and a self-hosted server without a key', async () => {
    const groq = (await admin.post('/providers/groq/check').expect(200)).body as Row;
    expect(groq).toMatchObject({ state: 'verified', lastCheck: { ok: true, message: 'Key accepted (5 models listed; llama-3.3-70b-versatile is available). No tokens were used.' } });
    const gemini = (await admin.post('/providers/gemini/check').expect(200)).body as Row;
    expect(gemini.lastCheck!.message).toContain('gemini-2.5-flash is available'); // "models/" prefix ignored

    await admin.post('/providers/mistral/keys', { values: { MISTRAL_API_KEY: 'bad-mistral-console-key' } }).expect(200);
    const mistral = (await admin.post('/providers/mistral/check').expect(200)).body as Row;
    expect(mistral).toMatchObject({ state: 'failed', lastCheck: { ok: false, message: 'Mistral refused the API key (401). Check MISTRAL_API_KEY.' } });

    await admin.post('/providers/openrouter/keys', { values: { OPENROUTER_API_KEY: 'sk-or-v1-console-key-0001' } }).expect(200);
    const or = (await admin.post('/providers/openrouter/check').expect(200)).body as Row;
    expect(or.lastCheck!.message).toContain('free tier');

    // Ollama: an address and a model, no key. A model the server does not have is named in the failure.
    await admin.post('/providers/custom_ai/check').expect(400);
    await admin.post('/providers/custom_ai/keys', { values: { CUSTOM_AI_BASE_URL: `${compat.url}`, CUSTOM_AI_MODEL: 'llama3.2' } }).expect(200);
    const wrong = (await admin.post('/providers/custom_ai/check').expect(200)).body as Row;
    expect(wrong.lastCheck!.message).toMatch(/has no model called llama3.2\. It offers: .*llama3\.1/);
    await admin.post('/providers/custom_ai/keys', { values: { CUSTOM_AI_MODEL: 'llama3.1' } }).expect(200);
    const ok = (await admin.post('/providers/custom_ai/check').expect(200)).body as Row;
    expect(ok).toMatchObject({ state: 'verified', configured: true });

    // The self-hosted server answers Copilot too; its replies come in code fences, which the adapter unwraps.
    await admin.post('/providers/ai_routing/keys', { values: { AI_PROVIDER_ORDER: 'custom_ai' } }).expect(200);
    const before = compat.requests.length;
    const lead = (await h().post('/leads', { fullName: 'Olla Ma', email: 'olla@buyer.test', jobTitle: 'Head of Ops', companyName: 'Buyer', estimatedValue: 15000, source: 'Website' }).expect(201)).body.lead;
    const rec = (await h().post(`/ai/leads/${lead.id}/qualify`).expect(200)).body;
    expect(rec.payload.summary).toMatch(/^Grade C lead/);
    const sent = compat.requests.slice(before);
    expect(sent[0]!.headers.authorization).toBeUndefined();
    expect(sent[0]!.body.response_format).toBeUndefined();
    expect(sent[0]!.body.model).toBe('llama3.1');
  });
});
