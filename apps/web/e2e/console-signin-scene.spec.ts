import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** The Console's animated sign-in (ADR 0075): its own scene and name, the same form and messages as before. */
test.describe('Console animated sign-in', () => {
  test('the Console has its own command-center scene, named, with the same sign-in form', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/operator/login');
    await page.getByLabel('Email').fill('nobody@platform.test');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByLabel('Password')).toHaveAttribute('type', 'text');
    await expect(page.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/operator/forgot-password');
    await expect(page.locator('main')).toHaveAttribute('data-sign-in-scene', 'console');
    await expect(page.locator('[data-workspace-badge="console"]')).toContainText('SampForce Console');
    await expect(page.locator('[data-workspace-badge="console"]')).toContainText('Super Admin · Sampledge staff only');
    await expect(page.locator('[data-scene-greeting="console"] strong')).toHaveText('SampForce Console');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-sfs-mode', 'light');
    await expect(page.getByRole('heading', { name: 'Welcome to the SampForce Console' })).toBeVisible();
    await axe(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    await ctx.close();
  });

});
