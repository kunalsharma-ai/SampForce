import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Company logos (ADR 0070): found from the company's website by the worker, shown on the profile with a small
 * country flag and in the companies list, uploaded and removed from the profile. The websites are made-up sites
 * served by the logo stand-in (apps/api/test/fixtures/logo-fixture.ts).
 */
const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string, height = 900) {
  if (!PREVIEW_DIR) return;
  await page.setViewportSize({ width: 1440, height });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

const SVG_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#111827"/><path d="M18 46V18l14 16 14-16v28" stroke="#facc15" stroke-width="6" fill="none" stroke-linejoin="round"/></svg>',
);

test('company logos are found from the website and shown where the flag was', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Logo Showcase Org');
  const companies = [
    { name: 'Lumen Harbor', country: 'GB', city: 'Bristol', industry: 'Market research', website: 'https://lumenharbor.example' },
    { name: 'Tidepool Research', country: 'AU', city: 'Sydney', industry: 'Market research', website: 'tidepool.example' },
    { name: 'Emberline Energy', country: 'IN', city: 'Pune', industry: 'Energy', website: 'https://www.emberline.example' },
    { name: 'Quantaforge Labs', country: 'DE', city: 'Berlin', industry: 'Software', website: 'quantaforge.example' },
    { name: 'Brightwave Media', country: 'US', city: 'Austin', industry: 'Media', website: 'brightwave.example' },
    { name: 'Oldfield & Sons', country: 'IE', city: 'Dublin', industry: 'Retail', website: 'oldfield.example' },
    { name: 'Nordlicht Research GmbH', country: 'DE', city: 'Munich', industry: 'Market research' },
  ];
  const ids: Record<string, string> = {};
  for (const c of companies) ids[c.name] = (await post(page, '/companies', c)).id;

  // The worker (in the API for e2e) looks the logos up within a few seconds.
  await expect
    .poll(async () => {
      const list = await (await page.request.get('/api/v1/companies?pageSize=50')).json();
      return list.items.filter((c: { logo: { status: string } | null }) => c.logo?.status === 'FOUND').length;
    }, { timeout: 30_000 })
    .toBe(6);

  // The list shows each company's logo before its name; a company without a website gets its monogram.
  await page.goto('/app/companies');
  const main = page.getByRole('main');
  for (const c of companies.slice(0, 6)) await expect(main.getByRole('img', { name: `${c.name} logo` }).first()).toBeVisible();
  await expect(main.getByRole('img', { name: 'Nordlicht Research GmbH logo' })).toHaveCount(0);
  await expect(main.getByRole('row', { name: /Lumen Harbor/ }).getByRole('img', { name: 'United Kingdom' })).toBeVisible();
  await axe(page);
  await shot(page, '01-companies-list-with-logos');

  // The profile: the logo where the big flag was, with the country's small flag on its corner.
  await page.goto(`/app/companies/${ids['Lumen Harbor']}`);
  const hero = main.locator('section[aria-labelledby="company-name"]');
  await expect(hero.getByRole('img', { name: 'Lumen Harbor logo' })).toBeVisible();
  await expect(hero.getByRole('img', { name: 'United Kingdom' })).toBeVisible();
  await expect(hero.getByText('Logo from the company’s website')).toBeVisible();
  await axe(page);
  await shot(page, '02-company-profile-logo-and-flag');

  // A small favicon stays sharp on its white tile.
  await page.goto(`/app/companies/${ids['Oldfield & Sons']}`);
  await expect(hero.getByRole('img', { name: 'Oldfield & Sons logo' })).toBeVisible();
  await expect(hero.getByRole('img', { name: 'Ireland' })).toBeVisible();
  await shot(page, '03-company-profile-small-favicon');

  // No website: a monogram in the company's colour, and the flag.
  await page.goto(`/app/companies/${ids['Nordlicht Research GmbH']}`);
  await expect(hero.getByText('NR', { exact: true })).toBeVisible();
  await expect(hero.getByRole('img', { name: 'Germany' })).toBeVisible();
  await shot(page, '04-company-profile-monogram');

  // Upload a logo from the profile; it is saved and shown at once.
  await hero.getByRole('button', { name: 'Change logo' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload logo' }).click();
  await (await chooser).setFiles({ name: 'nordlicht.svg', mimeType: 'image/svg+xml', buffer: SVG_LOGO });
  await expect(hero.getByRole('img', { name: 'Nordlicht Research GmbH logo' })).toBeVisible();
  await expect(hero.getByText('Uploaded logo')).toBeVisible();
  await page.reload();
  await expect(hero.getByRole('img', { name: 'Nordlicht Research GmbH logo' })).toBeVisible();
  await hero.getByRole('button', { name: 'Change logo' }).click();
  await expect(page.getByRole('menuitem', { name: 'Remove logo' })).toBeVisible();
  await shot(page, '05-company-profile-logo-menu');
  await page.getByRole('menuitem', { name: 'Remove logo' }).click();
  await expect(hero.getByRole('img', { name: 'Nordlicht Research GmbH logo' })).toHaveCount(0);
  await expect(hero.getByText('NR', { exact: true })).toBeVisible();

  // An uploaded logo replaces the website's until it is removed; then the website's comes back.
  await page.goto(`/app/companies/${ids['Brightwave Media']}`);
  await hero.getByRole('button', { name: 'Change logo' }).click();
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload logo' }).click();
  await (await chooser2).setFiles({ name: 'bw.svg', mimeType: 'image/svg+xml', buffer: SVG_LOGO });
  await expect(hero.getByText('Uploaded logo')).toBeVisible();
  await hero.getByRole('button', { name: 'Change logo' }).click();
  await page.getByRole('menuitem', { name: 'Use the website’s logo instead' }).click();
  await expect(hero.getByText('Logo from the company’s website')).toBeVisible({ timeout: 20_000 });

  if (PREVIEW_DIR) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/app/companies/${ids['Emberline Energy']}`);
    await expect(hero.getByRole('img', { name: 'Emberline Energy logo' })).toBeVisible();
    await shot(page, '06-company-profile-dark');
    await page.goto('/app/companies');
    await expect(main.getByRole('img', { name: 'Emberline Energy logo' }).first()).toBeVisible();
    await shot(page, '07-companies-list-dark');
  }
});
