import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The colourful sidebar: every section has its own palette and each item its own colour, the current page is marked
 * in its colour and the mark follows you as you switch; text stays readable in light and dark.
 */

const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

const setTheme = (page: Page, theme: 'light' | 'dark') =>
  page.evaluate((th) => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: th }, version: 0 })), theme);

async function shoot(page: Page, file: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(1100);
  await page.locator('[data-shell="sidebar"]').screenshot({ path: `${PREVIEW_DIR}/${file}` });
}

test('each menu section has its own colours, and the current page is marked in its colour as you switch', async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, 'Menu Colours');
  await setTheme(page, 'light');
  await page.goto('/app');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Companies' })).toBeVisible();

  // Every section heading and every item carries its own colour.
  const headings = new Map(await nav.locator('[data-nav-heading]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-nav-heading'), getComputedStyle(e).getPropertyValue('--st-dot').trim()] as const)));
  expect(headings.size).toBeGreaterThanOrEqual(4);
  expect(new Set(headings.values()).size).toBe(headings.size);
  const workspace = await nav.locator('[aria-labelledby="nav-Workspace"] [data-nav-tone]').evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue('--st-dot').trim()));
  expect(new Set(workspace.slice(0, 6)).size).toBe(6);

  // The Revenue section is gone from the menu.
  await expect(nav.getByRole('heading', { name: 'Revenue' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^Quotes/ })).toHaveCount(0);

  // The current page's mark is in that item's colour, and moves with you.
  const current = nav.locator('a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await shoot(page, '01-menu-light.png');
  await nav.getByRole('link', { name: 'Companies' }).click();
  await expect(page).toHaveURL(/\/app\/companies/);
  await expect(current).toHaveAccessibleName(/Companies/);
  const companiesColour = await current.evaluate((e) => getComputedStyle(e).getPropertyValue('--st-dot').trim());
  await nav.getByRole('link', { name: 'Meetings' }).click();
  await expect(page).toHaveURL(/\/app\/meetings/);
  await expect(current).toHaveAccessibleName(/Meetings/);
  expect(await current.evaluate((e) => getComputedStyle(e).getPropertyValue('--st-dot').trim())).not.toBe(companiesColour);
  await expect(current.locator('.sf-nav-ico')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await shoot(page, '02-menu-switched-light.png');

  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const a11y = await new AxeBuilder({ page }).include('[data-shell="sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);

  await setTheme(page, 'dark');
  await page.reload();
  await expect(current).toHaveAccessibleName(/Meetings/);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const dark = await new AxeBuilder({ page }).include('[data-shell="sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(dark.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
  await shoot(page, '03-menu-dark.png');
  await nav.getByRole('link', { name: 'Follow-ups' }).click();
  await expect(current).toHaveAccessibleName(/Follow-ups/);
  await shoot(page, '04-menu-switched-dark.png');
});
