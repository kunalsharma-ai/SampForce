import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Company export to Excel and CSV (ADR 0079): the Export menu on the Companies list and on a company page. */
const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string) {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('exports the filtered company list and a single company as Excel and CSV', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Frequent Research');
  const acme = await post(page, '/companies', {
    name: 'Acme Panels',
    industry: 'Market research',
    country: 'IN',
    city: 'Mumbai',
    website: 'https://acmepanels.example',
    primaryEmail: 'sales@acmepanels.example',
    linkedinUrl: 'https://www.linkedin.com/company/acme-panels',
    socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/acmepanels' }],
    moreDetails: [{ label: 'VAT number', value: 'IN-VAT-123' }],
    notes: 'Asked for rates in December',
  });
  await post(page, '/contacts', { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Research', email: 'priya@acmepanels.example', linkedinUrl: 'https://www.linkedin.com/in/priya-nair', companyId: acme.id });
  await post(page, '/companies', { name: 'Zeta Fieldwork', country: 'GB' });

  // The list: search narrows the export to what is on screen.
  await page.goto('/app/companies');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Zeta Fieldwork' })).toBeVisible();
  await main.getByPlaceholder('Search…').fill('acme');
  await expect(main.getByRole('link', { name: 'Zeta Fieldwork' })).toHaveCount(0);
  await main.getByTestId('company-export').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('Export the companies in this list')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Excel workbook/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'CSV: employees' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('[role="menu"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
  await shot(page, '01-companies-export-menu');

  let download = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'CSV: companies' }).click();
  let file = await download;
  expect(file.suggestedFilename()).toMatch(/^sampforce-companies-\d{4}-\d{2}-\d{2}\.csv$/);
  const companies = await readFile((await file.path())!, 'utf8');
  expect(companies).toContain('Acme Panels');
  expect(companies).toContain('IN-VAT-123');
  expect(companies).toContain('https://facebook.com/acmepanels');
  expect(companies).not.toContain('Zeta Fieldwork');

  await main.getByTestId('company-export').click();
  download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Excel workbook/ }).click();
  file = await download;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  expect((await readFile((await file.path())!)).subarray(0, 2).toString()).toBe('PK');

  // One company from its page, with its employees.
  await page.goto(`/app/companies/${acme.id}`);
  await page.getByTestId('company-export').click();
  await expect(page.getByRole('menu').getByText('Export this company with its employees')).toBeVisible();
  await shot(page, '02-company-page-export-menu');
  download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'CSV: employees' }).click();
  file = await download;
  expect(file.suggestedFilename()).toMatch(/^sampforce-[A-Z]+\d+-acme-panels-employees-\d{4}-\d{2}-\d{2}\.csv$/);
  const employees = await readFile((await file.path())!, 'utf8');
  expect(employees).toContain('Head of Research');
  expect(employees).toContain('priya@acmepanels.example');
  expect(employees).toContain('https://www.linkedin.com/in/priya-nair');
});
