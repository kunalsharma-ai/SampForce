// Serves the app's web export (pnpm build) for the end-to-end tests: apps/web/e2e/mobile-app.spec.ts drives it at
// phone size against the real API. Not for production; the app ships to phones through the stores.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = join(import.meta.dirname, '..', 'dist-web');
const port = Number(process.env.MOBILE_WEB_PORT ?? 8090);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No web export at ${root}. Run "pnpm build" in apps/mobile first.`);
  process.exit(1);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (path === '/health') return res.end('ok');
  const file = normalize(join(root, path));
  // The app routes on the client: anything that is not a file gets the page.
  const target = file.startsWith(root) && existsSync(file) && statSync(file).isFile() ? file : join(root, 'index.html');
  res.setHeader('content-type', TYPES[extname(target)] ?? 'application/octet-stream');
  createReadStream(target).pipe(res);
}).listen(port, '127.0.0.1', () => console.warn(`Mobile web export on http://localhost:${port}`));
