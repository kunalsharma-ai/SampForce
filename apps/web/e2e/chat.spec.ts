import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

/** A teammate in the signed-in workspace, signed in in their own browser. */
async function teammate(browser: Browser, page: Page, name: string, roleKey = 'member') {
  const inv = await post(page, '/tenants/current/invitations', { email: `${name.split(' ')[0]!.toLowerCase()}-${Date.now()}@example.com`, roleKey });
  const ctx = await browser.newContext();
  const res = await ctx.request.post('/api/v1/auth/invitations/accept', { headers: ORIGIN, data: { token: inv.inviteUrl.split('/invite/')[1], name, password: 'a-long-password-1' } });
  expect(res.ok(), await res.text()).toBe(true);
  return { ctx, page: await ctx.newPage() };
}

test('colleagues chat live in a channel and direct messages, with files, record links, read receipts and search', async ({ page, browser }) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => void d.accept());
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const acme = await post(page, '/companies', { name: 'Acme Panels', country: 'IN', city: 'Pune' });
  const priya = await teammate(browser, page, 'Priya Nair');
  const main = page.getByRole('main');

  // Team chat is in the sidebar and the top bar.
  await page.goto('/app');
  await page.getByRole('link', { name: 'Team chat' }).first().click();
  await expect(page).toHaveURL(/\/app\/chat$/);
  await expect(main.getByRole('heading', { name: 'Team chat', level: 1 })).toBeVisible();
  await expect(main.locator('[data-chat-connection="live"]')).toBeVisible();

  // A channel for project updates, with Priya in it.
  await main.getByRole('button', { name: 'New channel' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Channel name').fill('Project updates');
  await dialog.getByLabel('What it is about').fill('Fieldwork status for every project');
  await dialog.getByLabel('Priya Nair').check();
  await dialog.getByRole('button', { name: 'Create channel' }).click();
  await expect(dialog).toBeHidden();
  await expect(main.getByRole('heading', { name: 'Project updates', level: 2 })).toBeVisible();

  // Priya is elsewhere in SampForce: the message reaches her live, as a pop-up, a badge and the tab title.
  await priya.page.goto('/app');
  await expect(priya.page.locator('[data-chat-unread="0"]')).toBeAttached();
  await main.getByLabel('Message', { exact: true }).fill('India B2B fieldwork starts Monday. Quotas are in the sheet.');
  await main.getByLabel('Message', { exact: true }).press('Enter');
  await expect(main.locator('[data-message]').filter({ hasText: 'India B2B fieldwork starts Monday.' })).toBeVisible();
  // It reached her device at once: Delivered, before she reads it.
  await expect(main.locator('[data-read-receipt="delivered"]')).toBeVisible();
  const notice = priya.page.locator('[data-chat-notice="Project updates"]');
  await expect(notice).toContainText('India B2B fieldwork starts Monday.');
  await expect(priya.page.locator('[data-chat-unread="1"]')).toBeVisible();
  await expect(priya.page).toHaveTitle(/^\(1\) /);
  await priya.page.goto('/app/chat');
  const pm = priya.page.getByRole('main');
  const item = pm.locator('[data-conversation="Project updates"]');
  // On a wide screen the chat page opens the newest conversation by itself, which reads it at once, so its unread
  // badge may already be gone here; the badge in the sidebar and the tab title above proved it was unread.
  await expect(item).toBeVisible();
  await item.click();
  await expect(pm.locator('[data-message]').filter({ hasText: 'India B2B fieldwork starts Monday.' })).toBeVisible();
  // Opening it reads it: the sender sees the read receipt, the badge clears.
  await expect(main.locator('[data-read-receipt="seen"]')).toContainText('Seen');
  await expect(priya.page.locator('[data-chat-unread="0"]')).toBeAttached();
  await expect(priya.page).not.toHaveTitle(/^\(\d+\) /);

  // Typing shows on the other side, and stops when the message arrives.
  await main.getByLabel('Message', { exact: true }).pressSequentially('Checking the', { delay: 20 });
  await expect(pm.locator('[data-typing]')).toContainText('Test Person is typing…');
  await expect(pm.locator('[data-chat-subtitle]')).toContainText('Test Person is typing…');
  await main.getByLabel('Message', { exact: true }).fill('');

  // Priya answers with a file; the owner points the channel at the company.
  await pm.locator('[data-chat-file-input]').setInputFiles({ name: 'quota-sheet.csv', mimeType: 'text/csv', buffer: Buffer.from('market,n\nIN,400\n') });
  await expect(pm.getByText('quota-sheet.csv')).toBeVisible();
  await pm.getByLabel('Message', { exact: true }).fill('Quota sheet for the India B2B tracker.');
  await pm.getByRole('button', { name: 'Send' }).click();
  await expect(main.locator('[data-message]').filter({ hasText: 'Quota sheet for the India B2B tracker.' })).toBeVisible();
  await expect(main.getByRole('link', { name: /quota-sheet\.csv/ })).toBeVisible();
  await main.getByRole('button', { name: 'Link a company, RFQ or deal' }).click();
  const picker = page.getByRole('dialog');
  await picker.getByLabel('Search by name or number').fill('Acme');
  await picker.getByRole('button', { name: /Acme Panels/ }).click();
  await main.getByLabel('Message', { exact: true }).fill('Priya from Acme asked for the feasibility today.');
  await main.getByRole('button', { name: 'Send' }).click();
  await expect(pm.locator('[data-message]').filter({ hasText: 'Priya from Acme asked for the feasibility today.' })).toBeVisible();
  const companyLink = main.getByRole('link', { name: new RegExp(`${acme.leadNumber} Acme Panels`) });
  await expect(companyLink).toHaveAttribute('href', `/app/companies/${acme.id}`);
  const download = page.waitForEvent('download');
  await main.getByRole('link', { name: /quota-sheet\.csv/ }).click();
  expect((await download).suggestedFilename()).toBe('quota-sheet.csv');
  await axe(page);
  await shot(page, '01-team-chat-project-updates-channel');

  // Edit your own message.
  const mineId = await main.locator('[data-message]').filter({ hasText: 'India B2B fieldwork starts Monday.' }).getAttribute('data-message');
  const mine = main.locator(`[data-message="${mineId}"]`);
  await mine.getByRole('button', { name: 'Edit' }).click();
  await mine.getByLabel('Edit message').fill('India B2B fieldwork starts Tuesday. Quotas are in the sheet.');
  await mine.getByRole('button', { name: 'Save' }).click();
  await expect(pm.locator('[data-message]').filter({ hasText: 'India B2B fieldwork starts Tuesday.' })).toBeVisible();
  await expect(pm.getByText('(edited)')).toBeVisible();

  // A direct message.
  await main.getByRole('button', { name: 'New message' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Priya Nair/ }).click();
  await expect(main.getByRole('heading', { name: 'Priya Nair', level: 2 })).toBeVisible();
  await main.getByLabel('Message', { exact: true }).fill('Can you call Acme about the feasibility budget?');
  await main.getByLabel('Message', { exact: true }).press('Enter');
  await expect(pm.locator('[data-conversation="Test Person"]')).toContainText('Can you call Acme');
  await shot(page, '02-team-chat-direct-message');

  // Search finds messages across your conversations.
  await main.getByLabel('Search messages').fill('feasibility');
  const results = main.getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('listitem')).toHaveCount(2);
  await shot(page, '03-team-chat-search');
  await results.getByRole('button', { name: /Project updates/ }).click();
  await expect(main.getByRole('heading', { name: 'Project updates', level: 2 })).toBeVisible();
  await priya.ctx.close();
});

