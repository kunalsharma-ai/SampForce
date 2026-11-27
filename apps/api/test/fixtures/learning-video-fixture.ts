import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/*
 * Stand-in video providers for Learning & Development (ADR 0097). The API reaches them through LEARNING_FIXTURE_URL as
 * /site/<host>/<path>. Two made-up YouTube videos: one with English captions (the sales training text), one without.
 * Nothing here is real.
 */

export const SALES_TEXT = readFileSync(join(__dirname, '../../src/learning/fixtures/sales-communication.txt'), 'utf8');
export const VIDEO_WITH_CAPTIONS = 'https://www.youtube.com/watch?v=SalesTrain01';
export const VIDEO_WITHOUT_CAPTIONS = 'https://youtu.be/NoCaption01';

const player = (id: string, title: string, tracks: object[]) =>
  `<!doctype html><html><head><title>${title} - YouTube</title></head><body><script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: id, title, lengthSeconds: '754', author: 'SampForce Academy', thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg?sqp=x`, width: 480 }] } },
    captions: tracks.length ? { playerCaptionsTracklistRenderer: { captionTracks: tracks } } : undefined,
  })};var meta = {};</script></body></html>`;

/** The captions as YouTube's json3 format: one event per line of the text, headings left out. */
function json3(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/^- /, ''));
  return JSON.stringify({ events: lines.map((l, i) => ({ tStartMs: i * 4000, segs: [{ utf8: `${l}\n` }] })) });
}

export interface LearningVideoFixture {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

export async function startLearningVideoFixture(): Promise<LearningVideoFixture> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    requests.push(u.pathname + u.search);
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (u.pathname === '/site/www.youtube.com/watch') {
      const v = u.searchParams.get('v');
      if (v === 'SalesTrain01') return send(200, 'text/html', player(v, 'Sales Communication Essentials', [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=SalesTrain01&lang=en', languageCode: 'en', name: { simpleText: 'English' } }]));
      if (v === 'NoCaption01') return send(200, 'text/html', player(v, 'Product Walkthrough', []));
      return send(404, 'text/html', 'not found');
    }
    if (u.pathname === '/site/www.youtube.com/api/timedtext' && u.searchParams.get('v') === 'SalesTrain01') {
      return send(200, 'application/json', json3(SALES_TEXT));
    }
    send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
