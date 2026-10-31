import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const post = async (page: Page, path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN })).json();

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('plans the forecast against targets, with win-history probabilities, risks and trends', async ({ page }) => {
  await signUp(page, 'Forecast Plan');
  const stages = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages as { id: string; category: string; name: string }[];
  const first = stages.find((s) => s.category === 'OPEN')!;
  const won = stages.find((s) => s.category === 'WON')!;
  const lost = stages.find((s) => s.category === 'LOST')!;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 4; i++) {
    const d = await post(page, '/deals', { name: `Closed ${i}`, amount: 5000, stageId: first.id, expectedCloseDate: today });
    await post(page, `/deals/${d.id}/move`, i < 3 ? { stageId: won.id } : { stageId: lost.id, lossReason: 'Went with a competitor' });
  }
  await post(page, '/deals', { name: 'Harbor expansion', amount: 40000, stageId: first.id, expectedCloseDate: today });

  await page.goto('/app/forecasting');
  await expect(page.getByText(/^No target for /)).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('100000');
  await page.getByRole('button', { name: 'Set target' }).click();
  await expect(page.getByText('Set for this period')).toBeVisible();
  await expect(page.getByText('15%', { exact: true })).toBeVisible(); // 15,000 won of 100,000
  const risks = page.getByRole('region', { name: 'No activity in 30 days' });
  await expect(risks.getByRole('link', { name: 'Harbor expansion' })).toBeVisible();

  await page.getByRole('button', { name: 'Change assumptions' }).click();
  await page.getByLabel('Probability of open deals').selectOption('history');
  await page.getByLabel('Minimum closed deals per stage').fill('3');
  await page.getByRole('button', { name: 'Save assumptions' }).click();
  await expect(page.getByText(/stage win rate over the last 12 months/)).toBeVisible();
  const row = page.getByRole('row', { name: /Harbor expansion/ });
  await expect(row.getByText('win history')).toBeVisible();
  await expect(row.getByText('75%')).toBeVisible();
  await expect(page.getByText('Went with a competitor · 1')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel('Forecast by').selectOption('month');
  await expect(page.getByText('A third of the quarter target (no month target set)')).toBeVisible();
  await page.getByLabel('Forecast by').selectOption('year');
  await expect(page.getByText('Sum of the targets set inside this period')).toBeVisible();
  await expectNoA11yViolations(page);
});
