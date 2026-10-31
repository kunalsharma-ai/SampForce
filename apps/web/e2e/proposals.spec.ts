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

test('builds a branded proposal from a template, shares the online link and sees it opened', async ({ page, browser }) => {
  await signUp(page, 'Proposal Flow');
  const currency = (await apiCall(page, 'get', '/tenants/current')).defaultCurrency as string;
  const product = await apiCall(page, 'post', '/catalog/products', { name: 'Panel survey' });
  const book = await apiCall(page, 'post', '/catalog/price-books', { name: 'List', currency, isDefault: true });
  await apiCall(page, 'put', `/catalog/price-books/${book.id}/prices/${product.id}`, { unitPrice: 2500 });
  const stage = (await apiCall(page, 'get', '/pipelines'))[0].stages[0];
  const deal = await apiCall(page, 'post', '/deals', { name: 'Brand tracker', amount: 100, stageId: stage.id });

  // Branding lives with the quote rules.
  await page.goto('/app/quotes');
  await page.getByRole('tab', { name: 'Catalogue & pricing' }).click();
  await page.getByLabel('Header line').fill('Sampledge Research · London');
  await page.getByLabel('Footer', { exact: true }).fill('Registered in England');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByRole('button', { name: 'Save branding' })).toBeDisabled();

  await page.goto(`/app/deals/${deal.id}`);
  await page.getByRole('button', { name: 'New quote' }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByLabel('Start from a template').selectOption({ label: 'Professional services' });
  await page.getByRole('button', { name: 'Use template' }).click();
  await expect(page.getByLabel('Section 2 heading')).toHaveValue('Scope of work');
  await page.getByLabel('Section 1 text').fill('A quarterly brand tracker across three markets.');
  await page.getByRole('button', { name: 'Remove section 5' }).click();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await page.getByRole('button', { name: 'Submit for sending' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  // Sharing is off until someone turns it on or emails the proposal.
  await expect(page.getByText('Link is off')).toBeVisible();
  await page.getByRole('button', { name: 'Email proposal' }).click();
  await expect(page.getByRole('dialog', { name: 'Email proposal' })).toContainText('A link to the online proposal is added');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Turn link on' }).click();
  await expect(page.getByText('Link is live')).toBeVisible();
  const url = await page.getByLabel('Proposal link').inputValue();
  expect(url).toMatch(/\/p\/[^/]+$/);
  await expect(page.getByText('Not opened yet.')).toBeVisible();

  // The customer opens it without signing in.
  const customer = await browser.newContext();
  const view = await customer.newPage();
  await view.goto(new URL(url).pathname);
  await expect(view.getByRole('heading', { level: 1, name: 'Quote for Brand tracker' })).toBeVisible();
  await expect(view.getByText('Sampledge Research · London')).toBeVisible();
  await expect(view.getByRole('heading', { name: 'Scope of work' })).toBeVisible();
  await expect(view.getByText('A quarterly brand tracker across three markets.')).toBeVisible();
  await expect(view.getByRole('heading', { name: 'Assumptions' })).toHaveCount(0);
  await expect(view.getByText('Panel survey')).toBeVisible();
  await expect(view.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  await expectNoA11yViolations(view);
  await customer.close();

  await page.reload();
  await expect(page.getByText(/Opened 1 time/)).toBeVisible();
  await expect(page.getByText('Opens are estimates')).toBeVisible();

  // Turning the link off stops it working.
  await page.getByRole('button', { name: 'Turn link off' }).click();
  await expect(page.getByText('Link is off')).toBeVisible();
  const gone = await page.request.get(`/api/v1/proposals/view/${new URL(url).pathname.split('/').pop()}?preview=1`);
  expect(gone.status()).toBe(404);
});
