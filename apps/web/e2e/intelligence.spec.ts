import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const DAY = 86_400_000;

async function apiPost(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('Command Center ranks next best actions, deal health lists risky deals, and records show one timeline', async ({ page }) => {
  await signUp(page, 'Signals E2E');
  const stages = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages as { id: string; category: string }[];
  const open = stages.find((s) => s.category === 'OPEN')!.id;
  const company = await apiPost(page, '/companies', { name: 'Northbeam Ltd' });
  const contact = await apiPost(page, '/contacts', { firstName: 'Mira', lastName: 'Stone', email: 'mira@northbeam.test', companyId: company.id });
  await apiPost(page, '/deals', { name: 'Northbeam rollout', amount: 12000, stageId: open, companyId: company.id, expectedCloseDate: new Date(Date.now() - 4 * DAY).toISOString().slice(0, 10) });
  await apiPost(page, '/activities', { type: 'NOTE', subject: 'Intro from the expo', contactId: contact.id });
  await apiPost(page, '/tasks', { title: 'Send the security questionnaire', dueAt: new Date(Date.now() - 2 * DAY).toISOString() });
  await apiPost(page, '/deal-health/refresh', {});

  // Command Center: ranked list with reasons, and the week's numbers.
  await page.goto('/app');
  await expect(page.getByText('Your next best actions')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send the security questionnaire' })).toBeVisible();
  await expect(page.getByText('Overdue by 2 days.')).toBeVisible();
  await expect(page.getByText(/Health \d+\/100: .*Close date has passed/)).toBeVisible();
  await expect(page.getByText('This week')).toBeVisible();
  await expect(page.getByText(/1 open deal is at high risk/)).toBeVisible();
  await expectNoA11yViolations(page);

  // Turn the risky deal's suggestion into a task.
  const item = page.locator('li').filter({ has: page.getByText(/Health \d+\/100/) });
  await item.getByRole('button', { name: 'Make it a task' }).click();
  await item.getByLabel('Task title').fill('Call Northbeam about the new date');
  await item.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText(/Health \d+\/100/)).toHaveCount(0);

  // Snooze the overdue task until tomorrow.
  await page.getByRole('button', { name: 'Snooze "Send the security questionnaire" until tomorrow' }).click();
  await expect(page.getByRole('link', { name: 'Send the security questionnaire' })).toHaveCount(0);

  // Deal health page, filtered to high risk.
  await page.goto('/app/deals');
  await page.getByRole('link', { name: 'Deal health' }).click();
  await expect(page.getByRole('heading', { name: 'Deal health', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /^High risk/ }).click();
  await expect(page).toHaveURL(/risk=high/);
  await expect(page.getByRole('link', { name: 'Northbeam rollout' })).toBeVisible();
  await expectNoA11yViolations(page);

  // The deal shows its monitor score; the company shows one timeline with its contact's note and the deal.
  await page.getByRole('link', { name: 'Northbeam rollout' }).click();
  await expect(page.getByText('Health monitor')).toBeVisible();
  await expect(page.getByText(/Close date has passed: Expected/)).toBeVisible();
  await page.goto(`/app/companies/${company.id}`);
  const timeline = page.getByRole('list', { name: 'Timeline, newest first' });
  await expect(timeline.getByText('Note: Intro from the expo')).toBeVisible();
  await expect(timeline.getByRole('link', { name: 'Mira Stone' })).toBeVisible();
  await expect(timeline.getByText(/^Started in /)).toBeVisible();
  await page.getByRole('button', { name: 'Deal stage changes' }).click();
  await expect(timeline.getByText('Note: Intro from the expo')).toHaveCount(0);
  await expect(timeline.getByText(/^Started in /)).toBeVisible();
  await expectNoA11yViolations(page);
});
