import { execFileSync } from 'node:child_process';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/**
 * A person's profile photo everywhere (ADR 0087): the photo chosen on My profile fills the welcome banner's avatar on
 * the workspace dashboard, and the Console uses it too for the operator with the same email, in the top bar, on the
 * Overview greeting and on the operators list. An operator can set a Console photo of their own and remove it again.
 */
const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, clip });
}

/** A portrait-like picture drawn in the browser, so the screenshots show a photo rather than a flat square. */
async function portrait(page: Page, colours: [string, string, string]): Promise<Buffer> {
  return Buffer.from(
    await page.evaluate(async ([bg1, bg2, shirt]) => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d')!;
      const sky = g.createLinearGradient(0, 0, 512, 512);
      sky.addColorStop(0, bg1);
      sky.addColorStop(1, bg2);
      g.fillStyle = sky;
      g.fillRect(0, 0, 512, 512);
      g.fillStyle = shirt;
      g.beginPath();
      g.ellipse(256, 520, 200, 170, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f1c7a3';
      g.fillRect(222, 300, 68, 70);
      g.beginPath();
      g.ellipse(256, 230, 98, 118, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3b2416';
      g.beginPath();
      g.ellipse(256, 150, 104, 62, 0, Math.PI, 0);
      g.fill();
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, colours),
  );
}

test('the profile photo shows in the workspace welcome banner and across the Console', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { email } = await signUp(page, `Photo Org ${Date.now().toString(36)}`);

  // Without a photo, the banner shows initials.
  await page.goto('/app');
  const avatar = page.locator('[data-welcome-avatar]');
  await expect(avatar).toHaveAttribute('data-welcome-avatar', 'initials');
  await expect(avatar).toHaveText('TP');
  await expect(page.locator('.sf-welcome-avatar img')).toHaveCount(0);

  // The photo chosen on My profile fills the banner's avatar.
  const photo = await portrait(page, ['#22d3ee', '#6366f1', '#0f172a']);
  const put = await page.request.put('/api/v1/me/photo', { headers: { ...ORIGIN, 'content-type': 'image/jpeg' }, data: photo });
  expect(put.ok(), await put.text()).toBe(true);
  await page.reload();
  await expect(avatar).toHaveAttribute('data-welcome-avatar', 'photo');
  const img = page.locator('.sf-welcome-avatar img');
  await expect(img).toHaveAttribute('src', /\/api\/v1\/people\/.+\/photo\?v=/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await shot(page, '01-workspace-welcome-photo', { x: 0, y: 0, width: 1440, height: 420 });

  // The same person is a Console operator: the Console uses their SampForce photo.
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Test Person', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15_000 });
  const banner = ops.locator('[data-welcome-avatar]');
  await expect(banner).toHaveAttribute('data-welcome-avatar', 'photo');
  await expect(ops.locator('.sf-welcome-avatar img')).toHaveAttribute('src', /\/api\/v1\/operator\/photos\/.+\?v=u/);
  const topBar = ops.getByRole('button', { name: 'Account: Test Person' }).locator('img');
  await expect(topBar).toBeVisible();
  await expect.poll(() => topBar.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await shot(ops, '02-console-overview-photo', { x: 0, y: 0, width: 1440, height: 460 });

  // The operators list shows it next to the name.
  await ops.goto('/operator/operators');
  await expect(ops.locator(`[data-operator-row="${email}"] img`)).toBeVisible();
  await shot(ops, '03-console-operators-photo', { x: 0, y: 0, width: 1440, height: 520 });

  // The account page says where the photo comes from, and a Console photo of their own replaces it.
  await ops.goto('/operator/account');
  const card = ops.locator('[data-operator-photo]');
  await expect(card).toContainText('From your SampForce profile');
  await card.getByRole('button', { name: 'Change photo' }).click();
  const dialog = ops.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
  await dialog.getByLabel('Choose a photo').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: await portrait(ops, ['#f97316', '#ec4899', '#1e293b']) });
  await expect(dialog.locator('[data-crop-area]')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save photo' }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText('Your Console photo.');
  await expect(card.locator('img')).toHaveAttribute('src', /\?v=o/);
  await expect(ops.getByRole('button', { name: 'Account: Test Person' }).locator('img')).toHaveAttribute('src', /\?v=o/);
  await shot(ops, '04-console-account-own-photo', { x: 0, y: 0, width: 1440, height: 560 });

  // Removing it brings the SampForce photo back.
  await card.getByRole('button', { name: 'Change photo' }).click();
  await dialog.getByRole('button', { name: 'Remove photo' }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText('From your SampForce profile');
  await expect(card.locator('img')).toHaveAttribute('src', /\?v=u/);

  // With no photo anywhere, initials come back in the workspace banner.
  expect((await page.request.delete('/api/v1/me/photo', { headers: ORIGIN })).ok()).toBe(true);
  await page.reload();
  await expect(avatar).toHaveAttribute('data-welcome-avatar', 'initials');
});
