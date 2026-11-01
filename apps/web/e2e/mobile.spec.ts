import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('works on a phone: drawer navigation and readable dashboard', async ({ page }) => {
  await signUp(page, 'Mobile Org');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Team Management' }).click();
  await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('phones get a bottom bar with the main pages and a create button', async ({ page }) => {
  await signUp(page, 'Bottom Bar Org');
  const bar = page.getByRole('navigation', { name: 'Quick navigation' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await bar.getByRole('link', { name: 'Deals' }).click();
  await expect(page).toHaveURL(/\/app\/deals/);
  await expect(bar.getByRole('link', { name: 'Deals' })).toHaveAttribute('aria-current', 'page');
  await bar.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('menuitem', { name: 'New task' }).click();
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
  // The page's last content is not hidden behind the bar.
  const pad = await page.locator('main').evaluate((m) => parseFloat(getComputedStyle(m).paddingBottom));
  expect(pad).toBeGreaterThanOrEqual(56);
});
