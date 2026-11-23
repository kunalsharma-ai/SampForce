import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * Animated sign-in (ADR 0075): each level has its own scene and welcome, the form works from the first frame, the
 * welcome after signing in matches the workspace really opened, and the next sign-in remembers it.
 */
test.describe('animated sign-in', () => {
  for (const [level, headline, name] of [
    ['super', 'Your whole company, in one place', 'Super Workspace'],
    ['manager', 'Lead your team to the next win', 'Manager Workspace'],
    ['executive', 'Ready to close? Let’s sell.', 'Executive Workspace'],
  ] as const) {
    test(`the ${level} scene shows its own welcome and never blocks the form`, async ({ page }) => {
      await page.goto(`/login?workspace=${level}`);
      // Typing straight away works: the animation is only behind the form.
      await page.getByLabel('Work email').fill('someone@example.com');
      await page.getByLabel('Password').fill('not-the-password');
      // The eye shows what was typed and hides it again; "Forgot your password?" is there too.
      await page.getByRole('button', { name: 'Show password' }).click();
      await expect(page.getByLabel('Password')).toHaveAttribute('type', 'text');
      await page.getByRole('button', { name: 'Hide password' }).click();
      await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
      await expect(page.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password');
      await expect(page.locator('main')).toHaveAttribute('data-sign-in-scene', level);
      await expect(page.locator(`[data-scene="${level}"]`)).toHaveCount(1);
      await expect(page.getByRole('heading', { name: headline })).toBeVisible();
      // The workspace is greeted and named in bold, in the greeting and on the sign-in box; its animation has a stage.
      await expect(page.locator(`[data-scene-greeting="${level}"] strong`)).toHaveText(name);
      await expect(page.locator(`[data-workspace-badge="${level}"]`)).toContainText(`You’re signing in to${name}`);
      await expect(page.locator(`[data-scene-stage="${level}"]`)).toHaveCount(1);
      await expect(page.locator('[data-scene]')).toHaveAttribute('aria-hidden', 'true');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByText('The email or password is incorrect.')).toBeVisible();
      // A wrong password: the red cross and the shake; typing again clears them.
      await expect(page.locator('[data-sign-in-cross]')).toBeVisible();
      await expect(page.locator('[data-sign-in-result]')).toHaveAttribute('data-sign-in-result', 'error');
      await page.getByLabel('Password').pressSequentially('x');
      await expect(page.locator('[data-sign-in-result]')).toHaveAttribute('data-sign-in-result', 'idle');
      if (PREVIEW_DIR) {
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${PREVIEW_DIR}/login-${level}.png` });
      }
    });
  }

  test('reduced motion settles on a still frame that passes accessibility checks', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/login?workspace=manager');
    await expect(page.getByRole('heading', { name: 'Lead your team to the next win' })).toBeVisible();
    // Every animation ends at once on its still frame (within a moment of the page appearing).
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length), { timeout: 2000 }).toBe(0);
    await axe(page);
    await ctx.close();
  });

  test('anyone can switch the sign-in page to light or dark and pick a palette, remembered on this device', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/login?workspace=super');
    const main = page.locator('main');
    // Fields are checked as soon as they are left.
    await page.getByLabel('Work email').fill('not-an-email');
    await page.getByLabel('Password').focus();
    await expect(page.getByLabel('Work email')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Work email').fill('someone@example.com');
    await expect(page.getByLabel('Work email')).toHaveAttribute('aria-invalid', 'false');
    await expect(main).toHaveAttribute('data-sfs-mode', 'dark');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(main).toHaveAttribute('data-sfs-mode', 'light');
    await page.getByRole('radio', { name: 'Ocean blue' }).click();
    await expect(page.getByRole('radio', { name: 'Ocean blue' })).toHaveAttribute('aria-checked', 'true');
    await expect(main).toHaveAttribute('data-sfs-palette', 'ocean');
    // The form still works in the new look, and the page passes accessibility checks in it.
    await page.getByLabel('Work email').fill('someone@example.com');
    await axe(page);
    await page.reload();
    await expect(main).toHaveAttribute('data-sfs-mode', 'light');
    await expect(main).toHaveAttribute('data-sfs-palette', 'ocean');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.getByRole('radio', { name: 'SampForce red' }).click();
    await expect(main).toHaveAttribute('data-sfs-mode', 'dark');
    await ctx.close();
  });

  test('works on a phone: the welcome sits above the form', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto('/login?workspace=executive');
    await page.getByLabel('Work email').fill('someone@example.com');
    await expect(page.getByRole('heading', { name: 'Ready to close? Let’s sell.' })).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    if (PREVIEW_DIR) {
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${PREVIEW_DIR}/login-phone-executive.png` });
    }
    await ctx.close();
  });

  test('after signing in, the welcome matches the workspace opened, once, and the next sign-in remembers it', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    await signUp(page, 'Frequent Research Welcome');
    const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@example.com` } });
    const token = (m.inviteUrl as string).split('/invite/')[1]!;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
    const manager = await ctx.newPage();
    const accepted = await manager.request.post('/api/v1/auth/invitations/accept', { data: { token, name: 'Rahul Sharma', password: 'a-long-password-1' }, headers: ORIGIN });
    expect(accepted.ok()).toBe(true);
    await manager.request.post('/api/v1/auth/logout', { headers: ORIGIN });

    // No link and no history on this device: the Executive scene; the welcome after sign-in is the Manager one.
    await manager.goto('/login');
    await expect(manager.locator('main')).toHaveAttribute('data-sign-in-scene', 'executive');
    await manager.getByLabel('Work email').fill(`rahul.${stamp}@example.com`);
    await manager.getByLabel('Password').fill('a-long-password-1');
    await manager.getByRole('button', { name: 'Sign in', exact: true }).click();
    // The right password: the green tick, then the welcome.
    await expect(manager.locator('[data-sign-in-tick]').getByRole('status')).toHaveText('Signed in');
    const welcome = manager.locator('[data-welcome="manager"]');
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('status')).toHaveText('Welcome back, Rahul');
    if (PREVIEW_DIR) {
      await manager.waitForTimeout(900);
      await manager.screenshot({ path: `${PREVIEW_DIR}/welcome-manager.png` });
    }
    await expect(welcome).toHaveCount(0, { timeout: 5000 });
    await manager.reload();
    await expect(manager.locator('[data-notification-bell]')).toBeVisible();
    await expect(manager.locator('[data-welcome]')).toHaveCount(0);

    // Signed out, this device now opens on the Manager scene.
    await manager.request.post('/api/v1/auth/logout', { headers: ORIGIN });
    await manager.goto('/login');
    await expect(manager.locator('main')).toHaveAttribute('data-sign-in-scene', 'manager');
    await ctx.close();
  });
});
