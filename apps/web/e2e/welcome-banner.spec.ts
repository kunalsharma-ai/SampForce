import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/*
 * The welcome banner (redesign): every home dashboard opens with a greeting for the time of day and the person's
 * name, their workspace, today's date and a line of the day, over a sky that follows the time of day. Executive,
 * Manager and Super Workspace dashboards and the Console Overview, on a computer, a tablet and a phone.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const SIZES = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } } as const;
const HELLO = /^(Good (morning|afternoon|evening)|Working late), /;

test.use({ reducedMotion: 'reduce', viewport: SIZES.desktop, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: SIZES.desktop, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

/** The banner reads right, passes axe and fits; then it is photographed in light and dark at every size. */
async function check(page: Page, path: string, name: string, badge: string, prefix: string) {
  const banner = page.locator('[data-welcome-banner]').first();
  if (page.url() === 'about:blank') await page.goto(path);
  for (const theme of ['light', 'dark'] as const) {
    // The workspace app applies the appearance saved on the person's account; the Console keeps its own (light).
    if (path.startsWith('/app')) {
      const pref = await (await page.request.get('/api/v1/me/preferences')).json();
      const res = await page.request.put('/api/v1/me/preferences/appearance', { data: { ...pref.appearance, mode: theme }, headers: ORIGIN });
      expect(res.ok(), await res.text()).toBe(true);
      await page.evaluate(() => {
        localStorage.removeItem('dealflow:preferences');
        localStorage.removeItem('dealflow:appearance-paint');
      });
    } else if (theme === 'dark') continue;
    for (const [size, viewport] of Object.entries(SIZES)) {
      await page.setViewportSize(viewport);
      await page.goto(path);
      await expect(banner.locator('[data-welcome-hello]')).toHaveText(new RegExp(`${HELLO.source}${name}`));
      await expect(banner).toHaveAttribute('data-welcome-banner', /^(morning|afternoon|evening|night)$/);
      await expect(banner.locator('[data-welcome-level]')).toHaveText(badge);
      await expect(banner.locator('[data-welcome-line]')).not.toBeEmpty();
      await expect(banner.locator('[data-welcome-date]')).not.toBeEmpty();
      // It never pushes the page sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      if (size === 'desktop') {
        const r = await new AxeBuilder({ page }).include('[data-welcome-banner]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
      }
      if (PREVIEW_DIR) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${PREVIEW_DIR}/${prefix}-${theme}-${size}.png` });
      }
    }
  }
  await page.setViewportSize(SIZES.desktop);
}

test('every home dashboard and the Console open with a welcome for the time of day and the person', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  await signUp(page, `Welcome Research ${stamp}`);
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  expect((await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN })).ok()).toBe(true);
  const p = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const priya = await join(browser, p.inviteUrl, 'Priya Sharma');

  await check(priya, '/app', 'Priya', 'Executive Workspace', '01-executive');
  await expect(priya.locator('[data-role-dashboard="EXECUTIVE"] [data-welcome-banner]').getByRole('heading', { level: 1 })).toHaveText('What do I need to do today?');
  await check(manager, '/app', 'Rahul', 'Manager Workspace', '02-manager');
  await check(page, '/app', 'Test', 'Super Workspace', '03-super');

  // The Console Overview greets the operator for the platform.
  const email = `ops-welcome-${String(stamp).slice(-6)}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Ola Welcome', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ viewport: SIZES.desktop, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15_000 });
  await check(ops, '/operator', 'Ola', 'Platform Console', '04-console');
});
