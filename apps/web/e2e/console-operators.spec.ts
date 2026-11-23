import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
/** Messages caught by the local stand-in email service (see playwright.config.ts). */
const MAILBOX = 'http://127.0.0.1:4401/messages';

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  // Next sets the tab title again after a soft navigation; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * Console roles and permissions (ADR 0074): a Super Admin invites an operator with a role, the invitee chooses a
 * password from the emailed link, sees only the menu their role allows, and a custom role is built from the matrix.
 */
test('Console operators: invite by link, roles, permission matrix and a menu per role', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-roles-${suffix}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Maya Console', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // ── Operators: everyone who can sign in, with their role ──
  const menu = ops.getByRole('navigation', { name: 'Operator' });
  await menu.getByRole('link', { name: 'Operators' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Operators' })).toBeVisible();
  const me = ops.locator(`[data-operator-row="${email}"]`);
  await expect(me).toContainText('(you)');
  await expect(me.locator('[data-operator-role]')).toHaveText('Super Admin');

  // ── Adding an operator emails them a one-time link ──
  const invitee = `fiona-${suffix}@platform.test`;
  await ops.getByRole('button', { name: 'Add operator' }).click();
  const dialog = ops.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Fiona Finance');
  await dialog.getByLabel('Work email').fill(invitee);
  await dialog.getByLabel('Role').selectOption({ label: 'Finance Admin' });
  await expect(dialog.locator('[data-role-summary]')).toContainText('Subscriptions, invoices and payments.');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(ops.getByRole('dialog')).toContainText(`We emailed the link to ${invitee}`);
  await ops.getByRole('button', { name: 'Done' }).click();
  const row = ops.locator(`[data-operator-row="${invitee}"]`);
  await expect(row).toContainText('Invited');
  await expect(row.locator('[data-operator-role]')).toHaveText('Finance Admin');
  await axe(ops);
  await shot(ops, '05-console-operators');

  // ── Roles & permissions: built-in roles, the matrix, and a custom role ──
  await menu.getByRole('link', { name: 'Roles & permissions' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Roles & permissions' })).toBeVisible();
  for (const name of ['Super Admin', 'Finance Admin', 'Support Admin', 'Sales Admin', 'Operations Admin', 'Read-only'])
    await expect(ops.locator(`[data-role-card="${name}"]`)).toBeVisible();
  await expect(ops.locator('[data-cell="finance:billing.manage"]')).toHaveAttribute('data-has', 'yes');
  await expect(ops.locator('[data-cell="read_only:billing.manage"]')).toHaveAttribute('data-has', 'no');
  await axe(ops);
  await shot(ops, '06-console-roles-matrix');

  await ops.getByRole('button', { name: 'New role' }).click();
  const editor = ops.getByRole('dialog');
  await editor.getByLabel('Role name').fill(`Onboarding ${suffix}`);
  await editor.getByLabel('Description').fill('Sets up new clients and their workspaces.');
  await editor.locator('[data-permission="clients.edit"]').check();
  // Editing clients brings seeing them, which is ticked and fixed.
  await expect(editor.locator('[data-permission="clients.view"]')).toBeChecked();
  await expect(editor.locator('[data-permission="clients.view"]')).toBeDisabled();
  await editor.locator('[data-permission="workspaces.manage"]').check();
  await axe(ops);
  await shot(ops, '07-console-role-editor');
  await editor.getByRole('button', { name: 'Create role' }).click();
  const card = ops.locator(`[data-role-card="Onboarding ${suffix}"]`);
  await expect(card).toContainText('4 of 22 permissions · 0 operators');
  await expect(ops.locator('[data-permission-matrix]')).toContainText(`Onboarding ${suffix}`);

  // ── The invitee chooses a password from the email and lands in a Console made for their role ──
  let link = '';
  await expect
    .poll(async () => {
      const mail = (await (await request.get(MAILBOX)).json()) as { to: string[]; subject: string; text: string }[];
      const m = mail.findLast((x) => x.to.includes(invitee) && x.subject === 'Your SampForce Console account');
      link = /(http\S+\/operator\/set-password#token=[\w-]+)/.exec(m?.text ?? '')?.[1] ?? '';
      return link;
    })
    .not.toBe('');
  const fiona = await (await browser.newContext()).newPage();
  await fiona.goto(link);
  await expect(fiona.getByRole('heading', { name: 'Welcome to the SampForce Console' })).toBeVisible();
  await expect(fiona.getByText(`Choose the password for ${invitee}.`)).toBeVisible();
  await expect.poll(() => fiona.url()).not.toContain('token=');
  await axe(fiona);
  await shot(fiona, '08-console-set-password');
  await fiona.getByLabel('New password').fill('fiona-finance-2026');
  await fiona.getByLabel('Type it again').fill('fiona-finance-2026');
  await fiona.getByRole('button', { name: 'Save password and sign in' }).click();
  await expect(fiona.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(fiona.getByRole('button', { name: 'Account: Fiona Finance' })).toContainText('Finance Admin');
  const fMenu = fiona.getByRole('navigation', { name: 'Operator' });
  await expect(fMenu.getByRole('link', { name: 'Audit log' })).toBeVisible();
  for (const hidden of ['Operators', 'Roles & permissions', 'Providers', 'Support tickets', 'Support chat'])
    await expect(fMenu.getByRole('link', { name: hidden })).toHaveCount(0);
  await shot(fiona, '09-console-finance-menu');
  // A page the role does not include says so instead of failing.
  await fiona.goto('/operator/operators');
  await expect(fiona.locator('[data-console-state="denied"]')).toContainText('Your operator role does not include this page');

  // ── The Super Admin sees them joined and changes their role, which applies at once ──
  await menu.getByRole('link', { name: 'Operators' }).click();
  await expect(row).toContainText('Active');
  await row.getByRole('button', { name: 'Actions for Fiona Finance' }).click();
  await ops.getByRole('menuitem', { name: 'Change role' }).click();
  await ops.getByRole('dialog').getByLabel('Role').selectOption({ label: `Onboarding ${suffix} (custom)` });
  await ops.getByRole('button', { name: 'Save role' }).click();
  await expect(row.locator('[data-operator-role]')).toHaveText(`Onboarding ${suffix}`);
  await fiona.goto('/operator');
  await expect(fiona.getByRole('button', { name: 'Account: Fiona Finance' })).toContainText(`Onboarding ${suffix}`);
  await expect(fiona.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Audit log' })).toHaveCount(0);
});
