import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { FEATURE_KEYS } from '@dealflow/types';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

/** The wizard's remaining steps (W5): past the person and permissions, then review and create. */
async function finishWizard(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
}

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

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** Permission Center (ADR 0071, part 3): a parent hands down features and actions, and never more than it has. */
test('the Permission Center hands features and actions down, and a manager cannot grant what it lacks', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, 'Frequent Research Panels');
  await page.goto('/app/settings');
  await page.getByRole('link', { name: /Workspaces/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();

  await page.getByRole('button', { name: 'New Manager Workspace' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Workspace name').fill('West India Sales');
  await dialog.getByLabel('Designation').fill('Regional Sales Manager');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Full name').fill('Meera Nair');
  await dialog.getByLabel('Work email').fill(`meera.${Date.now()}@example.com`);
  await expect(dialog.getByText('This email is free to use.')).toBeVisible();
  await finishWizard(dialog);
  const link = dialog.getByLabel('Invitation link');
  await expect(link).toHaveValue(/\/invite\//);
  const token = (await link.inputValue()).split('/invite/')[1]!;
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-workspace="West India Sales"]')).toContainText('Regional Sales Manager');
  await expect(page.locator('[data-usage="Manager Workspaces"]')).toContainText('1');
  await shot(page, '09-workspace-structure');
  await axe(page);

  // The Super Workspace takes RFQs and deleting in CRM away, and lets the manager build a team.
  await page.getByRole('button', { name: 'Permissions West India Sales' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'RFQs', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Delete in CRM' }).uncheck();
  await dialog.getByRole('checkbox', { name: 'May create Executive Workspaces in its team' }).check();
  await shot(page, '10-permission-center');
  await axe(page);
  await dialog.getByRole('button', { name: 'Save permissions' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. It applies on its next request.');
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  const tree = await (await page.request.get('/api/v1/workspaces', { headers: ORIGIN })).json();
  const west = tree.workspaces.find((w: { name: string }) => w.name === 'West India Sales');
  expect(west.features).not.toContain('rfqs');
  expect(west.actions.CRM).not.toContain('delete');
  expect(west.canCreateExecutives).toBe(true);

  // The manager signs in, builds a team, and can hand down only what West India Sales has.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const manager = await ctx.newPage();
  const accept = await manager.request.post('/api/v1/auth/invitations/accept', { data: { token, name: 'Meera Nair', password: 'a-long-password-1' }, headers: ORIGIN });
  expect(accept.ok(), await accept.text()).toBe(true);
  await manager.goto('/app/settings/workspaces');
  await manager.getByRole('button', { name: 'New Executive Workspace' }).click();
  dialog = manager.getByRole('dialog');
  await dialog.getByLabel('Workspace name').fill('Priya Sharma');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await finishWizard(dialog);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(manager.locator('[data-workspace="Priya Sharma"]')).toBeVisible();
  await manager.getByRole('button', { name: 'Permissions Priya Sharma' }).click();
  dialog = manager.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'RFQs', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'Delete in CRM' })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'May create Executive Workspaces in its team' })).toHaveCount(0);
  await shot(manager, '11-manager-permission-center');
  await axe(manager);

  const priya = (await (await manager.request.get('/api/v1/workspaces', { headers: ORIGIN })).json()).workspaces.find((w: { name: string }) => w.name === 'Priya Sharma');
  const grant = await manager.request.put(`/api/v1/workspaces/${priya.id}/permissions`, { data: { features: [...priya.features, 'rfqs'] }, headers: ORIGIN });
  expect(grant.status()).toBe(403);
  expect((await grant.json()).error.code).toBe('FEATURE_NOT_GRANTED');
  await ctx.close();
});
