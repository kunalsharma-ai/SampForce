import Anthropic from '@anthropic-ai/sdk';
import type { ApiEnv } from '../common/env';

export type Effort = 'low' | 'medium' | 'high';
export type ModelMessage = Anthropic.Beta.BetaMessageParam;
export type ModelTool = Anthropic.Beta.BetaTool;
export type ModelBlock = Anthropic.Beta.BetaContentBlock;

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools?: ModelTool[];
  maxTokens: number;
  effort: Effort;
  /** JSON schema the final answer must follow (structured outputs). */
  jsonSchema?: Record<string, unknown>;
}

export interface ModelResponse {
  content: ModelBlock[];
  stopReason: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Which provider answered (set by the fallback chain; ADR 0067). */
  provider?: string;
}

/** One interface per vendor, so the gateway can add adapters without touching agents. */
export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generate(req: ModelRequest): Promise<ModelResponse>;
}

/**
 * Why a provider could not answer, so the fallback chain (ADR 0067) can move on to the next provider and rest this one:
 * `rate_limited` (429, a free tier's quota), `unavailable` (5xx, overload, timeout, network), `auth` (key refused,
 * no credit left, model not available to the key) or `rejected` (the provider refused this request's shape).
 */
export type ProviderFailureKind = 'rate_limited' | 'unavailable' | 'auth' | 'rejected';

/** A provider refused or failed a request. `retryAfterMs` comes from the provider's Retry-After header when it sent one. */
export class AiProviderFailure extends Error {
  constructor(
    message: string,
    readonly kind: ProviderFailureKind,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

/** Errors worth retrying later (rate limits, overload, timeouts, network). */
export class TransientProviderError extends AiProviderFailure {
  constructor(message: string, kind: 'rate_limited' | 'unavailable' = 'unavailable', retryAfterMs: number | null = null) {
    super(message, kind, retryAfterMs);
  }
}

/** Milliseconds from a Retry-After header (seconds or an HTTP date), or null. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * Claude adapter on the official SDK. Thinking is left to the model (adaptive by default on current
 * models) and depth is set with `effort`. Server-side fallbacks re-run a declined request on the
 * model Anthropic recommends for that refusal category.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly fallbacks: boolean;

  constructor(private readonly env: ApiEnv) {
    this.fallbacks = env.AI_SERVER_FALLBACKS;
    // Every setting is explicit so ambient ANTHROPIC_* variables on the host never redirect traffic.
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      authToken: null,
      baseURL: env.AI_API_BASE_URL,
      timeout: env.AI_REQUEST_TIMEOUT_MS,
      // One quick retry; after that the fallback chain moves on to the next provider instead of waiting (ADR 0067).
      maxRetries: 1,
    });
  }

  /** Read at call time: a model changed in the operator console applies to the next request (ADR 0053). */
  get model(): string {
    return this.env.AI_MODEL;
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    try {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        output_config: { effort: req.effort, ...(req.jsonSchema ? { format: { type: 'json_schema' as const, schema: req.jsonSchema } } : {}) },
        ...(this.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      return {
        content: res.content,
        stopReason: res.stop_reason,
        model: res.model,
        inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
        outputTokens: res.usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new TransientProviderError(err.message, 'rate_limited', retryAfterMs(err.headers?.get?.('retry-after')));
      if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) throw new TransientProviderError(err.message);
      if (err instanceof Anthropic.APIError) {
        const status = err.status ?? 0;
        // 529 is Anthropic's "overloaded"; 401/403 a refused key; 402 no credit; 404 a model the key cannot use.
        if (status === 529 || status >= 500) throw new TransientProviderError(err.message);
        throw new AiProviderFailure(`The AI provider rejected the request (${err.status ?? 'no status'}).`, [401, 402, 403, 404].includes(status) ? 'auth' : 'rejected');
      }
      throw err;
    }
  }
}

export const textOf = (content: ModelBlock[]): string =>
  content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
