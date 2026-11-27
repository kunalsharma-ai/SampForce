import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';
import { expectCleanLayout, LAYOUT_SIZES, setMode } from './layout-check';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (redesign previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
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

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return page;
}

const header = (page: Page) => page.locator('header[data-header="workspace"]');

/**
 * Redesign R1 (ADR 0081): the new header has only the page, one search, the working status with check-in, break and
 * check-out, the bell and the account menu. An executive's breaks reach the manager's Team status and bell.
 */
test('an executive checks in, takes a break and checks out; the manager sees it live', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, 'Header Redesign Org');
  const m = await post(page.request, '/workspaces', { level: 'MANAGER', name: 'West Team', designation: 'Sales Manager', person: { inviteEmail: `meera.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Meera Iyer');
  const put = await page.request.put(`/api/v1/workspaces/${m.id}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN });
  expect(put.ok()).toBe(true);
  const e = await post(manager.request, '/workspaces', { level: 'EXECUTIVE', name: 'Rahul Verma', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const executive = await join(browser, e.inviteUrl, 'Rahul Verma');

  // ── The executive's header: nothing but the essentials ──
  await executive.bringToFront();
  await executive.goto('/app');
  const bar = header(executive);
  await expect(bar.locator('[data-header-page]')).toContainText('Dashboard');
  await expect(bar.locator('[data-header-search]')).toContainText('Search companies, contacts, deals, tasks...');
  await expect(bar.locator('[data-availability="CHECKED_OUT"]')).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Your status: Checked out/ })).toBeVisible();
  // The old top bar buttons are gone from the header.
  for (const name of ['Copilot', 'Quick create', 'Keyboard shortcuts', 'Integrations', 'Calendar']) await expect(bar.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Notifications' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Account menu' })).toBeVisible();
  await shot(executive, '01-header-checked-out');

  // The search opens the global search.
  await bar.locator('[data-header-search]').click();
  const search = executive.getByPlaceholder('Search records, pages and commands…');
  await expect(search).toBeVisible();
  await search.press('Escape');
  await expect(search).toBeHidden();

  // ── Check in, break, resume ──
  await bar.locator('[data-availability-action="check-in"]').click();
  await expect(bar.locator('[data-availability="WORKING"]')).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Your status: Working, \d{1,2}:\d{2}/ })).toBeVisible();
  await expect(bar.locator('[data-status-since]')).toBeVisible();
  await shot(executive, '02-header-working');
  await axe(executive, 'header');

  await bar.locator('[data-availability-action="break"]').click();
  await expect(bar.locator('[data-availability="ON_BREAK"]')).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Your status: On break, 0 min/ })).toBeVisible();
  await expect(bar.locator('[data-availability-action="resume"]')).toBeVisible();
  await shot(executive, '03-header-on-break');

  // ── The manager sees it: Team status and the bell ──
  await manager.bringToFront();
      await manager.goto('/app/team-status');
  await expect(manager.getByRole('heading', { level: 1, name: 'Team status' })).toBeVisible();
  const rahul = manager.locator('[data-person="Rahul Verma"]');
  await expect(rahul).toHaveAttribute('data-person-status', 'ON_BREAK');
  await expect(rahul).toContainText('On break');
  await expect(manager.locator('[data-status-count="ON_BREAK"]')).toContainText('1');
  await shot(manager, '04-team-status-manager');
  await axe(manager);
  await manager.locator('[data-status-count="ON_BREAK"]').click();
  await expect(manager.locator('[data-person]')).toHaveCount(1);
  await manager.locator('[data-status-count="ON_BREAK"]').click();
  await header(manager).getByRole('button', { name: /^Notifications/ }).click();
  const panel = manager.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('Rahul Verma is on a break')).toBeVisible();
  await expect(panel.getByText('Rahul Verma checked in')).toBeVisible();
  await shot(manager, '05-bell-team-status');
  await manager.keyboard.press('Escape');

  // ── The executive resumes and opens today's times ──
  await executive.bringToFront();
  await bar.locator('[data-availability-action="resume"]').click();
  await expect(bar.locator('[data-availability="WORKING"]')).toBeVisible();
  await bar.getByRole('button', { name: /^Your status:/ }).click();
  const times = executive.locator('[data-today-times]');
  await expect(times).toContainText('Checked in');
  await expect(times).toContainText('Worked today');
  await expect(times).toContainText('1 · 0 min');
  // Choosing Available is a status of its own.
  await executive.getByRole('button', { name: 'Available', exact: true }).click();
  await expect(bar.locator('[data-availability="AVAILABLE"]')).toBeVisible();
  if (!(await times.isVisible())) await bar.getByRole('button', { name: /^Your status:/ }).click();
  await expect(times).toBeVisible();
  await shot(executive, '06-status-popover');
  await axe(executive, '[data-radix-popper-content-wrapper]');
  await executive.keyboard.press('Escape');

  // The Super Workspace sees everyone.
  await page.bringToFront();
  await page.goto('/app/team-status');
  await expect(page.locator('[data-person="Rahul Verma"]')).toHaveAttribute('data-person-status', 'AVAILABLE');
  await expect(page.locator('[data-person="Meera Iyer"]')).toHaveAttribute('data-person-status', 'CHECKED_OUT');

  // ── Check out ──
  await executive.bringToFront();
  await bar.locator('[data-availability-action="check-out"]').click();
  await expect(bar.locator('[data-availability="CHECKED_OUT"]')).toBeVisible();
  await manager.bringToFront();
  await manager.reload();
  await expect(manager.locator('[data-person="Rahul Verma"]')).toHaveAttribute('data-person-status', 'CHECKED_OUT');
  await expect(manager.locator('[data-person="Rahul Verma"]')).toContainText(/Checked out at/);

  // ── No overlapping or cut-off text, light and dark, desktop, tablet and phone ──
  for (const mode of ['light', 'dark'] as const) {
    await setMode(manager, mode);
    for (const size of LAYOUT_SIZES) {
      await manager.setViewportSize({ width: size.width, height: size.height });
      await manager.bringToFront();
      await manager.goto('/app/team-status');
      await expect(manager.locator('[data-person="Rahul Verma"]')).toBeVisible();
      await expectCleanLayout(manager, 'header[data-header="workspace"]');
      // The Ctrl K hint stays on one line inside the search box, or is left out where the box is narrow.
      const hint = manager.locator('[data-search-shortcut]');
      if (await hint.isVisible()) {
        const [k, box] = await Promise.all([hint.boundingBox(), manager.locator('[data-header-search]').boundingBox()]);
        expect(k!.height, size.name).toBeLessThanOrEqual(22);
        expect(k!.x + k!.width, size.name).toBeLessThanOrEqual(box!.x + box!.width);
      }
      await expectCleanLayout(manager, 'main');
      await shot(manager, `07-team-status-${mode}-${size.name}`);
    }
  }
  await setMode(executive, 'dark');
  await executive.bringToFront();
  await executive.goto('/app');
  await bar.locator('[data-availability-action="check-in"]').click();
  await expect(bar.locator('[data-availability="WORKING"]')).toBeVisible();
  await expectCleanLayout(executive, 'header[data-header="workspace"]');
  await shot(executive, '08-header-working-dark');
});

test('the account menu holds what left the header', async ({ page }) => {
  await signUp(page, 'Account Menu Org');
  await page.bringToFront();
  await page.goto('/app/deals');
  await header(page).getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByRole('menu');
  for (const item of ['Company', 'Contact', 'Deal', 'Copilot', 'Add this page to favourites', 'Open Theme Studio', 'Help & support', 'Help Center', 'Settings']) await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Switch to (light|dark) mode/ })).toBeVisible();
  await shot(page, '09-account-menu');
  await axe(page, '[role="menu"]');
  await menu.getByRole('menuitem', { name: 'Help & support' }).click();
  await expect(page.locator('[data-help-panel="workspace"]')).toBeVisible();
});
