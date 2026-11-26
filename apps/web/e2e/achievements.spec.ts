import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';
import { expectCleanLayout, LAYOUT_SIZES, setMode } from './layout-check';

/*
 * Achievement celebrations (ADR 0090) in the browser: each real achievement is celebrated once, after the change is
 * saved, in its own design; it never replays on a reload; it waits while a dialog is open; My Achievements keeps the
 * history and the settings. Other suites never see celebrations: they show under test only when a test opts in.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const SBX_URL = 'http://127.0.0.1:4970';
const SBX_KEY = 'sbx_test_key_0123456789';
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function call(page: Page, method: 'post' | 'patch' | 'put', path: string, data: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** Celebrations stay out of every other suite; this one opts in before the first page loads. */
async function optIn(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('sampforce.celebrations.test', 'on'));
}

const popups = (page: Page) => page.locator('[data-celebration-host] [data-celebration]');

/** Waits for the next celebration, checks it is the expected one, and returns it. */
async function celebration(page: Page, kind: string): Promise<Locator> {
  const card = popups(page).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute('data-kind', kind);
  // By its id: once it closes, the next one in the queue takes the first place.
  return page.locator(`[data-celebration="${await card.getAttribute('data-celebration')}"]`);
}

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  // Mid-way through the entrance, so the picture shows the scene, not the first frame.
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function close(page: Page, card: Locator) {
  await card.getByRole('button', { name: 'Close celebration' }).click();
  await expect(card).toBeHidden();
}

/** No celebration appears within a few seconds (claims run half a second after a change, and on page load). */
async function expectNoCelebration(page: Page) {
  await page.waitForTimeout(2500);
  await expect(popups(page)).toHaveCount(0);
}

async function me(page: Page) {
  return (await (await page.request.get('/api/v1/auth/me')).json()) as { tenant: { id: string }; user: { id: string } };
}

/** Today 23:00 UTC (workspaces start on UTC), so a task is due today whatever the time of the run. */
function laterToday(): string {
  const d = new Date();
  d.setUTCHours(23, 0, 0, 0);
  return d.toISOString();
}

async function wonCompany(page: Page, name: string, revenue: number, currency = 'GBP') {
  const lead = await call(page, 'post', '/company-leads', {
    company: { name, country: 'GB', city: 'London', website: `https://${name.toLowerCase().replace(/[^a-z]+/g, '')}.example` },
    employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', emails: [{ value: `priya@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example` }] }],
  });
  const rfq = await call(page, 'post', '/rfqs', { companyId: lead.company.id, contactId: lead.employeeIds[0], projectName: 'UK drivers survey', sampleSize: 400, cpi: 12.5, currency });
  await call(page, 'patch', `/rfqs/${rfq.id}`, { status: 'WON', actualRevenue: revenue });
  return lead.company.id as string;
}

