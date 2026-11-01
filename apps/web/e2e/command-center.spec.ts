import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce' });

/** Creates deals through the API and moves them, so the charts have real stage history. */
async function seedDeals(page: Page) {
  const pipelines = await (await page.request.get('/api/v1/pipelines')).json();
  const stages = pipelines[0].stages as { id: string; name: string }[];
  const stage = (n: string) => stages.find((s) => s.name === n)!.id;
  const make = async (name: string, amount: number, to?: string, lossReason?: string) => {
    const res = await page.request.post('/api/v1/deals', { data: { name, amount, stageId: stage('Qualification') }, headers: ORIGIN });
    expect(res.ok()).toBe(true);
    const deal = await res.json();
    for (const s of to ? ['Discovery', to] : []) {
      const mv = await page.request.post(`/api/v1/deals/${deal.id}/move`, { data: { stageId: stage(s), ...(s === 'Closed Lost' ? { lossReason } : {}) }, headers: ORIGIN });
      expect(mv.ok()).toBe(true);
    }
  };
  await make('Northwind renewal', 24_000, 'Closed Won');
  await make('Contoso pilot', 6_000, 'Closed Lost', 'Budget');
  await make('Fabrikam rollout', 15_000, 'Proposal');
  await make('Litware trial', 3_000);
}

const widget = (page: Page, id: string) => page.locator(`[data-widget="${id}"]`);
const order = (page: Page) => page.locator('[data-widget]').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')));

test('charts show real numbers, switch to a table, and filter by period and owner', async ({ page }) => {
  await signUp(page, 'Charts Co');
  await seedDeals(page);
  await page.goto('/app');

  // Salesperson preset: just my numbers, last 30 days.
  await expect(page.getByLabel('Owner')).toHaveValue('me');
  await expect(page.getByRole('button', { name: 'Salesperson' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kpi-closedWonRevenue')).toContainText('$24,000');
  await expect(page.getByTestId('kpi-winRate')).toContainText('50');

  const trend = widget(page, 'revenueTrend');
  await expect(trend.getByRole('img', { name: /\$24,000 in total/ })).toBeVisible();
  await trend.getByRole('button', { name: 'Revenue trajectory: show as table' }).click();
  await expect(trend.getByRole('table')).toContainText('$24,000');
  const download = page.waitForEvent('download');
  await trend.getByRole('button', { name: 'Revenue trajectory: download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);

  // Executive preset brings in conversion, win/loss and team charts.
  await page.getByRole('button', { name: 'Executive' }).click();
  await expect(page.getByLabel('Period')).toHaveValue('90d');
  await expect(page.getByLabel('Owner')).toHaveValue('');
  const winLoss = widget(page, 'winLoss');
  await expect(winLoss).toContainText('top loss reason: Budget');
  await winLoss.getByRole('button', { name: 'Win and loss: show as table' }).click();
  await expect(winLoss.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Lost', exact: true }) })).toContainText('$6,000');
  const funnel = widget(page, 'stageConversion');
  await funnel.getByRole('button', { name: 'Stage conversion: show as table' }).click();
  await expect(funnel.getByRole('row', { name: /Qualification/ })).toContainText('4');
  await expect(funnel.getByRole('row', { name: /Discovery/ })).toContainText('3');
  await expect(widget(page, 'team')).toContainText('Team performance');
  await expect(widget(page, 'goal')).toContainText('Set one in Forecasting');

  // The choice is saved for next time.
  await page.getByLabel('Period').selectOption('7d');
  await expect(page.getByText(/last 7 days/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Period')).toHaveValue('7d');
  await expect(page.getByRole('button', { name: 'Executive' })).toHaveAttribute('aria-pressed', 'true');

  // Let the metric cards finish fading in before checking contrast.
  await expect(widget(page, 'kpis').locator('li').last()).toHaveCSS('opacity', '1');
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(a11y.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
});

test('customize mode reorders, resizes, hides and restores widgets, and saves per person', async ({ page }) => {
  await signUp(page, 'Layout Co');
  await page.goto('/app');
  await expect(widget(page, 'nextActions')).toBeVisible();
  const start = await order(page);
  expect(start.slice(0, 3)).toEqual(['nextActions', 'insights', 'kpis']);

  await page.getByRole('button', { name: 'Customize layout' }).click();
  const panel = page.getByRole('region', { name: 'Customize dashboard' });
  await expect(panel).toBeVisible();

  await page.getByRole('button', { name: 'Move Key metrics up' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Key metrics moved up.' })).toBeAttached();
  await page.getByRole('button', { name: 'Move Key metrics up' }).click();
  expect((await order(page)).slice(0, 3)).toEqual(['kpis', 'nextActions', 'insights']);

  await page.getByRole('button', { name: 'Make Next best actions full width' }).click();
  await page.getByRole('button', { name: 'Hide Recent activity' }).click();
  await expect(widget(page, 'activity')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Show Recent activity' })).toBeVisible();
  await panel.getByRole('button', { name: 'Show Team performance' }).click();
  await expect(widget(page, 'team')).toBeVisible();

  // Drag the pipeline chart to the top.
  // The two cards are a screen apart, so dispatch the drag events rather than moving the mouse across a scroll.
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await widget(page, 'pipeline').dispatchEvent('dragstart', { dataTransfer: dt });
  await widget(page, 'kpis').dispatchEvent('dragover', { dataTransfer: dt });
  await widget(page, 'kpis').dispatchEvent('drop', { dataTransfer: dt });
  await widget(page, 'pipeline').dispatchEvent('dragend', { dataTransfer: dt });
  expect((await order(page))[0]).toBe('pipeline');

  // Cancel throws the draft away.
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await order(page)).toEqual(start);

  // Do it again and keep it.
  await page.getByRole('button', { name: 'Customize layout' }).click();
  await page.getByRole('button', { name: 'Hide Recent activity' }).click();
  await page.getByRole('button', { name: 'Move Key metrics up' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByText('Custom', { exact: true })).toBeVisible();
  await page.reload();
  await expect(widget(page, 'kpis')).toBeVisible();
  expect((await order(page)).slice(0, 2)).toEqual(['nextActions', 'kpis']);
  await expect(widget(page, 'activity')).toHaveCount(0);

  // Reset goes back to the default.
  await page.getByRole('button', { name: 'Customize layout' }).click();
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(widget(page, 'activity')).toBeVisible();
  expect(await order(page)).toEqual(start);
});
