import { type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Quick chat (redesign R9): a tab on the right edge (a tab of the bottom bar on phones) opens team chat over any page.
 * It sits in a gutter the page keeps free, so it covers nothing; new messages ring a short chime that can be muted.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function teammate(browser: Browser, page: Page, name: string) {
  const inv = await post(page, '/tenants/current/invitations', { email: `${name.split(' ')[0]!.toLowerCase()}-${Date.now()}@example.com`, roleKey: 'member' });
  const ctx = await browser.newContext();
  const res = await ctx.request.post('/api/v1/auth/invitations/accept', { headers: ORIGIN, data: { token: inv.inviteUrl.split('/invite/')[1], name, password: 'a-long-password-1' } });
  expect(res.ok(), await res.text()).toBe(true);
  return { ctx, page: await ctx.newPage() };
}

const chimes = (page: Page) => page.evaluate(() => (globalThis as { __sfChimes?: number }).__sfChimes ?? 0);

test('quick chat opens from any page, covers nothing and rings for new messages', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Quick Chat Research');
  const priya = await teammate(browser, page, 'Priya Nair');
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const dm = await post(priya.page, '/chat/conversations', { kind: 'DIRECT', userId: me.user.id });

  // ── The tab sits in the page's right gutter: nothing on the page reaches under it ──
  await page.goto('/app/companies');
  const tab = page.locator('[data-quick-chat-tab]');
  await expect(tab).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const tabBox = (await tab.boundingBox())!;
  const contentRight = await page.evaluate(() => {
    const main = document.getElementById('main')!;
    const style = getComputedStyle(main);
    return main.getBoundingClientRect().right - parseFloat(style.paddingRight);
  });
  expect(contentRight).toBeLessThanOrEqual(tabBox.x);
  // Nothing of the page sits under the tab, at any height of it.
  const under = await page.evaluate((b) => {
    const main = document.getElementById('main')!;
    const hits: string[] = [];
    for (let y = b.y + 2; y < b.y + b.height; y += 8)
      for (const x of [b.x + 2, b.x + b.width / 2, b.x + b.width - 2])
        for (const el of document.elementsFromPoint(x, y)) if (el !== main && main.contains(el)) hits.push(el.tagName);
    return hits;
  }, tabBox);
  expect(under).toEqual([]);
  await shot(page, '01-quick-chat-tab');

  // ── A message arrives: the tab counts it and a chime rings once (page clicked first, as browsers require) ──
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  const before = await chimes(page);
  await post(priya.page, `/chat/conversations/${dm.id}/messages`, { clientId: crypto.randomUUID(), body: 'Can you check the Acme quota?' });
  await expect(tab.locator('[data-quick-chat-unread="1"]')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => chimes(page)).toBe(before + 1);
  await expect(page.locator('[data-chat-notice]')).toBeVisible();

  // ── Open it: the conversation list, then the conversation, without leaving the page ──
  await tab.click();
  const panel = page.locator('[data-quick-chat]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-quick-chat-conversation="Priya Nair"]')).toContainText('Can you check the Acme quota?');
  await shot(page, '02-quick-chat-list');
  await panel.locator('[data-quick-chat-conversation="Priya Nair"]').click();
  await expect(panel.locator('[data-message]').filter({ hasText: 'Can you check the Acme quota?' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/companies$/);
  await panel.getByLabel('Message', { exact: true }).fill('On it, sending in 10 minutes 👍');
  await panel.getByLabel('Message', { exact: true }).press('Enter');
  await expect.poll(async () => ((await (await priya.page.request.get(`/api/v1/chat/conversations/${dm.id}/messages`)).json()) as { body: string }[]).map((m) => m.body)).toContain('On it, sending in 10 minutes 👍');
  await expect(tab.locator('[data-quick-chat-unread]')).toHaveCount(0);
  // While the conversation is open, a new message in it does not ring.
  const open = await chimes(page);
  await post(priya.page, `/chat/conversations/${dm.id}/messages`, { clientId: crypto.randomUUID(), body: 'Thanks!' });
  await expect(panel.locator('[data-message]').filter({ hasText: 'Thanks!' })).toBeVisible();
  expect(await chimes(page)).toBe(open);
  await panel.getByRole('button', { name: 'Emoji', exact: true }).click();
  await expect(panel.locator('[data-emoji-picker] [data-emoji-grid] button').first()).toBeVisible();
  await panel.locator('[data-emoji-picker] [role=tab]').nth(1).click();
  await expect(panel.locator('[data-emoji-grid] button')).not.toHaveCount(0);
  await shot(page, '03-quick-chat-conversation');
  await panel.getByRole('button', { name: 'Emoji', exact: true }).click();

  // ── Muting the sound: the next message elsewhere shows but does not ring ──
  await panel.getByRole('button', { name: 'Back to conversations' }).click();
  await panel.getByRole('button', { name: 'Sound for new messages' }).click();
  await expect(panel.locator('[data-quick-chat-sound="off"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  const muted = await chimes(page);
  await post(priya.page, `/chat/conversations/${dm.id}/messages`, { clientId: crypto.randomUUID(), body: 'One more thing.' });
  await expect(tab.locator('[data-quick-chat-unread="1"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);
  expect(await chimes(page)).toBe(muted);
  // The choice is kept after a reload.
  await page.reload();
  await page.locator('[data-quick-chat-tab]').click();
  await expect(page.locator('[data-quick-chat-sound="off"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // ── The Team chat page itself has no tab ──
  await page.goto('/app/chat');
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(page.locator('[data-quick-chat-tab]')).toHaveCount(0);

  // ── Phones: a tab of the bottom bar, nothing floating over the page ──
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/companies');
  await expect(page.locator('[data-quick-chat-tab]')).toBeHidden();
  const bar = page.locator('[data-shell="bottom-nav"]');
  await expect(bar.locator('[data-quick-chat-bar]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await shot(page, '04-phone-bottom-bar');
  await bar.locator('[data-quick-chat-bar]').click();
  await expect(page.locator('[data-quick-chat]')).toBeVisible();
  await page.locator('[data-quick-chat-conversation="Priya Nair"]').click();
  await expect(page.locator('[data-quick-chat] [data-message]').filter({ hasText: 'One more thing.' })).toBeVisible();
  await shot(page, '05-phone-quick-chat');
  await priya.ctx.close();
});
