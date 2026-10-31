import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://dealflow_app:dealflow_app_dev@localhost:5432/dealflow';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('public landing and pricing pages are honest about the launch preview', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('http://localhost:3000/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Close smarter');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pricing' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pricing' })).toBeVisible();
  await expect(page.getByText('Launch pricing preview.')).toBeVisible();
  const growth = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Growth' }) });
  await expect(growth.getByText('$12')).toBeVisible();
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await expect(growth.getByText('$15')).toBeVisible();
  await expect(page.getByText('Quoted individually')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('billing page, trial, onboarding checklist and a custom role', async ({ page }) => {
  await signUp(page, 'Billing Flow');
  const checklist = page.getByRole('heading', { name: 'Get your workspace ready' });
  await expect(checklist).toBeVisible();
  await expect(page.getByText('Create your first deal')).toBeVisible();

  await page.goto('/app/billing');
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await expect(page.getByText('Plans are paid by bank transfer.')).toBeVisible();
  await expect(page.getByText('Proposed launch pricing')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Seats in use' })).toBeVisible();
  await expectNoA11yViolations(page);

  const pro = page.getByRole('listitem').filter({ hasText: 'Professional' });
  await pro.getByRole('button', { name: /Try free for 14 days/ }).click();
  await expect(page.getByText(/You are trying DealFlow Professional until/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Try free/ })).toHaveCount(0);

  await page.goto('/app/team');
  await page.getByRole('button', { name: 'New custom role' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Deal desk');
  await page.getByRole('group', { name: 'Permissions' }).locator('label', { hasText: /^read$/ }).first().check();
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('button', { name: 'Edit Deal desk' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/app');
  await page.getByRole('button', { name: 'Hide checklist' }).click();
  await expect(checklist).toHaveCount(0);
});

test('operator console: sign-in, workspace list, support access and an audited override', async ({ page, browser }) => {
  const email = `ops-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: databaseUrl, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Operator', OPERATOR_ROLE: 'ADMIN' },
  });

  await signUp(page, 'Operated Workspace');
  await page.goto('/app/administration');
  await page.getByLabel('Reason').fill('Investigating an import problem');
  await page.getByRole('button', { name: 'Grant access' }).click();
  await expect(page.getByText(/On until/)).toBeVisible();

  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator');
  await expect(ops).toHaveURL(/\/operator\/login/);
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
  await ops.getByLabel('Search workspaces').fill('Operated Workspace');
  await ops.getByRole('link', { name: 'Operated Workspace' }).first().click();
  await expect(ops.getByText('Granted by the workspace until')).toBeVisible();
  await expect(ops.getByText('Investigating an import problem').or(ops.getByText('support_access.granted'))).toBeVisible();
  await expectNoA11yViolations(ops);

  await ops.getByLabel('Plan').selectOption('business');
  await ops.getByLabel('Seats').fill('12');
  await ops.getByLabel('Reason (recorded in both audit logs)').fill('Annual order form signed');
  await ops.getByRole('button', { name: 'Apply' }).click();
  await expect(ops.getByText(/business · 12 seats · managed manually/)).toBeVisible();

  await ops.getByRole('link', { name: 'Operator log' }).click();
  await expect(ops.getByText('tenant.plan_overridden').first()).toBeVisible();

  await page.goto('/app/billing');
  await expect(page.getByText(/managed by the DealFlow team/).first()).toBeVisible();
});

test('pay by invoice: the workspace requests an invoice and the plan starts when an operator records the payment', async ({ page, browser }) => {
  const email = `ops-pay-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: databaseUrl, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Payments', OPERATOR_ROLE: 'ADMIN' },
  });
  const workspace = `Invoice Buyer ${Date.now()}`;
  await signUp(page, workspace);
  await page.goto('/app/billing');
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await page.getByLabel('Seats', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Request invoice for Growth, $30.00' }).click();
  const invoice = page.locator('[aria-labelledby="open-invoice-heading"]');
  await expect(invoice.getByText('$30.00')).toBeVisible();
  await expect(invoice.getByText('Waiting for payment')).toBeVisible();
  await expect(page.getByText('The DealFlow team will send payment details for this invoice.')).toBeVisible();
  const number = (await page.locator('#open-invoice-heading').textContent())!.match(/DF-\d{6}/)![0];
  await expectNoA11yViolations(page);

  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { name: /Waiting for payment/ })).toBeVisible();
  await ops.getByRole('listitem').filter({ hasText: number }).getByRole('link', { name: workspace }).click();
  await ops.getByLabel('Bank or transfer reference').fill('UTR-E2E-1');
  await ops.getByRole('button', { name: 'Mark paid' }).click();
  await expect(ops.getByText(/growth · 2 seats · paid by invoice/)).toBeVisible();
  await expect(ops.getByText('ref UTR-E2E-1')).toBeVisible();
  await expectNoA11yViolations(ops);

  await page.reload();
  await expect(page.getByText('Paid by invoice', { exact: true })).toBeVisible();
  await expect(page.getByText(/2 seats · monthly · paid until/)).toBeVisible();
  await expect(page.locator('#open-invoice-heading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Request invoice for Growth/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Renew Growth, $30.00' })).toBeVisible();
});
