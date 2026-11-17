import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save full-page screenshots of each screen (used for phase previews). */
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

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector('main')?.scrollHeight ?? 0));
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 2600) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('custom fields are set up in CRM configuration and used on records and in filters', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await signUp(page, 'Fieldwork Partners');
  await post(page, '/custom-fields', { entity: 'COMPANY', key: 'panel_size', label: 'Panel size', type: 'NUMBER', description: 'Respondents in the panel' });
  await post(page, '/custom-fields', { entity: 'COMPANY', key: 'budget', label: 'Annual budget', type: 'CURRENCY', currency: 'USD' });
  await post(page, '/custom-fields', { entity: 'COMPANY', key: 'markets', label: 'Markets', type: 'MULTISELECT', options: ['India', 'UAE', 'UK'] });
  await post(page, '/custom-fields', { entity: 'COMPANY', key: 'nda_signed', label: 'NDA signed', type: 'BOOLEAN' });
  await post(page, '/custom-fields', { entity: 'COMPANY', key: 'signed_on', label: 'Signed on', type: 'DATE' });

  // Add a dropdown field from the screen.
  await page.goto('/app/settings/crm?section=fields');
  const main = page.getByRole('main');
  await expect(main.getByRole('list', { name: 'Fields on companies' }).getByRole('listitem')).toHaveCount(5);
  await main.getByLabel('Name', { exact: true }).fill('Account tier');
  await main.getByLabel('Type', { exact: true }).selectOption('SELECT');
  await main.getByLabel('Dropdown values').fill('Gold\nSilver\nBronze');
  await main.getByRole('checkbox', { name: 'Global search looks through this field' }).check();
  await main.getByRole('button', { name: 'Add field' }).click();
  const fields = main.getByRole('list', { name: 'Fields on companies' });
  await expect(fields.getByRole('listitem')).toHaveCount(6);
  await expect(fields.getByRole('listitem').last()).toContainText('Account tier');
  // Reorder: the new field moves up one place.
  await fields.getByRole('button', { name: 'Move Account tier up' }).click();
  await expect(fields.getByRole('listitem').nth(4)).toContainText('Account tier');
  await axe(page);
  await shot(page, '01-custom-fields');

  // Values on a company, then shown on its profile.
  const gold = await post(page, '/companies', { name: 'Gold Panels Ltd', country: 'IN', city: 'Pune', customFields: { account_tier: 'Gold', panel_size: 12000, markets: ['India', 'UAE'], nda_signed: true, budget: { amount: 50000, currency: 'USD' }, signed_on: '2026-10-01' } });
  await post(page, '/companies', { name: 'Silver Surveys', country: 'GB', city: 'Leeds', customFields: { account_tier: 'Silver', panel_size: 800 } });
  await page.goto(`/app/companies/${gold.id}`);
  await expect(main.getByText('12,000').first()).toBeVisible();
  await expect(main.getByText('Account tier').first()).toBeVisible();
  await shot(page, '02-company-custom-values');

  // The companies list filters by a custom field.
  await page.goto('/app/companies');
  await expect(main.getByText('Silver Surveys')).toBeVisible();
  await main.getByRole('button', { name: 'Custom field filter' }).click();
  const pop = page.getByRole('dialog');
  await pop.getByLabel('Field').selectOption('panel_size');
  await pop.getByLabel('Test').selectOption('gte');
  await pop.getByLabel('Value', { exact: true }).fill('5000');
  await pop.getByRole('button', { name: 'Add filter' }).click();
  await expect(main.getByText('Panel size is at least 5000')).toBeVisible();
  await expect(main.getByText('Gold Panels Ltd')).toBeVisible();
  await expect(main.getByText('Silver Surveys')).toHaveCount(0);
  await axe(page);
  await shot(page, '03-companies-custom-filter');
});

