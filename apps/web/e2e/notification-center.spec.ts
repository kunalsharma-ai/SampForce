import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
  if (include) b = b.include(include);
  const r = await b.analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/**
 * A stand-in for the browser's audio, so the test can count chimes: every chime starts oscillators, and the stand-in
 * counts them in `window.__chimes`. Real browsers block audio until a click; the stand-in is always allowed.
 */
const FAKE_AUDIO = () => {
  (window as unknown as { __chimes: number }).__chimes = 0;
  class Node {
    connect(n: unknown) {
      return n;
    }
  }
  class Param {
    value = 0;
    setValueAtTime() {}
    linearRampToValueAtTime() {}
    exponentialRampToValueAtTime() {}
  }
  class FakeContext {
    state = 'running';
    currentTime = 0;
    destination = new Node();
    resume() {
      return Promise.resolve();
    }
    createGain() {
      return Object.assign(new Node(), { gain: new Param() });
    }
    createOscillator() {
      (window as unknown as { __chimes: number }).__chimes += 1;
      return Object.assign(new Node(), { type: 'sine', frequency: new Param(), start() {}, stop() {} });
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
};
const chimes = (page: Page) => page.evaluate(() => (window as unknown as { __chimes: number }).__chimes);

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(FAKE_AUDIO);
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

/**
 * Notification Center (ADR 0075): a manager assigns a task and the executive, with SampForce already open, hears one
 * chime and sees it in the bell, on the home dashboard and in the Tasks section, all in step.
 */
test('a new notification arrives live in the bell, on the home dashboard and in its section, with one chime', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  await signUp(page, 'Frequent Research Alerts');
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', designation: 'Regional Sales Manager', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');
  const put = await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN });
  expect(put.ok()).toBe(true);
  const e = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@example.com` } });
  const executive = await join(browser, e.inviteUrl, 'Priya Sharma');
  // Something from before she opened SampForce: shown, but never chimed.
  await post(manager.request, '/assigned-tasks', { title: 'Read the onboarding pack', workspaceId: e.id });

  await executive.goto('/app');
  const bell = executive.locator('[data-notification-bell]');
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  await expect(executive.locator('[data-home-notifications]')).toContainText('Read the onboarding pack');
  await executive.waitForTimeout(1500);
  expect(await chimes(executive)).toBe(0);

  // The manager assigns an urgent task while the executive has the home dashboard open.
  await post(manager.request, '/assigned-tasks', { title: 'Call the five new research leads', priority: 'HIGH', workspaceId: e.id });
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 unread', { timeout: 15_000 });
  await expect(executive.locator('[data-home-notifications]')).toContainText('Call the five new research leads');
  await expect(executive.locator('[data-nav-unread="tasks"]')).toContainText('2');
  await expect.poll(() => chimes(executive)).toBeGreaterThan(0);
  await shot(executive, '01-home-notifications-card');

  // The bell's panel: All, Unread, Action required, mark read.
  await bell.click();
  const panel = executive.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.locator('[data-notification="task.assigned"]')).toHaveCount(2);
  await shot(executive, '02-bell-panel');
  await axe(executive, '[role="dialog"]');
  await panel.getByRole('tab', { name: /Unread/ }).click();
  await expect(panel.locator('[data-read="no"]')).toHaveCount(2);
  await executive.keyboard.press('Escape');

  // Opening Tasks is reading them: the strip shows what was new on this visit, and the bell and menu count clear.
  await executive.goto('/app/tasks');
  const strip = executive.locator('[data-section-notices="tasks"]');
  await expect(strip).toContainText('New in Tasks: 2');
  await expect(strip).toContainText('Marked as read');
  await expect(strip).toContainText('Call the five new research leads');
  await expect(bell).toHaveAttribute('aria-label', 'Notifications');
  await expect(executive.locator('[data-nav-unread="tasks"]')).toHaveCount(0);
  await shot(executive, '03-section-notices-tasks');
  await axe(executive);
  await strip.getByRole('button', { name: 'Got it' }).click();
  await expect(strip).toHaveCount(0);
  // Opening another page (a fresh page load) and reading chimed nothing: what was there already never replays.
  expect(await chimes(executive)).toBe(0);
  await executive.reload();
  await expect(bell).toBeVisible();
  await executive.waitForTimeout(1500);
  expect(await chimes(executive)).toBe(0);

  // The history page: everything, read ones muted; put one back to unread.
  await executive.goto('/app/notifications');
  const history = executive.locator('[data-notification-history]');
  await expect(history.locator('[data-notification="task.assigned"]')).toHaveCount(2);
  await history.getByRole('button', { name: 'Mark as unread: New task: Read the onboarding pack' }).click({ force: true });
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  await shot(executive, '04-history-and-settings');
  await axe(executive);

  // Sound settings are the person's own and stay after a reload; a muted category arrives silently. The same category
  // names are also on the On-screen pop-ups card above, so these are found in the sound card.
  const sound = executive.locator('#preferences');
  await sound.getByRole('checkbox', { name: 'Follow-up assigned' }).click();
  await expect(sound.getByRole('checkbox', { name: 'Follow-up assigned' })).not.toBeChecked();
  await executive.getByRole('checkbox', { name: 'Play a sound when a notification arrives' }).click();
  await expect(executive.getByRole('checkbox', { name: 'Play a sound when a notification arrives' })).not.toBeChecked();
  await executive.reload();
  await expect(executive.getByRole('checkbox', { name: 'Play a sound when a notification arrives' })).not.toBeChecked();
  await expect(sound.getByRole('checkbox', { name: 'Follow-up assigned' })).not.toBeChecked();
  await executive.waitForTimeout(1000);
  const before = await chimes(executive);
  await post(manager.request, '/assigned-tasks', { title: 'Quietly arriving task', workspaceId: e.id });
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 unread', { timeout: 15_000 });
  await executive.waitForTimeout(800);
  expect(await chimes(executive)).toBe(before);
});
