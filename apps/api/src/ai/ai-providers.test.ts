import { describe, expect, it } from 'vitest';
import type { ApiEnv } from '../common/env';
import { AiProviderChain, parseProviderOrder, providerOrder } from './ai-providers';
import { extractJson, mistralToolId, toChatMessages } from './openai-compatible';
import { AiProviderFailure, type ModelMessage, type ModelProvider, type ModelResponse, retryAfterMs, TransientProviderError } from './provider';

const env = (over: Partial<ApiEnv> = {}) => ({ AI_MODEL: 'claude-opus-5-5', GROQ_MODEL: 'llama', GEMINI_MODEL: 'gemini', AI_API_BASE_URL: 'http://a', GROQ_API_BASE_URL: 'http://g', GEMINI_API_BASE_URL: 'http://m', ...over }) as unknown as ApiEnv;

const ok = (provider: string): ModelResponse => ({ content: [], stopReason: 'end_turn', model: provider, inputTokens: 1, outputTokens: 1 });

/** A chain whose clients are stand-ins: each key answers or throws as the test says. */
function chainWith(e: ApiEnv, behaviour: Record<string, () => Promise<ModelResponse>>, clock: { t: number }) {
  const chain = new AiProviderChain(e, null, () => clock.t);
  const calls: string[] = [];
  // Swap the real clients for stand-ins.
  (chain as unknown as { client: (k: string) => ModelProvider }).client = (k: string) => ({
    name: k, model: k,
    generate: async () => {
      calls.push(k);
      return behaviour[k]!();
    },
  });
  return { chain, calls };
}

