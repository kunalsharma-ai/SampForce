import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { FEATURE_KEYS } from '@dealflow/types';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (sampforce/previews/help-center). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  // A pointer left over a button after a click would check its hover colour instead.
  await page.mouse.move(0, 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/**
 * The Help Center (ADR 0073), end to end: a Help menu at every workspace level, searchable FAQs and feature guides
 * that leave out what the workspace was not given, "Other: raise a query", the Console's Support tickets inbox and
 * the answer reaching the person who asked.
 */
test('help at every level, a raised query and its answer from the Console', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const org = `Help Desk ${Date.now()}`;
  await signUp(page, org);

  // ── Super Workspace: the Help Center ──
  await page.goto('/app/help');
  const center = page.locator('[data-help-center="workspace"]');
  await expect(center.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
  await expect(center.locator('[data-help-category="workspaces"]')).toBeVisible();
  await expect(center.locator('[data-faq="workspaces.permissionCenter"]')).toBeAttached();
  await axe(page);
  await shot(page, '01-help-center-super-workspace');

  // A topic narrows the questions and guides to it; a question opens in place.
  await center.locator('[data-help-category="deals"]').click();
  await expect(center.locator('[data-faq-group]')).toHaveCount(1);
  await center.locator('[data-faq="deals.move"] summary').click();
  await expect(center.locator('[data-faq="deals.move"]')).toContainText('drag the card to the next column');
  await center.locator('#faqs').scrollIntoViewIfNeeded();
  await shot(page, '02-topic-deals-faqs');
  await center.getByRole('button', { name: 'Show all topics' }).click();

  // One search across answers and guides.
  await page.getByRole('searchbox', { name: 'Search help' }).fill('import excel');
  const results = page.locator('[data-help-results]');
  await expect(results.locator('[data-faq="data.import"]')).toBeVisible();
  await expect(results.locator('[data-help-guide="page.import"]')).toBeVisible();
  await shot(page, '03-search-answers-and-guides');
  await results.locator('[data-help-guide="page.import"]').click();
  await expect(page.getByRole('dialog', { name: 'Import data' })).toBeVisible();
  await shot(page, '04-feature-guide-dialog');
  await page.keyboard.press('Escape');

  // ── The Help menu in the top bar, from any page ──
  await page.goto('/app/deals');
  await page.locator('[data-help-menu]').click();
  const menu = page.locator('[data-help-panel="workspace"]');
  await expect(menu.getByRole('link', { name: 'Frequently asked questions' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'My queries' })).toBeVisible();
  await shot(page, '05-help-menu');
  await menu.getByRole('link', { name: 'Other: raise a query' }).click();

  // ── Other: raise a query, with answers suggested as you type ──
  const form = page.locator('[data-raise-query-dialog]');
  await expect(form.getByRole('heading', { name: 'Raise a query' })).toBeVisible();
  await form.getByLabel('What do you need help with?').fill('Export deals to Excel for our board');
  await expect(form.locator('[data-query-suggestions]')).toContainText('How do I export my records?');
  await form.getByLabel('Topic').selectOption('deals');
  await form.getByLabel('Feature (optional)').selectOption('data_export');
  await form.getByLabel('Details').fill('We need every open deal with its owner and stage in one file before Monday’s board meeting.');
  await form.getByText('High priority').click();
  // A screenshot, a call back and what the app already knows.
  await form.locator('#query-files').setInputFiles({ name: 'deals-board.png', mimeType: 'image/png', buffer: Buffer.from('a screenshot of the deals board') });
  await expect(form.locator('[data-attached-file="deals-board.png"]')).toBeVisible();
  await form.getByText('Phone', { exact: true }).click();
  await form.getByLabel('Phone number').fill('+91 98765 43210');
  await expect(form.locator('[data-query-context]')).toContainText('your workspace, role, email and app version');
  await expect(form.getByText('Sent with the page you came from: /app/deals')).toBeVisible();
  await axe(page);
  await shot(page, '06-raise-a-query');
  await form.getByRole('button', { name: 'Send query' }).click();
  await expect(form.locator('[data-query-sent]')).toContainText('Query #1 sent');
  await shot(page, '07-query-sent');
  await form.getByRole('link', { name: 'Open my query' }).click();
  await expect(page).toHaveURL(/\/app\/help\/queries\?ticket=/);
  const thread = page.locator('[data-ticket-thread="1"]');
  await expect(thread).toContainText('Export deals to Excel for our board');
  await expect(thread.locator('[data-message-file="deals-board.png"]')).toBeVisible();
  await expect(thread.locator('[data-ticket-status="SUBMITTED"]')).toBeVisible();
  await axe(page);
  await shot(page, '08-my-queries');

  // ── Manager and Executive Workspaces see only what they were given ──
  const created = await post(page.request, '/workspaces', {
    level: 'MANAGER',
    name: 'North India Sales',
    features: FEATURE_KEYS.filter((k) => k !== 'sequences' && k !== 'rfqs'),
    person: { inviteEmail: `rahul.${Date.now()}@example.com` },
  });
  const exec = await post(page.request, '/workspaces', { level: 'EXECUTIVE', name: 'Amit Desk', parentId: created.id, person: { inviteEmail: `amit.${Date.now()}@example.com` } });
  for (const [ws, name, file] of [
    [created, 'Rahul Sharma', '09-help-center-manager-workspace'],
    [exec, 'Amit Verma', '10-help-center-executive-workspace'],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const token = (ws.inviteUrl as string).split('/invite/')[1]!;
    const accept = await p.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
    expect(accept.ok(), await accept.text()).toBe(true);
    await p.goto('/app/help');
    const c = p.locator('[data-help-center="workspace"]');
    await expect(c.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
    // Sequences and RFQs were not given to North India Sales, so no answer or guide mentions them.
    await expect(c.locator('[data-help-guide="page.deals"]')).toBeVisible();
    await expect(c.locator('[data-help-guide="page.sequences"]')).toHaveCount(0);
    await expect(c.locator('[data-faq="outreach.sequence"]')).toHaveCount(0);
    await expect(c.locator('[data-faq="deals.rfq"]')).toHaveCount(0);
    // Only managers and the Super Workspace run a Permission Center.
    await expect(c.locator('[data-faq="workspaces.permissionCenter"]')).toHaveCount(ws === created ? 1 : 0);
    await expect(p.locator('[data-help-menu]')).toBeVisible();
    await shot(p, file);
    await ctx.close();
  }

  // ── The Console answers ──
  const email = `ops-help-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Priya Support', OPERATOR_ROLE: 'SUPPORT' },
  });
  const opsCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const ops = await opsCtx.newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('link', { name: /Support tickets/ }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Support tickets' })).toBeVisible();
  await ops.getByLabel('Search tickets').fill('Export deals to Excel');
  const row = ops.locator('[data-ticket]').filter({ hasText: org });
  await expect(row).toContainText('Export deals to Excel for our board');
  await row.click();
  const pane = ops.locator('[data-ticket-pane]');
  await expect(pane).toContainText(org);
  await expect(pane).toContainText('/app/deals');
  await expect(pane).toContainText('+91 98765 43210');
  await expect(pane.locator('[data-message-file="deals-board.png"]')).toBeVisible();
  // Opening a new ticket marks it Under review.
  await expect(pane.getByLabel('Ticket status')).toHaveValue('UNDER_REVIEW');
  await pane.getByLabel('Your answer').fill('Open Deals, choose the Table view, filter to open deals and choose Export. The file has the owner and stage columns.');
  await pane.getByRole('button', { name: 'Send answer' }).click();
  await expect(pane.locator('[data-ticket-status="AWAITING_USER"]')).toHaveCount(0); // the pane uses a status picker
  await expect(pane.getByLabel('Ticket status')).toHaveValue('AWAITING_USER');
  // Answered tickets leave the Open tab; they are found under Answered.
  await ops.locator('[data-status-filter="AWAITING_USER"]').click();
  await expect(ops.locator('[data-ticket]').filter({ hasText: org })).toBeVisible();

  // Support reports: what was raised, by whom and how fast.
  await ops.locator('[data-support-view="reports"]').click();
  const report = ops.locator('[data-support-report]');
  await expect(report.locator('[data-report-stat="raised"]')).not.toContainText(/^\D*0$/);
  await expect(report.locator('[data-report-group="client"]')).toContainText(org);
  await expect(report.locator('[data-report-group="topic"] [data-report-row="deals"]')).toBeVisible();
  await report.locator('[data-report-days="7"]').click();
  await expect(report.locator('[data-report-trend] li')).toHaveCount(7);
  await axe(ops);
  await shot(ops, '26-console-support-reports', true);
  await ops.locator('[data-support-view="tickets"]').click();
  await axe(ops);
  await shot(ops, '11-console-support-tickets');
  await ops.getByRole('link', { name: 'Help', exact: true }).click();
  const consoleHelp = ops.locator('[data-help-center="console"]');
  await expect(consoleHelp.locator('[data-faq="console.tickets"]')).toBeAttached();
  await expect(consoleHelp.locator('[data-help-guide="page.operatorSupport"]')).toBeVisible();
  await expect(consoleHelp.locator('[data-raise-query-card]')).toHaveCount(0);
  await axe(ops);
  await shot(ops, '12-console-help');
  await opsCtx.close();

  // ── The answer reaches the person who asked ──
  await page.reload();
  await expect(thread.locator('[data-message-author="OPERATOR"]')).toContainText('choose the Table view');
  await expect(thread.locator('[data-ticket-status="AWAITING_USER"]')).toBeVisible();
  await expect(thread.locator('[data-message-author="OPERATOR"]')).toContainText('SampForce support');
  await shot(page, '13-query-answered');
  await thread.getByLabel('Reply').fill('Thanks, that worked.');
  await thread.getByRole('button', { name: 'Send reply' }).click();
  await expect(thread.locator('[data-ticket-status="UNDER_REVIEW"]')).toBeVisible();
  await thread.getByRole('button', { name: 'Close query' }).click();
  await expect(thread.locator('[data-ticket-status="CLOSED"]')).toBeVisible();

  // ── In Arabic, right to left ──
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption('ar');
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/app/help');
  await expect(page.getByRole('heading', { level: 1, name: 'كيف يمكننا المساعدة؟' })).toBeVisible();
  await expect(page.locator('[data-faq="account.password"]')).toContainText('نسيت كلمة المرور');
  await shot(page, '14-help-center-arabic');
});

test('the Help Center on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, 'Help Phone');
  await page.goto('/app/help');
  await expect(page.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
  await expect(page.locator('[data-help-menu]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, '15-help-center-phone');
});
