import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

async function noAxeViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('builds a prospect list from a file, a form and Mock Mode search, then adds real people to the CRM', async ({ page }) => {
  test.setTimeout(60_000);
  await signUp(page, 'Prospecting');
  await page.goto('/app/prospects');
  await expect(page.getByText('Apollo.io people search')).toBeVisible();
  await expect(page.getByText('Mock Mode', { exact: true })).toBeVisible();
  await expect(page.getByText('No prospect lists yet.', { exact: false })).toBeVisible();
  await noAxeViolations(page);

  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByLabel('List name').fill('Q4 carriers');
  await page.getByLabel('Description').fill('Mid-size logistics companies');
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.getByRole('link', { name: 'Q4 carriers' }).click();
  await expect(page.getByRole('heading', { name: 'Q4 carriers' })).toBeVisible();
  await expect(page.getByText('This list is empty.', { exact: false })).toBeVisible();

  // By hand.
  await page.getByRole('button', { name: 'Add prospect' }).click();
  const add = page.getByRole('dialog', { name: 'Add prospect' });
  await add.getByLabel('Full name').fill('Asha Rao');
  await add.getByLabel('Email').fill('asha@carrier-one.test');
  await add.getByLabel('Company', { exact: true }).fill('Carrier One');
  await add.getByLabel('Industry').fill('Logistics');
  await add.getByLabel('Country').fill('India');
  await noAxeViolations(page);
  await add.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 prospect.' })).toBeVisible();

  // From a CSV file, with a bad row reported.
  await page.getByRole('button', { name: 'Import CSV or Excel' }).click();
  const imp = page.getByRole('dialog', { name: 'Import CSV or Excel' });
  const csv = 'Name,Email,Title,Company,Country,Employees\nBen Ode,ben@carrier-two.test,VP Sales,Carrier Two,Kenya,120\nCara Diaz,cara@shipfast.test,COO,ShipFast,Mexico,1200\nAsha Rao,asha@carrier-one.test,,Carrier One,India,\nBroken,not-an-email,,,,\n';
  await imp.getByLabel('File').setInputFiles({ name: 'carriers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(imp.getByText('carriers.csv: 4 rows.')).toBeVisible();
  await expect(imp.getByLabel('Email', { exact: true })).toHaveValue('1');
  await expect(imp.getByLabel('Company size')).toHaveValue('5');
  await noAxeViolations(page);
  await imp.getByRole('button', { name: 'Import 4 rows' }).click();
  await expect(imp.getByRole('list', { name: 'Rows not imported' })).toHaveText('Row 5: Enter a valid email address');
  await imp.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added 2 prospects. 1 already in this list. 1 row could not be imported.' })).toBeVisible();

  const table = page.getByRole('table', { name: 'Prospects in Q4 carriers' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await page.getByLabel('Country', { exact: true }).selectOption({ label: 'Kenya (1)' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row', { name: /Ben Ode/ })).toContainText('51-200');
  await page.getByLabel('Country', { exact: true }).selectOption('');

  // Mock Mode provider search: labelled sample people.
  await page.getByRole('button', { name: 'Find prospects' }).click();
  const find = page.getByRole('dialog', { name: 'Find prospects' });
  await find.getByLabel('Company websites').fill('northwind.com');
  await find.getByLabel('Job titles').fill('Head of Operations');
  await find.getByRole('button', { name: 'Search' }).click();
  await expect(find.getByText('Mock Mode: these are sample people', { exact: false })).toBeVisible();
  await expect(find.getByRole('list', { name: 'Search results' }).getByRole('listitem')).toHaveCount(12);
  await expect(find.getByRole('list', { name: 'Search results' }).getByRole('listitem').first()).toContainText('northwind.example');
  await noAxeViolations(page);
  await find.getByRole('button', { name: 'Add 12 to this list' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added 12 prospects. 12 email addresses found.' })).toBeVisible();
  await expect(page.getByText('This list has 12 sample people from Mock Mode.', { exact: false })).toBeVisible();

  // Select one real person and one sample: only the real one reaches the CRM.
  await page.getByLabel('Sort by', { exact: true }).selectOption('name');
  await table.getByLabel('Select Ben Ode').check();
  await table.getByRole('row').filter({ hasText: 'northwind.example' }).first().getByRole('checkbox').check();
  await expect(page.getByRole('status').filter({ hasText: '2 selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to CRM as leads' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 as leads. 1 skipped.' })).toBeVisible();
  await expect(table.getByRole('row', { name: /Ben Ode/ }).getByRole('link', { name: 'Lead' })).toBeVisible();
  await noAxeViolations(page);

  await page.getByRole('button', { name: 'Remove duplicates' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No duplicates found.' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export eligible' }).click();
  expect((await download).suggestedFilename()).toMatch(/^q4-carriers-\d{4}-\d{2}-\d{2}\.csv$/);

  await expect(page.getByText('Not sent to a sequence yet.', { exact: false })).toBeVisible();

  // Limits: the admin sees everyone's usage (one search and twelve reveals so far).
  await page.goto('/app/prospects');
  await page.getByRole('tab', { name: 'Usage and limits' }).click();
  await expect(page.getByText('You have used 13 of 100 provider calls', { exact: false })).toBeVisible();
  await page.getByLabel('Own limit for Test Person').fill('20');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await noAxeViolations(page);

  await page.goto('/app/leads');
  await expect(page.getByRole('link', { name: 'Ben Ode' })).toBeVisible();
});
