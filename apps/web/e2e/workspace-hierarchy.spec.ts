import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { FEATURE_KEYS } from '@dealflow/types';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** Workspace hierarchy (ADR 0071): each person sees which workspace they work in, and what it was not given. */
test('shows the workspace in the header and refuses a module the workspace was not given', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  await page.goto('/app');
  await expect(page.getByRole('banner').getByText('Super Workspace')).toBeVisible();
  await page.getByRole('button', { name: /account menu/i }).click();
  await expect(page.getByRole('menu').getByText('Client Administrator')).toBeVisible();
  await shot(page, '01-super-workspace-identity');
  await page.keyboard.press('Escape');

  const created = await post(page.request, '/workspaces', {
    level: 'MANAGER',
    name: 'North India Sales',
    designation: 'Regional Sales Manager',
    features: FEATURE_KEYS.filter((k) => k !== 'rfqs'),
    person: { inviteEmail: `rahul.${Date.now()}@example.com` },
  });
  const token = (created.inviteUrl as string).split('/invite/')[1]!;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const manager = await ctx.newPage();
  const accept = await manager.request.post('/api/v1/auth/invitations/accept', { data: { token, name: 'Rahul Sharma', password: 'a-long-password-1' }, headers: ORIGIN });
  expect(accept.ok(), await accept.text()).toBe(true);
  await manager.goto('/app');
  await expect(manager.getByRole('banner').getByText('Manager Workspace')).toBeVisible();
  await manager.getByRole('button', { name: /account menu/i }).click();
  await expect(manager.getByRole('menu').getByText('Regional Sales Manager')).toBeVisible();
  await shot(manager, '02-manager-workspace-identity');
  await manager.keyboard.press('Escape');

  await manager.goto('/app/rfqs');
  await expect(manager.getByText(/not available in your workspace/i)).toBeVisible();
  await shot(manager, '03-module-not-given-to-workspace');
  const direct = await manager.request.get('/api/v1/rfqs', { headers: ORIGIN });
  expect(direct.status()).toBe(403);
  await ctx.close();
});
