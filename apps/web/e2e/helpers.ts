import { expect, type Page } from '@playwright/test';

export async function signUp(page: Page, org = 'E2E Org') {
  const id = Math.random().toString(36).slice(2, 10);
  const email = `e2e-${id}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Test Person');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await page.getByLabel('Organization name').fill(org);
  await page.getByRole('button', { name: 'Start free' }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole('heading', { name: 'Welcome, Test' })).toBeVisible();
  return { email, password: 'correcthorse1' };
}