test('messages written without a connection wait on the device and are sent when it returns', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Offline Office Ltd');
  const ravi = await teammate(browser, page, 'Ravi Kumar');
  const ch = await post(page, '/chat/conversations', { kind: 'CHANNEL', name: 'Project updates', memberIds: [] });
  const members = (await (await page.request.get('/api/v1/chat/people')).json()) as Array<{ id: string; name: string }>;
  await post(page, `/chat/conversations/${ch.id}/members`, { userIds: [members.find((m) => m.name === 'Ravi Kumar')!.id] });
  await page.goto(`/app/chat?c=${ch.id}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Project updates', level: 2 })).toBeVisible();

  await ravi.page.goto(`/app/chat?c=${ch.id}`);
  const rm = ravi.page.getByRole('main');
  await expect(rm.locator('[data-chat-connection="live"]')).toBeVisible();

  // The office network drops: Ravi keeps writing.
  await ravi.ctx.setOffline(true);
  await expect(rm.locator('[data-chat-connection="offline"]')).toBeVisible();
  await expect(rm.getByRole('status')).toContainText('You are offline.');
  await rm.getByLabel('Message', { exact: true }).fill('Pune site: 120 completes today.');
  await rm.getByLabel('Message', { exact: true }).press('Enter');
  await rm.locator('[data-chat-file-input]').setInputFiles({ name: 'pune-tally.txt', mimeType: 'text/plain', buffer: Buffer.from('completes=120') });
  await expect(rm.getByText('pune-tally.txt')).toBeVisible();
  await rm.getByLabel('Message', { exact: true }).fill('Tally attached.');
  await rm.getByLabel('Message', { exact: true }).press('Enter');
  await expect(rm.locator('[data-outbox="queued"]')).toHaveCount(2);
  await expect(rm.getByText('Waiting for the connection. It will be sent automatically.').first()).toBeVisible();
  await shot(ravi.page, '04-team-chat-offline-outbox');
  // Nothing has reached the server.
  await page.waitForTimeout(1500);
  await expect(main.locator('[data-message]').filter({ hasText: 'Pune site: 120 completes today.' })).toHaveCount(0);

  // The tab is closed while offline. The messages stay on the device.
  await ravi.page.close();
  await ravi.ctx.setOffline(false);
  const again = await ravi.ctx.newPage();
  await again.goto('/app');
  // Back online, the outbox is sent in order, and the colleague receives both live.
  await expect(main.locator('[data-message]').filter({ hasText: 'Pune site: 120 completes today.' })).toBeVisible({ timeout: 15_000 });
  await expect(main.locator('[data-message]').filter({ hasText: 'Tally attached.' })).toBeVisible();
  await expect(main.getByRole('link', { name: /pune-tally\.txt/ })).toBeVisible();
  const order = await main.locator('[data-message]').allInnerTexts();
  expect(order.findIndex((x) => x.includes('Pune site'))).toBeLessThan(order.findIndex((x) => x.includes('Tally attached')));
  await again.goto(`/app/chat?c=${ch.id}`);
  await expect(again.getByRole('main').locator('[data-outbox]')).toHaveCount(0);
  await expect(again.getByRole('main').locator('[data-message]').filter({ hasText: 'Tally attached.' })).toBeVisible();
  // Sent exactly once each.
  const stored = (await (await page.request.get(`/api/v1/chat/conversations/${ch.id}/messages`)).json()) as Array<{ body: string }>;
  expect(stored.filter((m) => m.body === 'Pune site: 120 completes today.')).toHaveLength(1);
  await shot(page, '05-team-chat-delivered-after-reconnect');
  await ravi.ctx.close();
});

test('a workspace admin and a super admin talk on the support line', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const org = `Lakeside Research ${Date.now().toString(36).slice(-4).toUpperCase()}`;
  await signUp(page, org);
  await page.goto('/app/chat');
  const main = page.getByRole('main');
  await main.locator('[data-conversation="SampForce support"]').click();
  await expect(main.getByRole('heading', { name: 'SampForce support', level: 2 })).toBeVisible();
  await expect(main.getByText('Your workspace admins and the SampForce super admins')).toBeVisible();
  await main.getByLabel('Message', { exact: true }).fill('Hello, can you raise our seat limit to 25 before Monday?');
  await main.getByLabel('Message', { exact: true }).press('Enter');
  await expect(main.locator('[data-read-receipt="sent"]')).toBeVisible();

  const email = `ops-chat-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Kunal Sharma', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('link', { name: /Support chat/ }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Support chat' })).toBeVisible();
  const om = ops.getByRole('main');
  await om.getByLabel('Search workspaces').fill(org);
  const line = om.locator('[data-conversation="SampForce support"]').filter({ hasText: org });
  await expect(line).toContainText('1');
  await line.click();
  await expect(om.locator('[data-message]').filter({ hasText: 'Hello, can you raise our seat limit to 25 before Monday?' })).toBeVisible();
  // The receipt sits under the admin's own latest message, so check it before the reply becomes the latest one.
  await expect(main.locator('[data-read-receipt="seen"]')).toBeVisible();
  await om.getByLabel('Message', { exact: true }).fill('Done. You now have 25 seats; the invoice follows the usual way.');
  await om.getByLabel('Message', { exact: true }).press('Enter');
  await expectNoViolations(ops);
  await shot(ops, '06-operator-support-chat');

  // The admin sees the reply live, marked as from a super admin.
  const reply = main.locator('[data-message]').filter({ hasText: 'Done. You now have 25 seats' });
  await expect(reply).toBeVisible();
  await expect(reply.getByText('Super admin')).toBeVisible();
  await axe(page);
  await shot(page, '07-team-chat-support-line');
});

