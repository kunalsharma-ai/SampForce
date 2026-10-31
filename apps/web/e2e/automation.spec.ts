import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

async function apiPost(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return res.json();
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('builds, simulates and runs a workflow from the studio', async ({ page }) => {
  await signUp(page, 'Studio Flow');
  await page.goto('/app/automation');
  await expect(page.getByRole('heading', { level: 1, name: 'Automation Studio' })).toBeVisible();
  await expect(page.getByText('No workflows yet.')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('link', { name: 'New workflow' }).click();
  await page.getByLabel('Name').fill('Call big leads');
  await page.getByLabel('Trigger').selectOption('lead.created');
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Field', { exact: true }).selectOption('record.estimatedValue');
  await page.getByLabel('Operator').selectOption('gte');
  await page.getByLabel('Value').fill('50000');
  await page.getByRole('button', { name: 'Add the first step' }).click();
  await page.getByLabel('Task title').fill('Call {{record.fullName}} now');
  await page.getByLabel('Step type').last().selectOption('delay');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(page.getByTestId('step-delay_1')).toBeVisible();
  await page.getByLabel('Step type').last().selectOption('action');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(page.getByTestId('step-action_2')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Create workflow' }).click();
  await expect(page).toHaveURL(/\/app\/automation\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Draft')).toBeVisible();

  // Simulate against a real lead before going live.
  const lead = (await apiPost(page, '/leads', { fullName: 'Grace Big', estimatedValue: 120000 })).lead;
  await page.getByRole('tab', { name: 'Simulate' }).click();
  await page.getByRole('combobox', { name: 'Record' }).fill('Grace');
  await page.getByRole('option', { name: /Grace Big/ }).click();
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.getByText('Create task "Call Grace Big now"')).toBeVisible();
  await expect(page.getByText(/Would wait until/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  const hot = (await apiPost(page, '/leads', { fullName: 'Hedy Hot', estimatedValue: 90000 })).lead;
  await apiPost(page, '/leads', { fullName: 'Cole Cold', estimatedValue: 10 });
  await page.getByRole('tab', { name: 'Run history' }).click();
  await expect(page.getByRole('button', { name: /Waiting/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Waiting/ })).toHaveCount(1);
  await expectNoA11yViolations(page);

  await page.goto(`/app/leads/${hot.id}`);
  await expect(page.getByText('Call Hedy Hot now')).toBeVisible();
  await page.goto(`/app/leads/${lead.id}`);
  await expect(page.getByText('Call Grace Big now')).toHaveCount(0);
});

test('waits for approval before emailing and reports why a run failed', async ({ page }) => {
  await signUp(page, 'Approval Flow');
  await page.goto('/app/automation');
  await page.getByRole('link', { name: 'Use template: Welcome new contacts' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Welcome new contacts');
  await expect(page.getByText('Needs approval each run')).toBeVisible();
  await page.getByRole('button', { name: 'Create workflow' }).click();
  await expect(page).toHaveURL(/\/app\/automation\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await apiPost(page, '/contacts', { firstName: 'Nina', lastName: 'New', email: 'nina@buyer.test' });
  await page.goto('/app/approvals');
  await expect(page.getByRole('heading', { name: /Email the record: "Great to meet you" to nina@buyer.test/ })).toBeVisible({ timeout: 20_000 });
  await expectNoA11yViolations(page);

  // The bell shows the approval request.
  await page.reload();
  await page.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
  await expect(page.getByRole('menuitem', { name: /Approval needed/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Nothing is waiting for approval.')).toBeVisible();

  // No mailbox is connected, so the run fails with a clear reason instead of pretending to send.
  await expect(async () => {
    await page.reload();
    await page.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
    await expect(page.getByRole('menuitem', { name: /Workflow "Welcome new contacts" failed/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('menuitem', { name: /Workflow "Welcome new contacts" failed/ }).click();
  await expect(page).toHaveURL(/\?run=/);
  await expect(page.getByText(/Connect your Google or Microsoft mailbox/).first()).toBeVisible();
});

test('integrations show mailbox set-up honestly and manage signed webhooks', async ({ page }) => {
  await signUp(page, 'Integrations Flow');
  await page.goto('/app/integrations');
  await expect(page.getByRole('heading', { name: 'Your mailbox and calendar' })).toBeVisible();
  await expect(page.getByText('Not set up on this installation')).toHaveCount(2);
  await expect(page.getByText(/An operator must add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  await page.getByLabel('Endpoint URL').fill('http://127.0.0.1:9/dealflow');
  await page.getByLabel('lead.created').check();
  await page.getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByText('Signing secret, shown once.')).toBeVisible();
  await expect(page.locator('code', { hasText: 'whsec_' })).toBeVisible();
  await expect(page.getByText('http://127.0.0.1:9/dealflow')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.reload();
  await expect(page.locator('code', { hasText: 'whsec_' })).toHaveCount(0);

  await page.goto('/app/communication');
  await expect(page.getByText('No mailbox connected.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compose' })).toBeDisabled();
  await expectNoA11yViolations(page);
  await page.goto('/app/meetings');
  await expect(page.getByText('No upcoming meetings with contacts.')).toBeVisible();
  await expectNoA11yViolations(page);
});
