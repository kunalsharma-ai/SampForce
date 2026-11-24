import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp, workspaceAction } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const CONTEXT = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' as const };

test.use(CONTEXT);

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function workspaceWithPerson(owner: Page, browser: Browser, input: { level: 'MANAGER' | 'EXECUTIVE'; name: string }, person: string) {
  const ws = await (await owner.request.post('/api/v1/workspaces', { data: { ...input, person: { inviteEmail: `${person.split(' ')[0]!.toLowerCase()}.${Date.now()}@example.com` } }, headers: ORIGIN })).json();
  const page = await (await browser.newContext(CONTEXT)).newPage();
  const accepted = await page.request.post('/api/v1/auth/invitations/accept', { data: { token: (ws.inviteUrl as string).split('/invite/')[1], name: person, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  return { id: ws.id as string, page };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Workspace management (sections 16-22): the Super Workspace blacklists a Manager Workspace until a day with its
 * password, and the manager is told until when. The Console lists every workspace, suspends one with the
 * operator's password (the client cannot lift it), sees its audit trail, and reactivates it.
 */
test('blacklists a team for a while, and the Console suspends and reactivates it', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const company = `Blockline Traders ${Date.now().toString().slice(-5)}`;
  await signUp(page, company, { autoConfirm: false });
  const north = await workspaceWithPerson(page, browser, { level: 'MANAGER', name: 'North Team' }, 'Rahul Sharma');

  // The Super Workspace blacklists North Team until a day: the day and a reason, then the password.
  await page.goto('/app/settings/workspaces');
  await workspaceAction(page, 'North Team', 'Blacklist for a while');
  const form = page.getByRole('dialog', { name: 'Blacklist North Team for a while' });
  await form.getByLabel('Blocked until').fill(inDays(10));
  await form.getByLabel('Reason').fill('Data quality review');
  await shot(page, '33-blacklist-workspace');
  await axe(page);
  await form.getByRole('button', { name: 'Continue' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm blacklist' });
  await confirm.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await confirm.getByRole('button', { name: 'Blacklist' }).click();
  const row = page.locator('[data-workspace="North Team"]');
  await expect(row.locator('[data-workspace-status]')).toContainText('Blacklisted until');
  await expect(row.locator('[data-blacklist-reason]')).toHaveText('Blacklisted: Data quality review');

  await north.page.goto('/app');
  await expect(north.page.getByText('Your workspace is blocked for now')).toBeVisible();
  await shot(north.page, '34-manager-sees-blacklist');
  await workspaceAction(page, 'North Team', 'Reactivate');
  await expect(row.locator('[data-workspace-status]')).toHaveText('Active');

  // The Console: every workspace of every client, with status, owner, users and parent.
  const opEmail = `ops-wm-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: opEmail, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Console Admin', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext(CONTEXT)).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(opEmail);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  // Signed in: the menu shows Workspace Management (the Overview's figures may still be loading).
  await ops.getByRole('link', { name: 'Workspace Management' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Workspace Management' })).toBeVisible();
  await ops.getByRole('textbox', { name: 'Search', exact: true }).fill(company);
  const table = ops.locator('[data-workspace-directory]');
  await expect(table.locator('[data-workspace-row]')).toHaveCount(2);
  const team = table.locator('[data-workspace-row="North Team"]');
  await expect(team).toContainText('Rahul Sharma');
  await expect(team).toContainText(company);
  await shot(ops, '35-console-workspace-management');
  await axe(ops);

  // Suspend with the operator's password.
  await ops.getByRole('button', { name: 'Actions for North Team' }).click();
  await ops.getByRole('menuitem', { name: 'Suspend' }).click();
  const suspend = ops.getByRole('dialog', { name: 'Suspend North Team' });
  await suspend.getByLabel('Reason').fill('Contract under review');
  await suspend.getByLabel('Your password').fill('operator-password-1');
  await shot(ops, '36-console-suspend-workspace');
  await suspend.getByRole('button', { name: 'Suspend' }).click();
  await expect(team.locator('[data-workspace-status]')).toHaveText('Suspended');

  // The client sees the Console's block and cannot lift it.
  await page.reload();
  await expect(row.locator('[data-console-lock]')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for North Team', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Reactivate', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The workspace page: status, people and the audit trail from both sides.
  await team.getByRole('link', { name: 'North Team' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'North Team' })).toBeVisible();
  const history = ops.locator('[data-workspace-history]');
  await expect(history).toContainText('deactivated by Console Admin');
  await expect(history).toContainText('blacklisted by');
  await expect(ops.locator('[data-status-reason]')).toHaveText('Reason: Contract under review');
  await shot(ops, '37-console-workspace-page');
  await axe(ops);
  await ops.getByRole('button', { name: 'Reactivate' }).click();
  const lift = ops.getByRole('dialog', { name: 'Reactivate North Team' });
  await lift.getByLabel('Reason').fill('Review finished');
  await lift.getByRole('button', { name: 'Reactivate' }).click();
  await expect(ops.locator('[data-workspace-summary] [data-workspace-status]')).toHaveText('Active');
  await north.page.reload();
  await expect(north.page.getByText('Your workspace is blocked for now')).toHaveCount(0);
});
