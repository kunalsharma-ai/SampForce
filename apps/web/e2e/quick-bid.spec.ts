import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce' });

async function apiCall(page: Page, method: 'post' | 'put' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function addItem(page: Page, name: string) {
  const select = page.getByLabel('Add an item');
  await select.selectOption((await select.locator('option', { hasText: name }).getAttribute('value'))!);
}

async function seedCatalogue(page: Page) {
  const currency = (await apiCall(page, 'get', '/tenants/current')).defaultCurrency as string;
  const fieldwork = await apiCall(page, 'post', '/catalog/products', { name: 'Online fieldwork' });
  const analysis = await apiCall(page, 'post', '/catalog/products', { name: 'Analysis and report' });
  const book = await apiCall(page, 'post', '/catalog/price-books', { name: 'List', currency, isDefault: true });
  await apiCall(page, 'put', `/catalog/price-books/${book.id}/prices/${fieldwork.id}`, { unitPrice: 8 });
  await apiCall(page, 'put', `/catalog/price-books/${book.id}/prices/${analysis.id}`, { unitPrice: 3000 });
  const company = await apiCall(page, 'post', '/companies', { name: 'Northwind' });
  await apiCall(page, 'post', '/deals', { name: 'Northwind usage study', amount: 10_000, companyId: company.id });
}

test('picks a template in the gallery and builds, saves and finalises a bid in the studio', async ({ page }) => {
  await signUp(page, 'Studio Co');
  await seedCatalogue(page);

  await page.goto('/app/quotes');
  await page.getByRole('link', { name: 'Bid templates' }).click();
  await expect(page.getByRole('heading', { name: 'Bid templates' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Bid templates' }).getByRole('listitem')).toHaveCount(10);
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Research' }).click();
  await expect(page.getByRole('list', { name: 'Bid templates' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: /Market Research Bid/ }).click();
  const example = page.getByRole('region', { name: 'Market Research Bid example preview' });
  await expect(example.getByRole('heading', { name: 'Sample design' })).toBeVisible();
  await page.getByLabel('Accent colour', { exact: true }).fill('#zz');
  await expect(page.getByText('Use a hex colour such as #2563eb.')).toBeVisible();
  await page.getByLabel('Accent colour', { exact: true }).fill('#0f766e');
  await axe(page);
  await page.getByRole('link', { name: 'Use template' }).click();

  // Step 1: inline validation, then the deal and its price book.
  await expect(page).toHaveURL(/\/app\/quotes\/quick\?template=market-research-bid&accent=%230f766e/);
  await expect(page.getByRole('button', { name: /Step 1 of 4: Client/ })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Create draft and continue' }).click();
  await expect(page.getByText('Choose the deal this bid is for.')).toBeVisible();
  await expect(page.getByLabel('Deal', { exact: true })).toBeFocused();
  await page.getByLabel('Deal', { exact: true }).fill('Northwind');
  await page.getByRole('option', { name: /Northwind usage study/ }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Proposal for Northwind usage study');
  await expect(page.getByLabel('Price book')).not.toHaveValue('');
  await axe(page);
  await page.getByRole('button', { name: 'Create draft and continue' }).click();

  // Step 2: the template's sections are editable and the preview follows along.
  await expect(page).toHaveURL(/quote=[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: 'Template', exact: true })).toBeFocused();
  const preview = page.getByRole('region', { name: "Live preview of the customer's proposal" });
  await expect(page.getByLabel('Section 1 heading')).toHaveValue('Research objectives');
  await page.getByLabel('Section 1 text').fill('Northwind wants to understand weekly product usage across five markets.');
  await expect(preview).toContainText('Northwind wants to understand weekly product usage');
  await expect(preview.locator('article')).toHaveAttribute('data-template', 'market-research-bid');
  await page.getByLabel('Section 2 heading').fill('');
  await expect(page.getByText('Not saved: fix the highlighted fields.')).toBeVisible();
  await expect(page.getByText('Give the section a heading.')).toBeVisible();
  await page.getByLabel('Section 2 heading').fill('Approach');
  await expect(page.getByText(/Saved at/)).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: items, pricing and validation.
  await expect(page.getByRole('heading', { name: 'Items and pricing' })).toBeFocused();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Add at least one item.')).toBeVisible();
  await addItem(page, 'Online fieldwork');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await addItem(page, 'Analysis and report');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const items = page.getByRole('list', { name: 'Items' });
  await items.getByLabel('Quantity').first().fill('0');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter a quantity above 0.')).toBeVisible();
  await items.getByLabel('Quantity').first().fill('1000');
  await items.getByLabel('Discount %').nth(1).fill('10');
  // 1000 × 8 + 3000 − 10% of 3000 = 10,700.
  await expect(preview).toContainText('10,700.00');
  await expect(page.getByText(/Saved at/)).toBeVisible();
  await axe(page);

  // The work is on the server: a reload brings it back.
  await page.reload();
  await page.getByRole('button', { name: /Step 3 of 4/ }).click();
  await expect(page.getByRole('list', { name: 'Items' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('region', { name: "Live preview of the customer's proposal" })).toContainText('10,700.00');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 4: finalise and share.
  await expect(page.getByRole('heading', { name: 'Review and send' })).toBeFocused();
  await page.getByRole('button', { name: 'Finalise bid' }).click();
  await expect(page.getByText('The bid is ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Turn link on' }).click();
  await expect(page.getByText('Link is live')).toBeVisible();
  await axe(page);
  const url = await page.getByLabel('Proposal link').inputValue();

  // The customer sees the same look.
  await page.goto(`${new URL(url).pathname}?preview=1`);
  const doc = page.locator('article[data-template="market-research-bid"]');
  await expect(doc).toBeVisible();
  await expect(doc).toHaveAttribute('data-cover', 'band');
  await expect(doc.getByRole('heading', { name: 'Approach' })).toBeVisible();
  await expect(doc).toContainText('Northwind wants to understand weekly product usage');
});

test('keeps an unstarted bid on this device and can start over', async ({ page }) => {
  await signUp(page, 'Draft Keeper');
  await seedCatalogue(page);
  await page.goto('/app/quotes/quick');
  await page.getByLabel('Deal', { exact: true }).fill('Northwind');
  await page.getByRole('option', { name: /Northwind usage study/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Usage study bid');
  await expect(page.getByText('Draft kept on this device until you continue.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Restored the bid you started earlier on this device.')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Usage study bid');
  await expect(page.getByLabel('Deal', { exact: true })).toHaveValue('Northwind usage study');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByText('Restored the bid')).toHaveCount(0);
});
