import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp, openAccountMenu } from './helpers';

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const section = (page: Page, name: 'favourites' | 'modules') => sidebar(page).locator(`[data-nav-section="${name}"]`);

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
}

test('favourites are saved to the account and show in the sidebar and search; visited pages are never recorded', async ({ page, browser }) => {
  const { email, password } = await signUp(page, 'Fav Org');
  await expect(section(page, 'favourites')).toHaveCount(0);

  await page.goto('/app/deals');
  await expect(page.getByRole('heading', { level: 1, name: 'Deals' })).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Add this page to favourites' }).click();
  await expect(section(page, 'favourites').getByRole('link', { name: 'Deals' })).toBeVisible();
  await openAccountMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Remove this page from favourites' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Visiting pages leaves no history: nothing is sent to the server and the sidebar has no Recent section.
  const visits: string[] = [];
  page.on('request', (r) => r.url().includes('/me/navigation/visits') && visits.push(r.url()));
  await page.goto('/app/quotes');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(2_000); // longer than the old 1.5 s recording delay
  await page.goto('/app/leads');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(visits).toEqual([]);
  await expect(sidebar(page).locator('[data-nav-section="recent"]')).toHaveCount(0);
  await expect(sidebar(page).getByRole('heading', { name: 'Recent', exact: true })).toHaveCount(0);

  // Search shows favourites first, and no Recent group.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog');
  await expect(palette.getByRole('group', { name: 'Favourites' }).getByRole('option', { name: 'Deals' })).toBeVisible();
  await expect(palette.getByRole('group', { name: 'Recent' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Another browser has nothing local: it gets the same favourites from the account.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signIn(p2, email, password);
  await expect(section(p2, 'favourites').getByRole('link', { name: 'Deals' })).toBeVisible();
  await section(p2, 'favourites').getByRole('button', { name: 'Remove Deals from favourites' }).click();
  await expect(section(p2, 'favourites')).toHaveCount(0);
  await other.close();

  await page.reload();
  await expect(section(page, 'favourites')).toHaveCount(0);
});

test('the menu can be reordered and modules hidden; hidden modules are still found by search', async ({ page }) => {
  await signUp(page, 'Menu Org');
  await page.getByRole('button', { name: 'Customize menu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize menu' });
  await dialog.getByRole('button', { name: 'Move Deals up' }).click();
  await dialog.getByRole('button', { name: 'Move Deals up' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Deals moved up.');
  await dialog.getByRole('button', { name: 'Hide Meetings' }).click();
  await expect(dialog.getByRole('button', { name: 'Hide Settings' })).toBeDisabled();
  const a11y = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Save menu' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  const workspace = section(page, 'modules').first().getByRole('link');
  await expect(workspace.nth(1)).toHaveText('Deals');
  await expect(section(page, 'modules').getByRole('link', { name: 'Meetings' })).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search records, pages and commands…').fill('meetings');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/meetings/);

  await page.getByRole('button', { name: 'Customize menu' }).click();
  await page.getByRole('button', { name: 'Restore default menu' }).click();
  await expect(section(page, 'modules').getByRole('link', { name: 'Meetings' })).toBeVisible();
  await expect(section(page, 'modules').first().getByRole('link').nth(1)).toHaveText('Companies');
});

test('keyboard shortcuts, Focus Workspace and search actions', async ({ page }) => {
  await signUp(page, 'Keys Org');
  await page.locator('body').press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('New inbound contact');
  const a11y = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.keyboard.press('g');
  await page.keyboard.press('d');
  await expect(page).toHaveURL(/\/app\/deals$/);
  await page.keyboard.press('n');
  await page.keyboard.press('t');
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
  // Letters typed into a field are text, not shortcuts.
  await page.getByRole('dialog', { name: 'New task' }).getByRole('textbox').first().fill('gd');
  await expect(page).toHaveURL(/\/app\/deals$/);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+.');
  await expect(page.locator('html')).toHaveAttribute('data-focus', 'on');
  await expect(sidebar(page)).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-focus', 'on');
  await page.getByRole('button', { name: /Exit focus/ }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-focus', 'on');
  await expect(sidebar(page)).toBeVisible();

  // Commands from search: switch mode, then hand a question to Copilot.
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search records, pages and commands…').fill('light mode');
  await page.getByRole('option', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search records, pages and commands…').fill('which deals are at risk');
  // A question is offered to Copilot first, so Enter asks it.
  await expect(page.getByRole('option').first()).toHaveText(/Ask Copilot/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'SampForce Copilot' })).toBeVisible();
});
