import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage: true });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
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
 * The four dashboards (ADR 0071, part 6): each workspace level opens on its own dashboard, counted from real records,
 * and the Console Admin's overview shows the platform. None of them has a recent-activity list.
 */
test('each workspace level opens on its own dashboard, and the numbers move when an executive records a lead', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  await signUp(page, `Frequent Research Dashboards ${stamp}`);
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  await post(page.request, '/workspaces', { level: 'MANAGER', name: 'South India Sales' });
  expect((await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN })).ok()).toBe(true);
  const p = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const priya = await join(browser, p.inviteUrl, 'Priya Sharma');
  const a = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Arjun Mehta', person: { inviteEmail: `arjun.${stamp}@example.com` } });
  await join(browser, a.inviteUrl, 'Arjun Mehta');
  await post(page.request, '/targets', { workspaceId: m.id, metric: 'LEADS', period: 'MONTHLY', startsOn: `${today.slice(0, 7)}-01`, amount: 40 });
  await post(manager.request, '/targets', { workspaceId: p.id, metric: 'LEADS', period: 'DAILY', startsOn: today, amount: 5 });

  // ── The executive's day, before and after a new lead ──
  await priya.goto('/app');
  const day = priya.locator('[data-level-dashboard="EXECUTIVE"]');
  await expect(day).toContainText('My day');
  await expect(priya.locator('[data-remaining]')).toHaveText('5');
  const company = await post(priya.request, '/companies', { name: `Kantar Panels ${stamp}` });
  await post(priya.request, '/activities', { type: 'CALL', subject: 'Intro call', companyId: company.id });
  await post(priya.request, '/companies', { name: `Ipsos Field ${stamp}` });
  await priya.reload();
  await expect(priya.locator('[data-today-leads]')).toHaveText('2');
  await expect(priya.locator('[data-remaining]')).toHaveText('3');
  await expect(priya.locator('[data-calls-today]')).toContainText('1');
  // An executive only has its own dashboards: My day and Executive.
  await expect(priya.getByRole('tab')).toHaveText(['My day', 'Executive']);
  await axe(priya);
  await shot(priya, '19-executive-my-day');

  // ── The manager's team ──
  await manager.goto('/app');
  await expect(manager.locator('[data-level-dashboard="MANAGER"]')).toContainText('Team overview: North India Sales');
  await expect(manager.locator('[data-stat="executives"]')).toContainText('2');
  await expect(manager.locator('[data-performance="Priya Sharma"]')).toContainText('2');
  await expect(manager.locator('[data-leader="Top executive"]')).toContainText('Priya Sharma');
  await expect(manager.locator('[data-leader="Needs support"]')).toContainText('Arjun Mehta');
  await expect(manager.locator('[data-report="TODAY"]')).toContainText('2');
  await expect(manager.locator('[data-other-managers]')).toHaveCount(0);
  await expect(manager.getByRole('tab')).toHaveText(['Team', 'Manager']);
  await axe(manager);
  await shot(manager, '20-manager-team-overview');

  // ── The Super Workspace's organisation ──
  await page.goto('/app');
  const org = page.locator('[data-level-dashboard="SUPER"]');
  await expect(org).toContainText('Organisation overview');
  await expect(page.locator('[data-stat="managers"]')).toContainText('2');
  await expect(page.locator('[data-stat="leads"]')).toContainText('2');
  await expect(page.locator('[data-leader="Leading Manager Workspace"]')).toContainText('North India Sales');
  await expect(page.locator('[data-leader="Leading Executive Workspace"]')).toContainText('Priya Sharma');
  await expect(page.locator('[data-target-total="LEADS"]')).toContainText('2 of 40');
  await axe(page);
  await shot(page, '21-super-organisation-overview');
  // The designation dashboards are still a tab away.
  await page.getByRole('tab', { name: 'Senior management' }).click();
  await expect(page.getByRole('heading', { name: 'Senior management dashboard' })).toBeVisible();

  // ── The Console Admin's platform overview ──
  const email = `ops-dash-${stamp}@platform.test`;
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
  await expect(ops.getByText('Support queries waiting')).toBeVisible();
  await axe(ops);
  await shot(ops, '22-console-overview');
  await opsCtx.close();
});
