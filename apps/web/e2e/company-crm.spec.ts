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

/** The whole page, by growing the window to fit it (a full-page capture would scroll the fixed sidebar away). */
async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector('main')?.scrollHeight ?? 0));
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 2600) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('company leads get numbers and coloured statuses, configured in CRM configuration', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const acme = await post(page, '/companies', { name: 'Acme Panels', country: 'IN', city: 'Pune', state: 'MH', industry: 'Market research', website: 'acmepanels.example' });
  await post(page, '/companies', { name: 'Nordlicht Research GmbH', country: 'DE', city: 'Munich', industry: 'Market research' });
  await post(page, '/companies', { name: 'Maple Insights', country: 'CA', city: 'Toronto', industry: 'Consulting' });
  expect(acme.leadNumber).toBe('FRFS01');
  await post(page, '/contacts', { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead', companyId: acme.id, email: 'priya@acmepanels.example' });

  // Settings links to the CRM configuration, which opens on lead numbers.
  await page.goto('/app/settings');
  const main = page.getByRole('main');
  await shot(page, '00-settings-crm-link');
  await main.getByRole('link', { name: /CRM configuration/ }).click();
  await expect(page).toHaveURL(/\/app\/settings\/crm$/);
  await expect(main.getByRole('heading', { name: 'CRM configuration', level: 1 })).toBeVisible();
  await expect(main.getByText('FRFS04')).toBeVisible();
  await expect(main.getByText('From your workspace initials')).toBeVisible();
  await axe(page);
  await shot(page, '01-crm-configuration-lead-numbers');

  // The starter company statuses, in order, with an added one.
  await main.getByText('Company statuses', { exact: true }).click();
  const companyStatuses = main.getByRole('list', { name: 'Company statuses' });
  await expect(companyStatuses.getByRole('listitem')).toHaveCount(15);
  await expect(companyStatuses.getByRole('listitem').first()).toContainText('New Lead');
  await main.getByLabel('Name').fill('Proposal Sent');
  await main.locator('#status-color').fill('#0f766e');
  await main.getByRole('button', { name: 'Add status' }).click();
  await expect(main.getByRole('status')).toHaveText('Added Proposal Sent.');
  await expect(companyStatuses.getByRole('listitem')).toHaveCount(16);
  await companyStatuses.getByRole('button', { name: 'Move Proposal Sent up' }).click();
  await expect(companyStatuses.getByRole('listitem').nth(14)).toContainText('Proposal Sent');
  await axe(page);
  await shot(page, '02-company-statuses');

  await main.getByText('Employee statuses', { exact: true }).click();
  await expect(main.getByRole('list', { name: 'Employee statuses' }).getByRole('listitem')).toHaveCount(16);
  await shot(page, '02b-employee-statuses');
  await main.getByText('Departments', { exact: true }).click();
  await expect(main.getByRole('list', { name: 'Departments' })).toContainText('Business Development');
  await shot(page, '02c-departments');
  await main.getByText('Designations', { exact: true }).click();
  await expect(main.getByRole('list', { name: 'Designations' })).toContainText('Business Development Manager');
  await shot(page, '03-designations');

  // The companies list shows the lead number, status chip and location with a flag.
  await page.goto('/app/companies');
  const row = main.getByRole('row').filter({ hasText: 'Acme Panels' });
  await expect(row).toContainText('FRFS01');
  await expect(row).toContainText('New Lead');
  await expect(row.getByRole('img', { name: 'India' })).toBeVisible();
  await shot(page, '04-companies-list');
  await page.goto('/app/contacts');
  await expect(main.getByRole('row').filter({ hasText: 'Priya Nair' })).toContainText('New Contact');
  await shot(page, '04b-employees-list');

  // The company page shows the lead card; the status changes there and is recorded.
  await page.goto(`/app/companies/${acme.id}`);
  await expect(main.getByLabel('Lead number')).toHaveText('FRFS01');
  await main.getByLabel('Change status').selectOption({ label: 'Discussion Phase' });
  await expect(main.getByText(/^Since /)).toBeVisible();
  await expect(main.getByLabel('Change status')).toHaveValue(/.+/);
  await expect.poll(async () => (await (await page.request.get(`/api/v1/companies/${acme.id}`)).json()).status.name).toBe('Discussion Phase');
  await shot(page, '05-company-lead-card');

  // Team: position and record visibility per role.
  await page.goto('/app/team');
  await main.getByLabel('Designation for Test Person').selectOption({ label: 'Senior Management' });
  await expect.poll(async () => (await (await page.request.get('/api/v1/tenants/current/members')).json())[0].designation?.name).toBe('Senior Management');
  await expect(main.getByLabel('Records Sales Representative sees')).toHaveValue('OWN');
  await expect(main.getByLabel('Records Sales Manager sees')).toHaveValue('TEAM');
  await expect(main.getByLabel('Records Owner sees')).toBeDisabled();
  await main.getByLabel('Records Viewer sees').selectOption('TEAM');
  await expect.poll(async () => ((await (await page.request.get('/api/v1/tenants/current/roles')).json()) as Array<{ key: string; recordScope: string }>).find((r) => r.key === 'viewer')?.recordScope).toBe('TEAM');
  await shot(page, '06-team-position-and-visibility');

  // Changing the prefix for every lead re-letters the existing numbers, keeping their order.
  await page.goto('/app/settings/crm');
  await main.getByLabel('Prefix').fill('SAMP');
  await main.getByText('New and existing leads').click();
  await main.getByRole('button', { name: 'Save lead numbers' }).click();
  await expect(main.getByRole('status')).toHaveText('Saved. The next lead will be SAMP04.');
  await shot(page, '07-lead-prefix-changed');
  await page.goto('/app/companies');
  await expect(main.getByRole('row').filter({ hasText: 'Acme Panels' })).toContainText('SAMP01');
  await shot(page, '08-companies-renumbered');
});
