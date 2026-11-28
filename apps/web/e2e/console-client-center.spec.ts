import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen. */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

function operator(role: 'ADMIN' | 'SUPPORT'): string {
  const email = `ops-k3-${role.toLowerCase()}-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Kai Center', OPERATOR_ROLE: role },
  });
  return email;
}

async function signIn(page: Page, email: string) {
  await page.goto('/operator/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('operator-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Operator' })).toBeVisible();
}

/**
 * The client command center (control-center K3): tabs for the overview, company, subscription, workspaces and
 * activity; the subscription's state; starting and extending a trial, cancelling and reactivating, each in the
 * subscription history with its before and after.
 */
test('client command center: tabs, subscription state, trial, cancel, reactivate and history', async ({ page: ops }) => {
  test.setTimeout(120_000);
  await signIn(ops, operator('ADMIN'));
  const name = `Command Center ${Date.now().toString().slice(-5)}`;
  const created = await ops.request.post('/api/v1/operator/clients', {
    headers: { origin: 'http://localhost:3000' },
    data: { organisation: { name }, administrator: { name: 'Mia Morgan', email: `mia-${Date.now()}@client.test` }, planCode: 'growth', seats: 8, paymentStatus: 'PENDING', durationMonths: 12, reason: 'New client' },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { client: { id: string } }).client.id;

  await ops.goto(`/operator/clients/${id}`);
  await expect(ops.getByRole('heading', { level: 1, name })).toBeVisible();
  const tabs = ops.getByRole('tablist', { name: 'Client sections' });
  await expect(tabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(ops.locator('[data-client-kpi="Subscription"] [data-subscription-state]')).toHaveText('Pending payment');
  await expect(ops.locator('[data-client-kpi="Seats used"]')).toContainText('0 / 8');
  await shot(ops, 'k3-01-client-overview');
  await axe(ops);

  // Keyboard: arrows move between tabs, and the open tab is in the address.
  await tabs.getByRole('tab', { name: 'Overview' }).focus();
  await ops.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Company' })).toHaveAttribute('aria-selected', 'true');
  await expect(ops).toHaveURL(/\?tab=company$/);
  await expect(ops.locator('[data-client-company]')).toBeVisible();

  // Subscription tab: start a trial of a bigger plan.
  await tabs.getByRole('tab', { name: 'Subscription' }).click();
  await expect(ops).toHaveURL(/\?tab=subscription$/);
  const history = ops.locator('[data-subscription-history]');
  await expect(history.locator('[data-subscription-event="CREATED"]')).toContainText('Growth');
  await ops.getByRole('button', { name: 'Start a trial' }).click();
  let dlg = ops.getByRole('dialog', { name: 'Start a trial' });
  await dlg.getByLabel('Days').fill('14');
  await dlg.getByLabel('Plan').selectOption('business');
  await dlg.getByLabel('Reason').fill('Evaluating the Business plan');
  await dlg.getByRole('button', { name: 'Start trial' }).click();
  await expect(dlg).toBeHidden();
  await expect(ops.locator('h2 [data-subscription-state]')).toHaveText('Trial');
  await expect(history.locator('[data-subscription-event]').first()).toContainText('Trial started');
  await expect(history.locator('[data-subscription-event]').first()).toContainText('Growth → Business');
  await expect(history.locator('[data-subscription-event]').first()).toContainText('Pending payment → Trial');

  // Extend it.
  await ops.getByRole('button', { name: 'Extend trial' }).click();
  dlg = ops.getByRole('dialog', { name: 'Extend trial' });
  await expect(dlg.getByLabel('Plan')).toBeDisabled();
  await dlg.getByLabel('Days to add').fill('7');
  await dlg.getByLabel('Reason').fill('Needs another week to decide');
  await dlg.getByRole('button', { name: 'Extend trial' }).click();
  await expect(dlg).toBeHidden();
  await expect(history.locator('[data-subscription-event]').first()).toContainText('Trial extended');

  // Renew for a year (ends the trial), then cancel at the end of the term.
  await ops.getByRole('button', { name: 'Renew or upgrade' }).click();
  dlg = ops.getByRole('dialog', { name: 'Renew or upgrade' });
  await dlg.getByLabel('Months').fill('12');
  await dlg.getByLabel('Payment').selectOption('PAID');
  await dlg.getByLabel('Reason').fill('Signed the annual order form');
  await dlg.getByRole('button', { name: 'Renew' }).click();
  await expect(dlg).toBeHidden();
  await expect(ops.locator('h2 [data-subscription-state]')).toHaveText('Active');

  await ops.getByRole('button', { name: 'Cancel subscription' }).click();
  dlg = ops.getByRole('dialog', { name: 'Cancel subscription' });
  await expect(dlg.getByRole('radio', { name: /At the end of the term/ })).toBeChecked();
  await dlg.getByLabel('Reason').fill('Moving to an in-house tool');
  await shot(ops, 'k3-03-client-cancel');
  await dlg.getByRole('button', { name: 'Cancel at term end' }).click();
  await expect(dlg).toBeHidden();
  await expect(ops.locator('[data-cancel-scheduled]')).toContainText('Cancels on');
  await expect(history.locator('[data-subscription-event]').first()).toContainText('Cancels at the end of the term');

  // Changed their mind: reactivate.
  await ops.getByRole('button', { name: 'Reactivate' }).click();
  dlg = ops.getByRole('dialog', { name: 'Reactivate subscription' });
  await dlg.getByLabel('Reason').fill('Decided to stay after all');
  await dlg.getByRole('button', { name: 'Reactivate' }).click();
  await expect(dlg).toBeHidden();
  await expect(ops.locator('[data-cancel-scheduled]')).toHaveCount(0);
  await expect(history.locator('[data-subscription-event="REACTIVATED"]')).toContainText('Decided to stay after all');
  await expect(history.locator('[data-subscription-event]')).toHaveCount(6);
  await shot(ops, 'k3-02-client-subscription', true);
  await axe(ops);

  // Workspaces & access and Activity & history.
  await tabs.getByRole('tab', { name: 'Workspaces & access' }).click();
  await expect(ops.locator('[data-console-workspaces]')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Activity & history' }).click();
  await expect(ops.locator('[data-console-history]')).toContainText('Subscription reactivated');
  await shot(ops, 'k3-04-client-activity');
  await axe(ops);

  // A deep link opens its tab.
  await ops.goto(`/operator/clients/${id}?tab=subscription`);
  await expect(tabs.getByRole('tab', { name: 'Subscription' })).toHaveAttribute('aria-selected', 'true');
});

test('an operator who cannot manage subscriptions sees the history but no subscription buttons', async ({ page: ops, browser }) => {
  const adminPage = await (await browser.newContext()).newPage();
  await signIn(adminPage, operator('ADMIN'));
  const created = await adminPage.request.post('/api/v1/operator/clients', {
    headers: { origin: 'http://localhost:3000' },
    data: { organisation: { name: `Read Only ${Date.now()}` }, administrator: { name: 'Ro Reader', email: `ro-${Date.now()}@client.test` }, planCode: 'growth', seats: 2, reason: 'New client' },
  });
  const id = ((await created.json()) as { client: { id: string } }).client.id;
  await signIn(ops, operator('SUPPORT'));
  await ops.goto(`/operator/clients/${id}?tab=subscription`);
  await expect(ops.locator('[data-subscription-history] [data-subscription-event="CREATED"]')).toBeVisible();
  await expect(ops.locator('[data-subscription-actions]')).toHaveCount(0);
  const res = await ops.request.post(`/api/v1/operator/clients/${id}/subscription/cancel`, { headers: { origin: 'http://localhost:3000' }, data: { when: 'NOW', reason: 'Should be refused' } });
  expect(res.status()).toBe(403);
});
