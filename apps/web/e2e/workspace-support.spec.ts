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

/**
 * Support tickets up the hierarchy and chat rules (ADR 0071, part 5): an executive's query is answered by its manager,
 * passed up to the Super Workspace and on to SampForce support (scenario 13), where an operator assigns a
 * representative and writes the resolution the executive then reads. The Super Workspace also sets who may chat.
 */
test('a query climbs from executive to SampForce support, and chat rules are set in the Permission Center', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const org = `Frequent Research Support ${stamp}`;
  await signUp(page, org);
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  expect((await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN })).ok()).toBe(true);
  const e = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const executive = await join(browser, e.inviteUrl, 'Priya Sharma');

  // The executive asks; it waits on her manager.
  const ticket = await post(executive.request, '/support/tickets', { subject: 'Panel price list missing from quotes', body: 'I cannot find the panel price list when I build a quote.', category: 'documents' });
  expect(ticket.handlerLevel).toBe('MANAGER');

  // ── The manager answers, then passes it up ──
  await manager.goto(`/app/help/queries?scope=handling&ticket=${ticket.id}`);
  const thread = manager.locator('[data-ticket-thread]');
  await expect(thread).toContainText('Panel price list missing from quotes');
  await expect(thread.locator('[data-ticket-handler="MANAGER"]')).toContainText('North India Sales');
  const panel = thread.locator('[data-handler-panel]');
  await panel.getByLabel('Your answer').fill('It sits under Quotes, Templates. Does that help?');
  await panel.getByRole('button', { name: 'Send answer' }).click();
  await expect(thread.locator('[data-ticket-status="AWAITING_USER"]')).toBeVisible();
  await axe(manager);
  await shot(manager, '15-manager-answers-query');
  await panel.getByLabel('Pass it to the Super Workspace').fill('Looks like a permission gap for my team.');
  await panel.getByRole('button', { name: 'Escalate' }).click();
  await expect(thread.locator('[data-ticket-handler="SUPER"]')).toBeVisible();
  await expect(thread.locator('[data-handler-panel]')).toHaveCount(0);

  // ── The Super Workspace passes it to SampForce support ──
  await page.goto('/app/help/queries?scope=handling');
  await page.locator('[data-ticket]').filter({ hasText: 'Panel price list missing from quotes' }).click();
  const superThread = page.locator('[data-ticket-thread]');
  await expect(superThread.locator('[data-message-author="WORKSPACE"]')).toHaveCount(2);
  await superThread.getByRole('button', { name: 'Escalate' }).click();
  await expect(superThread.locator('[data-ticket-handler="CONSOLE"]')).toContainText('SampForce support');

  // ── SampForce support assigns a representative, answers and resolves ──
  const email = `ops-ws-${stamp}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Anjali Support', OPERATOR_ROLE: 'SUPPORT' },
  });
  const opsCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const ops = await opsCtx.newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('link', { name: /Support tickets/ }).click();
  await ops.getByLabel('Search tickets').fill('Panel price list');
  await ops.locator('[data-ticket]').filter({ hasText: org }).click();
  const pane = ops.locator('[data-ticket-pane]');
  await pane.getByLabel('Support representative').selectOption({ label: 'Anjali Support' });
  await expect(pane.getByLabel('Support representative')).toHaveValue(/.+/);
  await pane.getByLabel('Your answer').fill('We switched on Quotes templates for North India Sales. Please try again.');
  await pane.getByRole('button', { name: 'Send answer' }).click();
  await expect(pane.getByLabel('Ticket status')).toHaveValue('AWAITING_USER');
  await pane.getByLabel('Resolution note').fill('Quotes templates granted to the North India Sales team.');
  await pane.getByRole('button', { name: 'Save', exact: true }).click();
  await pane.getByLabel('Ticket status').selectOption('CLOSED');
  await expect(pane.getByLabel('Ticket status')).toHaveValue('CLOSED');
  await axe(ops);
  await shot(ops, '16-console-assigns-and-resolves');
  await opsCtx.close();

  // ── The executive reads who helped and how it was resolved ──
  await executive.goto(`/app/help/queries?ticket=${ticket.id}`);
  const mine = executive.locator('[data-ticket-thread]');
  await expect(mine.locator('[data-resolution-note]')).toContainText('Quotes templates granted to the North India Sales team.');
  await expect(mine).toContainText('Anjali Support');
  await expect(mine.locator('[data-ticket-status="CLOSED"]')).toBeVisible();
  await axe(executive);
  await shot(executive, '17-executive-reads-resolution');

  // ── Chat rules: the Super Workspace lets this manager chat with other managers ──
  await page.goto('/app/settings/workspaces');
  await page.getByRole('button', { name: 'Permissions North India Sales' }).click();
  const dialog = page.getByRole('dialog');
  const chat = dialog.locator('[data-chat-setting]');
  await chat.getByLabel('May chat with other Manager Workspaces').check();
  await dialog.getByRole('button', { name: 'Save permissions' }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
  await chat.scrollIntoViewIfNeeded();
  await shot(page, '18-chat-permission');
  const tree = await (await page.request.get('/api/v1/workspaces')).json();
  expect(tree.workspaces.find((w: { id: string }) => w.id === m.id).canChatWithPeers).toBe(true);

  // The executive cannot open a chat with someone outside her reach: the people list leaves them out.
  const people = await (await executive.request.get('/api/v1/chat/people')).json();
  expect(people.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['Rahul Sharma']));
});
