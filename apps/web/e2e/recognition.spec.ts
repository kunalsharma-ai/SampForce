import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Employee of the Month and performance improvement plans (ADR 0102) through the screens. A manager sets an Employee
 * of the Month target; the executive's real records fill it in until they are eligible; the manager names them the
 * team's winner; the executive sees the celebration, the card and downloads the certificate. Then the manager gives
 * another executive an improvement plan; it shows on that dashboard only while open; the executive acknowledges it,
 * the records and the manager's evaluation meet the goals, and only the manager's decision completes it.
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
  if (celebrate) await page.addInitScript(() => window.localStorage.setItem('sampforce.celebrations.test', 'on'));
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

async function closeCelebrations(page: Page) {
  const c = page.locator('[data-celebration-host] [data-celebration]');
  for (let i = 0; i < 4 && (await c.count()) > 0; i++) {
    await c.first().getByRole('button', { name: 'Close celebration' }).click();
    await page.waitForTimeout(300);
  }
}

test('Employee of the Month: a target fills in from records, the manager names the winner, the winner celebrates and gets a certificate', async ({ page, browser }) => {
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

  // ── Before any target: the card is still there for the executive ──
  await priya.goto('/app');
  const card = priya.locator('[data-eom-card]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-eom-no-target]')).toBeVisible();
  await expect(priya.locator('[data-pip-card]')).toHaveCount(0);

  // ── The manager sets a target for Priya ──
  await manager.goto('/app/recognition');
  await expect(manager.getByRole('tab', { name: 'Employee of the Month – targets and winners' })).toHaveAttribute('aria-selected', 'true');
  await manager.locator('[data-new-target]').click();
  let dialog = manager.getByRole('dialog');
  const priyaId = await dialog.locator('#t-person option', { hasText: 'Priya Sharma' }).getAttribute('value');
  await dialog.getByLabel('Person').selectOption(priyaId!);
  await dialog.locator('[data-goal-row="0"]').getByLabel('Measure').selectOption('QUALIFIED_COMPANIES');
  await dialog.locator('[data-goal-row="0"]').getByLabel('Amount').fill('2');
  await dialog.locator('[data-goal-row="0"]').getByLabel('Period').selectOption('PERIOD');
  await dialog.locator('[data-goal-row="1"]').getByLabel('Measure').selectOption('CONTACTS');
  await dialog.locator('[data-goal-row="1"]').getByLabel('Amount').fill('1');
  await dialog.locator('[data-goal-row="1"]').getByLabel('Period').selectOption('PERIOD');
  await dialog.getByLabel('Reward (optional)').fill('Team dinner and a day off');
  await shot(manager, '01-set-target');
  await dialog.locator('[data-save-target]').click();
  await expect(dialog).toHaveCount(0);
  const row = manager.locator('[data-target-row="Priya Sharma"]');
  await expect(row).toContainText('0%');
  await expect(row.locator('[data-status="ACTIVE"]')).toBeVisible();

  // ── Priya's records count by themselves ──
  await post(priya.request, '/companies', { name: `Kantar Panels ${stamp}`, website: `https://kantar-${stamp}.test` });
  await priya.reload();
  await expect(card.locator('[data-eom-target="ACTIVE"]')).toBeVisible();
  await expect(card).toContainText('You’re currently at 25% of your Employee of the Month target. Keep going!');
  await expect(card.locator('[data-goal="QUALIFIED_COMPANIES"]')).toContainText('Remaining: 1');
  await closeCelebrations(priya);
  await shot(priya, '02-executive-progress');

  const company = await post(priya.request, '/companies', { name: `Ipsos Field ${stamp}`, website: `https://ipsos-${stamp}.test` });
  await post(priya.request, '/contacts', { firstName: 'Meera', lastName: 'Iyer', email: `meera.${stamp}@ipsos.test`, companyId: company.id });
  await priya.reload();
  await expect(card.locator('[data-eom-target="ELIGIBLE"]')).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Congratulations! You have achieved your Employee of the Month target.');
  const eligible = priya.locator('[data-celebration-host] [data-celebration]').first();
  await expect(eligible).toBeVisible({ timeout: 20_000 });
  await shot(priya, '03-eligible-celebration');
  await closeCelebrations(priya);
  await shot(priya, '04-executive-eligible');

  // ── The manager names the team's winner from the eligible people ──
  await manager.reload();
  const team = manager.locator('[data-scope="TEAM"]');
  await expect(team.locator('[data-candidate="Priya Sharma"]')).toContainText('100%');
  await shot(manager, '05-ranking', true);
  await team.locator('[data-choose="Priya Sharma"]').click();
  dialog = manager.getByRole('dialog');
  await dialog.getByLabel('Note (optional)').fill('Brilliant month of prospecting.');
  await dialog.locator('[data-confirm-award]').click();
  await expect(team.locator('[data-award="Priya Sharma"]')).toBeVisible();
  await expect(manager.locator('[data-history-row="Priya Sharma"]')).toBeVisible();
  await axe(manager);

  // ── Priya sees the celebration, the spotlight and her certificate ──
  await priya.reload();
  const stage = priya.locator('[data-celebration-host] [data-celebration]').first();
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage).toContainText('Employee of the Month');
  await shot(priya, '06-winner-celebration');
  await closeCelebrations(priya);
  await expect(card.locator('[data-eom-mine]')).toContainText('Congratulations, Priya! You have been selected as Employee of the Month');
  await shot(priya, '07-winner-card');
  const [download] = await Promise.all([priya.waitForEvent('download'), card.locator('[data-eom-certificate]').click()]);
  expect(download.suggestedFilename()).toMatch(/employee-of-the-month-\d{4}-\d{2}\.pdf/);

  // Arjun's card shows the team's winner.
  await arjun.goto('/app');
  await expect(arjun.locator('[data-eom-winner]')).toContainText('Priya Sharma');
  await shot(arjun, '08-teammate-sees-winner');
  await axe(arjun);

  // ── Improvement plan: the manager assigns one to Arjun ──
  await manager.goto('/app/recognition?tab=plans');
  await manager.locator('[data-new-plan]').click();
  dialog = manager.getByRole('dialog');
  const arjunId = await dialog.locator('#p-person option', { hasText: 'Arjun Mehta' }).getAttribute('value');
  await dialog.getByLabel('Person').selectOption(arjunId!);
  await dialog.getByLabel('Plan title').fill('Prospecting and call quality');
  await dialog.getByLabel('Why the plan is needed').fill('Fewer qualified companies than the team for two months.');
  await dialog.getByLabel('Areas to improve (separate with commas)').fill('Prospecting, Call quality');
  await dialog.getByLabel('Current level (optional)').fill('1 qualified company a week');
  await dialog.getByLabel('Required level (optional)').fill('1 qualified company and a good call review');
  await dialog.locator('[data-goal-row="0"]').getByLabel('Measure').selectOption('QUALIFIED_COMPANIES');
  await dialog.locator('[data-goal-row="0"]').getByLabel('Amount').fill('1');
  await dialog.locator('[data-goal-row="0"]').getByLabel('Period').selectOption('PERIOD');
  await dialog.locator('[data-goal-row="1"]').getByLabel('Goal name (optional)').fill('Call quality review');
  await shot(manager, '09-assign-plan');
  await dialog.locator('[data-start-plan]').click();
  const detail = manager.locator('[data-plan-detail]');
  await expect(detail).toContainText('PIP-');
  await expect(detail.locator('[data-plan-status="ACTIVE"]')).toBeVisible();
  await shot(manager, '10-plan-detail');
  await manager.keyboard.press('Escape');

  // ── Arjun sees the plan on his dashboard and acknowledges it ──
  await arjun.reload();
  const pip = arjun.locator('[data-pip-card]');
  await expect(pip).toBeVisible();
  await expect(pip).toContainText('Complete these goals by');
  await expect(pip).toContainText('0 of 2 goals met');
  await shot(arjun, '11-plan-on-dashboard');
  await pip.locator('[data-pip-acknowledge]').click();
  dialog = arjun.getByRole('dialog');
  await dialog.getByLabel('Comment').fill('Understood. I will book two client calls a day.');
  await dialog.locator('[data-pip-send]').click();
  await expect(arjun.locator('[data-pip-card="IN_PROGRESS"]')).toBeVisible();
  await axe(arjun);

  // His records meet the counted goal; the manager scores the evaluation goal.
  await post(arjun.request, '/companies', { name: `Nielsen ${stamp}`, website: `https://nielsen-${stamp}.test` });
  await arjun.reload();
  await expect(pip).toContainText('1 of 2 goals met');
  const planId = new URL((await pip.getByRole('link', { name: 'Open the plan' }).getAttribute('href'))!, 'http://localhost:3000').searchParams.get('plan');
  await manager.goto(`/app/recognition?tab=plans&plan=${planId}`);
  const evaluate = detail.locator('[data-evaluations] [data-evaluate]').first();
  await evaluate.getByLabel('Score (0 to 100)').fill('82');
  await evaluate.getByLabel('Comments').fill('Clear pitch, good questions, kept the client engaged.');
  await evaluate.getByRole('button', { name: 'Save score' }).click();
  await expect(detail.locator('[data-plan-status="READY_FOR_REVIEW"]')).toBeVisible();
  await expect(detail.locator('[data-plan-history]')).toContainText('Acknowledged');
  await shot(manager, '12-ready-for-review');
  // A deadline does not fail a plan; only a decision closes it.
  await detail.locator('[data-decision-form]').getByLabel('Comment for the record').fill('Every goal met. Well done, Arjun.');
  await detail.locator('[data-save-decision]').click();
  await expect(detail.locator('[data-plan-status="COMPLETED"]')).toBeVisible();
  await manager.keyboard.press('Escape');

  // ── Arjun sees the completion once, then the plan card is gone ──
  await arjun.reload();
  const done = arjun.locator('[data-pip-completed]');
  await expect(done).toContainText('Well done! You completed improvement plan');
  await shot(arjun, '13-plan-completed');
  await done.locator('[data-pip-dismiss]').click();
  await expect(done).toHaveCount(0);
  await arjun.reload();
  await expect(arjun.locator('[data-pip-card], [data-pip-completed]')).toHaveCount(0);
  await expect(arjun.locator('[data-eom-card]')).toBeVisible();

  // ── The Super Workspace: winners and the rules ──
  await page.goto('/app/recognition');
  await expect(page.locator('[data-history-row="Priya Sharma"]')).toBeVisible();
  await shot(page, '14-super-recognition', true);
  await page.getByRole('tab', { name: 'Rules' }).click();
  await page.locator('#p-selection').selectOption('AUTOMATIC');
  await page.locator('[data-flag="managersDecidePlans"]').uncheck();
  await page.locator('[data-save-policy]').click();
  await expect(page.locator('[data-recognition-settings]')).toContainText('Saved');
  await shot(page, '15-rules');
  await axe(page);
  const policy = await (await page.request.get('/api/v1/recognition/policy')).json();
  expect(policy).toMatchObject({ selection: 'AUTOMATIC', managersDecidePlans: false });
});