/** "Mark as won" on the company page; the celebration waits for the dialog to close. */
async function markWon(page: Page, companyId: string) {
  await page.goto(`/app/companies/${companyId}`);
  await page.getByRole('button', { name: 'Mark as won' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mark as won' }).click();
  await expect(dialog.getByRole('status')).toContainText(/Deal DEAL-\d+ was made and marked won\./);
  // Saved, but the person is still in the dialog: nothing covers it.
  await expectNoCelebration(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test('converting a company, an RFQ SampBidx accepted and a cleared task list are each celebrated once, in their own design', async ({ page }) => {
  test.setTimeout(180_000);
  await optIn(page);
  await signUp(page, 'Celebration Fieldwork');
  const { user } = await me(page);

  // ── Company converted into a deal: its own card, then the first-won-deal milestone on the full-screen stage ──
  const companyId = await wonCompany(page, 'Northwind Panels Ltd', 5400);
  await markWon(page, companyId);
  const deal = await celebration(page, 'DEAL_CONVERTED');
  await expect(deal).toContainText('Company converted into a deal!');
  await expect(deal).toContainText('Northwind Panels Ltd');
  await expect(deal).toContainText(/DEAL-\d+/);
  await expect(page.locator('[data-confetti="ribbons"]')).toBeVisible();
  await axe(page);
  await shot(page, '01-deal-converted');
  // Hovering pauses the timer so nobody loses it while reading.
  await deal.hover();
  await page.waitForTimeout(9500);
  await expect(deal).toBeVisible();
  await close(page, deal);

  const first = await celebration(page, 'DEALS_WON_MILESTONE');
  await expect(first).toHaveAttribute('data-level', 'MAJOR');
  await expect(first).toContainText('Your first won deal!');
  await shot(page, '02-first-won-deal');
  // Escape closes it too.
  await page.keyboard.press('Escape');
  await expect(first).toBeHidden();

  // A reload never replays a celebration.
  await page.reload();
  await expectNoCelebration(page);

  // ── An RFQ is celebrated only once SampBidx has accepted it ──
  await call(page, 'post', '/apps/sampbidx/keys', { baseUrl: `${SBX_URL}/api`, apiKey: SBX_KEY });
  const lead = await call(page, 'post', '/company-leads', {
    company: { name: 'Acme Panels Pvt Ltd', country: 'IN', city: 'Pune', ownerId: user.id },
    employees: [{ firstName: 'Ravi', lastName: 'Kumar', emails: [{ value: 'ravi@acmepanels.example' }] }],
  });
  const rfq = await call(page, 'post', '/rfqs', { companyId: lead.company.id, contactId: lead.employeeIds[0], projectName: 'India B2B IT decision makers' });
  await call(page, 'patch', `/rfqs/${rfq.id}`, { methodology: 'Online survey', market: 'IN', sampleSize: 400, loi: 15, ir: 20, cpi: 12.5, deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
  await page.goto(`/app/rfqs?open=${rfq.id}`);
  const rfqDialog = page.getByRole('dialog');
  const panel = rfqDialog.getByRole('region', { name: 'Send to SampBidx' });
  await panel.getByRole('button', { name: 'Send this RFQ to SampBidx' }).click();
  await expect(panel.getByRole('status')).toContainText('Sent. SampBidx has it as SBX-');
  await expectNoCelebration(page);
  await page.keyboard.press('Escape');
  await expect(rfqDialog).toBeHidden();
  const sent = await celebration(page, 'RFQ_SUBMITTED');
  await expect(sent).toContainText('RFQ Successfully Submitted!');
  await expect(sent).toContainText(rfq.number);
  await expect(sent).toContainText('SBX-');
  await shot(page, '03-rfq-submitted');
  await close(page, sent);

  // ── Tasks: an important task gets a small toast; the last of today's tasks gets the clean sweep ──
  const important = await call(page, 'post', '/tasks', { title: 'Send the board pack', priority: 'HIGH', assigneeId: user.id, dueAt: laterToday() });
  const routine = await call(page, 'post', '/tasks', { title: 'File the call notes', priority: 'LOW', assigneeId: user.id, dueAt: laterToday() });
  // Finished through the tasks API (the same task.completed change the Tasks page makes); the reload claims it.
  await call(page, 'patch', `/tasks/${routine.id}`, { status: 'DONE' });
  await page.reload();
  // An ordinary task is not a special achievement.
  await expectNoCelebration(page);

  await call(page, 'patch', `/tasks/${important.id}`, { status: 'DONE' });
  await page.reload();
  const toast = await celebration(page, 'TASK_IMPORTANT');
  await expect(toast).toContainText('Send the board pack');
  await shot(page, '04-important-task');
  await close(page, toast);
  const sweep = await celebration(page, 'ALL_TASKS_DONE');
  await expect(sweep).toContainText('All Tasks Completed!');
  await shot(page, '05-all-tasks-done');
  await close(page, sweep);

  // ── My Achievements keeps every one, and opening one shows it still ──
  await page.goto('/app/achievements');
  const timeline = page.locator('[data-achievement-timeline]');
  for (const kind of ['DEAL_CONVERTED', 'DEALS_WON_MILESTONE', 'RFQ_SUBMITTED', 'TASK_IMPORTANT', 'ALL_TASKS_DONE']) await expect(timeline.locator(`[data-kind="${kind}"]`)).toHaveCount(1);
  await expect(page.locator('[data-badge="first-conversion"]')).toHaveAttribute('data-earned', 'yes');
  await expect(page.locator('[data-badge="rfq-launch"]')).toHaveAttribute('data-earned', 'yes');
  await expect(page.locator('[data-stat="Deals converted"]')).toContainText('1');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'RFQs submitted' }).click();
  await expect(timeline.locator('li')).toHaveCount(1);
  await timeline.getByRole('button').first().click();
  const detail = page.getByRole('dialog');
  await expect(detail.locator('[data-celebration]')).toHaveAttribute('data-sfc-still', '');
  await expect(page.locator('[data-confetti]')).toHaveCount(0);
  await axe(page);
  await detail.getByRole('button', { name: 'Close celebration' }).click();
  await expectNoCelebration(page);
});

test('the daily lead target counts only valid new companies, with 25, 50 and 75 percent milestones', async ({ page }) => {
  test.setTimeout(150_000);
  await optIn(page);
  await signUp(page, 'Lead Quota Research');

  await page.goto('/app/achievements');
  await expect(page.locator('[data-lead-progress="DAY"]')).toContainText('0 valid leads. No target set.');
  await page.getByLabel('Leads per day').fill('4');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  const add = (name: string, extra: object) => call(page, 'post', '/companies', { name, ...extra });
  await add('Alpha Insights', { website: 'https://alpha.example', domain: 'alpha.example' });
  await page.reload();
  const quarter = await celebration(page, 'LEAD_MILESTONE');
  await expect(quarter).toContainText('25% of today’s lead target');
  await expect(quarter).toContainText('1/4');
  await shot(page, '06-lead-milestone-25');
  await close(page, quarter);

  // A name alone, or a company already in SampForce, does not count.
  await add('Bare Name Only', {});
  await add('Alpha Insights Copy', { domain: 'alpha.example' });
  await page.reload();
  await expectNoCelebration(page);
  await expect(page.locator('[data-lead-progress="DAY"]')).toContainText('1 of 4 valid leads');
  await expect(page.locator('[data-lead-progress="DAY"]')).toContainText('2 not counted');

  await add('Beta Panels', { primaryEmail: 'hello@beta.example' });
  await add('Gamma Field', { primaryPhone: '+44 20 7946 0000' });
  await page.reload();
  const half = await celebration(page, 'LEAD_MILESTONE');
  await expect(half).toContainText('50%');
  await close(page, half);
  const threeQuarters = await celebration(page, 'LEAD_MILESTONE');
  await expect(threeQuarters).toContainText('75%');
  await shot(page, '07-lead-milestone-75');
  await close(page, threeQuarters);

  await add('Delta Research', { linkedinUrl: 'https://www.linkedin.com/company/delta-research' });
  await page.reload();
  const target = await celebration(page, 'LEAD_TARGET');
  await expect(target).toContainText('Daily Lead Target Achieved!');
  await expect(target).toContainText('4 qualified leads');
  await shot(page, '08-daily-lead-target');
  await close(page, target);
  await expect(page.locator('[data-lead-progress="DAY"]')).toContainText('Target reached');
  await expect(page.locator('[data-badge="quota-reached"]')).toHaveAttribute('data-earned', 'yes');

  // Subtle style: smaller pop-ups and no confetti. A switched-off category is kept in the history without a pop-up.
  await page.getByText('Subtle', { exact: true }).click();
  await page.getByLabel('Tasks and follow-ups', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const { user } = await me(page);
  const task = await call(page, 'post', '/tasks', { title: 'Quiet task', priority: 'HIGH', assigneeId: user.id });
  await call(page, 'patch', `/tasks/${task.id}`, { status: 'DONE' });
  await page.reload();
  await expectNoCelebration(page);
  await expect(page.locator('[data-achievement-timeline] [data-kind="TASK_IMPORTANT"]')).toHaveCount(1);

  // ── The page and its settings: no overlapping or cut-off text in light and dark, desktop, tablet and phone ──
  await axe(page);
  if (PREVIEW_DIR) {
    await page.setViewportSize({ width: 1440, height: await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 3200)) });
    await page.screenshot({ path: `${PREVIEW_DIR}/12-my-achievements.png` });
    await page.locator('#celebration-settings').screenshot({ path: `${PREVIEW_DIR}/13-celebration-settings.png` });
  }
  for (const mode of ['light', 'dark'] as const) {
    await setMode(page, mode);
    for (const size of LAYOUT_SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.reload();
      await expect(page.locator('[data-my-achievements] [data-badge]').first()).toBeVisible();
      await expectCleanLayout(page, 'main');
      if (PREVIEW_DIR && mode === 'dark' && size.name === 'phone') await page.screenshot({ path: `${PREVIEW_DIR}/14-my-achievements-phone-dark.png`, fullPage: true });
    }
  }
});

test('a steady working day and a big deal that reaches the sales target, with reduced motion respected', async ({ page }) => {
  test.setTimeout(180_000);
  await optIn(page);
  await signUp(page, 'Steady Day Analytics');
  const { tenant, user } = await me(page);

  // Reduce motion: the celebration shows its last frame, without movement or confetti.
  await page.goto('/app/achievements');
  await page.getByLabel('Reduce motion').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // ── A day worked from check-in to check-out with a planned break, not overlong ──
  const bar = page.locator('header').first();
  await bar.locator('[data-availability-action="check-in"]').click();
  await expect(bar.locator('[data-availability="WORKING"]')).toBeVisible();
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/e2e-fixture.ts', JSON.stringify({ action: 'backdateWorkSession', tenantId: tenant.id, userId: user.id, hours: 6, breakMinutes: 30 })], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });
  await bar.locator('[data-availability-action="check-out"]').click();
  await expect(bar.locator('[data-availability="CHECKED_OUT"]')).toBeVisible();
  const steady = await celebration(page, 'CONSISTENCY');
  await expect(steady).toContainText('Outstanding Consistency!');
  await expect(steady).toContainText('Your breaks were part of a healthy day.');
  await expect(steady).toHaveAttribute('data-sfc-still', '');
  await expect(page.locator('[data-confetti]')).toHaveCount(0);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/09-steady-day-still.png` });
  await close(page, steady);

  // ── A monthly sales target and a major deal, full motion ──
  await page.goto('/app/achievements');
  await page.getByLabel('Reduce motion').uncheck();
  await page.getByLabel(/Revenue per month/).fill('10000');
  await page.getByLabel(/Major deal from/).fill('8000');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // In the workspace's own currency: a deal in another currency is only compared once exchange rates are set.
  const companyId = await wonCompany(page, 'Contoso Healthcare Panels', 12_000, 'USD');
  await markWon(page, companyId);
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    await expect(popups(page).first()).toBeVisible({ timeout: 15_000 });
    const card = page.locator(`[data-celebration="${await popups(page).first().getAttribute('data-celebration')}"]`);
    const kind = (await card.getAttribute('data-kind'))!;
    seen.push(kind);
    if (kind === 'SALES_TARGET') {
      await expect(card).toContainText('Sales Target Achieved!');
      await expect(card).toContainText('120%');
      await shot(page, '10-sales-target');
    }
    if (kind === 'MAJOR_DEAL') {
      await expect(card).toContainText('Major deal closed!');
      await expect(page.locator('[data-confetti="stars"]')).toBeVisible();
      await shot(page, '11-major-deal-stage');
    }
    await close(page, card);
  }
  expect(seen.sort()).toEqual(['DEALS_WON_MILESTONE', 'DEAL_CONVERTED', 'MAJOR_DEAL', 'SALES_TARGET']);
  await page.goto('/app/achievements');
  await expect(page.locator('[data-sales-progress]')).toContainText('120%');
  await expect(page.locator('[data-badge="big-win"]')).toHaveAttribute('data-earned', 'yes');
});
