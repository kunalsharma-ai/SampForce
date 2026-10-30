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
}

/** One interface per vendor, so the gateway can add adapters without touching agents. */
export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generate(req: ModelRequest): Promise<ModelResponse>;
}

/** Errors worth retrying later (rate limits, overload, timeouts, network). */
export class TransientProviderError extends Error {}

/**
 * Claude adapter on the official SDK. Thinking is left to the model (adaptive by default on current
 * models) and depth is set with `effort`. Server-side fallbacks re-run a declined request on the
 * model Anthropic recommends for that refusal category.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly fallbacks: boolean;

  constructor(env: ApiEnv) {
    this.model = env.AI_MODEL;
    this.fallbacks = env.AI_SERVER_FALLBACKS;
    // Every setting is explicit so ambient ANTHROPIC_* variables on the host never redirect traffic.
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      authToken: null,
      baseURL: env.AI_API_BASE_URL,
      timeout: env.AI_REQUEST_TIMEOUT_MS,
      maxRetries: 2,
    });
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
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        throw new TransientProviderError(err.message);
      }
      if (err instanceof Anthropic.APIError) throw new Error(`The AI provider rejected the request (${err.status ?? 'no status'}).`);
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
