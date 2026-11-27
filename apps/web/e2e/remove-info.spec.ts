import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Removing unwanted information from a company and a contact, and deleting employees (ADR 0097). Set PREVIEW_DIR for screenshots. */
const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, target?: ReturnType<Page['locator']>) {
  if (!PREVIEW_DIR) return;
  if (target) await target.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  else await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('removes single values from a company and a contact, and deletes employees', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Tidy Data Research');
  const company = await page.request.post('/api/v1/companies', {
    data: {
      name: 'Northwind Panels',
      industry: 'Market research',
      legalName: 'Northwind Panels Ltd',
      services: ['Online panels', 'Old service we dropped'],
      emails: [{ value: 'hello@northwind.example', primary: true }, { value: 'old-inbox@northwind.example' }],
      phones: [{ value: '+44 20 7946 0001', primary: true }],
      notes: 'Outdated note from a previous import',
    },
    headers: ORIGIN,
  });
  expect(company.ok(), await company.text()).toBe(true);
  const companyId = (await company.json()).id as string;
  const people = ['Asha Rao', 'Ben Cole', 'Chen Li', 'Dana Ortiz', 'Eli Novak', 'Farah Aziz'];
  let ashaId = '';
  for (const [i, full] of people.entries()) {
    const [firstName, lastName] = full.split(' ');
    const res = await page.request.post('/api/v1/contacts', {
      data: {
        firstName,
        lastName,
        companyId,
        jobTitle: i === 0 ? 'Old designation' : 'Research lead',
        department: 'Research',
        country: 'GB',
        city: 'London',
        remarks: i === 0 ? 'Unwanted remark' : null,
        emails: [{ value: `${firstName!.toLowerCase()}@northwind.example`, primary: true }, ...(i === 0 ? [{ value: 'asha.old@northwind.example' }] : [])],
      },
      headers: ORIGIN,
    });
    expect(res.ok(), await res.text()).toBe(true);
    if (i === 0) ashaId = (await res.json()).id;
  }

  // Company: each saved value has its own ×; the first press asks, the second removes.
  await page.goto(`/app/companies/${companyId}`);
  const info = page.locator('#business-information');
  await expect(info.getByText('Old service we dropped')).toBeVisible();
  await shot(page, '01-company-values-removable', info);
  await info.getByRole('button', { name: 'Remove Old service we dropped' }).click();
  await shot(page, '02-company-remove-confirm', info);
  await info.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(info.getByText('Old service we dropped')).toHaveCount(0);
  await info.getByRole('button', { name: 'Remove old-inbox@northwind.example' }).click();
  await info.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(info.getByText('old-inbox@northwind.example')).toHaveCount(0);
  await info.getByRole('button', { name: /^Remove Legal name/ }).click();
  await info.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(info.getByText('Northwind Panels Ltd')).toHaveCount(0);
  await expect(info.getByText('hello@northwind.example')).toBeVisible();
  await shot(page, '03-company-after-removing', info);
  const saved = await (await page.request.get(`/api/v1/companies/${companyId}`)).json();
  expect(saved.services).toEqual(['Online panels']);
  expect(saved.legalName).toBeNull();
  expect(saved.emails.map((e: { value: string }) => e.value)).toEqual(['hello@northwind.example']);

  // Employees: tick some and delete them, or one row's bin, or all of them.
  const employees = page.locator('#company-employees');
  await expect(employees.getByRole('link', { name: 'Farah Aziz' })).toBeVisible();
  await employees.getByRole('checkbox', { name: 'Select Eli Novak' }).check();
  await employees.getByRole('checkbox', { name: 'Select Farah Aziz' }).check();
  await employees.scrollIntoViewIfNeeded();
  await shot(page, '04-employees-selected', employees);
  await employees.getByRole('button', { name: 'Delete selected (2)' }).click();
  await expect(employees.getByText('Delete 2 employees?')).toBeVisible();
  await shot(page, '05-employees-delete-confirm', employees);
  await employees.getByRole('button', { name: 'Delete 2', exact: true }).click();
  await expect(employees.getByText('Deleted 2.')).toBeVisible();
  await expect(employees.getByRole('link', { name: 'Farah Aziz' })).toHaveCount(0);
  await employees.getByRole('button', { name: 'Delete Dana Ortiz' }).click();
  await employees.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(employees.getByRole('link', { name: 'Dana Ortiz' })).toHaveCount(0);
  await expect(employees.getByRole('link', { name: 'Asha Rao' })).toBeVisible();
  await shot(page, '06-employees-after-delete', employees);

  // Contact: remove the designation, one email, the location and the remark.
  await page.goto(`/app/contacts/${ashaId}`);
  const main = page.getByRole('main');
  const details = main.locator('dl').filter({ hasText: 'Employee remarks' }).first();
  await expect(details.getByText('Old designation', { exact: true })).toBeVisible();
  await shot(page, '07-contact-values-removable', details);
  for (const name of ['Remove Designation', 'Remove asha.old@northwind.example', 'Remove Location', 'Remove Employee remarks']) {
    await details.getByRole('button', { name, exact: true }).click();
    await details.getByRole('button', { name: 'Remove', exact: true }).click();
    // Saved: the confirm goes, and the value with its × goes too.
    await expect(details.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    await expect(details.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(main.getByText(/Old designation/)).toHaveCount(0);
  await expect(details.getByText('Unwanted remark')).toHaveCount(0);
  await shot(page, '08-contact-after-removing', details);
  const contact = await (await page.request.get(`/api/v1/contacts/${ashaId}`)).json();
  expect(contact.jobTitle).toBeNull();
  expect(contact.country).toBeNull();
  expect(contact.remarks).toBeNull();
  expect(contact.emails.map((e: { value: string }) => e.value)).toEqual(['asha@northwind.example']);

  // Delete all employees: every one left goes at once.
  await page.goto(`/app/companies/${companyId}`);
  await employees.getByRole('button', { name: 'Delete all employees' }).click();
  await expect(employees.getByText('Delete 3 employees?')).toBeVisible();
  await employees.getByRole('button', { name: 'Delete 3', exact: true }).click();
  await expect(employees.getByText('No employees at this company yet.')).toBeVisible();
  await shot(page, '09-employees-all-deleted', employees);
});