test('statuses, categories, currency, notifications, exports, dashboards and attribution are configured by administrators', async ({ page }) => {
  await signUp(page, 'Fieldwork Admin Co');
  const main = page.getByRole('main');

  await page.goto('/app/settings/crm?section=rfq-statuses');
  await expect(main.getByRole('list', { name: 'RFQ statuses' }).getByRole('listitem').first()).toBeVisible();
  await axe(page);
  await shot(page, '04-rfq-statuses');

  await page.goto('/app/settings/crm?section=deal-statuses');
  await expect(main.getByRole('list', { name: 'Deal statuses' }).getByRole('listitem').first()).toBeVisible();
  await shot(page, '05-deal-statuses');

  await page.goto('/app/settings/crm?section=follow-up-types');
  const cats = main.getByRole('list', { name: 'Follow-up categories' });
  await expect(cats.getByRole('listitem').first()).toBeVisible();
  const before = await cats.getByRole('listitem').count();
  expect(before).toBeGreaterThan(1);
  await main.getByLabel('Name', { exact: true }).fill('Site visit');
  await main.getByRole('button', { name: 'Add category' }).click();
  await expect(main.getByRole('status').filter({ hasText: 'Added Site visit.' })).toBeVisible();
  await expect(cats.getByRole('listitem')).toHaveCount(before + 1);
  await axe(page);
  await shot(page, '06-follow-up-categories');

  await page.goto('/app/settings/crm?section=currency');
  await expect(main.getByLabel('Base currency')).toBeVisible();
  await axe(page);
  await shot(page, '07-currency');

  await page.goto('/app/settings/crm?section=notifications');
  const saveNotifications = main.getByRole('button', { name: 'Save notification settings' });
  await expect(saveNotifications).toBeDisabled();
  await main.getByLabel('Remind the owner before an RFQ deadline').selectOption('3');
  await saveNotifications.click();
  await expect(main.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.reload();
  await expect(main.getByLabel('Remind the owner before an RFQ deadline')).toHaveValue('3');
  await axe(page);
  await shot(page, '08-notifications');

  await page.goto('/app/settings/crm?section=exports');
  await expect(main.getByRole('button', { name: 'Save export permissions' })).toBeVisible();
  await axe(page);
  await shot(page, '09-export-permissions');

  await page.goto('/app/settings/crm?section=dashboards');
  await expect(main.getByLabel('Dashboard level')).toBeVisible();
  await expect(main.getByRole('list', { name: 'Default layout' })).toBeVisible();
  await axe(page);
  await shot(page, '10-dashboard-permissions');

  await page.goto('/app/settings/crm?section=attribution');
  await expect(main.getByRole('button', { name: 'Save attribution rule' })).toBeVisible();
  await axe(page);
  await shot(page, '11-attribution');
});

test('conditional fields show only when another field has a value, and formula fields calculate as people type', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await signUp(page, 'Panel Partners');
  await post(page, '/custom-fields', { entity: 'CONTACT', key: 'sample_size', label: 'Sample size', type: 'NUMBER' });
  await post(page, '/custom-fields', { entity: 'CONTACT', key: 'cpi', label: 'CPI', type: 'CURRENCY', currency: 'USD', description: 'Cost per interview' });
  await post(page, '/custom-fields', { entity: 'CONTACT', key: 'is_panelist', label: 'Panelist', type: 'BOOLEAN' });

  await page.goto('/app/settings/crm?section=fields');
  const main = page.getByRole('main');
  await main.getByLabel('Record type').selectOption('CONTACT');
  const fields = main.getByRole('list', { name: 'Fields on employees' });
  await expect(fields.getByRole('listitem')).toHaveCount(3);

  // A formula field: the editor checks the formula as it is typed.
  await main.getByLabel('Name', { exact: true }).fill('Project value');
  await main.getByLabel('Type', { exact: true }).selectOption('FORMULA');
  await main.getByLabel('Formula').fill('{sample_size} * (');
  await expect(main.getByText('The formula ends too early')).toBeVisible();
  await main.getByLabel('Formula').fill('{sample_size} * ');
  await main.getByRole('button', { name: 'CPI', exact: true }).click();
  await expect(main.getByLabel('Formula')).toHaveValue('{sample_size} * {cpi}');
  await main.getByLabel('Show as money in').fill('USD');
  await expect(main.getByRole('option', { name: /USD/ }).first()).toBeVisible();
  await main.getByLabel('Show as money in').press('Enter');
  await shot(page, '12-formula-field-editor');
  await main.getByRole('button', { name: 'Add field' }).click();
  await expect(fields.getByRole('listitem')).toHaveCount(4);

  // A conditional field: shown only for panelists, and required while it is shown.
  await main.getByLabel('Name', { exact: true }).fill('Panel name');
  await main.getByLabel('Type', { exact: true }).selectOption('TEXT');
  await main.getByLabel('Field', { exact: true }).selectOption('is_panelist');
  await main.getByLabel('Test', { exact: true }).selectOption('eq');
  await main.getByLabel('Value', { exact: true }).selectOption('true');
  await main.getByRole('checkbox', { name: 'Required while it is shown' }).check();
  await main.getByRole('button', { name: 'Add field' }).click();
  await expect(fields.getByRole('listitem')).toHaveCount(5);
  await expect(fields.getByRole('listitem').last()).toContainText('Shown when Panelist is Yes');
  await expect(fields.getByRole('listitem').nth(3)).toContainText('{sample_size} * {cpi}');
  await axe(page);
  await shot(page, '13-conditional-and-formula-fields');

  // On a new employee the formula calculates as the numbers are typed, and Panel name appears for panelists only.
  await page.goto('/app/contacts');
  await page.getByRole('button', { name: 'New contact' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name *').fill('Asha');
  await dialog.getByLabel('Last name').fill('Rao');
  await expect(dialog.getByLabel(/^Panel name/)).toHaveCount(0);
  await dialog.getByLabel('Sample size').fill('400');
  await dialog.getByLabel('CPI').fill('2.5');
  await expect(dialog.getByText('$1,000')).toBeVisible();
  await dialog.getByLabel('Panelist').selectOption('true');
  await expect(dialog.getByLabel('Panel name *')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create contact' }).click();
  await expect(dialog.getByText('Panel name is required').or(dialog.getByText('This field is required'))).toBeVisible();
  await axe(page);
  await shot(page, '14-new-employee-conditional-formula');
  await dialog.getByLabel('Panel name *').fill('Urban India 2026');
  await dialog.getByRole('button', { name: 'Create contact' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeVisible();
  await expect(main.getByText('$1,000').first()).toBeVisible();
  await expect(main.getByText('Urban India 2026').first()).toBeVisible();
  await expect(main.getByText('$2.50').first()).toBeVisible();
  await shot(page, '15-employee-calculated-value');
});
