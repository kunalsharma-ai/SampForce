import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

async function apiCall(page: Page, method: 'post' | 'put' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('quotes a deal from the price book, accepts it and records the signed contract', async ({ page }) => {
  await signUp(page, 'Quote Flow');
  const currency = (await apiCall(page, 'get', '/tenants/current')).defaultCurrency as string;
  const product = await apiCall(page, 'post', '/catalog/products', { name: 'Research seat' });
  const book = await apiCall(page, 'post', '/catalog/price-books', { name: 'List', currency, isDefault: true });
  await apiCall(page, 'put', `/catalog/price-books/${book.id}/prices/${product.id}`, { unitPrice: 400 });
  const stage = (await apiCall(page, 'get', '/pipelines'))[0].stages[0];
  const deal = await apiCall(page, 'post', '/deals', { name: 'Seat expansion', amount: 100, stageId: stage.id });

  await page.goto('/app/quotes');
  await expect(page.getByRole('heading', { level: 1, name: 'Quotes & Proposals' })).toBeVisible();
  await page.getByRole('tab', { name: 'Catalogue & pricing' }).click();
  await expect(page.getByLabel('Research seat price in List')).toHaveValue('400');
  await expectNoA11yViolations(page);

  await page.goto(`/app/deals/${deal.id}`);
  await page.getByRole('button', { name: 'New quote' }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByLabel('Line 1 quantity').fill('3');
  await page.getByLabel('Line 1 discount percent').fill('5');
  await expect(page.getByText('1,140.00').first()).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await page.getByRole('button', { name: 'Submit for sending' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as sent' }).click();
  await page.getByRole('button', { name: 'Customer accepted' }).click();
  await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
  expect((await apiCall(page, 'get', `/deals/${deal.id}`)).amount).toBe(1140);

  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page).toHaveURL(/\/app\/contracts\/[0-9a-f-]{36}$/);
  await expect(page.getByText('1,140.00')).toBeVisible();
  await page.getByLabel('Signed by').fill('Ada Customer');
  await page.getByRole('button', { name: 'Mark as signed' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText(/Ada Customer on/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test('captures a lead through a hosted form with consent and finds it in a segment', async ({ page, browser }) => {
  await signUp(page, 'Form Flow');
  await page.goto('/app/marketing');
  await page.getByRole('tab', { name: 'Lead forms' }).click();
  await page.getByRole('button', { name: 'New lead form' }).click();
  await page.getByLabel('Internal name').fill('Demo request');
  await page.getByLabel('Heading visitors see').fill('Book a demo');
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Create form' }).click();
  const open = page.getByRole('link', { name: 'Open form' });
  await expect(open).toBeVisible();
  const href = (await open.getAttribute('href'))!;

  // A visitor with no session fills it in.
  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  const res = await visitor.goto(href);
  expect(res!.headers()['content-security-policy']).toMatch(/frame-ancestors \*(;|$)/);
  expect(res!.headers()['x-frame-options']).toBeUndefined();
  await expect(visitor.getByRole('heading', { name: 'Book a demo' })).toBeVisible();
  await expectNoA11yViolations(visitor);
  await visitor.getByLabel(/Full name/).fill('Vera Visitor');
  await visitor.getByLabel(/Work email/).fill('vera@visitor.test');
  await visitor.getByLabel(/product news/).check();
  await visitor.getByRole('button', { name: 'Submit' }).click();
  await expect(visitor.getByRole('status')).toContainText('Thank you');
  await ctx.close();

  await page.getByRole('tab', { name: 'Segments' }).click();
  await page.getByRole('button', { name: 'New segment' }).click();
  await page.getByLabel('Name').fill('Opted-in leads');
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule 1 field').selectOption('marketingConsent');
  await page.getByLabel('Rule 1 value').selectOption('OPTED_IN');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('Vera Visitor')).toBeVisible();
  await expect(page.getByText(/1 match · 1 opted in/)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Save segment' }).click();
  await expect(page.getByRole('button', { name: /Opted-in leads/ })).toBeVisible();

  // Every other page refuses framing.
  const appRes = await page.request.get('/app/marketing');
  expect(appRes.headers()['x-frame-options']).toBe('DENY');
});

test('shows revenue analytics and customer health from real records', async ({ page }) => {
  await signUp(page, 'Revenue Flow');
  const stages = (await apiCall(page, 'get', '/pipelines'))[0].stages as { id: string; category: string }[];
  const won = await apiCall(page, 'post', '/deals', { name: 'Closed one', amount: 5000, stageId: stages[0]!.id });
  await apiCall(page, 'post', `/deals/${won.id}/move`, { stageId: stages.find((s) => s.category === 'WON')!.id });
  const company = await apiCall(page, 'post', '/companies', { name: 'Healthy Co' });
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  const contract = await apiCall(page, 'post', '/contracts', { name: 'Support plan', companyId: company.id, value: 2000, startDate: today, endDate: end });
  await apiCall(page, 'post', `/contracts/${contract.id}/sign`, { signedBy: 'X', signedAt: today, method: 'wet_ink' });

  await page.goto('/app/revenue');
  await expect(page.getByRole('heading', { level: 1, name: 'Revenue Intelligence' })).toBeVisible();
  await expect(page.getByText('1 deal closed won')).toBeVisible();
  await page.getByLabel('Amount').fill('20000');
  await page.getByRole('button', { name: 'Set target' }).click();
  await expect(page.getByText('25%', { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/app/customer-success');
  await expect(page.getByRole('link', { name: 'Healthy Co' })).toBeVisible();
  await expect(page.getByText(/Watch · 45\/100/)).toBeVisible();
  await expect(page.getByText('Renewal within 30 days:')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('tab', { name: 'Escalations' }).click();
  await expect(page.getByText('No escalations.')).toBeVisible();
  await expectNoA11yViolations(page);
});