describe('AI provider order', () => {
  it('parses a comma list, and refuses unknown or repeated names', () => {
    expect(parseProviderOrder(' Groq, gemini ,anthropic')).toEqual(['groq', 'gemini', 'anthropic']);
    expect(() => parseProviderOrder('groq,gpt')).toThrow('Unknown AI provider "gpt"');
    expect(() => parseProviderOrder('groq,groq')).toThrow('listed twice');
    expect(() => parseProviderOrder(' , ')).toThrow('at least one');
  });

  it('uses the built-in order when none is set', () => {
    expect(providerOrder(env())).toEqual(['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'mistral', 'custom_ai']);
    expect(providerOrder(env({ AI_PROVIDER_ORDER: 'groq' }))).toEqual(['groq']);
  });

  it('only offers providers with keys, and a self-hosted server needs an address and a model but no key', () => {
    const chain = new AiProviderChain(env({ GROQ_API_KEY: 'k', CUSTOM_AI_BASE_URL: 'http://ollama:11434/v1' }));
    expect(chain.active()).toEqual(['groq']);
    const withModel = new AiProviderChain(env({ GROQ_API_KEY: 'k', CUSTOM_AI_BASE_URL: 'http://ollama:11434/v1', CUSTOM_AI_MODEL: 'llama3.1' }));
    expect(withModel.active()).toEqual(['groq', 'custom_ai']);
    expect(new AiProviderChain(env()).current()).toBeNull();
  });
});

describe('fallback chain', () => {
  const e = env({ ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm', AI_PROVIDER_ORDER: 'anthropic,groq,gemini' });

  it('moves on after a rate limit, rests the provider for Retry-After, then tries it first again', async () => {
    const clock = { t: 1_000_000 };
    let limited = true;
    const { chain, calls } = chainWith(e, {
      anthropic: async () => {
        if (limited) throw new TransientProviderError('429', 'rate_limited', 5_000);
        return ok('anthropic');
      },
      groq: async () => ok('groq'),
      gemini: async () => ok('gemini'),
    }, clock);
    expect((await chain.generate({ system: '', messages: [], maxTokens: 1, effort: 'low' })).provider).toBe('groq');
    expect(calls).toEqual(['anthropic', 'groq']);
    expect(chain.plan()).toEqual(['groq', 'gemini']);
    await chain.generate({ system: '', messages: [], maxTokens: 1, effort: 'low' });
    expect(calls).toEqual(['anthropic', 'groq', 'groq']);
    clock.t += 5_001;
    limited = false;
    expect((await chain.generate({ system: '', messages: [], maxTokens: 1, effort: 'low' })).provider).toBe('anthropic');
  });

  it('tries resting providers anyway when every provider is resting', async () => {
    const clock = { t: 0 };
    const { chain } = chainWith(e, {
      anthropic: async () => { throw new TransientProviderError('down'); },
      groq: async () => { throw new AiProviderFailure('bad key', 'auth'); },
      gemini: async () => { throw new TransientProviderError('429', 'rate_limited'); },
    }, clock);
    await expect(chain.generate({ system: '', messages: [], maxTokens: 1, effort: 'low' })).rejects.toThrow(/Every AI provider failed\. Anthropic Claude: down Groq: bad key Google Gemini: 429/);
    expect(chain.plan()).toEqual(['anthropic', 'groq', 'gemini']);
  });

  it('says retry later when any failure was temporary, and never swallows a programming error', async () => {
    const clock = { t: 0 };
    const { chain } = chainWith(e, {
      anthropic: async () => { throw new AiProviderFailure('refused', 'rejected'); },
      groq: async () => { throw new TransientProviderError('busy'); },
      gemini: async () => { throw new TypeError('bug'); },
    }, clock);
    await expect(chain.generate({ system: '', messages: [], maxTokens: 1, effort: 'low' })).rejects.toBeInstanceOf(TypeError);
    const { chain: c2 } = chainWith(env({ ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g', AI_PROVIDER_ORDER: 'anthropic,groq' }), {
      anthropic: async () => { throw new AiProviderFailure('refused', 'rejected'); },
      groq: async () => { throw new TransientProviderError('busy'); },
    }, clock);
    await expect(c2.generate({ system: '', messages: [], maxTokens: 1, effort: 'low' })).rejects.toBeInstanceOf(TransientProviderError);
  });
});

describe('OpenAI-compatible translation', () => {
  const convo: ModelMessage[] = [
    { role: 'user', content: 'How is my pipeline?' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm', signature: 's' }, { type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'toolu_01ABC', name: 'pipeline_summary', input: { period: 'quarter' } }] } as ModelMessage,
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01ABC', content: '{"weighted":20000}' }, { type: 'text', text: 'and deals?' }] } as ModelMessage,
  ];

  it('turns tool use and tool results into chat completion messages, dropping thinking', () => {
    const out = toChatMessages('You are Copilot.', convo);
    expect(out).toEqual([
      { role: 'system', content: 'You are Copilot.' },
      { role: 'user', content: 'How is my pipeline?' },
      { role: 'assistant', content: 'Let me check.', tool_calls: [{ id: 'toolu_01ABC', type: 'function', function: { name: 'pipeline_summary', arguments: '{"period":"quarter"}' } }] },
      { role: 'tool', tool_call_id: 'toolu_01ABC', content: '{"weighted":20000}' },
      { role: 'user', content: 'and deals?' },
    ]);
  });

  it('gives Mistral 9-character ids that still pair a call with its result', () => {
    const out = toChatMessages('s', convo, mistralToolId);
    const id = out[2]!.tool_calls![0]!.id;
    expect(id).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(out[3]!.tool_call_id).toBe(id);
    expect(mistralToolId('abcDEF123')).toBe('abcDEF123');
  });

  it('cuts the JSON out of fences, think blocks and prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('<think>let me see</think>{"a":1}')).toBe('{"a":1}');
    expect(extractJson('Here you go: {"a":{"b":2}} hope it helps')).toBe('{"a":{"b":2}}');
  });

  it('reads Retry-After in seconds or as a date', () => {
    expect(retryAfterMs('7')).toBe(7000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null)).toBeNull();
  });
});
