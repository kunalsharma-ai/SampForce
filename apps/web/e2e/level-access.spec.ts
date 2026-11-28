import { execFileSync } from 'node:child_process';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/*
 * Section and field access per level (redesign R8, ADR 0092): the Console Admin ticks, on the client's profile, which
 * sections and record fields its Executive Workspaces may see. The executive's menu, pages and records follow at once;
 * the Super Workspace keeps everything. The client's own Settings has no switch for it.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.setItem('sf.companyMore', 'open'));
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' }).first();

test('the Console decides which sections and fields an Executive Workspace sees', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, `Access Research ${stamp}`);
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const ws = await (await page.request.post('/api/v1/workspaces', { data: { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } }, headers: ORIGIN })).json();
  const grant = await page.request.put(`/api/v1/workspaces/${ws.id}/permissions`, { data: { actions: me.workspace.actions, features: me.tenant.features }, headers: ORIGIN });
  expect(grant.ok(), await grant.text()).toBe(true);
  const priya = await join(browser, ws.inviteUrl, 'Priya Sharma');
  const priyaMe = await (await priya.request.get('/api/v1/auth/me')).json();
  const company = await (
    await page.request.post('/api/v1/companies', { data: { name: `Kite Insights ${stamp}`, primaryEmail: 'hello@kite.test', primaryPhone: '+919876543210', industry: 'Market research', ownerId: priyaMe.user.id }, headers: ORIGIN })
  ).json();

  // Before: the executive has Email Finder in the menu and sees the company's email.
  await priya.goto('/app');
  await expect(sidebar(priya).getByRole('link', { name: /^Email Finder/ })).toBeVisible();
  await priya.goto(`/app/companies/${company.id}`);
  await expect(priya.getByRole('link', { name: 'hello@kite.test' }).first()).toBeVisible();

  // The client's Settings has no switch for sections.
  await page.goto('/app/settings');
  await expect(page.locator('[data-menu-sections]')).toHaveCount(0);

  // ── The Console Admin opens the client's profile and unticks Email Finder and the company email for executives ──
  const email = `ops-access-${String(stamp).slice(-6)}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Ola Access', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15_000 });
  await ops.goto(`/operator/clients/${me.tenant.id}?tab=workspaces`);
  const card = ops.locator('[data-client-workspace-rules]');
  const matrix = card.locator('[data-access-matrix]');
  await expect(matrix).toBeVisible();
  await expect(matrix.locator('[data-access-summary]')).toHaveText('Manager: everything · Executive: everything');
  await matrix.locator('[data-access-group="Engage"] summary').click();
  const finder = matrix.getByRole('checkbox', { name: 'Executive Workspaces may see Email finder' });
  await expect(finder).toBeChecked();
  await finder.uncheck();
  await expect(matrix.getByRole('checkbox', { name: 'Manager Workspaces may see Email finder' })).toBeChecked();
  await matrix.locator('[data-access-entity="company"] summary').click();
  await matrix.getByRole('checkbox', { name: 'Executive Workspaces may see Company Email' }).uncheck();
  await expect(matrix.locator('[data-access-summary]')).toHaveText('Manager: everything · Executive: 2 hidden');
  await card.getByLabel('Reason', { exact: true }).fill('Executives do not look up emails');
  await card.locator('[data-access-group="Engage"]').scrollIntoViewIfNeeded();
  await shot(ops, '01-console-access-grid');
  await card.getByRole('button', { name: 'Save for this client' }).click();
  await expect(card.getByText('Saved. It applies to the client on its next request.')).toBeVisible();
  await expect(card.getByText(/own executive access/)).toBeVisible();

  // Searching the grid finds a field across record types.
  await matrix.getByLabel('Find a section or field').fill('phone');
  await expect(matrix.locator('[data-access-field="company.primaryPhone"]')).toBeVisible();
  await expect(matrix.locator('[data-access-field="contact.phone"]')).toBeVisible();
  await expect(matrix.locator('[data-access-field="company.primaryEmail"]')).toHaveCount(0);
  await shot(ops, '02-console-access-search');
  await matrix.getByLabel('Find a section or field').fill('');

  // The Leads and Accounts switch lives here now.
  const sections = ops.locator('[data-client-menu-sections]');
  await expect(sections.getByRole('switch', { name: /Show the Inbound contacts page/ })).toBeChecked();
  await sections.scrollIntoViewIfNeeded();
  await shot(ops, '03-console-hidden-sections');

  // ── The executive: no Email Finder in the menu, the page is refused, the email is gone; the phone stays ──
  await priya.goto('/app');
  await expect(sidebar(priya).getByRole('link', { name: /^Dashboard/ })).toBeVisible();
  await expect(sidebar(priya).getByRole('link', { name: /^Email Finder/ })).toHaveCount(0);
  await priya.goto('/app/finder');
  await expect(priya.locator('[data-feature-locked]')).toBeVisible();
  await priya.goto(`/app/companies/${company.id}`);
  await expect(priya.getByRole('heading', { level: 1, name: company.name })).toBeVisible();
  await expect(priya.getByText('hello@kite.test')).toHaveCount(0);
  await expect(priya.getByText('+91').first()).toBeVisible();
  await shot(priya, '04-executive-company-without-email');

  // ── The Super Workspace still sees everything ──
  await page.goto(`/app/companies/${company.id}`);
  await expect(page.getByRole('link', { name: 'hello@kite.test' }).first()).toBeVisible();
  await page.goto('/app');
  await expect(sidebar(page).getByRole('link', { name: /^Email Finder/ })).toBeVisible();
  await shot(page, '05-super-still-sees-email-finder');
});
