import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The company page's quick actions and Company performance cards each have their own colour, readable in light and
 * dark, and still name themselves in words.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include('#company-name').include('[aria-labelledby="company-kpis"]').include('[role="toolbar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

const setTheme = (page: Page, theme: 'light' | 'dark') =>
  page.evaluate((th) => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: th, motion: 'off' }, version: 0 })), theme);

test('every quick action and performance card has its own colour, in light and dark', async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, 'Colour Fieldwork');
  await setTheme(page, 'light');
  const lead = await post(page, '/company-leads', {
    company: { name: 'Northwind Panels Ltd', country: 'GB', city: 'London', primaryEmail: 'hello@northwind.example' },
    employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Research Director', emails: [{ value: 'priya@northwind.example' }] }],
  });
  await post(page, '/rfqs', { companyId: lead.company.id, contactId: lead.employeeIds[0], projectName: 'UK drivers survey', currency: 'GBP' });

  await page.goto(`/app/companies/${lead.company.id}`);
  const toolbar = page.getByRole('toolbar', { name: 'Quick actions' });
  await expect(toolbar.getByRole('button', { name: 'Edit company' })).toBeVisible();
  const kpis = page.locator('[aria-labelledby="company-kpis"]');
  await expect(kpis.getByRole('link', { name: 'RFQs received: 1' })).toBeVisible();

  // Each action and each card is drawn in a colour of its own.
  const tints = async (sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue('--st-dot').trim()));
  const actions = await tints('[data-quick-action]');
  expect(actions.length).toBeGreaterThanOrEqual(10);
  expect(new Set(actions).size).toBe(actions.length);
  const cards = await tints('[data-kpi]');
  expect(cards.length).toBe(12);
  expect(new Set(cards).size).toBe(cards.length);

  await axe(page);
  if (PREVIEW_DIR) await page.locator('#company-name').evaluate((h) => h.closest('section')!.scrollIntoView({ block: 'start' }));
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/01-company-colours-light.png`, fullPage: false });
  if (PREVIEW_DIR) await toolbar.evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110); document.querySelector('main')?.scrollBy(0, -110); });
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/02-actions-and-performance-light.png` });

  await setTheme(page, 'dark');
  await page.reload();
  await expect(kpis.getByRole('link', { name: 'RFQs received: 1' })).toBeVisible();
  await axe(page);
  if (PREVIEW_DIR) await toolbar.evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110); document.querySelector('main')?.scrollBy(0, -110); });
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/03-actions-and-performance-dark.png` });

  // Phone width: the actions wrap and the cards sit two to a row, nothing runs off the page.
  await setTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(kpis.getByRole('link', { name: 'RFQs received: 1' })).toBeVisible();
  expect(await page.locator('main').evaluate((m) => m.scrollWidth - m.clientWidth)).toBeLessThanOrEqual(1);
  if (PREVIEW_DIR) await toolbar.evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110); document.querySelector('main')?.scrollBy(0, -110); });
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/04-phone.png` });
});
