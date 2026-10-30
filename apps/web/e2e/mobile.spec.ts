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
