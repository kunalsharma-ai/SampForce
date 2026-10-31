import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const post = async (page: Page, path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN })).json();
const put = (page: Page, path: string, data: object) => page.request.put(`/api/v1${path}`, { data, headers: ORIGIN });

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('a customer signs in to the portal, approves a proposal and gets an answer to a request', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Portal Vendor');
  const product = await post(page, '/catalog/products', { name: 'Onboarding package', unit: 'package' });
  const currency = (await (await page.request.get('/api/v1/tenants/current')).json()).defaultCurrency ?? 'USD';
  const book = await post(page, '/catalog/price-books', { name: 'Standard', currency, isDefault: true });
  await put(page, `/catalog/price-books/${book.id}/prices/${product.id}`, { unitPrice: 4000 });
  const stage = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages[0];
  const company = await post(page, '/companies', { name: 'Harbor Freight Co' });
  await post(page, '/contacts', { firstName: 'Hana', lastName: 'Ito', email: 'hana@harbor.test', companyId: company.id });
  const deal = await post(page, '/deals', { name: 'Harbor onboarding', amount: 8000, stageId: stage.id, companyId: company.id });
  const quote = await post(page, '/quotes', { opportunityId: deal.id, title: 'Harbor onboarding proposal', lines: [{ productId: product.id, quantity: 2 }] });
  await post(page, `/quotes/${quote.id}/transition`, { action: 'submit' });
  await post(page, `/quotes/${quote.id}/transition`, { action: 'mark_sent' });
  await post(page, '/tasks', { title: 'Data migration workshop', opportunityId: deal.id });
  const slug = `harbor-${Math.random().toString(36).slice(2, 8)}`;

  // Set the portal up.
  await page.goto('/app/portal');
  await expect(page.getByText('Not set up')).toBeVisible();
  await page.getByRole('button', { name: 'Set up the portal' }).click();
  await page.getByLabel('Portal is on').check();
  await page.getByLabel('Portal address').fill(slug);
  await page.getByLabel('Portal name').fill('Harbor projects');
  await page.getByLabel('Let approvers approve or decline proposals').check();
  await page.getByRole('button', { name: 'Save portal settings' }).click();
  await expect(page.getByText('Portal settings saved.')).toBeVisible();
  await expect(page.getByText('Portal on')).toBeVisible();
  await expectNoA11yViolations(page);

  // Invite the contact as an approver, share a milestone and a document.
  await page.goto(`/app/companies/${company.id}`);
  await page.getByRole('button', { name: 'Invite to portal' }).click();
  await page.getByLabel('Contact', { exact: true }).selectOption({ label: 'Hana Ito (hana@harbor.test)' });
  await page.getByLabel('Access', { exact: true }).selectOption('approver');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const invite = await page.getByLabel('Invitation link').inputValue();
  expect(invite).toContain(`/portal/${slug}/accept?token=`);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('hana@harbor.test · never signed in')).toBeVisible();
  await page.getByRole('tab', { name: 'Milestones' }).click();
  await page.getByLabel('Show "Data migration workshop" in portal').click();
  await expect(page.getByLabel('Show "Data migration workshop" in portal')).toBeChecked();
  await page.getByRole('tab', { name: /^Documents/ }).click();
  await page.getByLabel('Share a document').setInputFiles({ name: 'migration-plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 migration plan') });
  await expect(page.getByRole('link', { name: 'migration-plan.pdf' })).toBeVisible();
  await expectNoA11yViolations(page);

  // The customer, in their own browser.
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const c = await ctx.newPage();
  await c.goto(invite);
  await c.getByLabel('Password', { exact: true }).fill('harbor-pass-123');
  await c.getByLabel('Confirm password').fill('harbor-pass-123');
  await c.getByRole('button', { name: 'Open portal' }).click();
  await expect(c.getByText('Harbor projects')).toBeVisible();
  await expect(c.getByRole('progressbar', { name: 'Harbor onboarding progress' })).toBeVisible();
  await expect(c.getByText('Data migration workshop')).toBeVisible();
  await expect(c.getByText('Invoices are not available in this portal yet.', { exact: false })).toBeVisible();
  await expectNoA11yViolations(c);

  await c.getByRole('tab', { name: 'Proposals' }).click();
  await expect(c.getByText('Waiting for your decision')).toBeVisible();
  await c.getByRole('button', { name: 'Open Harbor onboarding proposal' }).click();
  await c.getByRole('button', { name: 'Approve proposal' }).click();
  await c.getByLabel('Note for the account team (optional)').fill('Approved by finance.');
  await expect(c.getByRole('button', { name: 'Confirm approval' })).toBeDisabled();
  await c.getByLabel(/^I approve Q-\d{4}/).check();
  await c.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(c.getByText('Thank you. The proposal is approved')).toBeVisible();
  await expect(c.getByRole('button', { name: 'Approve proposal' })).toHaveCount(0);

  await c.getByRole('tab', { name: 'Documents' }).click();
  await expect(c.getByRole('link', { name: 'migration-plan.pdf' })).toBeVisible();

  await c.getByRole('tab', { name: 'Requests' }).click();
  await c.getByRole('button', { name: 'New request' }).click();
  await c.getByLabel('Subject').fill('Add two more users');
  await c.getByLabel('Type').selectOption('change_request');
  await c.getByLabel('Details').fill('We hired two people. Can they get access?');
  await c.getByRole('button', { name: 'Send request' }).click();
  await expect(c.getByText('We hired two people. Can they get access?')).toBeVisible();
  await expectNoA11yViolations(c);

  // The team answers from the inbox.
  await page.goto('/app/portal');
  await page.getByRole('button', { name: /Add two more users/ }).click();
  await page.getByLabel('Reply to the customer').fill('Done. They will get invitations today.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('in_progress');
  await expectNoA11yViolations(page);
  const audit = await (await page.request.get('/api/v1/audit-logs?limit=50')).json();
  expect(audit.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['portal.proposal_accepted', 'portal.request_created', 'portal.user_invited']));

  await c.reload();
  await c.getByRole('tab', { name: 'Requests' }).click();
  await c.getByRole('button', { name: /Add two more users/ }).click();
  await expect(c.getByText('Done. They will get invitations today.')).toBeVisible();
  await expect(c.getByText('In progress')).toBeVisible();

  // Signing out ends the portal session; the workspace app is not reachable with it.
  await c.getByRole('button', { name: 'Sign out' }).click();
  await expect(c.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await c.goto('/app');
  await expect(c).toHaveURL(/\/login/);
  await ctx.close();
});
