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

test('lists become cards on a phone instead of a squeezed table', async ({ page }) => {
  await signUp(page, 'Phone List Org');
  const res = await page.request.post('/api/v1/leads', { data: { fullName: 'Pia Phone', companyName: 'Pocket Co' }, headers: { origin: 'http://localhost:3000' } });
  expect(res.ok()).toBe(true);
  await page.goto('/app/leads');
  const list = page.getByRole('list', { name: 'Leads' });
  await expect(list.getByRole('link', { name: 'Pia Phone' })).toBeVisible();
  await expect(list).toContainText('Pocket Co');
  await expect(page.getByRole('table')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
