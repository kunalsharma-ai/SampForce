import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const rootVar = (page: Page, name: string) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);
const previewVar = (page: Page, name: string) => page.getByTestId('theme-preview').evaluate((el, n) => (el as HTMLElement).style.getPropertyValue(n).trim(), name);

test('Theme Studio previews a theme, applies it, and the account keeps it on another device', async ({ page, browser }) => {
  const { email, password } = await signUp(page, 'Studio Org');
  await page.goto('/app/settings/appearance');
  await expect(page.getByRole('heading', { level: 1, name: 'Theme Studio' })).toBeVisible();
  const before = await rootVar(page, '--primary');

  await page.getByText('Emerald Command', { exact: true }).click();
  await page.getByText('Compact', { exact: true }).click();
  // The preview changes, the page does not until Apply.
  await expect.poll(() => previewVar(page, '--primary')).not.toBe(before);
  expect(await rootVar(page, '--primary')).toBe(before);
  await expect(page.getByRole('status').filter({ hasText: 'Unapplied changes' })).toBeVisible();

  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Saved to your account')).toBeVisible();
  const emerald = await previewVar(page, '--primary');
  expect(await rootVar(page, '--primary')).toBe(emerald);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'emerald');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  // Compact density: 36 px buttons.
  expect(await page.getByRole('button', { name: 'Apply' }).evaluate((b) => b.getBoundingClientRect().height)).toBe(36);

  // A fresh browser has nothing on the device; the settings come from the account.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('/login');
  await p2.getByLabel('Work email').fill(email);
  await p2.getByLabel('Password').fill(password);
  await p2.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(p2).toHaveURL(/\/app/);
  await expect(p2.locator('html')).toHaveAttribute('data-theme', 'emerald');
  await expect(p2.locator('html')).toHaveAttribute('data-density', 'compact');
  expect(await rootVar(p2, '--primary')).toBe(emerald);
  await other.close();
});

test('Discard throws the draft away and the top bar switcher applies a theme at once', async ({ page }) => {
  await signUp(page, 'Switcher Org');
  await page.goto('/app/settings/appearance');
  await page.getByText('Rose Quartz', { exact: true }).click();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'signature');

  await page.getByRole('button', { name: /^Theme: / }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: /^Theme: / }).click();
  await page.getByRole('menuitemradio', { name: 'Cyber Graphite' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyber');
  await expect(page.getByRole('button', { name: 'Theme: Cyber Graphite' })).toBeVisible();
  // The studio's draft follows a change made elsewhere while it is untouched.
  await expect(page.getByRole('radio', { name: 'Cyber Graphite' })).toBeChecked();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyber');
});

test('a hard-to-read custom colour is adjusted and explained; named themes are saved and deleted', async ({ page }) => {
  await signUp(page, 'Brand Org');
  await page.goto('/app/settings/appearance');
  await page.getByText('Custom Brand Studio', { exact: true }).click();
  await page.getByRole('radio', { name: 'Light' }).check({ force: true });
  await page.getByLabel('Primary', { exact: true }).fill('#FFE066');
  await expect(page.getByRole('list', { name: 'Automatic adjustments' })).toContainText('Primary was darkened from #FFE066');
  await expect(page.getByRole('list', { name: 'Contrast checks' }).getByText(/fails/)).toHaveCount(0);
  await page.getByLabel('Primary', { exact: true }).fill('#zz');
  await expect(page.getByText('Use a 6-digit hex colour such as #00D9FF.')).toBeVisible();
  await page.getByLabel('Primary', { exact: true }).fill('#FFE066');

  await page.getByLabel('Name').fill('Launch week');
  await page.getByRole('button', { name: 'Save draft as theme' }).click();
  const saved = page.getByRole('list', { name: 'Your saved themes' });
  await expect(saved).toContainText('Launch week');
  await page.reload();
  await expect(saved).toContainText('Launch week · Custom Brand Studio');
  await page.getByRole('button', { name: 'Delete Launch week' }).click();
  await expect(page.getByText('No saved themes yet.')).toBeVisible();
});

test('an owner sets the workspace default and a reset returns to it', async ({ page }) => {
  await signUp(page, 'Default Org');
  await page.goto('/app/settings/appearance');
  await page.getByText('Pearl Executive', { exact: true }).click();
  await page.getByRole('button', { name: 'Use this draft as the workspace default' }).click();
  await expect(page.getByText(/Members who have not chosen their own settings see Pearl Executive/)).toBeVisible();

  await page.getByText('Oceanic Intelligence', { exact: true }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Saved to your account')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'oceanic');

  await page.getByRole('button', { name: 'Reset to the workspace default' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pearl');
  await expect(page.getByText('You are using the workspace default.')).toBeVisible();
  await page.goto('/app/administration');
  await expect(page.getByRole('cell', { name: 'tenant.appearance_default_set' })).toBeVisible();
});

test('motion, background and low-power settings reach the page', async ({ page }) => {
  await signUp(page, 'Motion Org');
  await page.goto('/app/settings');
  await page.getByText('Minimal', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'minimal');
  await page.goto('/app/settings/appearance');
  await page.getByText('Plain', { exact: true }).click();
  await page.getByText('Ultra compact', { exact: true }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-background', 'plain');
  // Ultra compact keeps small controls at the 24 px WCAG minimum.
  const sm = await page.getByRole('button', { name: 'Save draft as theme' }).evaluate((b) => b.getBoundingClientRect().height);
  expect(sm).toBeGreaterThanOrEqual(24);
});

for (const [theme, mode] of [
  ['Solar Horizon', 'Light'],
  ['Obsidian Intelligence', 'Dark'],
  ['Rose Quartz', 'Light'],
  ['Midnight Sapphire', 'Dark'],
] as const) {
  test(`${theme} (${mode.toLowerCase()}) has no WCAG 2.2 A/AA violations on the studio and key pages`, async ({ page }) => {
    test.setTimeout(90_000);
    await signUp(page, 'Axe Theme Org');
    await page.goto('/app/settings/appearance');
    await page.getByText(theme, { exact: true }).click();
    await page.getByRole('radio', { name: mode }).check({ force: true });
    await page.getByText('Off', { exact: true }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Saved to your account')).toBeVisible();
    for (const path of ['/app/settings/appearance', '/app', '/app/leads', '/app/deals']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations, `${path}: ${r.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(', ')}`).toEqual([]);
    }
  });
}
