import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the Claude Messages API (`POST /v1/messages`). It returns responses in the
 * API's shape so the gateway, the SDK and the tool loop run end to end without a real key. The default
 * handler is a small rule set; tests can replace it per case. Passing tests against this fixture shows
 * DealFlow's plumbing and safety rules work. It says nothing about the quality of real model answers;
 * that is what the eval suites in apps/api/evals measure with a real key.
 */
export interface FixtureRequest {
  headers: IncomingMessage['headers'];
  body: MessagesBody;
}

export interface MessagesBody {
  model: string;
  system?: string;
  max_tokens: number;
  messages: { role: string; content: string | Block[] }[];
  tools?: { name: string }[];
  output_config?: { effort?: string; format?: { type: string; schema: unknown } };
  fallbacks?: unknown;
}

export interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface FixtureReply {
  content: Block[];
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  status?: number;
}

export type Handler = (body: MessagesBody) => FixtureReply;

export interface AiFixture {
  url: string;
  requests: FixtureRequest[];
  /** Replace the handler (pass null to restore the rule set). */
  use(handler: Handler | null): void;
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
  });

let toolSeq = 0;
export const text = (t: string): FixtureReply => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
export const json = (v: unknown): FixtureReply => text(JSON.stringify(v));
export const toolUse = (name: string, input: unknown): FixtureReply => ({
  content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: `toolu_fixture_${++toolSeq}`, name, input }],
  stop_reason: 'tool_use',
});

const lastMessage = (b: MessagesBody) => b.messages[b.messages.length - 1]!;
const userText = (b: MessagesBody): string => {
  const m = lastMessage(b);
  return typeof m.content === 'string' ? m.content : (m.content.find((x) => x.type === 'text')?.text ?? '');
};
/** The tool call the latest tool results answer, with the result content. */
export function lastToolResult(b: MessagesBody): { name: string; input: Record<string, unknown>; result: Record<string, unknown>; isError: boolean } | null {
  const m = lastMessage(b);
  if (typeof m.content === 'string') return null;
  const res = m.content.find((x) => x.type === 'tool_result');
  if (!res) return null;
  const prev = b.messages[b.messages.length - 2];
  const use = prev && typeof prev.content !== 'string' ? prev.content.find((x) => x.type === 'tool_use' && x.id === res.tool_use_id) : undefined;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(res.content ?? '{}');
  } catch {
    parsed = { raw: res.content };
  }
  return { name: use?.name ?? '', input: (use?.input as Record<string, unknown>) ?? {}, result: parsed, isError: !!res.is_error };
}