test('a group of three stays in sync across devices, through a refresh, a dropped network and a gateway without WebSockets', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, 'Group Sync Research');
  const asha = await teammate(browser, page, 'Asha Rao');
  const vik = await teammate(browser, page, 'Vikram Shah');
  // Vikram's office gateway does not pass WebSockets on: his browser falls back to held requests.
  await vik.ctx.route(/\/api\/v1\/chat\/socket-ticket$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: 'x', path: '/api/v1/chat/no-socket-here', expiresAt: new Date().toISOString() }) }));
  const main = page.getByRole('main');

  // A group from New message: pick two people.
  await page.goto('/app/chat');
  await main.getByRole('button', { name: 'New message' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add Asha Rao to a group' }).click();
  await dialog.getByRole('button', { name: /^Vikram Shah/ }).click();
  await dialog.getByLabel('Group name').fill('Pune field team');
  await dialog.getByRole('button', { name: 'Start group' }).click();
  await expect(main.getByRole('heading', { name: 'Pune field team', level: 2 })).toBeVisible();

  await asha.page.goto('/app/chat');
  const am = asha.page.getByRole('main');
  await vik.page.goto('/app/chat');
  const vm = vik.page.getByRole('main');
  await expect(vm.locator('[data-chat-connection="live"][data-chat-transport="polling"]')).toBeVisible({ timeout: 20_000 });
  await expect(am.locator('[data-chat-connection="live"][data-chat-transport="websocket"]')).toBeVisible();
  await am.locator('[data-conversation="Pune field team"]').click();
  await vm.locator('[data-conversation="Pune field team"]').click();
  // Everyone sees the others online.
  await expect(main.locator('[data-chat-subtitle]')).toContainText('3 people, 3 online');

  // Three people write at once; everyone ends with all three, once each, in the same order.
  await Promise.all([
    main.getByLabel('Message', { exact: true }).fill('Owner: quotas updated'),
    am.getByLabel('Message', { exact: true }).fill('Asha: 40 completes'),
    vm.getByLabel('Message', { exact: true }).fill('Vikram: 35 completes'),
  ]);
  await Promise.all([main.getByLabel('Message', { exact: true }).press('Enter'), am.getByLabel('Message', { exact: true }).press('Enter'), vm.getByLabel('Message', { exact: true }).press('Enter')]);
  const texts = ['Owner: quotas updated', 'Asha: 40 completes', 'Vikram: 35 completes'];
  for (const m of [main, am, vm]) for (const x of texts) await expect(m.locator('[data-message]').filter({ hasText: x })).toHaveCount(1, { timeout: 15_000 });
  const orderOf = async (m: typeof main) => (await m.locator('[data-message]').allInnerTexts()).map((x) => texts.find((y) => x.includes(y))).filter(Boolean);
  expect(await orderOf(am)).toEqual(await orderOf(main));
  expect(await orderOf(vm)).toEqual(await orderOf(main));
  // Everyone has read everything: "Seen by everyone".
  await main.getByLabel('Message', { exact: true }).fill('Great, thanks both');
  await main.getByLabel('Message', { exact: true }).press('Enter');
  await expect(main.locator('[data-read-receipt="seen"]')).toContainText('Seen by everyone', { timeout: 15_000 });

  // Asha's second device (another browser session of hers) has the same history.
  const ashaPhone = await browser.newContext({ storageState: await asha.ctx.storageState() });
  const phone = await ashaPhone.newPage();
  await phone.goto('/app/chat');
  await phone.getByRole('main').locator('[data-conversation="Pune field team"]').click();
  for (const x of texts) await expect(phone.getByRole('main').locator('[data-message]').filter({ hasText: x })).toHaveCount(1);

  // A refresh keeps the conversation and its history.
  await asha.page.reload();
  await expect(am.getByRole('heading', { name: 'Pune field team', level: 2 })).toBeVisible();
  for (const x of texts) await expect(am.locator('[data-message]').filter({ hasText: x })).toHaveCount(1);

  // Asha's network drops; messages sent meanwhile arrive when it returns, without a reload.
  await asha.ctx.setOffline(true);
  await expect(am.locator('[data-chat-connection="offline"]')).toBeVisible({ timeout: 15_000 });
  await main.getByLabel('Message', { exact: true }).fill('Sent while Asha was offline');
  await main.getByLabel('Message', { exact: true }).press('Enter');
  await page.waitForTimeout(1000);
  await expect(am.locator('[data-message]').filter({ hasText: 'Sent while Asha was offline' })).toHaveCount(0);
  await asha.ctx.setOffline(false);
  await expect(am.locator('[data-chat-connection="live"]')).toBeVisible({ timeout: 20_000 });
  await expect(am.locator('[data-message]').filter({ hasText: 'Sent while Asha was offline' })).toHaveCount(1, { timeout: 15_000 });
  await expect(vm.locator('[data-message]').filter({ hasText: 'Sent while Asha was offline' })).toHaveCount(1, { timeout: 15_000 });
  await phone.getByRole('main').locator('[data-message]').filter({ hasText: 'Sent while Asha was offline' }).waitFor();
  await shot(page, '08-team-chat-group-in-sync');
  await shot(vik.page, '09-team-chat-compatibility-mode');
  await ashaPhone.close();
  await asha.ctx.close();
  await vik.ctx.close();
});

async function expectNoViolations(page: Page) {
  await axe(page);
}
