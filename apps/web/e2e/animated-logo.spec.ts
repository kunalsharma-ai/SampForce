import { execFileSync } from 'node:child_process';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save close-ups and a recording of the animated logo (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

/** The names of the CSS animations running inside the logo right now. */
const running = (logo: Locator) =>
  logo.evaluate((el) =>
    [...new Set(el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').map((a) => (a as CSSAnimation).animationName))].sort(),
  );

async function closeUp(page: Page, logo: Locator, name: string) {
  if (!PREVIEW_DIR) return;
  const box = (await logo.boundingBox())!;
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, clip: { x: 0, y: 0, width: Math.max(box.x + box.width + 24, 280), height: box.y + box.height + 16 } });
}

/**
 * The SampForce logo in the top-left corner: it strikes in when the app loads, the spark twinkles and the bolt glows
 * at rest, and hovering jolts it and sweeps a shine over "Force". Under reduced motion it is simply the still logo.
 */
test('the corner logo animates in workspaces and the Console, and stays still under reduced motion', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signUp(page, `Logo Motion ${Date.now().toString(36)}`);
  // A clean recording for the preview (screenshots during a recording leave glitches in the video).
  if (PREVIEW_DIR) {
    const rec = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: PREVIEW_DIR, size: { width: 1440, height: 900 } }, storageState: await page.context().storageState() });
    const r = await rec.newPage();
    await r.goto('/app');
    await r.waitForTimeout(4500);
    await r.locator('[data-shell="sidebar"] [data-logo-animated="yes"]').hover();
    await r.waitForTimeout(1500);
    await r.mouse.move(700, 500);
    await r.waitForTimeout(5000);
    await rec.close();
  }
  const app = page;
  await app.goto('/app');
  const logo = app.locator('[data-shell="sidebar"] [data-logo-animated="yes"]');
  await expect(logo).toBeVisible();
  // On load: the halves strike in, the streaks shoot, the spark pops and the shine sweeps.
  await app.waitForTimeout(250);
  await closeUp(app, logo, '50-logo-intro-strike');
  await app.waitForTimeout(500);
  await closeUp(app, logo, '51-logo-intro-flash');
  await expect.poll(() => running(logo)).toEqual(expect.arrayContaining(['sf-glow', 'sf-twinkle']));
  await app.waitForTimeout(1500);
  await closeUp(app, logo, '52-logo-rest');
  // Hover jolts the bolt, dashes the streaks, spins the spark and sweeps the shine again.
  await logo.hover();
  await expect.poll(() => running(logo)).toEqual(expect.arrayContaining(['sf-dash', 'sf-jolt', 'sf-ring-again', 'sf-shine-again', 'sf-spark-spin']));
  await app.waitForTimeout(150);
  await closeUp(app, logo, '53-logo-hover');
  await app.mouse.move(700, 500);
  // Keyboard focus on the logo's link does the same.
  await app.getByRole('link', { name: 'SampForce Command Center' }).focus();
  await app.keyboard.press('Shift+Tab');
  await app.keyboard.press('Tab');
  await expect.poll(() => running(logo)).toContain('sf-jolt');

  // Reduced motion: every animation ends at once and the logo is its normal still self.
  const still = await (await browser.newContext({ reducedMotion: 'reduce', storageState: await page.context().storageState() })).newPage();
  await still.goto('/app');
  const quiet = still.locator('[data-shell="sidebar"] [data-logo-animated="yes"]');
  await expect(quiet).toBeVisible();
  await expect.poll(() => running(quiet)).toEqual([]);
  await expect(quiet.locator('.sf-spark')).toHaveCSS('opacity', '1');
  await expect(quiet.locator('.sf-word')).toHaveCSS('opacity', '1');

  // The Console's corner logo animates too.
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-logo-${suffix}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Logo Ops', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const consoleLogo = ops.locator('[data-console-sidebar] [data-logo-animated="yes"]');
  await expect(consoleLogo).toBeVisible();
  await expect.poll(() => running(consoleLogo)).toEqual(expect.arrayContaining(['sf-glow', 'sf-twinkle']));
  await ops.waitForTimeout(1200);
  await closeUp(ops, consoleLogo, '54-logo-console');
});
