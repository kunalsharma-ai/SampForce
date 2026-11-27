import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
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

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

/** Targets and tasks (ADR 0071, part 4): scenario 12 through the screens, and a target split down the team. */
test('a manager assigns a task the executive sees on the dashboard, and a target is split down the team', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  await signUp(page, 'Frequent Research Fieldwork');
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', designation: 'Regional Sales Manager', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  const put = await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN });
  expect(put.ok()).toBe(true);
  const e = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const executive = await join(browser, e.inviteUrl, 'Priya Sharma');

  // The Super Workspace sets the manager's monthly lead target on the Targets page.
  await page.goto('/app/targets');
  await page.getByRole('button', { name: 'Set a target' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Workspace').selectOption({ label: 'North India Sales · Manager Workspace' });
  await dialog.getByLabel('Measure').selectOption('LEADS');
  await dialog.getByLabel('Number').fill('10');
  await dialog.getByRole('button', { name: 'Set target' }).click();
  await expect(page.locator('[data-targets-of="North India Sales"]')).toContainText('Set by the Super Workspace');

  // The manager splits it with its executive.
  await manager.goto('/app/targets');
  await manager.getByRole('button', { name: 'Split among team' }).click();
  dialog = manager.getByRole('dialog');
  await dialog.getByLabel('Priya Sharma').fill('6');
  await dialog.getByRole('button', { name: 'Save split' }).click();
  await expect(manager.locator('[data-targets-of="Priya Sharma"]')).toContainText('Handed down by the manager');
  await expect(manager.locator('[data-targets-of="North India Sales"]')).toContainText(/Handed down: 6 of 10/);

  // Scenario 12: the manager assigns a high-priority task to the executive.
  await manager.goto('/app/tasks');
  await manager.getByRole('button', { name: 'New task' }).click();
  dialog = manager.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Call the five new research leads');
  await dialog.getByLabel('Description').fill('Introduce the panel book and book a demo with each.');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByRole('button', { name: 'Assign task' }).click();
  await expect(manager.locator('[data-task-detail]')).toContainText('Call the five new research leads');
  await shot(manager, '13-task-assigned');
  await manager.keyboard.press('Escape');

  // The executive records a lead; the dashboard shows the task first and the target moving.
  await post(executive.request, '/companies', { name: `Kantar Panels ${stamp}` });
  await executive.goto('/app?view=overview');
  const card = executive.locator('[data-tasks-for-you]');
  await expect(card.locator('[data-task="Call the five new research leads"]')).toContainText('High priority');
  await expect(executive.locator('[data-your-targets]')).toContainText('1 of 6');
  await shot(executive, '12-executive-tasks-and-targets');
  await axe(executive);

  await card.locator('[data-task="Call the five new research leads"]').click();
  await expect(executive).toHaveURL(/\/app\/tasks\?task=/);
  dialog = executive.getByRole('dialog');
  await dialog.getByLabel('Add a comment').fill('Three called, two tomorrow.');
  await dialog.getByRole('button', { name: 'Post' }).click();
  await expect(dialog).toContainText('Three called, two tomorrow.');
  await dialog.getByRole('button', { name: 'Mark done' }).click();
  await expect(dialog.locator('[data-task-history]')).toContainText('Status: Open → Done');
  await axe(executive);

  // The manager tracks completion and sees the whole team's targets.
  await manager.goto('/app/tasks?task=' + new URL(executive.url()).searchParams.get('task'));
  await manager.getByRole('dialog').getByText('Three called, two tomorrow.').waitFor();
  await manager.keyboard.press('Escape');
  await manager.getByRole('tab', { name: /Assigned by me/ }).click();
  await expect(manager.locator('[data-task="Call the five new research leads"]')).toContainText('Done');
  await manager.goto('/app/targets');
  await expect(manager.locator('[data-targets-of="North India Sales"] [data-target-progress]')).toHaveText('1 of 10');
  await shot(manager, '14-team-targets');
  await axe(manager);
});
