import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

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

/**
 * Workspace redesign W7: the owner closes the company from Settings (what it stops, the typed name and password, a
 * second yes), everyone is signed out, the Console sees it closing with the erase date and reopens it.
 */
test('an owner closes the company and the Console reopens it', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { email } = await signUp(page, 'Shutter Traders', { autoConfirm: false });
  const ws = await (await page.request.post('/api/v1/workspaces', { data: { level: 'MANAGER', name: 'North Team', person: { inviteEmail: `rahul.${Date.now()}@example.com` } }, headers: ORIGIN })).json();
  const accepted = await page.request.post('/api/v1/auth/invitations/accept', { data: { token: (ws.inviteUrl as string).split('/invite/')[1], name: 'Rahul Sharma', password: 'a-long-password-1' }, headers: ORIGIN });
  expect(accepted.ok()).toBe(true);
  await page.request.post('/api/v1/leads', { data: { fullName: 'Ravi Menon' }, headers: ORIGIN });
  // Accepting signed this browser in as Rahul; sign back in as the owner.
  await page.request.post('/api/v1/auth/login', { data: { email, password: 'correcthorse1' }, headers: ORIGIN });

  const tenantId = ((await (await page.request.get('/api/v1/auth/me')).json()) as { tenant: { id: string } }).tenant.id;
  await page.goto('/app/settings');
  const card = page.locator('[data-close-company]');
  await card.getByRole('button', { name: 'Close company' }).click();
  const impact = page.getByRole('dialog', { name: 'Close Shutter Traders' });
  await expect(impact.locator('[data-close-workspaces] li')).toHaveCount(2);
  await expect(impact.locator('[data-close-workspaces]')).toContainText('North Team · Manager Workspace · 1 people');
  await expect(impact.locator('[data-close-records]')).toContainText('1 inbound contacts');
  await impact.getByLabel('Reason (optional)').fill('Moving to another tool');
  await shot(page, '28-close-company-impact');
  await axe(page);
  await impact.getByRole('button', { name: 'Continue' }).click();

  const typed = page.getByRole('dialog', { name: 'Confirm closing' });
  await typed.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await expect(typed.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await typed.getByLabel('Type Shutter Traders to confirm').fill('Shutter Traders');
  await shot(page, '29-close-company-typed-name');
  await typed.getByRole('button', { name: 'Continue' }).click();

  const final = page.getByRole('dialog', { name: 'Close Shutter Traders now?' });
  await shot(page, '30-close-company-second-confirmation');
  await final.getByRole('button', { name: 'Close the company' }).click();
  await expect(page).toHaveURL(/\/login\?closed=/);
  await expect(page.locator('[data-company-closed]')).toContainText('Your company was closed and everyone was signed out.');
  await shot(page, '31-company-closed-sign-in');

  // Signing in says why, and until when.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Your company closed its SampForce account.')).toBeVisible();

  // The Console sees it closing and reopens it.
  const opEmail = `ops-close-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: opEmail, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Console Admin', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext(CONTEXT)).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(opEmail);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await ops.goto(`/operator/clients/${tenantId}`);
  await expect(ops.locator('[data-client-closing]')).toContainText(`Closed by its owner on`);
  await expect(ops.locator('[data-client-closing]')).toContainText('Reason given: Moving to another tool.');
  await shot(ops, '32-console-client-closing');
  await ops.getByRole('button', { name: 'Reopen company' }).click();
  const reopen = ops.getByRole('dialog', { name: 'Reopen company' });
  await reopen.getByLabel('Reason').fill('Owner asked to come back');
  await reopen.getByRole('button', { name: 'Reopen company' }).click();
  await expect(ops.locator('[data-client-closing]')).toHaveCount(0);

  // Everything is back.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app/);
  const leads = await (await page.request.get('/api/v1/leads?q=Ravi')).json();
  expect(JSON.stringify(leads)).toContain('Ravi Menon');
});
