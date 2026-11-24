import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp, workspaceAction } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, locator?: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  // Scrolled so the part shown starts just below the sticky top bar.
  if (locator) await page.locator(locator).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 88));
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function send(req: APIRequestContext, method: 'post' | 'put' | 'patch', path: string, data: object) {
  const res = await req[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

/**
 * Audit views (ADR 0071, part 7, spec section 17): the Super Workspace reads who changed what across its organisation,
 * lets one manager read its own team's log, and the Console Admin reads the platform log with the client's name.
 */
test('the Super Workspace reads its audit log, lets a manager read the team’s, and the Console reads the platform’s', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const org = `Frequent Research Audit ${stamp}`;
  await signUp(page, org);
  const tenantId = (await (await page.request.get('/api/v1/auth/me')).json()).tenant.id as string;
  const m = await send(page.request, 'post', '/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  const s = await send(page.request, 'post', '/workspaces', { level: 'MANAGER', name: 'South India Sales' });
  await send(page.request, 'put', `/workspaces/${m.id}/permissions`, { canCreateExecutives: true });
  const p = await send(manager.request, 'post', '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const priya = await join(browser, p.inviteUrl, 'Priya Sharma');
  await send(page.request, 'post', '/targets', { workspaceId: m.id, metric: 'LEADS', period: 'MONTHLY', startsOn: `${new Date().toISOString().slice(0, 7)}-01`, amount: 40 });
  const task = await send(manager.request, 'post', '/assigned-tasks', { title: 'Call the Kantar panel team', workspaceId: p.id });
  await send(priya.request, 'patch', `/assigned-tasks/${task.id}`, { status: 'DONE' });
  const company = await send(priya.request, 'post', '/companies', { name: `Kantar Panels ${stamp}` });
  await send(priya.request, 'patch', `/companies/${company.id}`, { website: 'https://kantar.example.com' });
  const tree = await (await page.request.get('/api/v1/workspaces')).json();
  const southFeatures = tree.workspaces.find((w: { id: string }) => w.id === s.id).features.filter((f: string) => f !== 'quotes');
  await send(page.request, 'put', `/workspaces/${s.id}/permissions`, { features: southFeatures });

  // ── The Console Admin raises the client's workspace limit ──
  const email = `ops-audit-${stamp}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Console Admin', OPERATOR_ROLE: 'ADMIN' },
  });
  const opsCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const ops = await opsCtx.newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await send(ops.request, 'put', `/operator/clients/${tenantId}/subscription`, { maxManagerWorkspaces: 6, reason: 'Order form 42 signed' });

  // ── The Super Workspace reads the organisation's log ──
  await page.goto('/app/administration');
  const log = page.locator('[data-audit-log]');
  await expect(log).toHaveAttribute('data-audit-scope', 'ORGANISATION');
  const completed = log.locator('[data-audit-entry="task.completed"]');
  await expect(completed.locator('[data-audit-actor]')).toContainText('Priya Sharma');
  await expect(completed.locator('[data-audit-actor]')).toContainText('Executive Workspace');
  await expect(completed.locator('[data-audit-record]')).toContainText('Call the Kantar panel team');
  await expect(log.locator('[data-audit-entry="workspace.limits_changed"]')).toContainText('SampForce Console');
  await expect(log.locator('[data-audit-entry="workspace.limits_changed"] [data-audit-changes]')).toContainText('Manager Workspaces');
  await expect(log.locator('[data-audit-entry="company.updated"] [data-audit-record]')).toContainText(`Kantar Panels ${stamp}`);
  await axe(page);
  await shot(page, '23-organisation-audit-log', '[data-audit-log]');
  // Who switched a feature off, by kind of change.
  await log.getByLabel('Kind of change').selectOption({ label: 'Features' });
  await expect(log.locator('[data-audit-entry]')).toHaveCount(1);
  await expect(log.locator('[data-audit-entry="workspace.features_changed"]')).toContainText('South India Sales');
  await expect(log.locator('[data-audit-entry="workspace.features_changed"] [data-audit-changes]')).toContainText('Switched off: Quotes');
  await shot(page, '24-audit-log-filtered-by-features', '[data-audit-log]');
  await log.getByRole('button', { name: 'Clear filters' }).click();
  await log.getByLabel('Workspace', { exact: true }).selectOption({ label: 'North India Sales' });
  await expect(log.locator('[data-audit-entry="workspace.features_changed"]')).toHaveCount(0);
  await expect(log.locator('[data-audit-entry="task.completed"]')).toBeVisible();

  // ── The manager is refused until the Super Workspace allows it ──
  await manager.goto('/app/administration');
  await expect(manager.locator('[data-audit-refused]')).toContainText('has not let your workspace read the audit log');
  await page.goto('/app/settings/workspaces');
  await workspaceAction(page, 'North India Sales', 'Permissions');
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-audit-setting]').getByLabel('May read its own team’s audit log').check();
  await dialog.getByRole('button', { name: 'Save permissions' }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
  await dialog.locator('[data-audit-setting]').scrollIntoViewIfNeeded();
  await shot(page, '25-manager-audit-permission');

  // ── The manager reads its own team's entries, and nothing of the other team ──
  await manager.reload();
  const team = manager.locator('[data-audit-log]');
  await expect(team).toHaveAttribute('data-audit-scope', 'TEAM');
  await expect(team.locator('[data-audit-entry="task.completed"]')).toContainText('Priya Sharma');
  await expect(team.locator('[data-audit-entry="workspace.features_changed"]')).toHaveCount(0);
  await expect(team.locator('[data-audit-entry="workspace.limits_changed"]')).toHaveCount(0);
  await expect(team).not.toContainText('South India Sales');
  await expect(manager.getByRole('link', { name: 'Workspace security' })).toHaveCount(0);
  await axe(manager);
  await shot(manager, '26-manager-team-audit-log', '[data-audit-log]');

  // ── The Console Admin reads the platform log for this client ──
  await ops.getByRole('link', { name: 'Audit log' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Activity & audit log' })).toBeVisible();
  await ops.getByLabel('Client', { exact: true }).selectOption({ label: org });
  const entry = ops.locator('[data-platform-entry="client.subscription_changed"]').first();
  await expect(entry.locator('[data-platform-client]')).toHaveText(org);
  await expect(entry).toContainText('Manager Workspaces');
  await expect(entry).toContainText('Reason: Order form 42 signed');
  await ops.getByLabel('Action contains').fill('subscription');
  await expect(ops.locator('[data-platform-entry]').filter({ hasNotText: 'subscription' })).toHaveCount(0);
  await axe(ops);
  await shot(ops, '27-console-platform-audit-log');
  await opsCtx.close();
});
