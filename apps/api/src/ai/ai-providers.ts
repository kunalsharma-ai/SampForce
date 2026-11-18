import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ApiEnv } from '../common/env';
import { OpenAiCompatibleProvider, type CompatibleProfile, type CompatibleTarget } from './openai-compatible';
import { AiProviderFailure, AnthropicProvider, type ModelProvider, type ModelRequest, type ModelResponse, type ProviderFailureKind, TransientProviderError } from './provider';

/** The AI providers SampForce can call, in the order they are tried when the operator has not chosen one (ADR 0067). */
export const AI_PROVIDER_KEYS = ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'mistral', 'custom_ai'] as const;
export type AiProviderKey = (typeof AI_PROVIDER_KEYS)[number];

interface AiProviderDef {
  key: AiProviderKey;
  name: string;
  /** Whether the keys it needs are set. */
  configured(env: ApiEnv): boolean;
  model(env: ApiEnv): string;
  /** Changes whenever a setting the client is built from changes, so a new key is used straight away. */
  signature(env: ApiEnv): string;
  build(env: ApiEnv): ModelProvider;
}

const isReasoningModel = (model: string) => /^(gpt-5|o\d)/i.test(model.replace(/^openai\//, ''));

const PROFILES: Record<Exclude<AiProviderKey, 'anthropic'>, CompatibleProfile> = {
  openai: { key: 'openai', name: 'OpenAI', json: 'schema', tokenParam: 'max_completion_tokens', effort: isReasoningModel },
  gemini: { key: 'gemini', name: 'Google Gemini', json: 'schema', tokenParam: 'max_tokens' },
  mistral: { key: 'mistral', name: 'Mistral', json: 'object', tokenParam: 'max_tokens', toolIds: 'mistral' },
  groq: { key: 'groq', name: 'Groq', json: 'object', tokenParam: 'max_completion_tokens' },
  openrouter: {
    key: 'openrouter', name: 'OpenRouter', json: 'prompt', tokenParam: 'max_tokens',
    // OpenRouter's optional attribution headers: the deployment's own address and product name.
    headers: (env) => ({ 'HTTP-Referer': env.PUBLIC_WEB_URL, 'X-Title': 'SampForce' }),
  },
  custom_ai: { key: 'custom_ai', name: 'Self-hosted or other (OpenAI-compatible)', json: 'prompt', tokenParam: 'max_tokens' },
};

const compatible = (
  profile: CompatibleProfile,
  target: (env: ApiEnv) => CompatibleTarget,
  configured: (env: ApiEnv) => boolean,
): AiProviderDef => ({
  key: profile.key as AiProviderKey,
  name: profile.name,
  configured,
  model: (env) => target(env).model,
  signature: (env) => {
    const t = target(env);
    return createHash('sha256').update(`${t.baseUrl}\n${t.apiKey ?? ''}\n${t.model}`).digest('hex');
  },
  // The target is read on every call, so a model changed in the console applies to the next request.
  build: (env) => new OpenAiCompatibleProvider(env, profile, () => target(env)),
});

export const AI_PROVIDER_DEFS: Record<AiProviderKey, AiProviderDef> = {
  anthropic: {
    key: 'anthropic',
    name: 'Anthropic Claude',
    configured: (env) => !!env.ANTHROPIC_API_KEY,
    model: (env) => env.AI_MODEL,
    signature: (env) => createHash('sha256').update(`${env.AI_API_BASE_URL}\n${env.ANTHROPIC_API_KEY ?? ''}`).digest('hex'),
    build: (env) => new AnthropicProvider(env),
  },
  openai: compatible(
    PROFILES.openai,
    (env) => ({ baseUrl: env.OPENAI_API_BASE_URL, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }),
    (env) => !!env.OPENAI_API_KEY,
  ),
  gemini: compatible(
    PROFILES.gemini,
    (env) => ({ baseUrl: env.GEMINI_API_BASE_URL, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    (env) => !!env.GEMINI_API_KEY,
  ),
  mistral: compatible(
    PROFILES.mistral,
    (env) => ({ baseUrl: env.MISTRAL_API_BASE_URL, apiKey: env.MISTRAL_API_KEY, model: env.MISTRAL_MODEL }),
    (env) => !!env.MISTRAL_API_KEY,
  ),
  groq: compatible(
    PROFILES.groq,
    (env) => ({ baseUrl: env.GROQ_API_BASE_URL, apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL }),
    (env) => !!env.GROQ_API_KEY,
  ),
  openrouter: compatible(
    PROFILES.openrouter,
    (env) => ({ baseUrl: env.OPENROUTER_API_BASE_URL, apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL }),
    (env) => !!env.OPENROUTER_API_KEY,
  ),
  custom_ai: compatible(
    PROFILES.custom_ai,
    (env) => ({ baseUrl: env.CUSTOM_AI_BASE_URL ?? '', apiKey: env.CUSTOM_AI_API_KEY, model: env.CUSTOM_AI_MODEL ?? '' }),
    // A local Ollama server needs no key: the address and the model are enough.
    (env) => !!env.CUSTOM_AI_BASE_URL && !!env.CUSTOM_AI_MODEL,
  ),
};

/** A workspace's own provider (ADR 0068): its key, model and, for an own server, address. */
export interface OwnProviderCreds {
  kind: AiProviderKey;
  apiKey: string | null;
  model: string;
  baseUrl: string | null;
}

/** Profiles and fixed endpoints of the compatible providers, reused for a workspace's own keys. */
const OWN_TARGET: Record<Exclude<AiProviderKey, 'anthropic'>, (env: ApiEnv) => string> = {
  openai: (env) => env.OPENAI_API_BASE_URL,
  gemini: (env) => env.GEMINI_API_BASE_URL,
  groq: (env) => env.GROQ_API_BASE_URL,
  openrouter: (env) => env.OPENROUTER_API_BASE_URL,
  mistral: (env) => env.MISTRAL_API_BASE_URL,
  custom_ai: () => '',
};

/** The default model of each provider, when a workspace leaves the model empty. */
export const defaultModel = (env: ApiEnv, kind: AiProviderKey): string =>
  kind === 'custom_ai' ? '' : AI_PROVIDER_DEFS[kind].model(Object.assign(Object.create(env) as ApiEnv, DEFAULT_MODELS));

const DEFAULT_MODELS = { AI_MODEL: 'claude-opus-5-5', OPENAI_MODEL: 'gpt-5-mini', GEMINI_MODEL: 'gemini-2.5-flash', GROQ_MODEL: 'llama-3.3-70b-versatile', OPENROUTER_MODEL: 'meta-llama/llama-3.3-70b-instruct:free', MISTRAL_MODEL: 'mistral-small-latest' };

/**
 * Builds a client for a workspace's own provider. The known providers keep their fixed public endpoints, so a
 * workspace can only choose an address for its own server, and that one goes through `ownFetch` (the workspace guard).
 */
export function buildOwnProvider(env: ApiEnv, creds: OwnProviderCreds, ownFetch: (url: string, init: RequestInit) => Promise<Response>): ModelProvider {
  if (creds.kind === 'anthropic') return new AnthropicProvider(env, { apiKey: creds.apiKey ?? '', model: creds.model });
  const profile = creds.kind === 'custom_ai' ? { ...PROFILES.custom_ai, name: 'Your AI server' } : PROFILES[creds.kind];
  const base = creds.kind === 'custom_ai' ? (creds.baseUrl ?? '') : OWN_TARGET[creds.kind](env);
  return new OpenAiCompatibleProvider(env, profile, () => ({ baseUrl: base, apiKey: creds.apiKey ?? undefined, model: creds.model }), creds.kind === 'custom_ai' ? ownFetch : undefined);
}

export const isAiProviderKey = (v: string): v is AiProviderKey => (AI_PROVIDER_KEYS as readonly string[]).includes(v);

/** Reads AI_PROVIDER_ORDER ("groq, gemini,anthropic"). Throws with a sentence for people when it is not valid. */
export function parseProviderOrder(raw: string): AiProviderKey[] {
  const keys = raw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!keys.length) throw new Error('Choose at least one AI provider.');
  const seen = new Set<string>();
  for (const k of keys) {
    if (!isAiProviderKey(k)) throw new Error(`Unknown AI provider "${k}". Use: ${AI_PROVIDER_KEYS.join(', ')}.`);
    if (seen.has(k)) throw new Error(`"${k}" is listed twice.`);
    seen.add(k);
  }
  return keys as AiProviderKey[];
}

/** The providers switched on, in the order they are tried. Unset: every provider in the built-in order. */
export function providerOrder(env: ApiEnv): AiProviderKey[] {
  if (!env.AI_PROVIDER_ORDER) return [...AI_PROVIDER_KEYS];
  try {
    return parseProviderOrder(env.AI_PROVIDER_ORDER);
  } catch {
    return [...AI_PROVIDER_KEYS];
  }
}

/** How long a provider rests after a failure before it is tried first again (a Retry-After header wins, up to 15 minutes). */
export const COOLDOWN_MS: Record<ProviderFailureKind, number> = { rate_limited: 60_000, unavailable: 30_000, auth: 5 * 60_000, rejected: 0 };
const MAX_COOLDOWN_MS = 15 * 60_000;

export interface ProviderHealth {
  lastOkAt: string | null;
  lastFailure: { at: string; kind: ProviderFailureKind; message: string } | null;
  coolingUntil: string | null;
}

/** platform_settings key holding a provider's last success and failure, shown in the operator console. */
export const AI_HEALTH_PREFIX = 'ai_provider_health:';

export interface HealthStore {
  read(key: AiProviderKey): Promise<ProviderHealth | null>;
  write(key: AiProviderKey, health: ProviderHealth): Promise<void>;
}

/** One of a workspace's own providers, ready to call. `id` is unique per workspace and provider (for resting). */
export interface OwnEntry {
  id: string;
  kind: AiProviderKey;
  name: string;
  provider: ModelProvider;
  onResult?: (err: AiProviderFailure | null) => void;
}

export interface ModelProviderSource {
  current(): ModelProvider | null;
}

/**
 * The providers to try for one call, in order, behind the single `ModelProvider` the gateway uses (ADR 0067).
 *
 * A provider that fails with a rate limit, an outage, a refused key or a refused request is rested for a while and
 * the next one is tried at once, so a free key with a low quota keeps automations running on the next provider.
 * Rested providers are skipped while another one is ready; when every provider is resting they are all tried anyway,
 * because an answer late is better than none. Programming errors are never swallowed: only provider failures move on.
 */
export class AiProviderChain implements ModelProviderSource {
  private readonly log = new Logger('AiProviderChain');
  private readonly clients = new Map<AiProviderKey, { signature: string; provider: ModelProvider }>();
  private readonly resting = new Map<string, number>();
  private readonly health = new Map<AiProviderKey, ProviderHealth>();

  constructor(
    private readonly env: ApiEnv,
    private readonly store: HealthStore | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Configured providers that are switched on, in order. */
  active(): AiProviderKey[] {
    return providerOrder(this.env).filter((k) => AI_PROVIDER_DEFS[k].configured(this.env));
  }

  restingUntil(key: AiProviderKey): number | null {
    const until = this.resting.get(key);
    return until && until > this.now() ? until : null;
  }

  /** The order a call would use now: ready providers first, resting ones after (or alone, when all are resting). */
  plan(): AiProviderKey[] {
    const active = this.active();
    const ready = active.filter((k) => !this.restingUntil(k));
    return ready.length ? ready : active;
  }

  private client(key: AiProviderKey): ModelProvider {
    const def = AI_PROVIDER_DEFS[key];
    const signature = def.signature(this.env);
    const cached = this.clients.get(key);
    if (cached?.signature === signature) return cached.provider;
    const provider = def.build(this.env);
    this.clients.set(key, { signature, provider });
    this.resting.delete(key); // a new key or address deserves a fresh try
    return provider;
  }

  current(): ModelProvider | null {
    const plan = this.plan();
    if (!plan.length) return null;
    const first = this.client(plan[0]!);
    return {
      name: first.name,
      model: first.model,
      generate: (req) => this.generate(req),
    };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    return this.generateWith(req, [], true);
  }

  /**
   * Tries a workspace's own providers first (ADR 0068), in its order, then, when `useShared`, the deployment's.
   * Own providers rest on failure like shared ones, keyed per workspace; their answers are marked `own:<kind>` so the
   * gateway can leave the plan's AI credits alone.
   */
  async generateWith(req: ModelRequest, own: OwnEntry[], useShared: boolean): Promise<ModelResponse> {
    const ownReady = own.filter((o) => !this.isResting(o.id));
    const ownPlan = ownReady.length ? [...ownReady, ...own.filter((o) => this.isResting(o.id))] : own;
    const shared = useShared ? this.plan() : [];
    const attempts: { id: string; name: string; run: () => Promise<ModelResponse>; ok: () => void; fail: (err: AiProviderFailure, until: number | null) => void; label: string }[] = [
      ...ownPlan.map((o) => ({
        id: o.id, name: `${o.name} (workspace)`, label: `own:${o.kind}`,
        run: () => o.provider.generate(req),
        ok: () => o.onResult?.(null),
        fail: (err: AiProviderFailure) => o.onResult?.(err),
      })),
      ...shared.map((key) => ({
        id: key, name: AI_PROVIDER_DEFS[key].name, label: key,
        run: () => this.client(key).generate(req),
        ok: () => this.record(key, null),
        fail: (err: AiProviderFailure, until: number | null) => this.record(key, err, until),
      })),
    ];
    const failures: { name: string; err: AiProviderFailure }[] = [];
    for (const a of attempts) {
      try {
        const res = await a.run();
        this.resting.delete(a.id);
        a.ok();
        return { ...res, provider: a.label };
      } catch (err) {
        if (!(err instanceof AiProviderFailure)) throw err;
        failures.push({ name: a.name, err });
        const rest = Math.min(MAX_COOLDOWN_MS, err.retryAfterMs ?? COOLDOWN_MS[err.kind]);
        if (rest > 0) this.resting.set(a.id, this.now() + rest);
        a.fail(err, rest > 0 ? this.now() + rest : null);
        if (attempts.length > 1) this.log.warn({ provider: a.label, kind: err.kind, err: err.message }, 'AI provider failed; trying the next one');
      }
    }
    const last = failures[failures.length - 1]?.err;
    if (!last) throw new AiProviderFailure('No AI provider is configured on this installation.', 'auth');
    if (failures.length === 1) throw last;
    const summary = failures.map((f) => `${f.name}: ${f.err.message}`).join(' ');
    // Retry later if any provider only had a temporary problem; otherwise the keys need an operator.
    if (failures.some((f) => f.err instanceof TransientProviderError)) throw new TransientProviderError(`Every AI provider failed. ${summary}`.slice(0, 900));
    throw new AiProviderFailure(`Every AI provider failed. ${summary}`.slice(0, 900), last.kind);
  }

  private isResting(id: string): boolean {
    const until = this.resting.get(id);
    return !!until && until > this.now();
  }

  /** Keeps the console's health line current: every failure is written, a success only when it changes the picture. */
  private record(key: AiProviderKey, err: AiProviderFailure | null, coolingUntil: number | null = null): void {
    const prev = this.health.get(key) ?? { lastOkAt: null, lastFailure: null, coolingUntil: null };
    const at = new Date(this.now()).toISOString();
    let next: ProviderHealth;
    if (err) {
      next = { ...prev, lastFailure: { at, kind: err.kind, message: err.message.slice(0, 300) }, coolingUntil: coolingUntil ? new Date(coolingUntil).toISOString() : null };
    } else {
      const fresh = prev.lastOkAt && this.now() - Date.parse(prev.lastOkAt) < 10 * 60_000 && !prev.coolingUntil && (!prev.lastFailure || prev.lastFailure.at < prev.lastOkAt);
      if (fresh) return;
      next = { ...prev, lastOkAt: at, coolingUntil: null };
    }
    this.health.set(key, next);
    if (!this.store) return;
    void this.merge(key, next).catch((e: unknown) => this.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'Could not record AI provider health'));
  }

  /** Other processes (the worker, other replicas) write too: keep the newest success and failure of both. */
  private async merge(key: AiProviderKey, mine: ProviderHealth): Promise<void> {
    const theirs = await this.store!.read(key);
    const newest = <T>(a: T | null, b: T | null, at: (x: T) => string): T | null => (!a ? b : !b ? a : at(a) >= at(b) ? a : b);
    const merged: ProviderHealth = {
      lastOkAt: newest(mine.lastOkAt, theirs?.lastOkAt ?? null, (x) => x),
      lastFailure: newest(mine.lastFailure, theirs?.lastFailure ?? null, (x) => x.at),
      coolingUntil: mine.coolingUntil,
    };
    await this.store!.write(key, merged);
  }
}

export function readHealth(raw: string | null | undefined): ProviderHealth | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ProviderHealth;
    return { lastOkAt: v.lastOkAt ?? null, lastFailure: v.lastFailure ?? null, coolingUntil: v.coolingUntil ?? null };
  } catch {
    return null;
  }
}

/** Reads and writes provider health in platform_settings. */
export function platformHealthStore(prisma: {
  platformSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(args: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }): Promise<unknown>;
  };
}): HealthStore {
  return {
    read: async (key) => readHealth((await prisma.platformSetting.findUnique({ where: { key: AI_HEALTH_PREFIX + key } }))?.value),
    write: async (key, health) => {
      const k = AI_HEALTH_PREFIX + key;
      const value = JSON.stringify(health);
      await prisma.platformSetting.upsert({ where: { key: k }, create: { key: k, value }, update: { value } });
    },
  };
}