/** Deterministic behaviour per prompt, recognised by the start of the system prompt. */
export const rules: Handler = (b) => {
  const system = b.system ?? '';
  // The fixture reads loosely shaped prompt input; a full type for every agent's input adds nothing here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loose = Record<string, any>;
  const input: Loose = (() => {
    try {
      return JSON.parse(userText(b)) as Loose;
    } catch {
      return {};
    }
  })();

  const strip = (v: unknown) => String(v ?? '').replace(/<\/?untrusted_data[^>]*>/g, '').trim();
  if (system.startsWith('You read a voice note a sales rep dictated')) {
    const note = strip(input.note);
    const today = String(input.today ?? new Date().toISOString().slice(0, 10));
    const addDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const nextWeekday = (target: number) => {
      const now = new Date(`${today}T00:00:00Z`).getUTCDay();
      return addDays(((target - now + 7) % 7) || 7);
    };
    const sentences = note.split(/(?<=[.!?])\s+/).map((x: string) => x.trim()).filter(Boolean);
    const actions: Loose[] = [];
    const unsupported: string[] = [];
    let lastCallRequested = false;
    for (const s of sentences) {
      const l = s.toLowerCase();
      const time = l.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      const dueTime = time ? `${String((Number(time[1]) % 12) + (time[3] === 'pm' ? 12 : 0)).padStart(2, '0')}:${time[2] ?? '00'}` : null;
      const dueDate = /tomorrow/.test(l) ? addDays(1) : /next monday/.test(l) ? nextWeekday(1) : /next week/.test(l) ? addDays(7) : null;
      if (/summari[sz]e my last/.test(l)) lastCallRequested = true;
      else if (/\bdelete|remove the|send (an )?email|change the (amount|stage|owner)/.test(l)) unsupported.push(s.replace(/[.!?]$/, ''));
      else if (/schedule .*meeting|book .*meeting/.test(l)) actions.push({ type: 'create_task', title: 'Follow-up meeting', dueDate, dueTime, meeting: true });
      else if (/\btask\b|remind me|follow up|call them/.test(l)) actions.push({ type: 'create_task', title: /call/.test(l) ? 'Call back' : 'Follow up', dueDate, dueTime, meeting: false });
      else if (/note that/.test(l)) actions.push({ type: 'add_note', body: s.replace(/^.*?note that\s*/i, '').replace(/^./, (c: string) => c.toUpperCase()) });
      else if (/add (a )?(new )?lead/.test(l)) {
        const m = s.match(/lead,?\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)(?: from ([A-Z][\w ]+?))?(?:[,.]|$)/);
        actions.push({ type: 'create_lead', name: m?.[1] ?? 'New lead', company: m?.[2]?.trim() ?? null, email: s.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0]?.replace(/\.$/, '') ?? null, phone: null });
      } else if (/add (a )?(new )?contact/.test(l)) {
        const m = s.match(/contact,?\s+([A-Z][a-z]+)(?: ([A-Z][a-z]+))?/);
        actions.push({ type: 'create_contact', firstName: m?.[1] ?? 'New', lastName: m?.[2] ?? null, jobTitle: null, email: null, phone: null });
      }
    }
    return json({ summary: `Voice note with ${sentences.length} sentence${sentences.length === 1 ? '' : 's'}.`, actions, lastCallRequested, unsupported });
  }
  if (system.startsWith('You brief an account manager on one customer')) {
    const h = input.health as { score: number; risk: string; signals: { label: string; detail: string }[] };
    const steps = (input.ruleBasedSteps as string[]).slice(0, 5).map((title, i) => ({ title, dueInDays: i * 2, why: h.signals[i]?.detail ?? 'From the health signals.' }));
    return json({
      summary: h.signals.length ? `${String(input.customer)} has ${h.risk.toLowerCase()} (${h.score}/100): ${h.signals.map((x) => x.label.toLowerCase()).join(', ')}.` : `${String(input.customer)} shows no risk signals.`,
      talkingPoints: h.signals.slice(0, 3).map((x) => `Ask about: ${x.detail}`),
      steps,
    });
  }
  if (system.startsWith('You are DealFlow Copilot')) {
    const tr = lastToolResult(b);
    if (!tr) {
      const q = userText(b);
      if (/pipeline|forecast|quarter/i.test(q)) return toolUse('pipeline_summary', {});
      const who = /task (?:for|to call) ([A-Z][\w'-]+(?: [A-Z][\w'-]+)?)/.exec(q)?.[1];
      if (who) return toolUse('search_records', { query: who, types: null });
      const stalled = /stalled|no activity|stopped/i.test(q);
      if (stalled) return toolUse('list_deals', { status: 'open', closing_within_days: null, stalled_days: 14, mine_only: false, min_amount: null, limit: 10 });
      return text('I can answer questions about your leads, deals, tasks and pipeline. Try asking about this quarter’s pipeline.');
    }
    if (tr.isError) return text(`I couldn’t do that: ${String(tr.result.error ?? 'the tool failed')}`);
    if (tr.name === 'pipeline_summary') {
      const q = tr.result.quarter as Record<string, number | string>;
      return text(`For ${q.period}: won ${q.won} ${tr.result.currency}, weighted open pipeline ${q.weighted}, base forecast ${q.base} (best case ${q.best}). This is a rule-based projection.`);
    }
    if (tr.name === 'list_deals') {
      const deals = (tr.result.deals as { name: string; lastActivity: string | null }[]) ?? [];
      return text(deals.length ? `Deals with no recent activity: ${deals.map((d) => d.name).join(', ')}.` : 'No open deals are stalled.');
    }
    if (tr.name === 'search_records') {
      const hit = (tr.result.results as { type: string; id: string; name: string }[] | undefined)?.[0];
      if (!hit) return text('I couldn’t find that record.');
      return toolUse('propose_create_task', { title: `Call ${hit.name}`, due_in_days: 1, related_type: hit.type === 'company' ? null : hit.type, related_id: hit.type === 'company' ? null : hit.id });
    }
    if (tr.name.startsWith('propose_')) return text(`I proposed this: ${String(tr.result.proposed)}. It is waiting for your confirmation.`);
    return text('Done.');
  }
  if (system.startsWith('You write short qualification notes')) {
    return json({ summary: `Grade ${input.grade} lead scoring ${input.score} from ${(input.signals ?? []).length} signals.`, nextStep: 'Call this week to confirm budget and timing.' });
  }
  if (system.startsWith('You recommend the single most useful next step')) {
    const first = (input.signals ?? [])[0]?.label ?? 'Keep momentum';
    return json({ title: `Check in on ${input.deal?.name ?? 'the deal'}`, reason: `Signal: ${first}.`, dueInDays: 2 });
  }
  if (system.startsWith('You turn a sales rep')) {
    const notes = String(input.notes ?? '').replace(/<\/?untrusted_data[^>]*>/g, '').trim();
    const items = notes.split('\n').filter((l) => l.trim().startsWith('- ')).map((l) => ({ title: l.trim().slice(2), owner: 'me', dueInDays: 3 }));
    return json({ summary: notes.split('\n')[0]!.slice(0, 200), decisions: [], actionItems: items, followUpEmail: { subject: 'Thanks for today', body: 'Hi,\n\nThank you for your time today. I will send the next steps shortly.\n' } });
  }
  if (system.startsWith('You draft a first outline of a sales proposal')) {
    const d = input.deal ?? {};
    return json({
      title: `Proposal: ${d.name}`,
      sections: [{ heading: 'Context', body: `${d.company ?? 'The customer'} is evaluating options.` }, { heading: 'Commercial summary', body: `${d.amount} ${d.currency}, as recorded on the deal. Final pricing is confirmed by the account owner.` }],
      basedOn: [`Deal amount ${d.amount} ${d.currency}`, `Stage ${d.stage}`],
      openQuestions: ['Confirm scope and start date'],
    });
  }
  if (system.startsWith('You convert a plain-language description')) {
    const desc = String(input.description ?? '');
    const definition = {
      trigger: { event: /deal/i.test(desc) ? 'deal.won' : 'lead.created', conditions: { match: 'all', rules: [] } },
      start: 'action_1',
      nodes: [{ id: 'action_1', type: 'action', action: { type: 'create_task', title: /deal/i.test(desc) ? 'Hand over {{record.name}}' : 'Call {{record.fullName}}', dueInDays: 1, assignTo: 'record_owner' }, next: null }],
    };
    return json({ name: /deal/i.test(desc) ? 'Hand over won deals' : 'Call new leads', definitionJson: JSON.stringify(definition), notes: '' });
  }
  if (system.startsWith('You explain to a sales manager')) {
    return text(`- The base forecast moved by ${input.delta?.base} ${input.currency}.\n- ${(input.changes ?? []).length} deals changed.`);
  }
  if (system.startsWith('You write sales emails')) {
    const obj = String(input.objective ?? 'checking in');
    const first = String(input.recipient?.name ?? '').split(' ')[0] || 'there';
    const sender = input.sender?.firstName ?? 'Me';
    const meeting = /meet|call|demo/i.test(obj);
    if (input.asTemplate) {
      const extra = /BADTAG/.test(obj) ? ' {{custom.nope}}' : (input.availableTags ?? []).find((t: string) => t.startsWith('var.')) ? ` {{${(input.availableTags as string[]).find((t) => t.startsWith('var.'))}}}` : '';
      return json({ subject: 'A quick idea for {{company}}', body: `Hi {{first_name|there}},\n\nI am reaching out about ${obj}.${extra}\n\n{{sender_first_name}}`, subjectAlternatives: ['Idea for {{company}}', 'Question for you'], basedOn: [], checkBeforeSending: [] });
    }
    const subject = input.mode === 'reply' ? `Re: ${input.receivedEmail?.subject ?? ''}` : input.mode === 'follow_up' ? 'Following up' : `About ${obj}`.slice(0, 80);
    return json({
      subject,
      body: `Hi ${first},\n\n${input.mode === 'follow_up' ? 'Following up on my last note.' : `I wanted to reach out about ${obj}.`}${meeting ? ' Would [proposed time] work for a short call?' : ''}\n\n${sender}`,
      subjectAlternatives: ['Quick question', `For ${first}`],
      basedOn: input.recipient ? [`Record: ${input.recipient.name}`] : [],
      checkBeforeSending: meeting ? ['Fill in [proposed time]'] : [],
    });
  }
  if (system.startsWith('You edit a sales email')) {
    const body = strip(input.body);
    const subject = strip(input.subject);
    if (/DROPTAGS/.test(body)) return json({ subject, body: body.replace(/\{\{[^}]*\}\}/g, 'friend'), changes: ['Removed fields'] });
    if (input.action === 'shorten') return json({ subject, body: body.split('\n')[0]!, changes: ['Cut to the first line'] });
    if (input.action === 'tone') return json({ subject, body: `${input.tone === 'friendly' ? 'Hey!' : 'Dear reader,'} ${body}`, changes: [`Made it ${input.tone}`] });
    return json({ subject: subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : '', body: body.replace(/\bdont\b/g, "don't").replace(/\bi\b/g, 'I'), changes: ['Fixed spelling and capitals'] });
  }
  if (system.startsWith('You suggest subject lines')) {
    const words = strip(input.body).split(/\s+/).slice(0, 4).join(' ');
    return json({ subjects: [{ text: `About: ${words}`, why: 'Names the topic' }, { text: 'Quick question', why: 'Short' }, { text: 'Idea for your team', why: 'Benefit first' }, { text: 'x'.repeat(150), why: 'Too long' }] });
  }
  if (system.startsWith('You read an email a sales rep received')) {
    const body = strip(input.email?.body).toLowerCase();
    const base = { objections: [] as string[], buyingSignals: [] as string[], followUpInDays: null as number | null, suggestedReply: { subject: `Re: ${input.email?.subject ?? ''}`, body: 'Thanks for your reply. [answer]' } };
    const out = /unsubscribe|remove me/.test(body)
      ? { ...base, intent: 'unsubscribe', confidence: 'high', nextAction: 'reply_now', followUpInDays: 5, reason: 'They asked to be removed.' }
      : /price|expensive|budget/.test(body)
        ? { ...base, intent: 'objection', confidence: 'high', objections: ['Price is too high'], buyingSignals: ['Asked about a smaller plan'], nextAction: 'reply_now', followUpInDays: 2, reason: 'They said the price is too high.' }
        : /out of office/.test(body)
          ? { ...base, intent: 'out_of_office', confidence: 'high', nextAction: 'follow_up_later', followUpInDays: 7, reason: 'Automatic reply.' }
          : /call|meeting|demo/.test(body)
            ? { ...base, intent: 'meeting_request', confidence: 'high', buyingSignals: ['Asked for a call'], nextAction: 'book_meeting', followUpInDays: 1, reason: 'They asked for a call.' }
            : { ...base, intent: 'interested', confidence: 'medium', nextAction: 'reply_now', followUpInDays: 3, reason: 'Positive reply.' };
    return json({ summary: `${(input.earlier ?? []).length + 1} emails so far. Latest: ${body.slice(0, 80)}`, ...out });
  }
  if (system.startsWith('You turn a sales meeting transcript')) {
    const t = strip(input.transcript);
    const lines = t.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const said = lines.map((l: string) => {
      const m = l.match(/^Speaker (\d+):\s*(.*)$/);
      return m ? { speaker: Number(m[1]), text: m[2]! } : { speaker: null, text: l };
    });
    const pick = (re: RegExp) => said.filter((x: { text: string }) => re.test(x.text)).map((x: { text: string }) => x.text.slice(0, 200));
    const speakers = [...new Set(said.map((x: { speaker: number | null }) => x.speaker).filter((v: number | null): v is number => v !== null))] as number[];
    const names = new Map<number, string>();
    for (const x of said) {
      const m = x.text.match(/\b(?:I'm|I am|this is) ([A-Z][a-z]+)/);
      if (m && x.speaker !== null && !names.has(x.speaker)) names.set(x.speaker, m[1]!);
    }
    const actions = said
      .filter((x: { text: string }) => /\b(I'll|we'll|I will|we will)\b/i.test(x.text))
      .map((x: { speaker: number | null; text: string }) => ({ title: x.text.replace(/^.*?\b(I'll|we'll|I will|we will)\s*/i, '').replace(/\.$/, '').slice(0, 120) || 'Follow up', owner: x.speaker === 1 ? 'customer' : 'me', dueInDays: /friday|this week/i.test(x.text) ? 3 : null }));
    return json({
      summary: `Meeting "${input.meeting?.title ?? ''}": ${lines.length} lines discussed.`,
      keyPoints: lines.slice(0, 2).map((l: string) => l.replace(/^Speaker \d+:\s*/, '').slice(0, 120)),
      requirements: pick(/\bneed|must|require/i),
      objections: pick(/expensive|concern|worried|too (much|long)/i),
      decisions: pick(/\bagree|decided|let's go/i),
      actionItems: actions,
      commitments: actions.map((a: { owner: string; title: string }) => ({ who: a.owner === 'me' ? 'Rep' : 'Customer', what: a.title })),
      participants: speakers.length
        ? speakers.map((n) => ({ name: names.get(n) ?? `Speaker ${n}`, speaker: n, side: names.has(n) ? (n === 0 ? 'us' : 'customer') : 'unknown' }))
        : [{ name: 'Rep', speaker: null, side: 'us' }],
      followUpEmail: { subject: `Follow-up: ${input.meeting?.title ?? 'our meeting'}`, body: `Thanks for the time today.\n\nNext steps:\n${actions.map((a: { title: string }) => `- ${a.title}`).join('\n') || '- [next step]'}` },
    });
  }
  return text('Unrecognised fixture prompt.');
};

export async function createAiFixture(port = 0): Promise<AiFixture> {
  const requests: FixtureRequest[] = [];
  let handler: Handler = rules;
  const server: Server = createServer(async (req, res) => {
    const raw = await read(req);
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    // GET /v1/models: what the operator console's connection test calls. Any key accepted except one marked bad.
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      if (!req.headers['x-api-key'] || String(req.headers['x-api-key']).includes('bad')) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5' }, { type: 'model', id: 'claude-sonnet-5-5' }], has_more: false }));
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
      return;
    }
    const body = JSON.parse(raw) as MessagesBody;
    requests.push({ headers: req.headers, body });
    let reply: FixtureReply;
    try {
      reply = handler(body);
    } catch (err) {
      reply = { content: [], status: 500 };
      void err;
    }
    if (reply.status && reply.status >= 400) {
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: reply.status === 429 ? 'rate_limit_error' : 'api_error', message: 'fixture error' } }));
      return;
    }
    const outText = reply.content.map((c) => c.text ?? JSON.stringify(c.input ?? '')).join('');
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_fixture_${requests.length}` }).end(
      JSON.stringify({
        id: `msg_fixture_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: reply.content,
        stop_reason: reply.stop_reason ?? 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: Math.ceil(raw.length / 4), output_tokens: Math.max(1, Math.ceil(outText.length / 4)) },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    requests,
    use: (h) => (handler = h ?? rules),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
