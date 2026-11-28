import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { FEATURE_KEYS } from '@dealflow/types';
import { E2E_DATABASE_URL } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  // Next sets the tab title again after a soft navigation; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** Console Admin (ADR 0071): a plan is created, a client is sold it, and the Console changes its subscription. */
test('the Console Admin creates a client on a plan, sets its limits and changes its subscription', async ({ browser }) => {
  test.setTimeout(180_000);
  const email = `ops-console-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Console Admin', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // Plan B: every feature but RFQs and SampBidx, sold yearly in rupees with four managers and six executives.
  const suffix = String(Date.now()).slice(-5);
  const planName = `Plan B ${suffix}`;
  const created = await ops.request.post('/api/v1/operator/console-plans', {
    headers: ORIGIN,
    data: {
      name: planName, features: FEATURE_KEYS.filter((k) => k !== 'rfqs' && k !== 'sampbidx'), reason: 'Plan for mid-size research firms',
      limits: { maxUsers: null, maxPipelines: null, monthlyAiCredits: 500, automationRunsPerMonth: 10000, maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 6 },
      terms: { description: 'Mid-size research firms', priceCents: 36000000, currency: 'INR', billingFrequency: 'YEAR', supportLevel: 'PRIORITY', durationMonths: 12, autoRenew: true, upgradeTo: [], available: true },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Plans' }).click();
  await expect(ops.locator('[data-console-plans]').getByText(planName)).toBeVisible();
  await shot(ops, '05-console-plans');

  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Clients' }).click();
  await ops.getByRole('link', { name: 'New client' }).click();
  // Create client (control-center K2): the company, then the details (skipped here), the plan, then approve.
  await expect(ops.getByRole('heading', { level: 1, name: 'Create client' })).toBeVisible();
  const client = `Frequent Research ${suffix}`;
  await ops.getByLabel('Company name').fill(client);
  await ops.getByLabel('Company email').fill(`info-${suffix}@frequent.example`);
  await ops.getByLabel('Website').fill('frequent.example');
  await ops.getByRole('button', { name: 'Skip, I’ll enter the details' }).click();
  await ops.getByRole('button', { name: 'Approve details' }).click();
  await ops.getByLabel('Administrator’s name').fill('Kavya Iyer');
  await ops.getByLabel('Administrator’s email').fill(`kavya-${suffix}@client.test`);
  await ops.getByLabel('Administrator’s designation').fill('Head of Sales Operations');
  const option = ops.getByLabel('Plan').locator('option', { hasText: planName });
  await ops.getByLabel('Plan').selectOption((await option.getAttribute('value'))!);
  await ops.getByLabel('Seats').fill('25');
  await ops.getByLabel('Payment').selectOption('PAID');
  await shot(ops, '06-console-new-client');
  await ops.getByRole('button', { name: 'Continue' }).click();
  await ops.getByRole('button', { name: 'Approve & create client' }).click();
  await expect(ops.getByLabel('Administrator invitation link')).toHaveValue(/\/invite\//);
  await ops.getByRole('button', { name: 'Open client' }).click();

  await expect(ops.getByRole('heading', { level: 1, name: client })).toBeVisible();
  await expect(ops.locator('[data-usage="Manager Workspaces"]')).toHaveText('0 / 4 used');
  await ops.getByRole('tab', { name: 'Workspaces & access' }).click();
  await expect(ops.locator('[data-console-workspaces]')).toContainText('Head of Sales Operations');
  await axe(ops);

  // Scenario 14: the Console raises the manager limit and the change is in the client's history.
  await ops.getByRole('tab', { name: 'Subscription' }).click();
  await ops.getByRole('button', { name: 'Change subscription' }).click();
  const sub = ops.getByRole('dialog');
  await sub.getByLabel('Manager Workspaces').fill('5');
  await sub.getByLabel('Reason').fill('Fifth region approved');
  await sub.getByRole('button', { name: 'Save changes' }).click();
  await expect(sub).toBeHidden();
  await ops.getByRole('tab', { name: 'Overview' }).click();
  await expect(ops.locator('[data-usage="Manager Workspaces"]')).toHaveText('0 / 5 used');
  await ops.getByRole('tab', { name: 'Activity & history' }).click();
  await expect(ops.locator('[data-console-history]')).toContainText('Manager Workspaces: plan limit (4) → 5');
  await shot(ops, '07-console-client', true);

  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Clients' }).click();
  await ops.getByLabel('Search clients').fill(client);
  await expect(ops.locator('[data-console-clients]').getByRole('link', { name: client })).toBeVisible();
  await shot(ops, '08-console-clients');
  await axe(ops);

  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Overview' }).click();
  await expect(ops.getByRole('heading', { name: 'Plans sold' })).toBeVisible();
  await shot(ops, '04-console-overview');
  await axe(ops);
});
