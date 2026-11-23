/**
 * Draws the app's icon, Android adaptive icon, splash image and Android notification icon from SampForce's brand mark
 * (apps/web/src/app/icon.svg), with Chromium through Playwright, into apps/mobile/assets. Run it again after the brand
 * mark changes:
 *
 *   node apps/mobile/scripts/make-store-assets.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Playwright comes with the web app's end-to-end tests.
const { chromium } = createRequire(join(here, '..', '..', 'web', 'package.json'))('@playwright/test');
const out = join(here, '..', 'assets');
const mark = readFileSync(join(here, '..', '..', 'web', 'src', 'app', 'icon.svg'), 'utf8');
/** The colour behind the mark: SampForce's dark navy, also the splash and adaptive icon background in app.json. */
export const BACKGROUND = '#111827';

/** Android draws notification icons from their alpha only, so the mark is drawn in plain white. */
const white = mark.replace(/fill="url\(#[a-z]\)"/g, 'fill="#fff"').replace(/fill="#FFC857"/g, 'fill="#fff"').replace(/<polygon[^>]*fill="url\(#h\)"[^>]*\/>/g, '');

const assets = [
  // iOS and the stores: square, no transparency (the system rounds the corners).
  { file: 'icon.png', size: 1024, background: BACKGROUND, svg: mark, scale: 0.62 },
  // Android adaptive icon foreground: the launcher crops to the middle 66%, so the mark stays inside it.
  { file: 'adaptive-icon.png', size: 1024, background: 'transparent', svg: mark, scale: 0.5 },
  { file: 'splash-icon.png', size: 1024, background: 'transparent', svg: mark, scale: 0.9 },
  { file: 'notification-icon.png', size: 96, background: 'transparent', svg: white, scale: 0.8 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const a of assets) {
  await page.setViewportSize({ width: a.size, height: a.size });
  const box = Math.round(a.size * a.scale);
  await page.setContent(
    `<html><body style="margin:0;width:${a.size}px;height:${a.size}px;display:flex;align-items:center;justify-content:center;background:${a.background}">` +
      `<div style="width:${box}px;height:${box}px">${a.svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path: join(out, a.file), omitBackground: a.background === 'transparent' });
  console.log(`assets/${a.file} ${a.size}x${a.size}`);
}
await browser.close();
