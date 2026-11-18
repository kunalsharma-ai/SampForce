import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Block, type FixtureReply, type Handler, type MessagesBody, rules } from './ai-fixture';

/**
 * A local stand-in for an OpenAI-compatible chat completions API (OpenAI, Gemini, Groq, OpenRouter, Mistral, Ollama).
 * Each request is turned back into the Messages-API shape and answered by the same rule set as the Claude fixture,
 * so Copilot's tool loop and the structured agents run end to end through the OpenAI adapter (ADR 0067).
 */
export interface ChatRequest {
  headers: IncomingMessage['headers'];
  body: {
    model: string;
    messages: { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }[];
    tools?: { type: string; function: { name: string; description: string; parameters: unknown } }[];
    response_format?: { type: string };
    max_tokens?: number;
    max_completion_tokens?: number;
    reasoning_effort?: string;
  };
}

export interface OpenAiFixture {
  url: string;
  requests: ChatRequest[];
  /** Replace the handler (null restores the rule set). */
  use(handler: Handler | null): void;
  /** Answer the next chat requests with this HTTP status (null: answer normally). */
  failWith(status: number | null, retryAfter?: string): void;
  /** Models GET /models lists. */
  models: string[];
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
  });

/** Chat messages back to the Messages-API conversation the rule set reads. */
export function toMessagesBody(b: ChatRequest['body']): MessagesBody {
  const system = b.messages.filter((m) => m.role === 'system').map((m) => m.content ?? '').join('\n');
  const messages: MessagesBody['messages'] = [];
  for (const m of b.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block: Block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' };
      const prev = messages[messages.length - 1];
      if (prev?.role === 'user' && Array.isArray(prev.content) && prev.content.every((x) => x.type === 'tool_result')) prev.content.push(block);
      else messages.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') });
      messages.push({ role: 'assistant', content: blocks });
      continue;
    }
    messages.push({ role: 'user', content: m.content ?? '' });
  }
  return { model: b.model, system, max_tokens: b.max_tokens ?? b.max_completion_tokens ?? 0, messages, tools: b.tools?.map((t) => ({ name: t.function.name })) };
}

export async function createOpenAiFixture(port = 0): Promise<OpenAiFixture> {
  const requests: ChatRequest[] = [];
  let handler: Handler = rules;
  let failing: { status: number; retryAfter?: string } | null = null;
  const fixture: OpenAiFixture = {
    url: '',
    requests,
    models: ['llama-3.3-70b-versatile', 'gpt-5-mini', 'models/gemini-2.5-flash', 'mistral-small-latest', 'llama3.1'],
    use: (h) => (handler = h ?? rules),
    failWith: (status, retryAfter) => (failing = status === null ? null : { status, retryAfter }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const send = (res: import('node:http').ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
  const server: Server = createServer(async (req, res) => {
    const raw = await read(req);
    const auth = String(req.headers.authorization ?? '');
    const badKey = auth.includes('bad');
    if (req.method === 'GET' && req.url === '/health') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    if (req.method === 'GET' && req.url === '/models') {
      if (badKey) return send(res, 401, { error: { message: 'Invalid API Key' } });
      return send(res, 200, { object: 'list', data: fixture.models.map((id) => ({ id, object: 'model' })) });
    }
    if (req.method === 'GET' && req.url === '/key') {
      if (badKey || !auth) return send(res, 401, { error: { message: 'No auth credentials found' } });
      return send(res, 200, { data: { label: 'sk-or-v1-fix', is_free_tier: true, limit_remaining: null, usage: 0 } });
    }
    if (req.method !== 'POST' || req.url !== '/chat/completions') return send(res, 404, { error: { message: 'not found' } });
    const body = JSON.parse(raw) as ChatRequest['body'];
    requests.push({ headers: req.headers, body });
    if (badKey) return send(res, 401, { error: { message: 'Invalid API Key' } });
    if (failing) return send(res, failing.status, { error: { message: failing.status === 429 ? 'Rate limit reached for requests per minute' : 'upstream error' } }, failing.retryAfter ? { 'retry-after': failing.retryAfter } : {});
    let reply: FixtureReply;
    try {
      reply = handler(toMessagesBody(body));
    } catch {
      return send(res, 500, { error: { message: 'fixture error' } });
    }
    if (reply.status && reply.status >= 400) return send(res, reply.status, { error: { message: 'fixture error' } });
    const text = reply.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
    const calls = reply.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id!, type: 'function', function: { name: c.name!, arguments: JSON.stringify(c.input ?? {}) } }));
    // Real compatible servers often wrap JSON answers in a code fence; the adapter must cope.
    const content = body.response_format || !text.startsWith('{') ? text : '```json\n' + text + '\n```';
    return send(res, 200, {
      id: `chatcmpl-fixture-${requests.length}`,
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, finish_reason: calls.length ? 'tool_calls' : reply.stop_reason === 'max_tokens' ? 'length' : 'stop', message: { role: 'assistant', content: content || null, ...(calls.length ? { tool_calls: calls } : {}) } }],
      usage: { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.max(1, Math.ceil(text.length / 4)), total_tokens: 0 },
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  fixture.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fixture;
}
