import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Deleting unwanted company and employee details from the Edit windows, and deleting employees (ADR 0097). Set PREVIEW_DIR for screenshots. */
const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, target?: ReturnType<Page['locator']>) {
  if (!PREVIEW_DIR) return;
  if (target) await target.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  else await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('deletes unwanted details only from Edit, and deletes employees', async ({ page }) => {
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

  // Company: nothing can be deleted from the page itself; Edit opens the window where details are deleted.
  await page.goto(`/app/companies/${companyId}`);
  const info = page.locator('#business-information');
  await expect(info.getByText('Old service we dropped')).toBeVisible();
  await expect(info.getByRole('button', { name: /^(Remove|Delete) / })).toHaveCount(0);
  await shot(page, '01-company-page-no-delete-buttons', info);
  await info.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit business information' });
  await edit.getByRole('button', { name: 'Delete Legal name' }).click();
  await expect(edit.getByRole('textbox', { name: 'Legal name' })).toHaveValue('');
  await edit.getByRole('textbox', { name: 'Services' }).fill('Online panels');
  await edit.getByRole('textbox', { name: 'Emails' }).fill('hello@northwind.example');
  await edit.getByRole('button', { name: 'Delete Remarks' }).click();
  await shot(page, '02-company-edit-delete', edit.locator('fieldset').first());
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(info.getByText('Old service we dropped')).toHaveCount(0);
  await expect(info.getByText('old-inbox@northwind.example')).toHaveCount(0);
  await expect(info.getByText('Northwind Panels Ltd')).toHaveCount(0);
  await expect(info.getByText('hello@northwind.example')).toBeVisible();
  await shot(page, '03-company-after-deleting', info);
  const saved = await (await page.request.get(`/api/v1/companies/${companyId}`)).json();
  expect(saved.services).toEqual(['Online panels']);
  expect(saved.legalName).toBeNull();
  expect(saved.notes).toBeNull();
  expect(saved.emails.map((e: { value: string }) => e.value)).toEqual(['hello@northwind.example']);

  // Employees: tick some and delete them together. A row has no delete button of its own.
  const employees = page.locator('#company-employees');
  await expect(employees.getByRole('link', { name: 'Farah Aziz' })).toBeVisible();
  await expect(employees.getByRole('button', { name: 'Delete Dana Ortiz' })).toHaveCount(0);
  await employees.getByRole('checkbox', { name: 'Select Eli Novak' }).check();
  await employees.getByRole('checkbox', { name: 'Select Farah Aziz' }).check();
  await employees.getByRole('button', { name: 'Delete selected (2)' }).click();
  await expect(employees.getByText('Delete 2 employees?')).toBeVisible();
  await employees.scrollIntoViewIfNeeded();
  await shot(page, '04-employees-delete-selected', employees);
  await employees.getByRole('button', { name: 'Delete 2', exact: true }).click();
  await expect(employees.getByText('Deleted 2.')).toBeVisible();
  await expect(employees.getByRole('link', { name: 'Farah Aziz' })).toHaveCount(0);

  // One employee: deleted from its Edit window.
  await employees.getByRole('button', { name: 'Edit Dana Ortiz' }).click();
  let person = page.getByRole('dialog', { name: 'Edit employee / POC' });
  await person.getByRole('button', { name: 'Delete employee' }).click();
  await shot(page, '05-employee-edit-delete', person.getByRole('alert'));
  await person.getByRole('button', { name: 'Delete employee' }).click();
  await expect(person).toBeHidden();
  await expect(employees.getByRole('link', { name: 'Dana Ortiz' })).toHaveCount(0);

  // An employee's details: designation, one email and the remark deleted in the same Edit window.
  await employees.getByRole('button', { name: 'Edit Asha Rao' }).click();
  person = page.getByRole('dialog', { name: 'Edit employee / POC' });
  await expect(person.getByRole('textbox', { name: 'Designation' })).toHaveValue('Old designation');
  await person.getByRole('textbox', { name: 'Designation' }).fill('');
  await person.getByRole('button', { name: 'Remove asha.old@northwind.example' }).click();
  await person.getByRole('textbox', { name: 'Employee remarks' }).fill('');
  await shot(page, '06-employee-edit-details', person.getByRole('group', { name: 'Email IDs' }).or(person.locator('fieldset').filter({ hasText: 'Email IDs' })).first());
  await person.getByRole('button', { name: 'Save changes' }).click();
  await expect(person).toBeHidden();
  const contact = await (await page.request.get(`/api/v1/contacts/${ashaId}`)).json();
  expect(contact.jobTitle).toBeNull();
  expect(contact.remarks).toBeNull();
  expect(contact.emails.map((e: { value: string }) => e.value)).toEqual(['asha@northwind.example']);

  // Delete all employees: every one left goes at once.
  await employees.getByRole('button', { name: 'Delete all employees' }).click();
  await expect(employees.getByText('Delete 3 employees?')).toBeVisible();
  await employees.getByRole('button', { name: 'Delete 3', exact: true }).click();
  await expect(employees.getByText('No employees at this company yet.')).toBeVisible();
  await shot(page, '07-employees-all-deleted', employees);
});
