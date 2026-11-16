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

test('a company lead is created step by step with branches, employees and ownership, and managed on its page', async ({ page, playwright }) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => void d.accept());
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const main = page.getByRole('main');

  // A teammate who reports to the signed-in manager.
  const inv = await post(page, '/tenants/current/invitations', { email: `rahul-${Date.now()}@example.com`, roleKey: 'member' });
  const other = await playwright.request.newContext({ baseURL: 'http://localhost:3000', extraHTTPHeaders: ORIGIN });
  await other.post('/api/v1/auth/invitations/accept', { data: { token: inv.inviteUrl.split('/invite/')[1], name: 'Rahul Verma', password: 'a-long-password-1' } });
  await other.dispose();
  const members = (await (await page.request.get('/api/v1/tenants/current/members')).json()) as Array<{ membershipId: string; userId: string; name: string }>;
  const designations = (await (await page.request.get('/api/v1/crm-config/designations')).json()) as Array<{ id: string; name: string }>;
  const d = (n: string) => designations.find((x) => x.name === n)!.id;
  const me = members.find((m) => m.name === 'Test Person')!;
  const rahul = members.find((m) => m.name === 'Rahul Verma')!;
  const patch = (m: { membershipId: string }, data: object) => page.request.patch(`/api/v1/tenants/current/members/${m.membershipId}/org`, { data, headers: ORIGIN });
  expect((await patch(me, { designationId: d('Business Development Manager') })).ok()).toBe(true);
  expect((await patch(rahul, { designationId: d('Business Development Executive'), reportingManagerId: me.userId })).ok()).toBe(true);

  // Companies lead with "Create new lead".
  await page.goto('/app/companies');
  await shot(page, '09-companies-create-new-lead');
  await main.getByRole('link', { name: 'Create new lead' }).click();
  await expect(page).toHaveURL(/\/app\/companies\/new$/);
  await expect(main.getByRole('heading', { name: 'Step 1 of 8: Company information' })).toBeVisible();

  // Step 1 refuses to move on without a name.
  await main.getByRole('button', { name: 'Next' }).click();
  await expect(main.getByText('Enter a company name')).toBeVisible();
  await main.getByLabel('Company name *').fill('Acme Panels Pvt Ltd');
  await main.getByLabel('Official website URL 1', { exact: true }).fill('acmepanels.example');
  await main.getByLabel('Company LinkedIn URL 1', { exact: true }).fill('linkedin.com/company/acme-panels');
  await main.getByLabel('Company email IDs 1', { exact: true }).fill('info@acmepanels.example');
  await main.getByRole('button', { name: 'Add email' }).click();
  await main.getByLabel('Company email IDs 2', { exact: true }).fill('sales@acmepanels.example');
  await main.getByLabel('Company phone numbers 1', { exact: true }).fill('+91 20 4567 8900');
  await main.getByLabel('Company overview').fill('Online panel and fieldwork company serving market research agencies in India.');
  await axe(page);
  await shot(page, '10-lead-step1-company');

  // A draft can be saved at any step.
  await main.getByRole('button', { name: 'Save draft' }).click();
  await expect(main.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
  await expect(page).toHaveURL(/draft=/);

  await main.getByRole('button', { name: 'Next' }).click();
  await expect(main.getByRole('heading', { name: 'Step 2 of 8: Company location' })).toBeVisible();
  await main.getByLabel('Country').fill('India');
  await main.getByLabel('Country').press('Enter');
  await expect(main.getByText('Dialling code +91')).toBeVisible();
  await expect(main.getByLabel('Time zone')).toHaveValue('Asia/Kolkata');
  await main.getByLabel('State / province').fill('Maharashtra');
  await main.getByLabel('City').fill('Pune');
  await main.getByLabel('Full address').fill('Office 402, Baner Road');
  await main.getByLabel('ZIP / postal code').fill('411045');
  await axe(page);
  await shot(page, '11-lead-step2-location');

  await main.getByRole('button', { name: 'Next' }).click();
  await main.getByLabel('Industry').fill('Market research');
  await main.getByLabel('Company size').selectOption('51-200');
  await main.getByLabel('Company type').selectOption('Private company');
  await main.getByLabel('Founded year').fill('2009');
  await main.getByLabel('Company specialties').fill('B2B panels, CATI, healthcare fieldwork');
  await main.getByRole('button', { name: 'Add branch' }).click();
  await main.getByLabel('Branch name *').fill('Berlin office');
  await main.locator('#lead-branch-0-country').fill('Germany');
  await main.locator('#lead-branch-0-country').press('Enter');
  await main.locator('#lead-branch-0-city').fill('Berlin');
  await main.getByLabel('Branch email').fill('berlin@acmepanels.example');
  await axe(page);
  await shot(page, '12-lead-step3-business-branches');

  await main.getByRole('button', { name: 'Next' }).click();
  await main.getByRole('button', { name: 'Add employee / POC' }).click();
  await main.getByLabel('Employee name *').fill('Priya Nair');
  await main.getByLabel('Designation').fill('Procurement Lead');
  await main.getByLabel('Department').fill('Procurement');
  await main.getByLabel('Email IDs 1', { exact: true }).fill('priya@acmepanels.example');
  await main.getByLabel('Next follow-up date').fill('2030-01-15');
  await axe(page);
  await shot(page, '13-lead-step4-employees');

  await main.getByRole('button', { name: 'Next' }).click();
  await expect(main.getByText('Business Development Manager').first()).toBeVisible();
  await main.getByLabel('Lead owner', { exact: true }).fill('Rahul');
  await main.getByLabel('Lead owner', { exact: true }).press('Enter');
  await expect(main.getByText('Business Development Executive')).toBeVisible();
  await main.getByLabel('POC name').fill('Test');
  await main.getByLabel('POC name').press('Enter');
  await axe(page);
  await shot(page, '14-lead-step5-ownership');

  await main.getByRole('button', { name: 'Next' }).click();
  await main.getByLabel('Company status').selectOption({ label: 'Discussion Phase' });
  await shot(page, '15-lead-step6-status');

  await main.getByRole('button', { name: 'Next' }).click();
  await main.getByLabel('Remarks').fill('Met their procurement team at the Quirks event.');
  await main.locator('input[type=file]').setInputFiles({ name: 'acme-brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 Acme brief') });
  await expect(main.getByRole('list', { name: 'Attachments' })).toContainText('acme-brief.pdf');
  await shot(page, '16-lead-step7-remarks');

  await main.getByRole('button', { name: 'Next' }).click();
  await expect(main.getByRole('heading', { name: 'Step 8 of 8: Review & save' })).toBeVisible();
  await expect(main).toContainText('sales@acmepanels.example');
  await expect(main).toContainText('Rahul Verma – Business Development Executive');
  await axe(page);
  await shot(page, '17-lead-step8-review');
  await main.getByRole('button', { name: 'Save lead' }).click();

  // The company page: lead number, profile, employees, branches, ownership and files.
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]{36}$/);
  await expect(main.getByLabel('Lead number')).toHaveText('FRFS01');
  await expect(main.getByRole('list', { name: 'Employees / POCs' })).toContainText('Priya Nair');
  await expect(main.getByRole('list', { name: 'Branches' })).toContainText('Berlin office');
  await expect(main.getByRole('list', { name: 'Attachments' })).toContainText('acme-brief.pdf');
  await expect(main.getByRole('list', { name: 'Ownership history' })).toContainText('First assigned to Rahul Verma');
  await expect(main.getByText('Discussion Phase').first()).toBeVisible();
  await axe(page);
  await shot(page, '18-company-page-after-create');

  // Ownership moves with a reason; the creator stays.
  await main.getByRole('button', { name: 'Change owner' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New owner', { exact: true }).fill('Test');
  await dialog.getByLabel('New owner', { exact: true }).press('Enter');
  await dialog.getByLabel('Reason').selectOption('HIGH_VALUE');
  await dialog.getByLabel('Note for the new owner').fill('Large tracker study; I will lead the negotiation.');
  await shot(page, '19-change-owner-dialog');
  await dialog.getByRole('button', { name: 'Change owner' }).click();
  await expect(main.getByRole('list', { name: 'Ownership history' })).toContainText('Rahul Verma to Test Person');
  await expect(main.getByRole('list', { name: 'Ownership history' })).toContainText('High-value opportunity');

  // "+ Add employee / POC" on the company page.
  await main.getByRole('button', { name: 'Add employee / POC' }).click();
  await dialog.getByLabel('Employee name *').fill('Arjun Mehta');
  await dialog.getByLabel('Designation').fill('Head of Insights');
  await dialog.getByLabel('Email IDs 1', { exact: true }).fill('arjun@acmepanels.example');
  await axe(page);
  await shot(page, '20-add-employee-dialog');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(main.getByRole('list', { name: 'Employees / POCs' })).toContainText('Arjun Mehta');
  await shot(page, '21-company-page-after-changes');

  // The employee profile with relationship numbers.
  await main.getByRole('link', { name: 'Priya Nair' }).click();
  await expect(main.getByText('Emails sent')).toBeVisible();
  await expect(main.getByText('Procurement Lead').first()).toBeVisible();
  await axe(page);
  await shot(page, '22-employee-profile');

  // Drafts are listed to carry on with later.
  await page.goto('/app/companies/new');
  await main.getByLabel('Company name *').fill('Half Done Research');
  await main.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/draft=/);
  await page.goto('/app/companies');
  await expect(main.getByRole('link', { name: 'Drafts (1)' })).toBeVisible();
  await main.getByRole('link', { name: 'Drafts (1)' }).click();
  await expect(main.getByRole('list', { name: 'Your drafts' })).toContainText('Half Done Research');
  await shot(page, '23-lead-drafts');
});
