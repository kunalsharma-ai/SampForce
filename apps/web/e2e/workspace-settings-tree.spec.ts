import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const CONTEXT = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' as const };

test.use(CONTEXT);

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function workspace(owner: Page, browser: Browser, input: { level: 'MANAGER' | 'EXECUTIVE'; name: string; parentId?: string; department?: string }, person?: string) {
  const email = person ? `${person.split(' ')[0]!.toLowerCase()}.${Date.now()}@example.com` : undefined;
  const ws = await (await owner.request.post('/api/v1/workspaces', { data: { ...input, ...(email ? { person: { inviteEmail: email, name: person } } : {}) }, headers: ORIGIN })).json();
  if (person) {
    const ctx = await browser.newContext(CONTEXT);
    const accepted = await ctx.request.post('/api/v1/auth/invitations/accept', { data: { token: (ws.inviteUrl as string).split('/invite/')[1], name: person, password: 'a-long-password-1' }, headers: ORIGIN });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    await ctx.close();
  }
  return ws.id as string;
}

/**
 * Workspace redesign W6: Settings in nine sections, each with one sentence on what it is for; the hierarchy drawn as
 * a tree (the company, its one Super Workspace, the managers and their executives) with an Actions menu on each card;
 * and changing the password while signed in.
 */
test('settings in nine sections, the workspace tree and changing the password', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { email } = await signUp(page, 'Tree Traders');
  const north = await workspace(page, browser, { level: 'MANAGER', name: 'North India', department: 'Field Sales' }, 'Rahul Sharma');
  await workspace(page, browser, { level: 'MANAGER', name: 'South India' }, 'Priya Nair');
  await workspace(page, browser, { level: 'EXECUTIVE', name: 'Delhi Field', parentId: north }, 'Asha Verma');
  await workspace(page, browser, { level: 'EXECUTIVE', name: 'Punjab Field', parentId: north });

  // Settings: nine sections, each saying what it is for. The old links still work.
  await page.goto('/app/settings');
  const sections = page.locator('[data-settings-section]');
  await expect(sections).toHaveCount(9);
  const titles = ['Workspace', 'Users & Workspaces', 'Roles & Permissions', 'Security', 'Password & Authentication', 'Data Management', 'Notifications', 'Integrations', 'Audit Logs'];
  for (const [i, title] of titles.entries()) await expect(sections.nth(i).getByRole('heading').first()).toHaveText(title);
  await expect(page.getByLabel('Workspace name')).toHaveValue('Tree Traders');
  await shot(page, '20-settings-nine-sections', true);
  await axe(page);

  // The hierarchy tree: company, Super Workspace, managers, executives.
  await page.getByRole('link', { name: /^Workspaces/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
  await expect(page.locator('[data-super-banner]')).toContainText('Tree Traders has one Super Workspace, and it is yours.');
  await expect(page.locator('[data-company-node]')).toContainText('Tree Traders');
  const superCard = page.locator('[data-workspace][data-level="SUPER"]');
  await expect(superCard.locator('[data-workspace-usage]')).toContainText('Manager Workspaces: 2');
  const northCard = page.locator('[data-workspace="North India"]');
  await expect(northCard.locator('[data-workspace-status]')).toHaveText('Active');
  await expect(northCard.locator('[data-workspace-person]')).toContainText('Rahul Sharma (rahul.');
  await expect(northCard).toContainText('Field Sales');
  await expect(northCard.locator('[data-workspace-usage]')).toContainText('Executive Workspaces in its team: 2');
  await expect(page.locator('[data-workspace="Punjab Field"] [data-workspace-status]')).toHaveText('Empty');
  // Executives hang under their manager.
  await expect(page.locator('[data-workspace="North India"] + ul [data-workspace="Delhi Field"]')).toBeVisible();
  await expect(page.locator('[data-workspace="North India"] + ul [data-workspace="Punjab Field"]')).toBeVisible();
  await shot(page, '21-workspace-hierarchy-tree', true);
  await axe(page);

  await page.getByRole('button', { name: 'Actions for North India', exact: true }).click();
  const menu = page.getByRole('menu');
  for (const item of ['Edit', 'Permissions', 'Deactivate', 'Delete']) await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
  await shot(page, '22-workspace-actions-menu');
  await menu.getByRole('menuitem', { name: 'Permissions', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  // Password & Authentication: change the password while signed in.
  await page.goto('/app/settings');
  await page.getByRole('link', { name: /^Change password/ }).click();
  await expect(page).toHaveURL(/\/app\/account\/security#change-password/);
  const card = page.locator('[data-change-password]');
  await card.getByLabel('Current password', { exact: true }).fill('not-my-password-1');
  await card.getByLabel('New password', { exact: true }).fill('a-brand-new-pass-2');
  await card.getByLabel('Repeat the new password').fill('a-brand-new-pass-3');
  await card.getByRole('button', { name: 'Change password' }).click();
  await expect(card.getByText('The two new passwords are not the same')).toBeVisible();
  await card.getByLabel('Repeat the new password').fill('a-brand-new-pass-2');
  await card.getByRole('button', { name: 'Change password' }).click();
  await expect(card.getByText('That password is not right.')).toBeVisible();
  await card.getByLabel('Current password', { exact: true }).fill('correcthorse1');
  await card.getByRole('button', { name: 'Change password' }).click();
  await expect(card.locator('[data-password-changed]')).toHaveText('Password changed.');
  await shot(page, '23-change-password-done');
  await axe(page);

  // The new password signs in; the old one does not.
  const fresh = await browser.newContext(CONTEXT);
  expect((await fresh.request.post('/api/v1/auth/login', { data: { email, password: 'correcthorse1' }, headers: ORIGIN })).status()).toBe(401);
  expect((await fresh.request.post('/api/v1/auth/login', { data: { email, password: 'a-brand-new-pass-2' }, headers: ORIGIN })).status()).toBe(200);
  await fresh.close();
});
