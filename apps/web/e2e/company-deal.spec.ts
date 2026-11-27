import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/* Company to Deal (redesign R4, ADR 0084) in the browser: "Mark as won" makes the won deal from the company's RFQs. */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function call(page: Page, method: 'post' | 'patch', path: string, data: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test('marking a company as won makes its deal from the won RFQ, and the company then opens that deal', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Won Deals Fieldwork');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  const lead = await call(page, 'post', '/company-leads', {
    company: { name: 'Northwind Panels Ltd', country: 'GB', city: 'London' },
    employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', emails: [{ value: 'priya@northwind.example' }] }],
  });
  const companyId = lead.company.id as string;
  const rfq = await call(page, 'post', '/rfqs', { companyId, contactId: lead.employeeIds[0], projectName: 'UK drivers survey', sampleSize: 400, cpi: 12.5, currency: 'GBP' });
  await call(page, 'patch', `/rfqs/${rfq.id}`, { status: 'WON', actualRevenue: 5400 });

  await page.goto(`/app/companies/${companyId}`);
  await page.getByRole('button', { name: 'Mark as won' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Mark Northwind Panels Ltd as won?');
  await axe(page);
  await dialog.getByRole('button', { name: 'Mark as won' }).click();
  await expect(dialog.getByRole('status')).toContainText(/Deal DEAL-\d+ was made and marked won\./);
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/01-mark-company-won.png` });

  await dialog.getByRole('link', { name: 'Open the deal' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Northwind Panels Ltd: UK drivers survey');
  await expect(page.locator('main')).toContainText('Won');
  await expect(page.locator('main')).toContainText('5,400');
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/02-won-deal.png` });

  // Back on the company: it is a client now and the button opens its deal.
  await page.goto(`/app/companies/${companyId}`);
  await expect(page.getByRole('link', { name: 'Won deal' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Existing Client');
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/03-company-won.png` });
});
