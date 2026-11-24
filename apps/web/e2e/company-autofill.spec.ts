import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Company auto-fill (ADR 0076): a new company with only a name and website gets its empty details filled from its own
 * website by the worker; the company page says what was filled and where from, and each value can be undone. The
 * websites are made-up sites served by the stand-in (apps/api/test/fixtures/company-sites.ts).
 */
const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function shot(page: Page, name: string, locator?: ReturnType<Page['locator']>) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(300);
  // A panel is shown in the middle of the page, as people see it (an element shot would sit under the sticky top bar).
  if (locator) await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('a new company is filled from its website, with sources, and each value can be undone', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Autofill Showcase Org');
  const res = await page.request.post('/api/v1/companies', { data: { name: 'Northwind Insights', website: 'northwind-insights.example' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  const { id } = await res.json();

  await page.goto(`/app/companies/${id}`);
  const panel = page.locator('#company-autofill');
  // The worker (in the API for e2e) reads the site within a few seconds; the page reloads the company when it is done.
  await expect(panel.getByRole('status')).toContainText(/details added/, { timeout: 30_000 });
  const filled = panel.getByRole('list', { name: 'Details auto-fill added' });
  // The first few fields show; the rest open with "Show all".
  await expect(filled.locator(':scope > li')).toHaveCount(6);
  await panel.scrollIntoViewIfNeeded();
  await shot(page, '02-autofill-panel', panel);
  await panel.getByRole('button', { name: /^Show all/ }).click();
  await expect(filled.locator(':scope > li').filter({ hasText: 'Certifications' })).toContainText('ISO 27001');
  await expect(filled.locator(':scope > li').filter({ hasText: 'Founded' })).toContainText('2009');
  await expect(filled.locator(':scope > li').filter({ hasText: 'Founded' }).getByRole('link', { name: /Company website/ })).toHaveAttribute('href', 'https://www.northwind-insights.example/about-us');
  // A value guessed from weak signals says so.
  await expect(filled.locator(':scope > li').filter({ hasText: 'Industry' })).toContainText('Best guess');
  // The company itself now has the details: the business information card shows the filled description.
  await expect(page.getByText(/^Northwind Insights is a global market research company/).first()).toBeVisible();
  await axe(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '01-company-page-after-autofill');

  // Undo one value: it leaves the company and the list.
  await filled.getByRole('button', { name: 'Undo Founded' }).click();
  await expect(filled.locator(':scope > li').filter({ hasText: 'Founded' })).toHaveCount(0);
  const after = await (await page.request.get(`/api/v1/companies/${id}`)).json();
  expect(after.foundedYear).toBeNull();
  expect(after.fieldSources.foundedYear).toMatchObject({ source: 'USER' });

  // Looking it up again straight away, from the header's quick action, is refused with a plain reason.
  await page.getByRole('button', { name: 'Enrich', exact: true }).first().click();
  await expect(panel.getByRole('alert')).toContainText('This company was just looked up. Try again in a minute.');

  // Undo all removes everything the run added.
  await panel.getByRole('button', { name: 'Undo all' }).click();
  await expect(panel).toContainText('Everything the last look-up filled was undone or changed since.');
  const cleared = await (await page.request.get(`/api/v1/companies/${id}`)).json();
  expect(cleared.certifications).toEqual([]);
  expect(cleared.website).toBe('https://northwind-insights.example');
  await shot(page, '03-autofill-undone', panel);
});

test('a company saved without a website is looked up again when its website is added', async ({ page }) => {
  test.setTimeout(60_000);
  await signUp(page, 'Autofill Enrich Org');
  // Without a website there is nothing to read yet, and Wikidata knows no company called this.
  const res = await page.request.post('/api/v1/companies', { data: { name: 'Plainfield Works' }, headers: ORIGIN });
  const { id } = await res.json();
  await page.goto(`/app/companies/${id}`);
  const panel = page.locator('#company-autofill');
  await expect(panel.getByRole('status')).toContainText('No website, and Wikidata has no company with exactly this name.', { timeout: 30_000 });
  await shot(page, '04-autofill-nothing-found', panel);

  // Adding the website looks it up again by itself.
  const patch = await page.request.patch(`/api/v1/companies/${id}`, { data: { website: 'globex-analytics.example' }, headers: ORIGIN });
  expect(patch.ok(), await patch.text()).toBe(true);
  await page.reload();
  await expect(panel.getByRole('status')).toContainText(/details added/, { timeout: 30_000 });
  await expect(panel).toContainText('when the website changed');
});
