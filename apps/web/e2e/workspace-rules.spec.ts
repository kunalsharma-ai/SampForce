import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { FEATURE_KEYS } from '@dealflow/types';
import { E2E_DATABASE_URL, setPlan, signUp, workspaceAction, perWorkspaceDelete } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

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
 * Workspace redesign W3: the Console sets, per plan, whether Manager and Executive Workspaces may delete and must use
 * two-step sign-in; the client's Permission Center says so; one client can differ from its plan.
 */
test('the Console limits a plan, the Permission Center shows the limit, and one client is given an exception', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const email = `ops-rules-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Console Admin', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  const planName = `Field Teams ${String(Date.now()).slice(-5)}`;
  const created = await ops.request.post('/api/v1/operator/console-plans', {
    headers: ORIGIN,
    data: {
      name: planName, features: [...FEATURE_KEYS], reason: 'Plan for field sales teams',
      limits: { maxUsers: null, maxPipelines: null, monthlyAiCredits: 500, automationRunsPerMonth: 10000, maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 6 },
      terms: { description: 'Field sales teams', priceCents: 1200000, currency: 'INR', billingFrequency: 'MONTH', supportLevel: 'STANDARD', durationMonths: 12, autoRenew: true, upgradeTo: [], available: true },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const planCode = ((await created.json()) as { name: string; code: string }[]).find((p) => p.name === planName)!.code;

  // The client, on that plan, with a Manager Workspace that has every action.
  await signUp(page, 'Frequent Research Field');
  // Delete is given workspace by workspace here (W2), so the organisation-wide switch is off.
  await perWorkspaceDelete(page);
  await setPlan(page, planCode);
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const ws = await (await page.request.post('/api/v1/workspaces', { data: { level: 'MANAGER', name: 'North Field Team', person: { inviteEmail: `north.${Date.now()}@example.com` } }, headers: ORIGIN })).json();
  const granted = await page.request.put(`/api/v1/workspaces/${ws.id}/permissions`, { data: { actions: me.workspace.actions }, headers: ORIGIN });
  expect(granted.ok(), await granted.text()).toBe(true);

  // The Console: managers on this plan may not delete; executives must use two-step sign-in.
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Workspace rules' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Workspace rules' })).toBeVisible();
  const card = ops.locator(`[data-plan-rules="${planCode}"]`);
  await expect(card).toContainText('No limits');
  await card.getByRole('checkbox', { name: 'Manager Workspaces may be given Delete' }).uncheck();
  await card.getByRole('checkbox', { name: 'Executive Workspaces', exact: true }).check();
  await card.getByLabel(`Reason for ${planName}`).fill('Field managers must not delete data');
  await card.getByRole('button', { name: `Save rules for ${planName}` }).click();
  await expect(card.getByRole('status')).toHaveText(`Saved. It applies to every client on ${planName}.`);
  await expect(card).toContainText('Limits set');
  await card.scrollIntoViewIfNeeded();
  await shot(ops, '06-console-workspace-rules');
  // The Console top bar is sticky: keep the card below it, or axe counts the checkboxes it covers as too small.
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 88));
  await axe(ops);

  // The client's Permission Center says why Delete cannot be given, and the manager has lost it.
  await page.goto('/app/settings/workspaces');
  await workspaceAction(page, 'North Field Team', 'Permissions');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-rule-note="delete"]')).toHaveText('Your SampForce plan does not let this level delete data, so Delete cannot be given here.');
  await expect(dialog.getByRole('checkbox', { name: 'Delete in CRM' })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'Edit in CRM' })).toBeChecked();
  await dialog.locator('[data-rule-note="delete"]').scrollIntoViewIfNeeded();
  await shot(page, '07-permission-center-console-rule');
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  // One client is allowed what its plan forbids.
  await ops.goto(`/operator/clients/${me.tenant.id}`);
  const rules = ops.locator('[data-client-workspace-rules]');
  await expect(rules).toContainText('Uses its plan’s rules');
  await rules.getByRole('checkbox', { name: 'Manager Workspaces may be given Delete' }).check();
  await rules.getByLabel('Reason', { exact: true }).fill('Agreed in the contract');
  await rules.getByRole('button', { name: 'Save for this client' }).click();
  await expect(rules.getByRole('status')).toHaveText('Saved. It applies to the client on its next request.');
  await expect(rules).toContainText('Differs from its plan: Managers may delete');
  await rules.scrollIntoViewIfNeeded();
  await shot(ops, '08-console-client-exception');
  await axe(ops);

  await page.reload();
  await workspaceAction(page, 'North Field Team', 'Permissions');
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Delete in CRM' })).toBeVisible();
  await expect(page.getByRole('dialog').locator('[data-rule-note="delete"]')).toHaveCount(0);
});
