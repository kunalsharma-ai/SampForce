import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Recurring tasks, target rings and performance ranking (ADR 0096) through the screens: a manager sets a daily task
 * for an executive, the executive's real records fill it in (a repeat company does not count), the half-way and done
 * celebrations show, the manager sees the team, a change applies from now on, targets show rings, what is left, the
 * previous period and the trend, and the Super Workspace ranks people with weights it chooses.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen. */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
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

async function join(browser: Browser, inviteUrl: string, name: string, { celebrate = false } = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: celebrate ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  // Celebrations stay out of the other suites; this person opts in before the first page loads.
  if (celebrate) await page.addInitScript(() => window.localStorage.setItem('sampforce.celebrations.test', 'on'));
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

test('a daily task fills in from real records, celebrates, changes from now on, and people are ranked by the weights Super chose', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, 'Frequent Research Fieldwork');
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', designation: 'Regional Sales Manager', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  const put = await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN });
  expect(put.ok()).toBe(true);
  const e = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const priya = await join(browser, e.inviteUrl, 'Priya Sharma', { celebrate: true });
  const e2 = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Arjun Mehta', person: { inviteEmail: `arjun.${stamp}@example.com` } });
  const arjun = await join(browser, e2.inviteUrl, 'Arjun Mehta');

  // ── The manager sets a recurring task for both executives ──
  await manager.goto('/app/tasks');
  await expect(manager.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
  await manager.getByRole('tab', { name: 'Recurring tasks' }).click();
  await manager.getByRole('button', { name: 'New recurring task' }).click();
  let dialog = manager.getByRole('dialog');
  await dialog.getByLabel('Task name').fill('Daily prospecting');
  await dialog.getByLabel('Measure').first().selectOption('QUALIFIED_COMPANIES');
  await dialog.getByLabel('Number').first().fill('2');
  await dialog.getByRole('button', { name: 'Add another' }).click();
  await dialog.locator('[data-requirement="1"]').getByLabel('Measure').selectOption('EMAILS_SENT');
  await dialog.locator('[data-requirement="1"]').getByLabel('Number').fill('5');
  await dialog.locator('[data-requirement="1"]').getByLabel('How often').selectOption('WEEK');
  await dialog.getByRole('button', { name: 'Whole team' }).click();
  await dialog.getByRole('radio', { name: '1 month' }).click();
  // Every day counts, so the test does not depend on the weekday it runs on.
  for (const d of ['Sat', 'Sun']) {
    const b = dialog.getByRole('button', { name: d, exact: true });
    if ((await b.getAttribute('aria-pressed')) === 'false') await b.click();
  }
  await expect(dialog).toContainText('Companies the person created that have a website');
  await dialog.evaluate((el) => el.scrollTo(0, 0));
  await shot(manager, '01-new-recurring-task');
  await axe(manager);
  await dialog.getByRole('button', { name: 'Set task' }).click();
  dialog = manager.getByRole('dialog');
  await expect(manager.locator('[data-plan-detail]')).toContainText('Daily prospecting');
  await manager.keyboard.press('Escape');
  await expect(manager.locator('[data-plan="Daily prospecting"]')).toContainText('2 qualified companies created per day');

  // ── Priya's day: nothing yet, then her records fill it in ──
  await priya.goto('/app/tasks');
  const today = priya.locator('[data-today-tasks]');
  await expect(today.locator('[data-instance="Daily prospecting"]').first()).toHaveAttribute('data-instance-status', 'NOT_STARTED');
  await shot(priya, '02-today-not-started');
  await axe(priya);

  await post(priya.request, '/companies', { name: `Kantar Panels ${stamp}`, website: `https://kantar-${stamp}.test` });
  // A repeat of the same company and one nobody can reach do not count.
  await post(priya.request, '/companies', { name: `Kantar Panels ${stamp}`, website: `https://kantar-copy-${stamp}.test` });
  await post(priya.request, '/companies', { name: `No details ${stamp}` });
  await priya.reload();
  const half = priya.locator('[data-celebration-host] [data-celebration]').first();
  await expect(half).toHaveAttribute('data-kind', 'TASK_PLAN_HALF', { timeout: 15_000 });
  await expect(today.locator('[data-instance-status="HALF_COMPLETED"]')).toContainText('1 done, 1 to go');
  await shot(priya, '03-halfway-celebration');
  await half.getByRole('button', { name: 'Close celebration' }).click();

  await post(priya.request, '/companies', { name: `Ipsos Field ${stamp}`, website: `https://ipsos-${stamp}.test` });
  await priya.reload();
  const done = priya.locator('[data-celebration-host] [data-celebration]').first();
  await expect(done).toHaveAttribute('data-kind', 'TASK_PLAN_DONE', { timeout: 15_000 });
  await expect(done).toContainText('Today’s task completed!');
  await shot(priya, '04-done-celebration');
  await done.getByRole('button', { name: 'Close celebration' }).click();
  // Completed leaves the pending list and stays below, in the day's history.
  await expect(today.locator('[data-instance-status="COMPLETED"]')).toContainText('Completed. It leaves your pending list');
  await shot(priya, '05-today-completed');

  // The bell has the manager's own note, the dashboard has the strip.
  await priya.goto('/app?view=overview');
  await expect(priya.locator('[data-dashboard-today-tasks]')).toBeVisible();
  await shot(priya, '06-dashboard-today-strip');

  // ── The manager sees the team and changes the task from now on ──
  await manager.goto('/app/tasks');
  await expect(manager.locator('[data-team-row="Priya Sharma Daily prospecting"][data-team-cadence="DAY"]')).toContainText('Completed');
  await expect(manager.locator('[data-team-row="Arjun Mehta Daily prospecting"][data-team-cadence="DAY"]')).toContainText('Not started');
  await shot(manager, '07-manager-team-today');
  await axe(manager);
  await manager.goto('/app/tasks?tab=recurring');
  await manager.locator('[data-plan="Daily prospecting"]').click();
  dialog = manager.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Change' }).click();
  const edit = manager.getByRole('dialog').filter({ hasText: 'Change recurring task' });
  await edit.getByLabel('Number').first().fill('3');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  await expect(dialog.locator('[data-plan-revisions]')).toContainText(/changed the task/i);
  await shot(manager, '08-plan-detail-history');
  await manager.keyboard.press('Escape');
  // Priya's finished day keeps the numbers it was measured against.
  await priya.goto('/app/tasks');
  await expect(today.locator('[data-instance-status="COMPLETED"]')).toContainText('2 done, target reached');

  // ── Targets: organisation, manager and executive rings ──
  await post(arjun.request, '/companies', { name: `Nielsen ${stamp}`, website: `https://nielsen-${stamp}.test` });
  await page.goto('/app/targets');
  for (const [ws, metric, amount] of [['Super Workspace', 'QUALIFIED_COMPANIES', '4'], ['North India Sales', 'QUALIFIED_COMPANIES', '2'], ['Priya Sharma', 'DEALS_CREATED', '5']] as const) {
    await page.getByRole('button', { name: 'Set a target' }).click();
    const d = page.getByRole('dialog');
    const option = await d.getByLabel('Workspace').locator('option', { hasText: ws }).first().getAttribute('value');
    await d.getByLabel('Workspace').selectOption(option!);
    await d.getByLabel('Measure').selectOption(metric);
    await d.getByLabel('Number').fill(amount);
    await d.getByRole('button', { name: 'Set target' }).click();
    await expect(d).toHaveCount(0);
  }
  // Three qualified companies across the organisation: 75% of the organisation target, 150% of the manager's.
  const org = page.locator('[data-targets-of="Frequent Research Fieldwork"]');
  await expect(org.locator('[data-target-progress]')).toHaveText('3 of 4');
  await expect(org.locator('[data-milestone-of]')).toHaveAttribute('data-milestone-of', 'NEAR');
  const team = page.locator('[data-targets-of="North India Sales"]');
  await expect(team.locator('[data-milestone-of]')).toHaveAttribute('data-milestone-of', 'EXCEEDED');
  await expect(team.locator('[data-target-remaining]')).toContainText('Exceeded by 1');
  await expect(page.locator('[data-targets-of="Priya Sharma"] [data-target-remaining]')).toContainText('5 to go');
  await shot(page, '09-targets-rings', true);
  await axe(page);
  await team.getByRole('button', { name: 'Progress and history' }).click();
  await expect(team.locator('[data-target-trend]')).toBeVisible();
  await page.getByRole('tab', { name: 'Managers' }).click();
  await expect(page.locator('[data-targets-of]')).toHaveCount(1);
  await shot(page, '10-target-trend');
  await axe(page);

  // ── Performance: Super ranks, sets the weights, and every point is shown ──
  await page.goto('/app/performance');
  const execs = page.locator('[data-ranking="executives"]');
  await expect(execs.locator('[data-rank-row="Priya Sharma"]')).toHaveAttribute('data-rank', '1');
  await expect(execs.locator('[data-rank-row="Arjun Mehta"]')).toHaveAttribute('data-rank', '2');
  await expect(page.locator('[data-ranking-method]')).toContainText('No AI is involved');
  await execs.locator('[data-rank-row="Priya Sharma"]').getByRole('button', { name: 'How it adds up' }).click();
  await expect(execs.locator('[data-score-breakdown="Priya Sharma"]')).toContainText('Qualified companies created');
  await shot(page, '11-performance-ranking', true);
  await axe(page);
  await page.getByRole('button', { name: 'Ranking settings' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Emails sent').fill('20');
  await dialog.getByLabel('Show executives their place in their team').check();
  await shot(page, '12-ranking-settings');
  await axe(page);
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-ranking-method]')).toContainText('Emails sent');

  // An executive sees their own figures and, now that Super allows it, their place in the team.
  await priya.goto('/app/performance');
  await expect(priya.locator('[data-my-rank]')).toContainText('1 of 2');
  await shot(priya, '13-executive-performance');
  await axe(priya);

  // The audit trail records the task and the ranking change.
  await page.goto('/app/administration');
  await expect(page.locator('[data-audit-entry="task_plan.created"]').first()).toContainText('Set a recurring task');
  await expect(page.locator('[data-audit-entry="performance.settings_updated"]').first()).toBeVisible();
});
