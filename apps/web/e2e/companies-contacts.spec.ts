import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Companies and their contacts in one place, and the smart import (ADR 0066). Set PREVIEW_DIR to save screenshots.
 */
const ORIGIN = { origin: 'http://localhost:3000' };
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

/** The shape of a real customer sheet: shouted headings, typos, one row per employee. */
const SHEET = [
  'DATE,NO OF BRANCHES & ADDRESS,COUNTRY & WORKING HOURS,COMPANY NAME,WESBSITE,COMPANY LINKEDIN ID,EMPLOYEE NAME,EMPLOYEE DESGNATION,EMPLOYEE EMAIL ID',
  '26-05-2026 (TUESDAY),"New Hope, Pennsylvania",United States of America (USA),Sommer Consulting,http://www.sommerconsulting.com/,https://www.linkedin.com/company/sommer-consulting,Brooks Anderson,Associate Director,brooks@sommerconsulting.com',
  '26-05-2026 (TUESDAY),"New Hope, Pennsylvania",United States of America (USA),Sommer Consulting,http://www.sommerconsulting.com/,https://www.linkedin.com/company/sommer-consulting,Farah Samawi,Insights & Research,farah@sommerconsulting.com',
  '26-05-2026 (TUESDAY),"New Hope, Pennsylvania",United States of America (USA),Sommer Consulting,http://www.sommerconsulting.com/,https://www.linkedin.com/company/sommer-consulting,Janine Karo,Senior Project Manager,janine@sommerconsulting.com',
  '27-05-2026 (WEDNESDAY),"Pune, Maharashtra",India,Kestrel Analytics,https://kestrel.example,,Rohan Iyer,Research Director,rohan@kestrel.example',
].join('\n');

test('imports a one-row-per-employee sheet: headings matched despite typos, new fields added, employees attached', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Frequent Research');
  await page.goto('/app/settings/import');
  const main = page.getByRole('main');
  await expect(main.getByLabel('Import into')).toHaveValue('companies_contacts');
  await main.getByLabel('Choose a CSV or Excel file').setInputFiles({ name: 'leads-23.csv', mimeType: 'text/csv', buffer: Buffer.from(SHEET) });

  await expect(main.getByLabel('Field for column COMPANY NAME')).toHaveValue('company.name');
  await expect(main.getByLabel('Field for column WESBSITE')).toHaveValue('company.website');
  await expect(main.getByLabel('Field for column COMPANY LINKEDIN ID')).toHaveValue('company.linkedinUrl');
  await expect(main.getByLabel('Field for column EMPLOYEE NAME')).toHaveValue('contact.fullName');
  await expect(main.getByLabel('Field for column EMPLOYEE DESGNATION')).toHaveValue('contact.jobTitle');
  await expect(main.getByLabel('Field for column EMPLOYEE EMAIL ID')).toHaveValue('contact.email');
  await expect(main.getByLabel('Field for column DATE')).toHaveValue('new:company');
  await expect(main.getByText('Adds the text field “No Of Branches & Address”.')).toBeVisible();
  await expect(main.getByText('6 matched')).toBeVisible();
  await expect(main.getByText('3 new fields')).toBeVisible();
  await axe(page);
  await shot(page, '01-import-auto-matched');

  await main.getByRole('button', { name: 'Check file' }).click();
  await expect(main.getByText('4 ready to import')).toBeVisible();
  await expect(main.getByText('New companies to add: 2')).toBeVisible();
  await expect(main.getByText('Employees to add: 4')).toBeVisible();
  await shot(page, '02-import-checked');
  await main.getByRole('button', { name: 'Import 4 rows' }).click();
  await expect(main.getByText('Import complete')).toBeVisible();
  await expect(main.getByText('New custom fields added')).toBeVisible();
  await shot(page, '03-import-complete');

  // The company page shows the employees and the new fields' values.
  await page.goto('/app/companies');
  await main.getByRole('link', { name: 'Sommer Consulting' }).click();
  await expect(main.getByRole('table', { name: 'Employees / POCs' })).toContainText('Farah Samawi');
  await expect(main.getByRole('table', { name: 'Employees / POCs' })).toContainText('Associate Director');
  await expect(main).toContainText('New Hope, Pennsylvania');
  await shot(page, '04-company-after-import');
});

