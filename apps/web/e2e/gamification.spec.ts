import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

async function apiCall(page: Page, method: 'post' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.json();
}

async function noAxeViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('admin sets the scoring rules, then the team sees points, badges and a team challenge', async ({ page }) => {
  await signUp(page, 'Gamified');
  const company = await apiCall(page, 'post', '/companies', { name: 'Acme' });
  for (let i = 0; i < 3; i++) await apiCall(page, 'post', '/activities', { type: 'CALL', subject: `Call ${i}`, companyId: company.id });
  const stages = (await apiCall(page, 'get', '/pipelines'))[0].stages as { id: string; category: string }[];
  const deal = await apiCall(page, 'post', '/deals', { name: 'Acme pilot', amount: 4000, stageId: stages[0]!.id, companyId: company.id });
  await apiCall(page, 'post', `/deals/${deal.id}/move`, { stageId: stages.find((s) => s.category === 'WON')!.id });

  // A sales team, made in Team Management.
  await page.goto('/app/team');
  await page.getByRole('button', { name: 'New team' }).click();
  const teamDialog = page.getByRole('dialog', { name: 'New team' });
  await teamDialog.getByLabel('Team name').fill('North');
  await teamDialog.getByLabel(/Test Person/).check();
  await teamDialog.getByRole('button', { name: 'Save team' }).click();
  await expect(page.getByRole('list', { name: 'Sales teams' }).getByText('North')).toBeVisible();

  // Off until an admin turns it on; the admin chooses what earns points.
  await page.goto('/app/gamification');
  await expect(page.getByText('Gamification is turned off for this workspace.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Rules and settings' })).toHaveAttribute('aria-selected', 'true');
  await noAxeViolations(page);
  await page.getByLabel('Call logged daily limit').fill('2');
  await page.getByLabel('Turn on points, leaderboards, badges and competitions').check();
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByRole('tab', { name: 'My performance' })).toBeVisible();

  await page.getByRole('tab', { name: 'My performance' }).click();
  // Calls: 3 logged, 2 counted (daily limit) = 10. Deal created 5, deal won 50, revenue 4 × 1 = 69.
  await expect(page.getByTestId('my-points')).toHaveText('69');
  const breakdown = page.getByRole('table', { name: 'Points by activity this month' });
  await expect(breakdown.getByRole('row', { name: /Call logged 3 2 10/ })).toBeVisible();
  await noAxeViolations(page);

  await page.getByRole('tab', { name: 'Leaderboards' }).click();
  await expect(page.getByRole('row', { name: /Test Person 69/ })).toBeVisible();
  await page.getByRole('button', { name: 'Teams' }).click();
  await expect(page.getByRole('row', { name: /North 69/ })).toBeVisible();
  await page.getByLabel('Period').selectOption({ index: 1 });
  await expect(page.getByRole('row', { name: /North 0/ })).toBeVisible();
  await noAxeViolations(page);

  await page.getByRole('tab', { name: 'Badges' }).click();
  await page.getByRole('button', { name: 'Add suggested badges' }).click();
  await expect(page.getByRole('list', { name: 'Badges' }).getByText('First win')).toBeVisible();
  await page.getByRole('button', { name: 'Check for new badges now' }).click();
  await expect(page.getByRole('status')).toHaveText('1 new badge awarded.');
  await expect(page.getByRole('list', { name: 'Recent awards' })).toContainText('Test Person earned First win');
  await noAxeViolations(page);

  await page.getByRole('tab', { name: 'Competitions' }).click();
  await page.getByRole('button', { name: 'New competition' }).click();
  const comp = page.getByRole('dialog', { name: 'New competition' });
  await comp.getByLabel('Name', { exact: true }).fill('Call blitz');
  await comp.getByLabel('Who competes').selectOption('team');
  await comp.getByLabel('Measure').selectOption('activities');
  await comp.getByLabel('Goal (optional)').fill('10');
  await comp.getByLabel('Reward (optional)').fill('Team lunch');
  await comp.getByRole('button', { name: 'Start competition' }).click();
  const standings = page.getByRole('list', { name: 'Standings for Call blitz' });
  await expect(standings).toContainText('1. North');
  await expect(standings).toContainText('3 activities · 30%');
  await expect(page.getByText('Goal: 10 activities per team · Reward: Team lunch')).toBeVisible();
  await noAxeViolations(page);
});
