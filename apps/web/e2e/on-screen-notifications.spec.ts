import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';
import { expectCleanLayout } from './layout-check';

/*
 * On-screen notifications (Kunal's spec section 9): a manager has SampForce open while an executive checks in, takes a
 * break, comes back, adds a company and finishes a task. Each shows as an animated card in the corner of the
 * manager's screen, the card opens its record and marks it read, and the manager's pop-up preferences (on or off,
 * time on screen, kinds, a preview) are kept. Everything also stays in the bell.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const SIZE = { width: 1440, height: 900 };

test.use({ viewport: SIZE, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** Browser tests opt in to on-screen cards (they would cover buttons in other suites). */
const OPT_IN = () => {
  try {
    localStorage.setItem('sampforce.onscreen.test', 'on');
  } catch {
    // The page still works without storage.
  }
};

async function join(browser: Browser, inviteUrl: string, name: string, optIn = false): Promise<Page> {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
  if (optIn) await ctx.addInitScript(OPT_IN);
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

test('a manager sees animated on-screen cards for the team’s check-ins, breaks, new companies and finished tasks', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, 'Frequent Research Pop-ups');
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'North India Sales', designation: 'Regional Sales Manager', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma', true);
  const put = await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN });
  expect(put.ok()).toBe(true);
  const e = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Kunal Verma', person: { inviteEmail: `kunal.${stamp}@example.com` } });
  const executive = await join(browser, e.inviteUrl, 'Kunal Verma');

  // The longest time on screen, so a slow run still finds each card before it closes by itself.
  const longer = await manager.request.put('/api/v1/notifications/preferences', { data: { sound: true, volume: 40, mutedSound: [], desktop: false, popups: true, popupSeconds: 20, mutedPopups: [] }, headers: ORIGIN });
  expect(longer.ok()).toBe(true);
  await manager.goto('/app');
  await expect(manager.locator('[data-notification-bell]')).toBeVisible();
  const host = manager.locator('[data-onscreen-host]');
  // Nothing pops up for what was there before the page opened.
  await manager.waitForTimeout(1500);
  await expect(host.locator('[data-onscreen-card]')).toHaveCount(0);

  // Check-in: a sun rises on the card.
  await post(executive.request, '/availability/check-in', {});
  const checkIn = host.locator('[data-onscreen-card="check-in"]');
  await expect(checkIn).toContainText('Kunal Verma checked in', { timeout: 20_000 });
  await expect(checkIn).toContainText('Checked in');
  await shot(manager, '01-check-in');
  const axe = await new AxeBuilder({ page: manager }).include('[data-onscreen-host]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
  await expectCleanLayout(manager, '[data-onscreen-host]');

  // A break, then back: each has its own card.
  await post(executive.request, '/availability/break', {});
  await expect(host.locator('[data-onscreen-card="break"]')).toContainText('Kunal Verma is on a break', { timeout: 20_000 });
  await post(executive.request, '/availability/resume', {});
  await expect(host.locator('[data-onscreen-card="back"]')).toContainText('Kunal Verma is back at work', { timeout: 20_000 });
  await shot(manager, '02-break-and-back');

  // A new company from the executive.
  const company = await post(executive.request, '/companies', { name: 'Ipsos Pop-up Panel' });
  const created = host.locator('[data-onscreen-card="company-created"]');
  await expect(created).toContainText('Kunal Verma added the company Ipsos Pop-up Panel', { timeout: 20_000 });

  // A task the manager assigned is finished: the tick draws itself and sparkles burst.
  const task = await post(manager.request, '/assigned-tasks', { title: 'Create 20 companies today', workspaceId: e.id });
  const done = await executive.request.patch(`/api/v1/assigned-tasks/${task.id}`, { data: { status: 'DONE' }, headers: ORIGIN });
  expect(done.ok(), await done.text()).toBe(true);
  const finished = host.locator('[data-onscreen-card="task-done"]');
  await expect(finished).toContainText('Task completed: Create 20 companies today', { timeout: 20_000 });
  await shot(manager, '03-company-and-task-done');
  // Let the stack finish sliding (a card leaving and the others moving up) before measuring it.
  await manager.waitForTimeout(1000);
  // The stack never holds more than four cards at once (the rest fold into a summary card).
  expect(await host.locator('[data-onscreen-card]').count()).toBeLessThanOrEqual(4);
  await expectCleanLayout(manager, '[data-onscreen-host]');

  // Opening a card goes to its record and reads it.
  await created.getByRole('button', { name: /Ipsos Pop-up Panel/ }).click();
  await expect(manager).toHaveURL(new RegExp(company.id));
  await expect(created).toHaveCount(0);
  // The close button closes one card.
  await finished.getByRole('button', { name: 'Close this notification' }).click();
  await expect(finished).toHaveCount(0);

  // Everything is also in the Notification Center.
  await manager.goto('/app/notifications');
  const history = manager.locator('[data-notification-history]');
  await expect(history.locator('[data-notification="company.created"]')).toBeVisible();
  await expect(history.locator('[data-notification="task.completed"]')).toBeVisible();

  // ── The manager's pop-up preferences ──
  const settings = manager.locator('[data-popup-settings]');
  await settings.scrollIntoViewIfNeeded();
  await settings.getByRole('button', { name: 'Show an example' }).click();
  await expect(host.locator('[data-onscreen-card="deal-won"]')).toContainText('Preview');
  await expect(host.locator('[data-onscreen-card="check-in"]')).toBeVisible();
  await shot(manager, '04-popup-settings-and-preview');
  await expectCleanLayout(manager, '[data-popup-settings]');

  // Close the cards first: in the corner of a computer screen they sit over the right-hand column of the settings.
  while (await host.locator('[data-onscreen-card]').count()) {
    await host.getByRole('button', { name: 'Close this notification' }).first().click();
    await manager.waitForTimeout(400);
  }

  // Team status muted for pop-ups: a check-out reaches the bell but does not pop up.
  await settings.locator('[data-popup-category="team_status"]').uncheck();
  await expect.poll(async () => (await (await manager.request.get('/api/v1/notifications/preferences')).json()).mutedPopups).toEqual(['team_status']);
  await manager.goto('/app');
  await post(executive.request, '/availability/check-out', {});
  await expect(manager.locator('[data-notification-bell]')).toHaveAttribute('aria-label', /unread/, { timeout: 20_000 });
  await manager.waitForTimeout(3000);
  await expect(host.locator('[data-onscreen-card="check-out"]')).toHaveCount(0);

  // Pop-ups off altogether, and the time on screen kept.
  const prefs = await (await manager.request.get('/api/v1/notifications/preferences')).json();
  const saved = await manager.request.put('/api/v1/notifications/preferences', { data: { ...prefs, popups: false, popupSeconds: 10 }, headers: ORIGIN });
  expect(saved.ok()).toBe(true);
  await manager.goto('/app/notifications');
  await expect(manager.locator('[data-popups-toggle]')).not.toBeChecked();
  await expect(manager.locator('[data-popup-seconds="10"]')).toBeVisible();
});

test('the phone shows the cards under the header, full width, clear of the bottom navigation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(OPT_IN);
  await signUp(page, 'Phone Pop-ups');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/notifications');
  await page.locator('[data-popup-settings]').getByRole('button', { name: 'Show an example' }).click();
  const cards = page.locator('[data-onscreen-card]');
  await expect(cards).toHaveCount(3);
  const header = await page.locator('header').first().boundingBox();
  const first = await cards.first().boundingBox();
  expect(first!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(first!.width).toBeGreaterThan(350);
  await expectCleanLayout(page, '[data-onscreen-host]');
  await shot(page, '05-phone-cards');
});
