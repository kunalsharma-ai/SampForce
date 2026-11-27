import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Redesign R7 (ADR 0091): an executive says where an assigned task stands (acknowledged, in progress, blocked with a
 * reason), the manager hears about each step and sees it on the task, both react to comments, and targets take the
 * new periods (half-yearly, yearly) and measures (emails sent, follow-ups completed, meetings, RFQs, conversions).
 */

const ORIGIN = { origin: 'http://localhost:3000' };
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

async function titles(req: APIRequestContext): Promise<string[]> {
  const page = (await (await req.get('/api/v1/notifications?limit=100')).json()) as { items: { title: string }[] };
  return page.items.map((n) => n.title);
}

test('the executive says where a task stands, the manager hears it, comments get reactions, and targets take new periods and measures', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, `Tasks Targets Research ${stamp}`);
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  expect((await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN })).ok()).toBe(true);
  const e = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const priya = await join(browser, e.inviteUrl, 'Priya Sharma');
  const task = await post(manager.request, '/assigned-tasks', { title: 'Send the panel book to Kantar', priority: 'HIGH', workspaceId: e.id });

  // ── Priya acknowledges, starts, then is blocked; Rahul hears each step ──
  await priya.goto(`/app/tasks?task=${task.id}`);
  let dialog = priya.getByRole('dialog');
  const controls = dialog.locator('[data-task-progress]');
  await expect(dialog.locator('[data-progress]').first()).toHaveText('Not acknowledged');
  await controls.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(dialog.locator('[data-progress]').first()).toHaveText('Acknowledged');
  await expect(controls.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
  await controls.getByRole('button', { name: 'Start working' }).click();
  await expect(dialog.locator('[data-progress]').first()).toHaveText('In progress');
  await controls.getByRole('button', { name: 'I’m blocked' }).click();
  await expect(controls.getByRole('button', { name: 'Tell them' })).toBeDisabled();
  await controls.getByLabel('What is blocking it?').fill('Waiting for the updated price list');
  await shot(priya, '01-executive-blocking');
  await controls.getByRole('button', { name: 'Tell them' }).click();
  await expect(dialog.locator('[data-progress]').first()).toHaveText('Blocked');
  await expect(dialog).toContainText('Blocked: Waiting for the updated price list');
  await expect(dialog.locator('[data-task-history]')).toContainText('marked it blocked');
  await axe(priya);
  await expect.poll(() => titles(manager.request)).toEqual(
    expect.arrayContaining(['Task acknowledged: Send the panel book to Kantar', 'Task in progress: Send the panel book to Kantar', 'Task blocked: Send the panel book to Kantar']),
  );

  // ── Rahul sees it blocked, with the reason, and answers; Priya reacts ──
  await manager.goto('/app/tasks?tab=oneoff');
  await manager.getByRole('tab', { name: /Assigned by me/ }).click();
  const row = manager.locator('[data-task="Send the panel book to Kantar"]');
  await expect(row.locator('[data-progress]')).toHaveText('Blocked');
  await expect(row).toContainText('Blocked: Waiting for the updated price list');
  await shot(manager, '02-manager-sees-blocked');
  await manager.goto(`/app/tasks?task=${task.id}`);
  dialog = manager.getByRole('dialog');
  // Only the person doing the task says where it stands.
  await expect(dialog.locator('[data-task-progress]')).toHaveCount(0);
  await dialog.getByLabel('Add a comment').fill('Price list attached to the company, go ahead.');
  await dialog.getByRole('button', { name: 'Post' }).click();
  await expect(dialog).toContainText('Price list attached to the company, go ahead.');

  await priya.goto(`/app/tasks?task=${task.id}`);
  dialog = priya.getByRole('dialog');
  const reactions = dialog.locator('[data-reactions]').first();
  await reactions.getByRole('button', { name: 'Add a reaction' }).click();
  await reactions.getByRole('button', { name: 'React with 👍' }).click();
  await expect(reactions.getByRole('button', { name: '👍 by Priya Sharma' })).toHaveAttribute('aria-pressed', 'true');
  await reactions.getByRole('button', { name: 'Add a reaction' }).click();
  await reactions.getByRole('button', { name: 'React with 🙏' }).click();
  await expect(reactions.getByRole('button', { name: '🙏 by Priya Sharma' })).toBeVisible();
  await shot(priya, '03-comment-reactions');
  // A second tap takes a reaction back.
  await reactions.getByRole('button', { name: '🙏 by Priya Sharma' }).click();
  await expect(reactions.getByRole('button', { name: /^🙏/ })).toHaveCount(0);
  await controls.getByRole('button', { name: 'Start working' }).click();
  await expect(dialog.locator('[data-progress]').first()).toHaveText('In progress');
  await axe(priya);

  await manager.goto(`/app/tasks?task=${task.id}`);
  await expect(manager.getByRole('dialog').locator('[data-reactions]').first().getByRole('button', { name: '👍 by Priya Sharma' })).toHaveAttribute('aria-pressed', 'false');

  // ── Targets: a yearly emails-sent target and a half-yearly RFQ target ──
  await page.goto('/app/targets');
  for (const [measure, period, amount] of [['EMAILS_SENT', 'YEARLY', '120'], ['RFQS', 'HALF_YEARLY', '12']] as const) {
    await page.getByRole('button', { name: 'Set a target' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Workspace').selectOption({ label: 'North India Sales · Manager Workspace' });
    await expect(d.getByLabel('Measure').locator('option')).toContainText(['Emails sent', 'Follow-ups completed', 'Meetings', 'RFQs received', 'Conversions']);
    await expect(d.getByLabel('Period').locator('option')).toContainText(['Half-yearly', 'Yearly']);
    await d.getByLabel('Measure').selectOption(measure);
    await d.getByLabel('Period').selectOption(period);
    await d.getByLabel('Number').fill(amount);
    await d.getByRole('button', { name: 'Set target' }).click();
    await expect(d).toHaveCount(0);
  }
  const box = page.locator('[data-targets-of="North India Sales"]');
  await expect(box).toContainText('Yearly emails sent');
  await expect(box).toContainText('Half-yearly rfqs received');

  // Priya's work counts toward the manager's targets.
  const company = await post(priya.request, '/companies', { name: `Kantar Panels ${stamp}` });
  await post(priya.request, '/interactions', { companyId: company.id, kind: 'EMAIL_SENT', subject: 'Panel book' });
  await page.reload();
  await expect(box.locator('[data-target-progress]')).toContainText(['1 of 120']);
  await shot(page, '04-new-target-periods-and-measures');
  await axe(page);
});
