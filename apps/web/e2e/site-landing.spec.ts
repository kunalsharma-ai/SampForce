import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  // Fades still run with reduced motion (only movement stops), so wait for the finite ones to end before scanning.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * The public website's Aurora redesign (ADR 0078): its own light and dark modes, the sign-in and sign-up portal that
 * opens over the page, and Help & Support for people who are not signed in, read in the Console.
 */
test('the home page: light and dark, the sign-up portal step by step, and signing in', async ({ browser }) => {
  test.setTimeout(120_000);
  // Reduced motion: axe must not scan cards that are still fading in (their colours are mid-blend).
  const ctx = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Close smarter.');
  const root = page.locator('[data-site-root]');
  // Follows the device until the visitor picks a mode, then keeps their choice.
  await expect(root).toHaveAttribute('data-sfx-mode', 'light');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await axe(page);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(root).toHaveAttribute('data-sfx-mode', 'dark');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(root).toHaveAttribute('data-sfx-mode', 'dark');
  await axe(page);
  for (const name of ['Core CRM', 'Revenue Copilot', 'Automation Studio', 'Built for teams']) await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();

  // ── Create a workspace, one question at a time ──
  await page.getByRole('banner').getByRole('link', { name: 'Start free' }).click();
  await expect(page).toHaveURL(/#start$/);
  const portal = page.getByRole('dialog', { name: 'Create your workspace' });
  await expect(portal.getByRole('tab', { name: 'Create workspace' })).toHaveAttribute('aria-selected', 'true');
  await expect(portal.getByText('Step 1 of 4')).toBeVisible();
  await expect(portal.getByLabel('Your name')).toBeFocused();
  await shot(page, 'portal-sign-up-1');
  await portal.getByRole('button', { name: 'Continue' }).click();
  await expect(portal.getByText('Enter your name')).toBeVisible();
  await portal.getByLabel('Your name').fill('Asha Rao');
  await portal.getByLabel('Your name').press('Enter');
  await expect(portal.getByText('Step 2 of 4')).toBeVisible();
  const email = `site-${Date.now().toString(36)}@example.com`;
  await portal.getByLabel('Work email').fill(email);
  await portal.getByRole('button', { name: 'Continue' }).click();
  await expect(portal.getByText('Step 3 of 4')).toBeVisible();
  await portal.getByLabel('Password', { exact: true }).fill('short');
  await expect(portal.locator('[data-password-strength]')).toHaveAttribute('data-password-strength', '1');
  await portal.getByRole('button', { name: 'Continue' }).click();
  await expect(portal.getByText('Use at least 10 characters')).toBeVisible();
  await portal.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await expect(portal.locator('[data-password-strength]')).toHaveAttribute('data-password-strength', '3');
  await shot(page, 'portal-sign-up-password');
  await portal.getByRole('button', { name: 'Continue' }).click();
  await expect(portal.getByText('Step 4 of 4')).toBeVisible();
  // Back keeps what was typed.
  await portal.getByRole('button', { name: 'Back' }).click();
  await expect(portal.getByLabel('Password', { exact: true })).toHaveValue('correcthorse1');
  await portal.getByRole('button', { name: 'Continue' }).click();
  await portal.getByLabel('Organization name').fill('Aurora Labs');
  await expect(portal.locator('[data-workspace-preview]')).toContainText('Aurora Labs');
  await expect(portal.locator('[data-workspace-preview]')).toContainText('AL');
  await axe(page);
  await shot(page, 'portal-sign-up-workspace');
  await portal.getByRole('button', { name: 'Create workspace' }).click();
  await expect(portal.getByText('Your workspace is ready')).toBeVisible();
  await expect(page).toHaveURL(/\/app\?welcome=1/);
  await expect(page.getByRole('heading', { name: 'What is happening across the organisation?', level: 1 })).toBeVisible();
  await ctx.close();

  // ── Sign in from a shared #sign-in link, with a wrong password first ──
  const again = await (await browser.newContext({ colorScheme: 'dark' })).newPage();
  await again.goto('/#sign-in');
  const signIn = again.getByRole('dialog', { name: 'Sign in' });
  await expect(signIn.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
  await expect(signIn.getByLabel('Work email')).toBeFocused();
  await signIn.getByLabel('Work email').fill(email);
  await signIn.getByLabel('Password', { exact: true }).fill('wrong-password-1');
  await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(signIn.getByRole('alert')).toBeVisible();
  await shot(again, 'portal-sign-in-error');
  // Switching sides keeps the URL in step.
  await signIn.getByRole('tab', { name: 'Create workspace' }).click();
  await expect(again).toHaveURL(/#start$/);
  await again.getByRole('dialog').getByRole('tab', { name: 'Sign in' }).click();
  await expect(again).toHaveURL(/#sign-in$/);
  await again.getByLabel('Work email').fill(email);
  await again.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await axe(again);
  await again.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(again).toHaveURL(/\/app$/);
});

test('the portal closes with Escape and the links still work without it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).toHaveURL('http://localhost:3000/');
  // The plain links go to the full pages, for new tabs and for people without scripts.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/signup');
});

test('Help & Support: answers for signed-out visitors, and a message the Console reads and handles', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext({ colorScheme: 'dark' })).newPage();
  await page.goto('/');
  await page.locator('[data-site-help-button]').click();
  const help = page.getByRole('dialog', { name: 'Help & Support' });
  await expect(help.getByRole('tab', { name: 'Answers' })).toHaveAttribute('aria-selected', 'true');
  await help.getByLabel('Search help').fill('okta');
  await expect(help.locator('[data-site-faqs] > li')).toHaveCount(1);
  await help.getByRole('button', { name: 'My company uses single sign-on. How do I sign in?' }).click();
  await expect(help.getByRole('link', { name: 'Sign in with SSO' }).last()).toHaveAttribute('href', '/login/sso');
  await shot(page, 'help-answers');
  await help.getByLabel('Search help').fill('zebra crossing');
  await expect(help.getByText('No answer matches that yet.')).toBeVisible();
  await help.getByRole('button', { name: 'Ask us instead' }).click();

  await expect(help.getByRole('tab', { name: 'Message us' })).toHaveAttribute('aria-selected', 'true');
  await help.getByRole('button', { name: 'Send message' }).click();
  await expect(help.getByText('Enter your name')).toBeVisible();
  const tag = Date.now().toString(36);
  await help.getByLabel('Your name').fill('Rohan Visitor');
  await help.getByLabel('Work email').fill(`rohan-${tag}@example.com`);
  await help.getByLabel('What is it about?').selectOption('SALES');
  await help.getByLabel('Your message').fill(`We are a team of 40 and want a demo (${tag}).`);
  await axe(page);
  await shot(page, 'help-message');
  await help.getByRole('button', { name: 'Send message' }).click();
  const sent = help.locator('[data-site-help-sent]');
  await expect(sent).toContainText('Message sent');
  const reference = (await sent.getAttribute('data-site-help-sent'))!;
  expect(reference).toMatch(/^SF-[A-Z0-9]{6}$/);
  await expect(sent).toContainText(reference);
  await shot(page, 'help-message-sent');

  // ── The Console reads it under Support tickets > Website messages ──
  const opsEmail = `ops-site-${tag}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: opsEmail, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Maya Support', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(opsEmail);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await ops.goto('/operator/support');
  await ops.getByRole('button', { name: 'Website messages' }).click();
  await expect(ops).toHaveURL(/view=website/);
  await ops.getByLabel('Search website messages').fill(tag);
  const row = ops.locator(`[data-site-message="${reference}"]`);
  await expect(row).toContainText('Rohan Visitor');
  await expect(row).toContainText('Talking to sales');
  await expect(row.getByRole('link', { name: `Reply to rohan-${tag}@example.com` })).toHaveAttribute('href', new RegExp(`^mailto:rohan-${tag}@example.com`));
  await axe(ops);
  await shot(ops, 'console-website-messages');
  await row.getByRole('button', { name: 'Mark handled' }).click();
  await expect(row).toHaveCount(0);
  await ops.getByRole('tab', { name: /Handled/ }).click();
  await expect(ops.locator(`[data-site-message="${reference}"]`)).toContainText('Handled by Maya Support');
});