test('companies and contacts in one place: see, add, edit, move and remove a company’s people without leaving', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'One Place');
  const acme = await post(page, '/companies', { name: 'Acme Panels', country: 'IN', city: 'Pune', industry: 'Market research', website: 'acmepanels.example' });
  await post(page, '/companies', { name: 'Nordlicht Research', country: 'DE', city: 'Munich' });
  await post(page, '/contacts', { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead', companyId: acme.id, email: 'priya@acmepanels.example' });
  await post(page, '/contacts', { firstName: 'Lena', lastName: 'Ortiz', jobTitle: 'Fieldwork Manager', email: 'lena@freelance.example' });

  // Companies and contacts are tabs of one place.
  await page.goto('/app/companies');
  const main = page.getByRole('main');
  const tabs = main.getByRole('navigation', { name: 'Companies and contacts' });
  await expect(tabs.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');

  // The contacts count opens the company's people in place.
  await main.getByRole('button', { name: 'Contacts at Acme Panels: 1' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('table', { name: 'Employees / POCs' })).toContainText('Priya Nair');
  await axe(page);
  await shot(page, '05-companies-list-contacts-in-place');

  // Add a new employee from the list.
  await dialog.getByRole('button', { name: 'Add employee / POC' }).click();
  const add = page.getByRole('dialog').last();
  await add.getByLabel('Employee name *').fill('Arjun Mehta');
  await add.getByLabel('Designation').fill('Head of Insights');
  await add.getByLabel('Email IDs 1', { exact: true }).fill('arjun@acmepanels.example');
  await add.getByRole('button', { name: 'Add employee' }).click();
  await expect(dialog.getByRole('table', { name: 'Employees / POCs' })).toContainText('Arjun Mehta');

  // Edit one in place.
  await dialog.getByRole('button', { name: 'Edit Priya Nair' }).click();
  const edit = page.getByRole('dialog').last();
  await expect(edit.getByLabel('Designation')).toHaveValue('Procurement Lead');
  await edit.getByLabel('Designation').fill('Head of Procurement');
  await shot(page, '06-edit-employee-in-place');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('table', { name: 'Employees / POCs' })).toContainText('Head of Procurement');

  // Bring in a contact who is already in SampForce.
  await dialog.getByRole('button', { name: 'Add an existing contact' }).click();
  const link = page.getByRole('dialog').last();
  await link.getByLabel('Contact').fill('Lena');
  await page.getByRole('option', { name: /Lena Ortiz/ }).click();
  await shot(page, '07-add-existing-contact');
  await link.getByRole('button', { name: 'Add to company' }).click();
  await expect(dialog.getByRole('table', { name: 'Employees / POCs' })).toContainText('Lena Ortiz');

  // Take one off the company: the contact stays in Contacts.
  await dialog.getByRole('button', { name: 'Remove Arjun Mehta from this company' }).click();
  await dialog.getByRole('button', { name: 'Remove from Acme Panels' }).click();
  await expect(dialog.getByRole('table', { name: 'Employees / POCs' })).not.toContainText('Arjun Mehta');
  await shot(page, '08-company-people-after-changes');
  await page.keyboard.press('Escape');
  await expect(main.getByRole('button', { name: 'Contacts at Acme Panels: 2' })).toBeVisible();

  await tabs.getByRole('link', { name: 'Contacts' }).click();
  await expect(page).toHaveURL(/\/app\/contacts$/);
  await expect(main.getByRole('link', { name: 'Arjun Mehta' })).toBeVisible();
  await shot(page, '09-contacts-tab');

  // On the company page, the same controls.
  await page.goto(`/app/companies/${acme.id}`);
  await expect(main.getByRole('button', { name: 'Edit Lena Ortiz' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Add an existing contact' })).toBeVisible();
  await axe(page);
  await shot(page, '10-company-page-people');
});

test('a new company is created with its employees in one go', async ({ page }) => {
  await signUp(page, 'Quick Create');
  await page.goto('/app/companies');
  await page.getByRole('button', { name: 'Quick create' }).click();
  await page.getByRole('menuitem', { name: 'Company' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company name *').fill('Helios Data');
  await dialog.getByRole('button', { name: 'Add employee / POC' }).click();
  await dialog.getByLabel('Employee name *').fill('Karl Weber');
  await dialog.getByLabel('Designation').fill('CEO');
  await dialog.getByLabel('Email', { exact: true }).fill('not-an-email');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(dialog.getByText('Enter a valid email')).toBeVisible();
  await dialog.getByLabel('Email', { exact: true }).fill('karl@helios.example');
  await dialog.getByRole('button', { name: 'Add employee / POC' }).click();
  await dialog.getByLabel('Employee name *').nth(1).fill('Ana Lima');
  await axe(page);
  await shot(page, '11-new-company-with-employees');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]{36}$/);
  const table = page.getByRole('main').getByRole('table', { name: 'Employees / POCs' });
  await expect(table).toContainText('Karl Weber');
  await expect(table).toContainText('Ana Lima');
});
