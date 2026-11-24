import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  // Next sets the tab title again after a soft navigation (a tab change); check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * Console notifications (ADR 0074, C3b): a new client and an unusual sign-in reach the operator through the worker,
 * show on the bell and the menu badge, open what they are about and turn read; each operator chooses the Console,
 * email, both or neither per type, and the choice is kept.
 */
test('Console notifications: the bell, the notifications page and preferences', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-notify-${suffix}@platform.test`;
  const password = 'operator-password-1';
  const org = `Heron Mills ${suffix}`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: password, OPERATOR_NAME: 'Wren Notify', OPERATOR_ROLE: 'ADMIN' },
  });

  // Three wrong passwords, then the right one: an unusual sign-in.
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  for (let i = 0; i < 3; i++) {
    await ops.getByLabel('Email').fill(email);
    await ops.getByLabel('Password').fill('not-the-password');
    const refused = ops.waitForResponse((r) => r.url().endsWith('/operator/login') && r.status() === 401);
    await ops.getByRole('button', { name: 'Sign in' }).click();
    await refused;
  }
  await expect(ops.getByText('Email or password is incorrect.')).toBeVisible();
  await ops.getByLabel('Password').fill(password);
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // A new client signs up.
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, org);

  // ── The notifications page: both arrive from the worker ──
  const nav = ops.getByRole('navigation', { name: 'Operator' });
  await nav.getByRole('link', { name: 'Notifications' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  const joined = ops.locator('[data-notification="client.created"]', { hasText: `New client: ${org}` });
  const unusual = ops.locator('[data-notification="signin.unusual"]', { hasText: email });
  await expect(async () => {
    await ops.reload();
    await expect(joined).toBeVisible({ timeout: 3_000 });
    await expect(unusual.first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await expect(joined).toHaveAttribute('data-read', 'no');
  await expect(nav.locator('[data-nav-item="notifications"]')).not.toHaveAttribute('data-notifications-unread', '0');
  await axe(ops);
  await shot(ops, '18-console-notifications');

  // ── The bell: the count, the latest and opening one ──
  const bell = ops.locator('[data-notification-bell]');
  await expect(bell).toHaveAccessibleName(/Notifications, \d+ unread/);
  await bell.click();
  const panel = ops.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText(`New client: ${org}`)).toBeVisible();
  await axe(ops);
  await shot(ops, '17-console-notification-bell');
  await panel.getByText(`New client: ${org}`).click();
  await expect(ops).toHaveURL(/\/operator\/clients\/[0-9a-f-]+$/);
  await expect(ops.getByRole('heading', { level: 1, name: org })).toBeVisible();

  // Opened, so read; Unread no longer lists it.
  await ops.goto('/operator/notifications?tab=unread');
  await expect(ops.getByRole('tab', { name: 'Unread' })).toHaveAttribute('aria-selected', 'true');
  await expect(unusual.first()).toBeVisible();
  await expect(joined).toHaveCount(0);
  // Opening the page a notification points to reads it too (ADR 0075): the unusual sign-ins are about Security.
  await ops.goto('/operator/security');
  await expect(ops.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(async () => {
    await ops.goto('/operator/notifications?tab=unread');
    await expect(ops.getByRole('tab', { name: 'Unread' })).toHaveAttribute('aria-selected', 'true');
    await expect(unusual).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  // Whatever else arrived meanwhile (other clients' new workspaces), "Mark all read" clears.
  const markAll = ops.getByRole('button', { name: 'Mark all read' });
  await expect(async () => {
    if ((await markAll.isVisible()) && (await markAll.isEnabled())) await markAll.click();
    await expect(ops.getByText('You are all caught up')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(bell).toHaveAccessibleName('Notifications');

  // ── Preferences: per type, kept after a reload ──
  await ops.getByRole('tab', { name: 'Preferences' }).click();
  const newClient = ops.locator('[data-pref="client.created"]');
  await expect(newClient.getByLabel('New client in the Console')).toBeChecked();
  await expect(newClient.getByLabel('New client by email')).not.toBeChecked();
  await expect(ops.locator('[data-pref="payment.failed"]').getByLabel('Payment failed by email')).toBeChecked();
  const saved = () => ops.waitForResponse((r) => r.url().endsWith('/operator/me/notification-preferences') && r.request().method() === 'PUT' && r.ok());
  let done = saved();
  await newClient.getByLabel('New client by email').click();
  await done;
  await expect(newClient.getByLabel('New client by email')).toBeChecked();
  done = saved();
  await newClient.getByLabel('New client in the Console').click();
  await done;
  await expect(newClient.getByLabel('New client in the Console')).not.toBeChecked();
  await axe(ops);
  await shot(ops, '19-console-notification-preferences');
  await ops.reload();
  await expect(newClient.getByLabel('New client in the Console')).not.toBeChecked();
  await expect(newClient.getByLabel('New client by email')).toBeChecked();
});
