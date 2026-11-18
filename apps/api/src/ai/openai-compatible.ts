import { createHash } from 'node:crypto';
import type { ApiEnv } from '../common/env';
import { AiProviderFailure, type ModelBlock, type ModelMessage, type ModelProvider, type ModelRequest, type ModelResponse, retryAfterMs, TransientProviderError } from './provider';

/**
 * How a provider's OpenAI-compatible endpoint differs from OpenAI's own (ADR 0067).
 *
 * `json`: how a structured answer is asked for. `schema` sends `response_format: json_schema` (OpenAI, Gemini),
 * `object` sends `json_object` (Groq, Mistral: schema support depends on the model), `prompt` sends no
 * response_format at all (OpenRouter's free models and self-hosted servers vary too much). The schema is always
 * written into the system prompt as well, and the answer is cut out of any code fence, so every mode yields JSON.
 */
export interface CompatibleProfile {
  key: string;
  name: string;
  json: 'schema' | 'object' | 'prompt';
  /** OpenAI's newer models only accept `max_completion_tokens`. */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /** Mistral accepts only 9-character alphanumeric tool call ids. */
  toolIds?: 'mistral';
  /** Send `reasoning_effort` (OpenAI reasoning models only). */
  effort?: (model: string) => boolean;
  headers?: (env: ApiEnv) => Record<string, string>;
}

export interface CompatibleTarget {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface ChatResponse {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

type LooseBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

const trim = (u: string) => u.replace(/\/+$/, '');

const blockText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? '' : JSON.stringify(content);
  return (content as LooseBlock[]).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('\n');
};

/** A stable 9-character alphanumeric id for Mistral, derived from the original id so a call and its result still match. */
export const mistralToolId = (id: string): string => (/^[a-zA-Z0-9]{9}$/.test(id) ? id : createHash('sha256').update(id).digest('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 9).padEnd(9, '0'));

/** Turns the Messages-API conversation the agents build into chat completion messages. Thinking blocks are dropped. */
export function toChatMessages(system: string, messages: ModelMessage[], toolId: (id: string) => string = (x) => x): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks = (Array.isArray(m.content) ? m.content : []) as LooseBlock[];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
    if (m.role === 'assistant') {
      const calls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: toolId(b.id ?? ''), type: 'function' as const, function: { name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // Tool results must directly follow the assistant message that asked for them, before any new user text.
    for (const b of blocks.filter((x) => x.type === 'tool_result')) {
      const body = blockText(b.content);
      out.push({ role: 'tool', tool_call_id: toolId(b.tool_use_id ?? ''), content: b.is_error ? `Error: ${body}` : body });
    }
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

/** The JSON object in a model's answer: the whole text, or the part inside a code fence or between the outer braces. */
export function extractJson(text: string): string {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1]!.trim() : t;
  if (body.startsWith('{') || body.startsWith('[')) return body;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

const textBlock = (text: string) => ({ type: 'text', text, citations: null }) as unknown as ModelBlock;

const parseArgs = (raw: string | undefined): unknown => {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

const errorText = (body: ChatResponse | null): string => {
  const e = body?.error;
  return (typeof e === 'string' ? e : (e?.message ?? '')).slice(0, 200);
};

/**
 * One adapter for every provider that speaks OpenAI's chat completions API: OpenAI, Google Gemini, Groq, OpenRouter,
 * Mistral and self-hosted servers such as Ollama, LM Studio, vLLM or LiteLLM. Requests and answers are translated
 * to and from the Messages-API shapes the agents use, so Copilot's tool loop and structured agents run unchanged.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string;

  constructor(
    private readonly env: ApiEnv,
    private readonly profile: CompatibleProfile,
    private readonly target: () => CompatibleTarget,
  ) {
    this.name = profile.key;
  }

  get model(): string {
    return this.target().model;
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const t = this.target();
    const toolId = this.profile.toolIds === 'mistral' ? mistralToolId : (x: string) => x;
    const system = req.jsonSchema
      ? `${req.system}\n\nAnswer with one JSON object only: no prose and no code fence. It must match this JSON schema:\n${JSON.stringify(req.jsonSchema)}`
      : req.system;
    const body: Record<string, unknown> = {
      model: t.model,
      messages: toChatMessages(system, req.messages, toolId),
      [this.profile.tokenParam]: req.maxTokens,
      ...(req.tools?.length
        ? { tools: req.tools.map((x) => ({ type: 'function', function: { name: x.name, description: x.description ?? '', parameters: x.input_schema } })) }
        : {}),
      ...(this.profile.effort?.(t.model) ? { reasoning_effort: req.effort } : {}),
    };
    if (req.jsonSchema && this.profile.json === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'answer', schema: req.jsonSchema, strict: false } };
    if (req.jsonSchema && this.profile.json === 'object') body.response_format = { type: 'json_object' };

    let res = await this.post(t, body);
    // Some models behind a compatible endpoint do not support response_format; the prompt alone still asks for JSON.
    if (res.status === 400 && body.response_format) {
      delete body.response_format;
      res = await this.post(t, body);
    }
    const parsed = (await res.json().catch(() => null)) as ChatResponse | null;
    if (!res.ok) {
      const detail = errorText(parsed);
      const message = `${this.profile.name} answered ${res.status}${detail ? `: ${detail}` : ''}.`;
      if (res.status === 429) throw new TransientProviderError(message, 'rate_limited', retryAfterMs(res.headers.get('retry-after')));
      if (res.status >= 500 || res.status === 408) throw new TransientProviderError(message);
      throw new AiProviderFailure(message, [401, 402, 403, 404].includes(res.status) ? 'auth' : 'rejected');
    }
    const choice = parsed?.choices?.[0];
    if (!choice?.message) throw new TransientProviderError(`${this.profile.name} sent an empty answer.`);
    const msg = choice.message;
    const content: ModelBlock[] = [];
    let text = (msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (req.jsonSchema && text) text = extractJson(text);
    if (text) content.push(textBlock(text));
    for (const call of msg.tool_calls ?? []) {
      content.push({ type: 'tool_use', id: call.id || `call_${content.length}`, name: call.function?.name ?? '', input: parseArgs(call.function?.arguments) } as unknown as ModelBlock);
    }
    const hasCalls = (msg.tool_calls?.length ?? 0) > 0;
    const finish = choice.finish_reason ?? '';
    const stopReason = hasCalls ? 'tool_use' : msg.refusal || finish === 'content_filter' ? 'refusal' : finish === 'length' ? 'max_tokens' : 'end_turn';
    return {
      content,
      stopReason,
      model: parsed?.model || t.model,
      inputTokens: parsed?.usage?.prompt_tokens ?? 0,
      outputTokens: parsed?.usage?.completion_tokens ?? 0,
      provider: this.name,
    };
  }

  private async post(t: CompatibleTarget, body: Record<string, unknown>): Promise<Response> {
    try {
      return await fetch(`${trim(t.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(t.apiKey ? { authorization: `Bearer ${t.apiKey}` } : {}),
          ...(this.profile.headers?.(this.env) ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.env.AI_REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new TransientProviderError(timeout ? `${this.profile.name} did not answer in time.` : `${this.profile.name} could not be reached.`);
    }
  }
}
