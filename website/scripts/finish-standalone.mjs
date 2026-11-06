// Runs after `vite build --mode standalone`: inlines the favicon and the social image link so the single
// HTML file works when opened straight from disk, and names it sampforce-showcase.html.
import { readFile, writeFile, rename } from 'node:fs/promises';

const dir = new URL('../dist-standalone/', import.meta.url);
let html = await readFile(new URL('index.html', dir), 'utf8');
const svg = await readFile(new URL('../public/brand/sampforce-icon.svg', import.meta.url));
const png = await readFile(new URL('../public/brand/sampforce-icon-512.png', import.meta.url));
html = html
  .replace(/href="\.?\/brand\/sampforce-icon\.svg"/, `href="data:image/svg+xml;base64,${svg.toString('base64')}"`)
  .replace(/href="\.?\/brand\/sampforce-icon-512\.png"/, `href="data:image/png;base64,${png.toString('base64')}"`)
  .replace(/\s*<meta property="og:image"[^>]*>/, '');
await writeFile(new URL('index.html', dir), html);
await rename(new URL('index.html', dir), new URL('sampforce-showcase.html', dir));
console.log(`dist-standalone/sampforce-showcase.html (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
