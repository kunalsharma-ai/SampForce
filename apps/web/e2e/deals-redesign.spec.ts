import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';
import { expectCleanLayout, LAYOUT_SIZES, setMode } from './layout-check';

/*
 * Deals and Pipeline redesign (ADR 0096): the deals dashboard, the board with bulk changes, the new deal fields and
 * the duplicate guard, and the restyled Pipeline page, each checked for overlaps at desktop, tablet and phone sizes
 * in light and dark. Set PREVIEW_DIR to save screenshots.
 */

const PREVIEW_DIR = process.env.PREVIEW_DIR;
const ORIGIN = { origin: 'http://localhost:3000' };
const DAY = 86_400_000;
const ymd = (offset: number) => {
  const d = new Date(Date.now() + offset * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.use({ reducedMotion: 'reduce', deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post<T = { id: string }>(page: Page, url: string, data: object): Promise<T> {
  const res = await page.request.post(`/api/v1${url}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

type Stage = { id: string; name: string; category: string };

async function seed(page: Page) {
  const pipelines = (await (await page.request.get('/api/v1/pipelines')).json()) as { isDefault: boolean; stages: Stage[] }[];
  const stages = pipelines.find((p) => p.isDefault)!.stages;
  const open = stages.filter((s) => s.category === 'OPEN');
  const globex = await post(page, '/companies', { name: 'Globex Research International' });
  const initech = await post(page, '/companies', { name: 'Initech' });
  const priya = await post(page, '/contacts', { firstName: 'Priya', lastName: 'Nair', email: 'priya@globex.example', companyId: globex.id });
  const make = (name: string, amount: number, extra: object = {}) => post(page, '/deals', { name, amount, ...extra });
  const harbor = await make('Harbor panel expansion with a long name that must wrap neatly', 52_000, { companyId: globex.id, contactId: priya.id, expectedCloseDate: ymd(6), priority: 'HIGH', stageId: open[0]!.id, nextFollowUpAt: ymd(2) });
  await post(page, '/activities', { type: 'CALL', subject: 'Scoping call', opportunityId: harbor.id });
  await make('Quartz renewal', 12_000, { companyId: initech.id, expectedCloseDate: ymd(-4), stageId: open[1]?.id ?? open[0]!.id });
  await make('Juniper pilot', 8_000, { companyId: globex.id, expectedCloseDate: ymd(20), priority: 'LOW', stageId: open[2]?.id ?? open[0]!.id });
  await make('Atlas tracker', 30_000, { stageId: open[open.length - 1]!.id, expectedCloseDate: ymd(45) });
  await make('Won wave 1', 40_000, { companyId: initech.id, stageId: stages.find((s) => s.category === 'WON')!.id });
  const lost = await make('Lost study', 3_000);
  await post(page, `/deals/${lost.id}/move`, { stageId: stages.find((s) => s.category === 'LOST')!.id, lossReason: 'Price' });
  return { stages, globex, harbor };
}

test('the deals dashboard shows real numbers with date filters, without overlaps', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Dashboard Co');
  await seed(page);
  await page.goto('/app/deals?view=dashboard');
  const dash = page.locator('[data-deals-dashboard]');
  await expect(dash.getByRole('heading', { name: 'Deals dashboard' })).toBeVisible();
  // This quarter (the default): 6 deals, 4 open worth $102,000, 1 won, 1 lost, 50% conversion.
  await expect(dash.locator('[data-kpi="Total deals"]')).toContainText('6');
  await expect(dash.locator('[data-kpi="Open deals"]')).toContainText('4');
  await expect(dash.locator('[data-kpi="Open deals"]')).toContainText('$102,000');
  await expect(dash.locator('[data-kpi="Won deals"]')).toContainText('$40,000');
  await expect(dash.locator('[data-kpi="Lost deals"]')).toContainText('1');
  await expect(dash.locator('[data-kpi="Conversion rate"]')).toContainText('50%');
  await expect(dash.locator('[data-kpi="Overdue"]')).toContainText('1');
  await expect(dash.getByRole('list', { name: 'Upcoming closing dates' })).toContainText('Harbor panel expansion');
  await expect(dash.getByRole('list', { name: 'Deals by company' })).toContainText('Globex Research International');
  await expect(dash.getByRole('list', { name: 'Deals by employee' })).toContainText('Test Person');
  await expect(dash.getByRole('list', { name: 'Deals by stage' }).locator('[data-stage-row]').first()).toBeVisible();
  // A past custom period leaves out created, won and lost deals; open pipeline stays.
  await dash.getByRole('button', { name: 'Custom dates' }).click();
  await dash.getByLabel('From').fill('2020-01-01');
  await dash.getByLabel('To').fill('2020-12-31');
  await expect(dash.locator('[data-kpi="Won deals"]')).toContainText('0');
  await expect(dash.locator('[data-kpi="Conversion rate"]')).toContainText('—');
  await expect(dash.locator('[data-kpi="Open deals"]')).toContainText('4');
  await dash.getByRole('button', { name: 'This quarter' }).click();
  await expect(dash.locator('[data-kpi="Won deals"]')).toContainText('$40,000');
  await axe(page);

  for (const mode of ['light', 'dark'] as const) {
    await setMode(page, mode);
    for (const size of LAYOUT_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/app/deals?view=dashboard');
      await expect(page.locator('[data-kpi="Won deals"]')).toContainText('$40,000');
      await expectCleanLayout(page, 'main');
      await shot(page, `deals-dashboard-${size.name}-${mode}`, true);
    }
  }
});

test('the board shows rich cards and changes many deals at once', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Board Co');
  const { stages } = await seed(page);
  await page.goto('/app/deals');
  await expect(page.locator('[data-deals-kpi-strip]')).toContainText('$102,000');
  const card = page.locator('[data-deal-card]').filter({ hasText: 'Harbor panel expansion' });
  await expect(card).toContainText('Globex Research International');
  await expect(card).toContainText('Priya Nair');
  await expect(card).toContainText(/Last activity/);
  await expect(card).toContainText(/Follow-up/);
  await expect(card).toContainText('$52,000');
  await expect(card).toContainText('High priority');
  await axe(page);
  await shot(page, 'deals-board-desktop-light');

  // Select two deals and change their priority and close date together.
  await page.getByRole('checkbox', { name: 'Select Quartz renewal' }).check();
  await page.getByRole('checkbox', { name: 'Select Juniper pilot' }).check();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await expect(bar).toContainText('2 deals selected');
  await shot(page, 'deals-board-bulk-bar');
  await bar.getByLabel('Set priority of selected').selectOption('HIGH');
  await expect(bar).toBeHidden();
  await expect(page.locator('[data-deal-card]').filter({ hasText: 'Juniper pilot' })).toContainText('High priority');

  // Select a whole stage and move it.
  const first = stages.find((s) => s.category === 'OPEN')!;
  const last = stages.filter((s) => s.category === 'OPEN').at(-1)!;
  await page.getByRole('checkbox', { name: `Select every deal in ${first.name}` }).check();
  await expect(bar).toContainText('1 deal selected');
  await bar.getByLabel('Move selected to stage').selectOption(last.id);
  await expect(page.getByRole('list', { name: `Deals in ${last.name}` })).toContainText('Harbor panel expansion');

  // Archive two deals: they leave the board and show in the table's archive, from where they come back.
  await page.getByRole('checkbox', { name: 'Select Quartz renewal' }).check();
  await page.getByRole('checkbox', { name: 'Select Atlas tracker' }).check();
  await bar.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('[data-deal-card]').filter({ hasText: 'Atlas tracker' })).toHaveCount(0);
  await page.goto('/app/deals?view=list&archived=true');
  await expect(page.getByRole('table')).toContainText('Atlas tracker');
  await page.getByRole('checkbox', { name: /Select all/ }).first().check();
  await page.getByRole('group', { name: 'Deal actions' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('table')).not.toContainText('Atlas tracker');
  await page.goto('/app/deals');
  await expect(page.locator('[data-deal-card]').filter({ hasText: 'Atlas tracker' })).toBeVisible();

  for (const mode of ['light', 'dark'] as const) {
    await setMode(page, mode);
    for (const size of LAYOUT_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/app/deals');
      await expect(page.locator('[data-deal-card]').first()).toBeVisible();
      await page.getByRole('checkbox', { name: 'Select Quartz renewal' }).check();
      await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
      await expectCleanLayout(page, 'main');
      await shot(page, `deals-board-${size.name}-${mode}`);
    }
  }
});

test('new deal fields, the linked RFQ, and the duplicate warning', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Fields Co');
  const { globex } = await seed(page);
  await post(page, '/rfqs', { companyId: globex.id, projectName: 'Germany B2B panel' });
  await page.goto('/app/deals?view=list');
  await page.getByRole('button', { name: 'New deal' }).click();
  const dialog = page.getByRole('dialog', { name: 'New deal' });
  await dialog.getByLabel('Deal name *').fill('Juniper pilot');
  await dialog.getByLabel('Company').fill('Globex');
  await page.getByRole('option', { name: /Globex Research International/ }).click();
  await dialog.getByLabel('Deal source').fill('Referral');
  const rfqSelect = dialog.getByLabel('Associated RFQ');
  await expect(rfqSelect.locator('option', { hasText: 'Germany B2B panel' })).toHaveCount(1);
  await rfqSelect.selectOption({ index: 1 });
  await dialog.getByLabel('Products or services').fill('Online panel');
  await page.keyboard.press('Enter');
  await dialog.getByLabel('Next follow-up').fill(ymd(3));
  await dialog.getByLabel('Notes').fill('Wants a June start');
  await shot(page, 'deal-form-new-fields');
  await dialog.getByRole('button', { name: 'Create deal' }).click();
  // Globex already has an open "Juniper pilot".
  const warning = dialog.locator('[data-duplicate-deal]');
  await expect(warning).toContainText('already has an open deal called “Juniper pilot”');
  await shot(page, 'deal-form-duplicate-warning');
  await warning.getByRole('button', { name: 'Create anyway' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/app\/deals\/[0-9a-f-]{36}/);
  await expect(page.getByText('Referral').first()).toBeVisible();
  await expect(page.getByText('Wants a June start')).toBeVisible();
  await expect(page.getByText(/Germany B2B panel/).first()).toBeVisible();
  await shot(page, 'deal-detail-new-fields');
});

test('the Pipeline page has a journey summary and toned columns without overlaps', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Journey Co');
  await seed(page);
  await page.goto('/app/pipelines');
  await expect(page.locator('[data-journey-summary]')).toContainText('All companies');
  await axe(page);
  for (const mode of ['light', 'dark'] as const) {
    await setMode(page, mode);
    for (const size of LAYOUT_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/app/pipelines');
      await expect(page.locator('[data-journey-summary]')).toBeVisible();
      await expectCleanLayout(page, 'main');
      await shot(page, `pipeline-${size.name}-${mode}`);
    }
  }
});
