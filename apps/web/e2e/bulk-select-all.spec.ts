import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Selecting every matching record on every page and deleting them all at once. Set PREVIEW_DIR for screenshots. */
const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('selects every matching company on every page and deletes them all at once', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Sweep Research');
  for (let i = 0; i < 40; i++) {
    const res = await page.request.post('/api/v1/companies', { data: { name: `Sweep Panel ${String(i + 1).padStart(2, '0')}`, country: 'IN' }, headers: ORIGIN });
    expect(res.ok(), await res.text()).toBe(true);
  }
  expect((await page.request.post('/api/v1/companies', { data: { name: 'Keeper Fieldwork' }, headers: ORIGIN })).ok()).toBe(true);

  await page.goto('/app/companies');
  const main = page.getByRole('main');
  const table = main.getByRole('table', { name: 'Companies' });
  await main.getByPlaceholder('Search…').fill('sweep');
  await expect(main.getByText('1–25 of 40')).toBeVisible();
  await table.getByRole('checkbox', { name: 'Select all rows on this page' }).check();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await expect(bar).toContainText('25 companies selected');
  await bar.getByRole('button', { name: 'Select all 40 companies' }).click();
  await expect(bar).toContainText('All 40 companies selected, on every page');
  await shot(page, '01-all-40-selected');

  await bar.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete 40 companies?' });
  await expect(dialog).toContainText('on every page, not only the rows you can see');
  await shot(page, '02-delete-all-confirm');
  await dialog.getByRole('button', { name: 'Delete 40 companies' }).click();
  // The password is asked once for all of them (signUp confirms it).
  await expect(main.getByText('No records match these filters.')).toBeVisible();
  await main.getByPlaceholder('Search…').fill('');
  await expect(table.getByRole('link', { name: 'Keeper Fieldwork' })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await shot(page, '03-after-delete-all');
});
