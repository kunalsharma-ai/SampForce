import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

const SIDEBAR = [
  'Command Center', 'Leads', 'Contacts', 'Companies', 'Deals', 'Pipelines', 'Accounts', 'Sales Activities',
  'Email & Communication', 'Email Sequences', 'Meetings', 'AI Agents', 'Automation Studio', 'Marketing', 'Campaigns',
  'Quotes & Proposals', 'Contracts', 'Revenue Intelligence', 'Forecasting', 'Customer Success',
  'Reports & Analytics', 'Team Management', 'Integrations', 'Marketplace', 'Billing', 'Settings', 'Administration',
];

test('redirects visitors without a session to sign-in', async ({ page }) => {
  await page.goto('/app/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsettings/);
});

test('validates the sign-up form before calling the API', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Start free' }).click();
  await expect(page.getByText('Enter your name')).toBeVisible();
  await expect(page.getByText('Use at least 10 characters')).toBeVisible();
});

test('signs up and shows Command Center KPIs from the API', async ({ page }) => {
  await signUp(page);
  await expect(page.getByTestId('kpi-totalLeads')).toContainText('0');
  await expect(page.getByTestId('kpi-aiAssistedActivities')).toContainText('0');
  await expect(page.getByTestId('kpi-automationSuccessRate')).toContainText('Not enough data yet');
  await expect(page.getByText('created the workspace')).toBeVisible();
  // Accessible table alternative to the chart.
  await page.getByRole('button', { name: 'Show as table' }).click();
  await expect(page.getByRole('rowheader', { name: 'Closed Won' })).toBeVisible();
});

test('every sidebar entry leads to a working page', async ({ page }) => {
  await signUp(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const label of SIDEBAR) {
    await nav.getByRole('link', { name: new RegExp(`^${label.replace(/[&]/g, '\\&')}`) }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('This page does not exist')).toHaveCount(0);
  }
  expect(await nav.getByRole('link').count()).toBe(SIDEBAR.length);
});

test('updates workspace settings and records them in the audit log', async ({ page }) => {
  await signUp(page, 'Settings Org');
  await page.goto('/app/settings');
  const name = page.getByLabel('Workspace name');
  await expect(name).toHaveValue('Settings Org');
  await name.fill('Settings Org Renamed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.goto('/app/administration');
  await expect(page.getByRole('cell', { name: 'tenant.updated' })).toBeVisible();
});

test('persists theme and motion preferences across reloads', async ({ page }) => {
  await signUp(page);
  await page.goto('/app/settings');
  await page.getByText('Off', { exact: true }).click();
  await page.getByText('Light', { exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('opens global search with the keyboard and navigates', async ({ page }) => {
  await signUp(page);
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search leads, contacts, companies, deals or modules…').fill('billing');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/billing/);
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
});

test('signs out', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/);
});

for (const theme of ['dark', 'light'] as const) {
  test(`has no WCAG 2.2 A/AA violations on key pages (${theme})`, async ({ page }) => {
    // Visits 22 pages with a full axe scan each; under a parallel run that takes longer than the default 30 s.
    test.setTimeout(120_000);
    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: t, motion: 'off' }, version: 0 })), theme);
    for (const path of ['/', '/pricing', '/login', '/signup']) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations, `${path}: ${r.violations.map((v) => v.id).join(', ')}`).toEqual([]);
    }
    await signUp(page);
    for (const path of ['/app', '/app/settings', '/app/team', '/app/administration', '/app/leads', '/app/deals', '/app/contacts', '/app/activities', '/app/pipelines', '/app/settings/import', '/app/settings/custom-fields', '/app/billing', '/app/reports', '/app/reports/dashboards', '/app/reports/flow', '/app/reports/replay', '/app/account/security', '/app/administration/security']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations, `${path}: ${r.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(', ')}`).toEqual([]);
    }
  });
}
