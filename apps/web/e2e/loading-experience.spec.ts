import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';
import { expectCleanLayout } from './layout-check';

/*
 * The loading experience (Kunal's spec section 3): skeletons at once, the animated SampForce logo when a load takes a
 * moment, real "N of M" counts while a page's data arrives, a plain message with Retry when something fails or takes
 * too long, and nothing at all for data that is already on screen. Slow and failing responses are made by holding or
 * failing the browser's own requests.
 */

const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('a slow page shows the bar and the SampForce loader with real counts, then the page', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Loader Research');
  await page.request.post('/api/v1/companies', { data: { name: 'Slowpoke Panels' }, headers: { origin: 'http://localhost:3000' } });
  // Hold the Companies list for four seconds.
  await page.route(/\/api\/v1\/companies(\?|$)/, async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/app/companies');
  await expect(page.locator('[data-load-bar]')).toBeVisible();
  const card = page.locator('[data-load-card="loading"]');
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.locator('svg.sfl-root')).toBeVisible();
  await expect(card).toContainText(/Loading/);
  await shot(page, '01-slow-page-loader');
  await expectCleanLayout(page, '[data-load-card]');
  // When the data arrives the loader goes and the page shows.
  await expect(page.getByText('Slowpoke Panels').first()).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveCount(0);
  await expect(page.locator('[data-load-bar]')).toHaveCount(0);

  // Data already on screen refreshing, and small actions, never show the loader.
  await page.unroute(/\/api\/v1\/companies(\?|$)/);
  await page.reload();
  await expect(page.getByText('Slowpoke Panels').first()).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-load-card]')).toHaveCount(0);
});

test('a part of the page that fails offers Try again, and trying again loads it', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Retry Research');
  await page.request.post('/api/v1/companies', { data: { name: 'Comeback Insights' }, headers: { origin: 'http://localhost:3000' } });
  let fail = true;
  await page.route(/\/api\/v1\/companies(\?|$)/, async (route) => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Down for a moment' } }) });
    else await route.continue();
  });
  await page.goto('/app/companies');
  const failed = page.locator('[data-load-card="failed"]');
  // The app retries a server error twice before it gives up, so this takes a few seconds.
  await expect(failed).toContainText('Part of this page did not load.', { timeout: 20_000 });
  await shot(page, '02-failed-part-retry');
  fail = false;
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Comeback Insights').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-load-card]')).toHaveCount(0);
});

test('opening SampForce on a slow connection shows skeletons, then the logo, never a blank page', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Skeleton Research');
  await page.route(/\/api\/v1\/auth\/me$/, async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  await page.goto('/app');
  const loading = page.locator('[data-page-loading]');
  await expect(loading).toBeVisible();
  await expect(page.locator('[data-page-loading="logo"] [data-brand-loader]')).toBeVisible({ timeout: 2500 });
  await expect(loading).toHaveAttribute('aria-busy', 'true');
  await shot(page, '03-app-opening-loader');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(loading).toHaveCount(0);
});
