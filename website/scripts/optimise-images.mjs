// Converts PNG/JPG screenshots into web-ready WebP files in src/assets/media.
//
//   npm run images -- <source folder>
//
// Each source file becomes <name>.webp, max 1600 px wide (phones: 720 px), quality 80.
// Add or replace a screenshot by dropping it in the source folder with the same file name and re-running.
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run images -- <folder with .png/.jpg screenshots>');
  process.exit(1);
}
const out = new URL('../src/assets/media/', import.meta.url).pathname;
await mkdir(out, { recursive: true });

for (const file of await readdir(src)) {
  if (!/\.(png|jpe?g)$/i.test(file)) continue;
  const { name } = parse(file);
  const input = sharp(join(src, file));
  const meta = await input.metadata();
  const phone = meta.height > meta.width;
  const width = Math.min(meta.width, phone ? 720 : 1600);
  const target = join(out, `${name}.webp`);
  await input.resize({ width }).webp({ quality: 80, effort: 5 }).toFile(target);
  const kb = Math.round((await stat(target)).size / 1024);
  console.log(`${file} -> media/${name}.webp (${width}px, ${kb} KB)`);
}
