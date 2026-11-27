import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The three role dashboards (redesign R6, ADR 0086): the executive's "What do I need to do today?", the manager's
 * "How is my team doing?" and the Super Workspace's "What is happening across the organisation?", counted from real
 * records, with every card opening the list it counts. The old level dashboard stays under ?view=overview.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage: true });
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

const prefs = (theme: 'light' | 'dark') => JSON.stringify({ state: { theme, motion: 'off' }, version: 0 });

async function join(browser: Browser, inviteUrl: string, name: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  await ctx.addInitScript((p) => localStorage.setItem('dealflow:preferences', p), prefs('light'));
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

async function noOverflow(page: Page) {
  expect(await page.locator('main').evaluate((m) => m.scrollWidth - m.clientWidth)).toBeLessThanOrEqual(1);
}

test('each role opens on the dashboard that answers its question, and every card opens its list', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  await signUp(page, `Frequent Research Roles ${stamp}`);
  await page.evaluate((p) => localStorage.setItem('dealflow:preferences', p), prefs('light'));
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  expect((await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN })).ok()).toBe(true);
  const p = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const priya = await join(browser, p.inviteUrl, 'Priya Sharma');
  const a = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Arjun Mehta', person: { inviteEmail: `arjun.${stamp}@example.com` } });
  await join(browser, a.inviteUrl, 'Arjun Mehta');
  await post(page.request, '/targets', { workspaceId: m.id, metric: 'LEADS', period: 'MONTHLY', startsOn: `${today.slice(0, 7)}-01`, amount: 40 });
  await post(manager.request, '/targets', { workspaceId: p.id, metric: 'LEADS', period: 'DAILY', startsOn: today, amount: 5 });

  // Priya works a company: a lead with an employee emailed nine days ago (so follow-up 1 is overdue), and a deal.
  const lead = await post(priya.request, '/company-leads', {
    company: { name: `Northwind Panels ${stamp}`, country: 'GB', city: 'London' },
    employees: [{ firstName: 'Lena', lastName: 'Ortiz', jobTitle: 'Research Director', emails: [{ value: `lena.${stamp}@northwind.example` }] }],
  });
  await post(priya.request, `/contacts/${lead.employeeIds[0]}/initial-email`, { sentAt: new Date(Date.now() - 9 * 86_400_000).toISOString() });
  await post(priya.request, '/deals', { name: 'Northwind tracker', amount: 4200, companyId: lead.company.id, customFields: {} });
  await post(priya.request, '/availability/check-in', {});

  // ── Executive: What do I need to do today? ──
  await priya.goto('/app');
  const exec = priya.locator('[data-role-dashboard="EXECUTIVE"]');
  await expect(exec.getByRole('heading', { level: 1 })).toHaveText('What do I need to do today?');
  await expect(exec.getByRole('toolbar', { name: 'Quick actions' }).getByRole('link', { name: 'Add company' })).toBeVisible();
  await expect(exec.locator('[data-tile="leads"]')).toContainText('1 / 5');
  await expect(exec.locator('[data-tile="follow-ups"]')).toContainText('1 overdue');
  await expect(exec.locator('[data-panel="follow-up-queue"]')).toContainText('Follow-up 1 of 5: Lena Ortiz');
  await expect(exec.locator('[data-strip-stage="NEGOTIATION"]')).toContainText('1');
  await expect(exec.locator('[data-panel="continue"] [data-company-card]').first()).toContainText(`Northwind Panels ${stamp}`);
  await expect(exec.locator('[data-target-ring="DAILY"]')).toContainText('20%');
  await axe(priya);
  await noOverflow(priya);
  await shot(priya, '01-executive-today');
  // The old level dashboard is a tab away.
  await expect(priya.getByRole('tab')).toHaveText(['My day', 'Overview', 'Executive']);
  // The follow-ups card opens the overdue list.
  await exec.locator('[data-tile="follow-ups"]').click();
  await expect(priya).toHaveURL(/\/app\/follow-ups\?bucket=overdue&scope=mine/);
  await expect(priya.getByRole('tab', { name: /Overdue/ })).toHaveAttribute('aria-selected', 'true');
  // The pipeline strip opens the board on the person's own companies.
  await priya.goto('/app');
  await exec.locator('[data-strip-stage="NEGOTIATION"] a').click();
  await expect(priya).toHaveURL(/\/app\/pipelines\?mine=true/);
  await expect(priya.getByRole('checkbox', { name: 'Only my companies' })).toBeChecked();

  // ── Manager: How is my team doing? ──
  await manager.goto('/app');
  const team = manager.locator('[data-role-dashboard="MANAGER"]');
  await expect(team.getByRole('heading', { level: 1 })).toHaveText('How is my team doing?');
  await expect(team.locator('[data-tile="leads"]')).toContainText('1');
  await expect(team.locator('[data-rank]').first()).toContainText('Priya Sharma');
  await expect(team.locator('[data-workload]').first()).toContainText('Priya Sharma');
  await expect(team.locator('[data-panel="new-companies"]')).toContainText(`Northwind Panels ${stamp}`);
  await expect(team.locator('[data-panel="active-deals"] [data-deal="Northwind tracker"]')).toBeVisible();
  await expect(team.locator('[data-panel="follow-up-queue"]')).toContainText('Priya Sharma');
  await expect(team.locator('[data-person="Priya Sharma"]')).toBeVisible();
  await expect(team.locator('[data-target-ring="MONTHLY"]')).toContainText('3%');
  await axe(manager);
  await noOverflow(manager);
  await shot(manager, '02-manager-team');
  await team.locator('[data-tile="overdue"]').click();
  await expect(manager).toHaveURL(/\/app\/follow-ups\?bucket=overdue&scope=team/);
  await expect(manager.getByRole('radio', { name: 'My team' })).toHaveAttribute('aria-checked', 'true');

  // ── Super: What is happening across the organisation? ──
  await page.goto('/app');
  const org = page.locator('[data-role-dashboard="SUPER"]');
  await expect(org.getByRole('heading', { level: 1 })).toHaveText('What is happening across the organisation?');
  await expect(org.locator('[data-tile="leads"]')).toContainText('1');
  await expect(org.locator('[data-tile="deals"]')).toContainText('1');
  await expect(org.locator('[data-funnel-stage="NEGOTIATION"]')).toContainText('1');
  await expect(org.locator('[data-status-team="North India Sales"]')).toContainText('1 of 3 checked in');
  await expect(org.locator('[data-workspace-target="North India Sales"]')).toContainText('3%');
  await expect(org.locator('[data-productivity="North India Sales"]')).toBeVisible();
  await expect(org.locator('[data-workload="North India Sales"]')).toBeVisible();
  await axe(page);
  await noOverflow(page);
  await shot(page, '03-super-organisation');

  // Dark mode.
  await page.evaluate((p) => localStorage.setItem('dealflow:preferences', p), prefs('dark'));
  await page.reload();
  await expect(org.locator('[data-funnel-stage="NEGOTIATION"]')).toContainText('1');
  await axe(page);
  await shot(page, '04-super-organisation-dark');

  // Tablet and phone widths: nothing runs off the page.
  await priya.setViewportSize({ width: 1024, height: 900 });
  await priya.goto('/app');
  await expect(exec.locator('[data-tile="leads"]')).toBeVisible();
  await noOverflow(priya);
  await shot(priya, '05-executive-tablet');
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.goto('/app');
  await expect(team.locator('[data-tile="leads"]')).toBeVisible();
  await noOverflow(manager);
  await shot(manager, '06-manager-phone');
});
