import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The Pipeline journey board and the company journey (redesign R5, ADR 0085): companies sit in the stage their
 * employees, RFQs and deals put them in; a card opens the visual journey; the Super Workspace renames and hides stages.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
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

/** The page content never scrolls sideways; only the board does (the header is checked by its own tests). */
async function noPageOverflow(page: Page) {
  expect(await page.locator('main').evaluate((m) => m.scrollWidth - m.clientWidth)).toBeLessThanOrEqual(1);
  const board = await page.locator('[data-journey-board]').boundingBox();
  expect(board!.x + board!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

const lead = (page: Page, name: string, people: string[]) =>
  post(page, '/company-leads', {
    company: { name, country: 'GB', city: 'London' },
    employees: people.map((n) => {
      const [firstName, lastName] = n.split(' ');
      return { firstName, lastName, jobTitle: 'Research Director', emails: [{ value: `${firstName!.toLowerCase()}@${name.split(' ')[0]!.toLowerCase()}.example` }] };
    }),
  });

test('companies sit in their journey stage, a card opens the journey, and the Super Workspace renames and hides stages', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Journey Fieldwork');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));

  const fresh = await lead(page, 'Fabrikam Insights', ['Lena Ortiz']);
  const followed = await lead(page, 'Northwind Panels Ltd', ['Priya Nair', 'Tom Hale']);
  await post(page, `/contacts/${followed.employeeIds[0]}/initial-email`, { sentAt: new Date(Date.now() - 9 * 86_400_000).toISOString() });
  const rfqCo = await lead(page, 'Contoso Market Research', ['Omar Haddad']);
  await post(page, '/rfqs', { companyId: rfqCo.company.id, contactId: rfqCo.employeeIds[0], projectName: 'UK drivers survey', currency: 'GBP' });
  const wonCo = await lead(page, 'Tailspin Panels', ['Sara Lind']);
  await post(page, `/companies/${wonCo.company.id}/won`, {});

  await page.goto('/app/pipelines');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pipeline');
  const board = page.locator('[data-journey-board]');
  const column = (key: string) => board.locator(`[data-journey-column="${key}"]`);
  await expect(column('FRESH_EMAIL').locator(`[data-journey-card="${fresh.company.id}"]`)).toBeVisible();
  const card = column('INITIAL_EMAIL').locator(`[data-journey-card="${followed.company.id}"]`);
  await expect(card).toContainText('Follow-up 1 of 5');
  // Sent 9 days ago, so follow-up 1 (7 days later) is overdue.
  await expect(card).toContainText('Follow-up 1 of 5: Priya Nair');
  await expect(card).toContainText('Overdue since');
  await expect(column('RFQ').locator(`[data-journey-card="${rfqCo.company.id}"]`)).toContainText('1 open RFQs');
  await expect(column('WON').locator(`[data-journey-card="${wonCo.company.id}"]`)).toBeVisible();
  await noPageOverflow(page);
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/01-pipeline-journey-board.png` });

  // Search narrows the board.
  await page.getByRole('textbox', { name: 'Search companies or company numbers' }).fill('contoso');
  await expect(board.getByRole('status')).toHaveText('1 company');
  await page.getByRole('textbox', { name: 'Search companies or company numbers' }).fill('');
  await expect(board.getByRole('status')).toHaveText('4 companies');

  // The card opens the visual journey.
  await card.click();
  const dialog = page.getByRole('dialog');
  const steps = dialog.locator('[data-company-journey]');
  await expect(steps.locator('[data-step="INITIAL_EMAIL"]')).toHaveAttribute('data-state', 'CURRENT');
  await expect(steps.locator('[data-step="FOLLOW_UP"]')).toHaveAttribute('data-state', 'NEXT');
  await expect(steps.locator('[data-step="NEW"]')).toHaveAttribute('data-state', 'DONE');
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/02-company-journey.png` });
  await dialog.getByRole('link', { name: 'Open company' }).click();
  await expect(page.locator('#journey [data-step="INITIAL_EMAIL"]')).toHaveAttribute('data-state', 'CURRENT');

  // Deal pipeline settings moved to Settings.
  await page.goto('/app/pipelines');
  await page.getByRole('link', { name: 'Deal pipeline settings' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/pipelines$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deal pipelines');

  // The Super Workspace renames one stage and hides another.
  await page.goto('/app/settings/crm?section=journey');
  const form = page.locator('[data-journey-settings]');
  await form.getByLabel('Name of the stage In Follow-up').fill('Chasing');
  await form.locator('[data-journey-stage="INITIAL_EMAIL"]').getByRole('checkbox').uncheck();
  await expect(form.locator('[data-journey-stage="RFQ"]').getByRole('checkbox')).toBeDisabled();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved.');
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/03-journey-stage-settings.png`, fullPage: true });

  await page.goto('/app/pipelines');
  await expect(column('INITIAL_EMAIL')).toHaveCount(0);
  await expect(column('FOLLOW_UP').getByRole('heading')).toHaveText('Chasing');
  // A company in a hidden stage shows in the stage before it.
  await expect(column('FRESH_EMAIL').locator(`[data-journey-card="${followed.company.id}"]`)).toBeVisible();

  // Tablet width: the board scrolls inside itself, the page does not.
  await page.setViewportSize({ width: 1024, height: 900 });
  await noPageOverflow(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/04-pipeline-tablet.png` });
});
