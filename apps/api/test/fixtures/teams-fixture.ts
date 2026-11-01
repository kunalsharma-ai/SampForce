import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in for Teams Workflows webhook URLs ("Send webhook alerts to a channel"). A URL looks like
 * /workflows/<flow>/triggers/manual/paths/invoke, as Power Automate's do. Flows named in `gone` answer 404 like a
 * deleted or turned-off flow; "busy" answers 429. Bodies must be the Adaptive Card message shape Microsoft documents,
 * or the stand-in answers 400. It has not been compared with a live Teams response.
 */
export interface TeamsCard {
  flow: string;
  text: string;
  actions: { type: string; title: string; url: string }[];
}

export interface TeamsFixture {
  url: string;
  /** A Workflows-style URL for a flow name. */
  flowUrl(flow: string): string;
  cards: TeamsCard[];
  gone: Set<string>;
  close(): Promise<void>;
}

export async function startTeamsFixture(port = 0): Promise<TeamsFixture> {
  const cards: TeamsCard[] = [];
  const gone = new Set<string>(['deleted-flow']);
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    if (u.pathname === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    const m = u.pathname.match(/^\/workflows\/([a-z0-9-]+)\/triggers\/manual\/paths\/invoke$/);
    if (!m || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const flow = m[1]!;
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      if (gone.has(flow)) return void res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'WorkflowNotFound' } }));
      if (flow === 'busy') return void res.writeHead(429).end();
      try {
        const body = JSON.parse(raw) as { type?: string; attachments?: { contentType?: string; content?: { type?: string; body?: { type: string; text: string }[]; actions?: TeamsCard['actions'] } }[] };
        const card = body.attachments?.[0];
        if (body.type !== 'message' || card?.contentType !== 'application/vnd.microsoft.card.adaptive' || card.content?.type !== 'AdaptiveCard') throw new Error('shape');
        cards.push({ flow, text: card.content.body?.map((b) => b.text).join('\n') ?? '', actions: card.content.actions ?? [] });
        res.writeHead(202).end();
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'InvalidRequestContent' } }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    flowUrl: (flow) => `${url}/workflows/${flow}/triggers/manual/paths/invoke?api-version=1&sig=test-${flow}`,
    cards,
    gone,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// Run on its own (Playwright): `tsx test/fixtures/teams-fixture.ts`, port from TEAMS_FIXTURE_PORT.
if (process.argv[1]?.endsWith('teams-fixture.ts')) {
  void startTeamsFixture(Number(process.env.TEAMS_FIXTURE_PORT ?? 4600)).then((f) => console.warn(`Teams fixture on ${f.url}`));
}
