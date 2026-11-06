// Quick sanity check after `npm run build:all`: both outputs exist and nothing loads from an unexpected host.
import { readFile, readdir } from 'node:fs/promises';

const fail = (m) => { console.error('✗', m); process.exitCode = 1; };
const ok = (m) => console.log('✓', m);

const dist = await readdir(new URL('../dist/assets/', import.meta.url)).catch(() => []);
dist.length ? ok(`dist/ has ${dist.length} assets`) : fail('dist/ is missing: run npm run build');

const html = await readFile(new URL('../dist-standalone/sampforce-showcase.html', import.meta.url), 'utf8').catch(() => '');
if (!html) fail('dist-standalone/sampforce-showcase.html is missing: run npm run build:standalone');
else {
  ok(`standalone HTML is ${(html.length / 1024 / 1024).toFixed(1)} MB`);
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('mailto:'));
  const allowed = ['https://www.sampledge.com'];
  const bad = external.filter((u) => !allowed.some((a) => u.startsWith(a)));
  bad.length ? fail(`standalone loads external files: ${bad.join(', ')}`) : ok('standalone needs no network');
  /["'(]\.?\/assets\/[^"']+\.(webp|woff2|js|css)/.test(html) ? fail('standalone still points at /assets files') : ok('all images, fonts and scripts are inlined');
}
