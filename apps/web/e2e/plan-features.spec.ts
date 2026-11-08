import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { setPlan, signUp } from './helpers';

const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://dealflow_app:dealflow_app_dev@localhost:5432/dealflow';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** Plan features (ADR 0057): what a plan leaves out is locked in the app, and the platform admin decides what is in. */
test('a Free workspace sees what its plan leaves out, and gets it when the plan or the operator adds it', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Plan Locks Ltd', { plan: 'free' });

  // The sidebar marks modules outside the plan, and the page itself explains the plan instead of failing.
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: /^Email Sequences/ }).locator('[data-nav-locked]')).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Leads/ }).locator('[data-nav-locked]')).toHaveCount(0);
  await page.goto('/app/sequences');
  const locked = page.locator('[data-feature-locked="sequences"]');
  await expect(locked.getByText('Email sequences is not in your plan')).toBeVisible();
  await expect(locked.getByText('Your workspace is on the Free plan.')).toBeVisible();
  await expect(locked.getByText('Email sequences is included from the Launch plan.')).toBeVisible();
  await expectNoA11yViolations(page);
  await locked.getByRole('link', { name: 'See plans and upgrade' }).click();
  await expect(page).toHaveURL(/\/app\/billing/);
  const list = page.locator('[data-billing-features]');
  await expect(list.getByText('Features in your plan')).toBeVisible();
  await expect(list.locator('[data-feature="reports"][data-included="yes"]')).toBeVisible();
  await expect(list.locator('[data-feature="sequences"][data-included="no"]')).toBeVisible();

  // The Launch plan includes sequences: the page opens.
  await setPlan(page, 'launch');
  await page.goto('/app/sequences');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[data-feature-locked]')).toHaveCount(0);
  await setPlan(page, 'free');

  // The platform admin turns one feature on for this workspace only, with a reason in both audit logs.
  const email = `ops-feat-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: databaseUrl, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Operator', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('link', { name: 'Plans' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Plans' })).toBeVisible();
  await expect(ops.locator('[data-plan="free"][data-feature="reports"]')).toContainText('✓');
  await expect(ops.locator('[data-plan="free"][data-feature="sequences"]')).not.toContainText('✓');
  await expectNoA11yViolations(ops);

  await ops.getByRole('link', { name: 'Workspaces' }).click();
  await ops.getByLabel('Search workspaces').fill('Plan Locks Ltd');
  await ops.getByRole('link', { name: 'Plan Locks Ltd' }).first().click();
  const features = ops.locator('[data-operator-features]');
  await features.getByLabel('Email sequences for this workspace').selectOption('on');
  await features.getByLabel('Reason (recorded in both audit logs)').fill('Pilot of sequences agreed with sales');
  await features.getByRole('button', { name: 'Apply 1 change' }).click();
  await expect(features.getByText('added')).toBeVisible();

  await page.goto('/app/sequences');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[data-feature-locked]')).toHaveCount(0);
  await page.goto('/app/billing');
  await expect(page.locator('[data-billing-features] [data-feature="sequences"]')).toContainText('added for your workspace');
});

test('the pricing page compares plans feature by feature', async ({ page }) => {
  await page.goto('/pricing');
  const table = page.locator('[data-pricing-features]');
  await expect(table.getByRole('rowheader', { name: 'Email sequences' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Enterprise Plus' })).toBeVisible();
});
