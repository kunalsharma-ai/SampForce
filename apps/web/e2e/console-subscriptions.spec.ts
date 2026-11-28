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
  const email = `ops-k4-${role.toLowerCase()}-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Bea Billing', OPERATOR_ROLE: role },
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
 * Subscriptions & billing (control-center K4): clients by subscription state, changes over a period, the agreed
 * monthly value and the work lists, each leading to the client's Subscription tab.
 */
test('Subscriptions & billing: states, changes, monthly value and work lists', async ({ page: ops }) => {
  test.setTimeout(120_000);
  await signIn(ops, operator('ADMIN'));
  const stamp = Date.now().toString().slice(-6);
  const make = async (name: string, extra: object) => {
    const res = await ops.request.post('/api/v1/operator/clients', {
      headers: { origin: 'http://localhost:3000' },
      data: { organisation: { name }, administrator: { name: 'Bo Billing', email: `bo-${name.replace(/\W/g, '').toLowerCase()}@client.test` }, planCode: 'growth', seats: 4, reason: 'New client', ...extra },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { client: { id: string } }).client.id;
  };
  const trialName = `Trialling Co ${stamp}`;
  const trial = await make(trialName, { paymentStatus: 'PAID' });
  const t = await ops.request.post(`/api/v1/operator/clients/${trial}/subscription/trial`, { headers: { origin: 'http://localhost:3000' }, data: { days: 6, reason: 'Six-day evaluation' } });
  expect(t.status()).toBe(200);
  await make(`Overdue Co ${stamp}`, { paymentStatus: 'OVERDUE', priceCents: 90_000, currency: 'EUR' });

  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Subscriptions & billing' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Subscriptions & billing' })).toBeVisible();
  await expect(ops.locator('[data-state-count="TRIAL"]')).not.toContainText(/^Trial0$/);
  await expect(ops.locator('[data-movement="Trials started"] dd')).not.toHaveText('0');
  await expect(ops.locator('[data-monthly-value] [data-value-currency="EUR"]')).toBeVisible();
  const trials = ops.locator('[data-work-list="trials"]');
  await expect(trials.getByRole('link', { name: trialName })).toBeVisible();
  await expect(ops.locator('[data-work-list="payments"]').getByRole('link', { name: `Overdue Co ${stamp}` })).toBeVisible();
  await shot(ops, 'k4-01-subscriptions', true);
  await axe(ops);

  // Another period reloads the changes.
  await ops.getByLabel('Period').selectOption('7');
  await expect(ops.locator('[data-subscription-movements] h2')).toHaveText('Changes over the last 7 days');

  // A client in a list opens on its Subscription tab.
  await trials.getByRole('link', { name: trialName }).click();
  await expect(ops.getByRole('heading', { level: 1, name: trialName })).toBeVisible();
  await expect(ops.getByRole('tab', { name: 'Subscription' })).toHaveAttribute('aria-selected', 'true');
  await expect(ops.locator('[data-subscription-history] [data-subscription-event="TRIAL_STARTED"]')).toBeVisible();

  // A state opens the clients list filtered to it.
  await ops.goBack();
  await ops.locator('[data-state-count="TRIAL"]').click();
  await expect(ops).toHaveURL(/\/operator\/clients\?subscription=TRIAL/);
  await expect(ops.getByLabel('Subscription')).toHaveValue('TRIAL');
  await ops.getByLabel('Search clients').fill(trialName);
  await expect(ops.locator('[data-console-clients] tbody tr')).toHaveCount(1);
  await shot(ops, 'k4-02-clients-by-subscription');
});

test('an operator without billing figures sees the states but not the money', async ({ page: ops }) => {
  await signIn(ops, operator('SUPPORT'));
  await ops.goto('/operator/subscriptions');
  await expect(ops.getByRole('heading', { level: 1, name: 'Subscriptions & billing' })).toBeVisible();
  await expect(ops.locator('[data-subscription-states]')).toBeVisible();
  await expect(ops.locator('[data-monthly-value]')).toContainText('Your role does not include billing figures.');
});
