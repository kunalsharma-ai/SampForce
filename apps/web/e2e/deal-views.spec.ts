import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const DAY = 86_400_000;
const ymd = (offset: number) => {
  const d = new Date(Date.now() + offset * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.use({ reducedMotion: 'reduce' });

async function seed(page: Page) {
  for (const [name, amount, close, priority] of [
    ['Harbor expansion', 50_000, ymd(-3), null],
    ['Quartz renewal', 12_000, ymd(2), 'HIGH'],
    ['Juniper pilot', 8_000, ymd(40), 'LOW'],
    ['Undated idea', 3_000, null, null],
  ] as const) {
    const res = await page.request.post('/api/v1/deals', { data: { name, amount, expectedCloseDate: close, priority }, headers: ORIGIN });
    expect(res.ok()).toBe(true);
  }
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

test('board cards open a side panel where the deal can be edited, with its history', async ({ page }) => {
  await signUp(page, 'Panel Co');
  await seed(page);
  await page.goto('/app/deals');
  const col = page.getByRole('list', { name: 'Deals in Qualification' });
  const card = col.getByRole('listitem').filter({ hasText: 'Quartz renewal' });
  await expect(card).toContainText('High priority');
  await expect(card).toContainText('Health: Not scored');
  await expect(card).toContainText('Owner: Test Person');

  await card.getByRole('link', { name: 'Quartz renewal' }).click();
  const panel = page.getByRole('dialog', { name: 'Quartz renewal' });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/deal=/);
  await axe(page);

  await panel.getByLabel('Priority').selectOption('MEDIUM');
  await panel.getByLabel('Amount (USD)').fill('-5');
  await expect(panel.getByText('Enter an amount of 0 or more')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await panel.getByLabel('Amount (USD)').fill('15000');
  await expect(panel.getByRole('status')).toHaveText('2 unsaved changes.');
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByRole('status')).toHaveText(/Saved at/);
  await expect(panel.getByText('$15,000').first()).toBeVisible();

  // Tabs work with the arrow keys; History lists the change.
  await panel.getByRole('tab', { name: 'Overview' }).focus();
  await page.keyboard.press('End');
  await expect(panel.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  const history = panel.getByRole('list', { name: 'Deal history' });
  await expect(history).toContainText('Priority: HIGH → MEDIUM');
  await expect(history).toContainText('Amount: 12000 → 15000');

  // Moving the deal from the panel updates the board behind it.
  await panel.getByRole('button', { name: /^Discovery/ }).click();
  await expect(panel.getByRole('button', { name: /^Discovery/ })).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/deal=/);
  await expect(page.getByRole('list', { name: 'Deals in Discovery' }).getByRole('listitem').filter({ hasText: 'Quartz renewal' })).toContainText('Medium priority');

  // Reloading with the panel open keeps it open (shareable link).
  await page.getByRole('link', { name: 'Harbor expansion' }).click();
  await expect(page.getByRole('dialog', { name: 'Harbor expansion' })).toBeVisible();
  await expect(page).toHaveURL(/deal=/);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Harbor expansion' })).toBeVisible();
});

test('priority, forecast, calendar, timeline and split views show the same deals in different shapes', async ({ page }) => {
  await signUp(page, 'Views Co');
  await seed(page);
  await page.goto('/app/deals');

  await page.getByRole('button', { name: 'Priority', exact: true }).click();
  await expect(page).toHaveURL(/view=priority/);
  const ranked = page.getByRole('list', { name: 'Deals by priority' }).getByRole('listitem').filter({ has: page.getByRole('link') });
  await expect(ranked.first()).toContainText('Harbor expansion');
  await expect(ranked.first()).toContainText('Close date passed 3 days ago');
  await expect(ranked.nth(1)).toContainText('Marked high priority');
  await axe(page);

  await page.getByRole('button', { name: 'Forecast', exact: true }).click();
  const overdue = page.getByRole('list', { name: 'Deals closing Overdue' });
  await expect(overdue.getByRole('link', { name: 'Harbor expansion' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Deals closing No close date' }).getByRole('link', { name: 'Undated idea' })).toBeVisible();
  await expect(page.getByText(/Open \$73,000 · weighted/)).toBeVisible();
  await axe(page);

  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const soon = new Date(Date.now() + 2 * DAY);
  if (soon.getMonth() !== new Date().getMonth()) await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('table').getByRole('link', { name: 'Quartz renewal' })).toBeVisible();
  await axe(page);
  await page.getByRole('table').getByRole('link', { name: 'Quartz renewal' }).click();
  await expect(page.getByRole('dialog', { name: 'Quartz renewal' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const rows = page.getByRole('list', { name: 'Deals by expected close' });
  await expect(rows.getByRole('link')).toHaveText(['Harbor expansion', 'Quartz renewal', 'Juniper pilot']);
  await expect(rows.getByRole('listitem').first()).toContainText('overdue');

  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByRole('list', { name: 'Deals' }).getByRole('button', { name: /Juniper pilot/ }).click();
  const region = page.getByRole('region', { name: 'Selected deal' });
  await expect(region.getByRole('heading', { name: 'Juniper pilot' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Search deals').fill('harbor');
  await expect(page.getByRole('list', { name: 'Deals' }).getByRole('button')).toHaveCount(1);
  await axe(page);

  // The view is remembered on this device.
  await page.goto('/app/deals');
  await expect(page).toHaveURL(/view=split/);
});
