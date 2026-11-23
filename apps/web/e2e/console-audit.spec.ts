import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  // Next sets the tab title again after a soft navigation (a tab or the entry drawer); check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * Activity & audit log (ADR 0074, C3): a change on the Security page shows in the audit log with what it was about
 * and its values before and after, the log searches and exports CSV, and the activity feed shows a new client
 * joining and the operator's change.
 */
test('Console audit log: before and after, search, CSV export and the activity feed', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-audit-${suffix}@platform.test`;
  const password = 'operator-password-1';
  const org = `Juniper Panels ${suffix}`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: password, OPERATOR_NAME: 'Iris Audit', OPERATOR_ROLE: 'ADMIN' },
  });
  // A new client signs up.
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, org);

  const ops = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill(password);
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // ── A change to record: the idle time on the Security page ──
  const nav = ops.getByRole('navigation', { name: 'Operator' });
  await nav.getByRole('link', { name: 'Security' }).click();
  // The policy is shared by every test (and a retry), so change it from whatever it is now.
  const idleSelect = ops.getByLabel('End a session after');
  const was = await idleSelect.inputValue();
  const now = was === '120' ? '60' : '120';
  await idleSelect.selectOption(now);
  await expect(idleSelect).toBeEnabled();

  // ── The audit log: search, what it was about, before and after ──
  await nav.getByRole('link', { name: 'Activity & audit log' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Activity & audit log' })).toBeVisible();
  await expect(ops.getByRole('tab', { name: 'Audit log' })).toHaveAttribute('aria-selected', 'true');
  await ops.getByLabel('Search', { exact: true }).fill(email);
  await ops.getByLabel('About', { exact: true }).selectOption({ label: 'Setting' });
  const row = ops.locator('[data-platform-entry="console.security_policy_changed"]').first();
  await expect(row).toContainText('Changed the security policy');
  await expect(row).toContainText('Iris Audit');
  await expect(row.locator('[data-platform-target]')).toContainText('Security policy');
  await expect(ops.locator('[data-platform-entry]').filter({ hasNotText: 'Iris Audit' })).toHaveCount(0);
  await axe(ops);
  await shot(ops, '14-console-audit-log');

  await row.getByRole('button', { name: /^Details: Changed the security policy/ }).click();
  const drawer = ops.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Changed the security policy' })).toBeVisible();
  const idle = drawer.locator('[data-diff-field="idleMinutes"]');
  await expect(idle).toHaveAttribute('data-changed', 'yes');
  await expect(idle.locator('del')).toHaveText(was);
  await expect(idle.locator('ins')).toHaveText(now);
  await expect(drawer).toContainText('Iris Audit');
  await expect(ops).toHaveURL(/entry=/);
  await axe(ops);
  await shot(ops, '15-console-audit-entry');
  await ops.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // ── CSV export of what the filters show ──
  const download = ops.waitForEvent('download');
  await ops.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^sampforce-audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await file.path())!, 'utf8');
  expect(csv).toContain('"When (UTC)","Operator"');
  expect(csv).toContain('console.security_policy_changed');

  // ── Activity: the new client and the operator's change ──
  await ops.getByRole('tab', { name: 'Activity' }).click();
  const feed = ops.locator('[data-activity-feed]');
  await expect(feed.locator('[data-activity="operator.action"]', { hasText: 'Iris Audit: Changed the security policy' }).first()).toBeVisible();
  await feed.getByRole('button', { name: 'Clients' }).click();
  await expect(feed.getByRole('button', { name: 'Clients' })).toHaveAttribute('aria-pressed', 'true');
  await expect(feed.locator('[data-activity="client.joined"]', { hasText: org })).toBeVisible();
  await expect(feed.locator('[data-category]:not([data-category="clients"])')).toHaveCount(0);
  await axe(ops);
  await shot(ops, '16-console-activity');

  // Put the idle time back for the other tests.
  await nav.getByRole('link', { name: 'Security' }).click();
  await ops.getByLabel('End a session after').selectOption({ label: '1 hour idle' });
  await expect(ops.getByLabel('End a session after')).toHaveValue('60');
});
