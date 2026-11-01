import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
// The Stripe stand-in (test/fixtures/card-payments-fixture.ts) answers on this port; see playwright.config.
const FIXTURE = 'http://127.0.0.1:4900';
const KEY = 'sk_test_goodBrowserFlow1';
const WHSEC = 'whsec_browserFlowSecret01';

async function apiCall(page: Page, method: 'post' | 'put' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('sets up card payments, and a customer pays an accepted proposal on the Stripe page (stand-in)', async ({ page, browser }) => {
  await signUp(page, 'Card Pay Flow');
  const currency = (await apiCall(page, 'get', '/tenants/current')).defaultCurrency as string;
  const product = await apiCall(page, 'post', '/catalog/products', { name: 'Brand tracker wave' });
  const book = await apiCall(page, 'post', '/catalog/price-books', { name: 'List', currency, isDefault: true });
  await apiCall(page, 'put', `/catalog/price-books/${book.id}/prices/${product.id}`, { unitPrice: 1200 });
  const stage = (await apiCall(page, 'get', '/pipelines'))[0].stages[0];
  const deal = await apiCall(page, 'post', '/deals', { name: 'Tracker 2027', amount: 1200, stageId: stage.id });
  const quote = await apiCall(page, 'post', '/quotes', { opportunityId: deal.id, title: 'Brand tracker 2027', lines: [{ productId: product.id, quantity: 1 }] });
  await apiCall(page, 'post', `/quotes/${quote.id}/transition`, { action: 'submit' });
  const { url } = await apiCall(page, 'post', `/quotes/${quote.id}/share`, { enabled: true });
  const proposalPath = new URL(url).pathname;

  // The admin saves Stripe keys; they are checked before saving and never shown again.
  await page.goto('/app/integrations');
  const card = page.getByRole('region', { name: /^Card payments/ });
  await expect(card.getByText('Not connected')).toBeVisible();
  await card.getByLabel('Restricted or secret key').fill('sk_test_wrongKeyForTest1');
  await card.getByLabel('Webhook secret').fill(WHSEC);
  await card.getByRole('button', { name: 'Check and save' }).click();
  await expect(card.getByRole('alert')).toContainText('Stripe refused the keys');
  await card.getByLabel('Restricted or secret key').fill(KEY);
  await card.getByRole('button', { name: 'Check and save' }).click();
  await expect(card.getByText('Globex Payments (test mode)')).toBeVisible();
  await expect(card.getByText('No payment confirmation has arrived yet', { exact: false })).toBeVisible();
  const webhookUrl = await card.getByLabel('Webhook URL').inputValue();
  expect(webhookUrl).toMatch(/\/api\/v1\/apps\/payments\/webhooks\/[a-f0-9]{24}$/);
  const results = await new AxeBuilder({ page }).include('#apps-heading').include('[aria-labelledby="app-payments"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  // As the admin would in the Stripe dashboard: point the account's webhook at that URL.
  expect((await page.request.post(`${FIXTURE}/_fixture/endpoints`, { data: { key: KEY, url: webhookUrl, secret: WHSEC } })).ok()).toBe(true);

  // Before acceptance the customer sees why they cannot pay yet.
  const customer = await browser.newContext();
  const buyer = await customer.newPage();
  await buyer.goto(proposalPath);
  await expect(buyer.getByText('Card payment opens once the proposal is accepted.')).toBeVisible();

  await apiCall(page, 'post', `/quotes/${quote.id}/transition`, { action: 'accept' });
  await buyer.reload();
  const payButton = buyer.getByRole('button', { name: /^Pay .* by card$/ });
  await expect(payButton).toBeVisible();
  await expect(buyer.getByText(/never sees your card details/)).toBeVisible();
  await payButton.click();
  await expect(buyer).toHaveURL(/127\.0\.0\.1:4900\/checkout\/cs_test_/);
  await buyer.getByRole('button', { name: 'Pay with test card' }).click();
  await expect(buyer).toHaveURL(new RegExp(`${proposalPath}\\?payment=done$`));
  await expect(buyer.getByText(/Payment confirmed by Stripe on/)).toBeVisible();
  await expect(buyer.getByRole('button', { name: /by card$/ })).toHaveCount(0);
  await customer.close();

  // The rep sees the confirmed payment on the quote, and the warning on Integrations is gone.
  await page.goto(`/app/quotes/${quote.id}`);
  const payments = page.getByLabel('Card payments');
  await expect(payments.getByText('Paid', { exact: true })).toBeVisible();
  await expect(payments).toContainText('Stripe');
  await page.goto('/app/integrations');
  await expect(page.getByRole('region', { name: /^Card payments/ }).getByText(/Last confirmation received/)).toBeVisible();
});
