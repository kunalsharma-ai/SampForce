import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in email service for tests: a minimal SMTP server that accepts every message and keeps it in memory,
 * plus a small HTTP endpoint (GET /messages, DELETE /messages) so browser tests can read what was sent.
 * Plain SMTP without TLS or authentication: never use it outside tests.
 */
export interface CapturedMail {
  from: string;
  to: string[];
  /** Raw message: headers and body. */
  raw: string;
  subject: string;
  /** The decoded text body. */
  text: string;
}

export interface SmtpFixture {
  url: string;
  messages: CapturedMail[];
  close(): Promise<void>;
}

function decode(raw: string): { subject: string; text: string } {
  const [head = '', ...rest] = raw.split(/\r?\n\r?\n/);
  const headers = head.replace(/\r?\n[ \t]+/g, ' ');
  const subjectLine = /^Subject: (.*)$/im.exec(headers)?.[1] ?? '';
  const subject = subjectLine.replace(/=\?utf-8\?([BQ])\?(.*?)\?=/gi, (_, enc: string, data: string) =>
    enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64').toString() : data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
  ).replace(/\?=\s+=\?/g, '');
  let body = rest.join('\n\n');
  const encoding = /^Content-Transfer-Encoding: (.*)$/im.exec(headers)?.[1]?.trim().toLowerCase();
  if (encoding === 'base64') body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString();
  else if (encoding === 'quoted-printable') {
    body = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  }
  return { subject, text: body.replace(/\r\n/g, '\n').replace(/\n$/, '') };
}

function session(socket: Socket, store: CapturedMail[]): void {
  let from = '';
  let to: string[] = [];
  let data: string[] | null = null;
  let buffer = '';
  const reply = (line: string) => socket.write(`${line}\r\n`);
  reply('220 smtp-fixture ESMTP');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let at: number;
    while ((at = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (data) {
        if (line === '.') {
          const raw = data.join('\r\n');
          store.push({ from, to, raw, ...decode(raw) });
          data = null;
          from = '';
          to = [];
          reply('250 2.0.0 Accepted');
        } else data.push(line.startsWith('..') ? line.slice(1) : line);
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') socket.write('250-smtp-fixture\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
      else if (cmd === 'HELO') reply('250 smtp-fixture');
      else if (cmd === 'MAIL') { from = /<(.*)>/.exec(line)?.[1] ?? ''; reply('250 2.1.0 OK'); }
      else if (cmd === 'RCPT') { to.push(/<(.*)>/.exec(line)?.[1] ?? ''); reply('250 2.1.5 OK'); }
      else if (cmd === 'DATA') { data = []; reply('354 End data with <CR><LF>.<CR><LF>'); }
      else if (cmd === 'RSET') { from = ''; to = []; reply('250 OK'); }
      else if (cmd === 'NOOP') reply('250 OK');
      else if (cmd === 'QUIT') { reply('221 Bye'); socket.end(); }
      else reply('502 Command not implemented');
    }
  });
  socket.on('error', () => undefined);
}

export async function startSmtpFixture(port = 0): Promise<SmtpFixture> {
  const messages: CapturedMail[] = [];
  const server: Server = createServer((s) => session(s, messages));
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `smtp://127.0.0.1:${actual}`,
    messages,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Runs standalone for Playwright: SMTP on SMTP_FIXTURE_PORT (default 4400), HTTP inspection one port above. */
if (require.main === module) {
  void (async () => {
    const port = Number(process.env.SMTP_FIXTURE_PORT ?? 4400);
    const smtp = await startSmtpFixture(port);
    const http: HttpServer = createHttpServer((req, res) => {
      if (req.url === '/health') return res.end('ok');
      if (req.url === '/messages' && req.method === 'DELETE') {
        smtp.messages.length = 0;
        return res.end('[]');
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(smtp.messages.map(({ from, to, subject, text }) => ({ from, to, subject, text }))));
    });
    http.listen(port + 1, '127.0.0.1', () => process.stdout.write(`SMTP fixture on ${smtp.url}, messages on http://127.0.0.1:${port + 1}/messages\n`));
  })();
}
