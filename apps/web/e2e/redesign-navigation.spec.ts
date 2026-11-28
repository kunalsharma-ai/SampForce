import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { setFeatures, signUp } from './helpers';
import { expectCleanLayout, LAYOUT_SIZES, setMode } from './layout-check';

/** Set PREVIEW_DIR to save screenshots of each screen (redesign previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' }).first();

/**
 * Redesign R2 (ADR 0082): the Command Center is the Dashboard, the sidebar opens with the daily sales work, everything
 * else sits under More, and the Leads and Accounts pages stay hidden until the Console Admin switches them on.
 */
test('a new organisation sees a short menu without Leads or Accounts until they are switched on', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Navigation Redesign Org', { sections: false });
  await page.goto('/app');
  const nav = sidebar(page);

  // ── Dashboard, not Command Center ──
  await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.locator('header[data-header="workspace"] [data-header-page]')).toContainText('Dashboard');
  await expect(page).toHaveTitle(/Dashboard/);
  await expect(page.getByText('Command Center', { exact: true })).toHaveCount(0);

  // ── The daily work first, in this order ──
  const primary = nav.locator('[data-nav-section="modules"]').first().getByRole('link');
  await expect(primary).toHaveText(['Dashboard', 'Companies', 'Contacts', 'Deals', 'Pipelines', 'Follow-ups', 'Calls', 'Tasks', 'Targets', 'Approvals', 'Performance', 'Recognition', 'RFQs', /^Team chat/, 'My achievements', 'Learning & Development', 'Team status']);
  await expect(nav.getByRole('link', { name: /^Inbound contacts/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^Accounts/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

  // ── Every other section shows directly too, with no More button ──
  await expect(nav.getByRole('button', { name: 'More' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Reports & Analytics' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Team Management' })).toBeVisible();
  await shot(page, '01-sidebar-all-sections', true);
  const a11y = await new AxeBuilder({ page }).include('[data-shell="sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(a11y.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`)).toEqual([]);

  // ── Search and shortcuts leave the switched-off pages out ──
  await page.goto('/app');
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Search records, pages and commands…');
  await search.fill('accounts');
  await expect(page.getByRole('option', { name: /^Accounts/ })).toHaveCount(0);
  await search.fill('new lead');
  await expect(page.getByRole('option', { name: 'New inbound contact', exact: true })).toHaveCount(0);
  await search.press('Escape');

  // ── Opening the address says it is switched off, with no upgrade button ──
  await page.goto('/app/leads');
  const off = page.locator('[data-feature-locked="leads_section"][data-opt-in]');
  await expect(off.getByText('Inbound contacts page is switched off')).toBeVisible();
  await expect(off.getByText('Your SampForce administrator can switch it on for your organisation.')).toBeVisible();
  await expect(off.getByRole('link', { name: 'See plans and upgrade' })).toHaveCount(0);
  await shot(page, '03-leads-switched-off');
  await page.goto('/app/accounts');
  await expect(page.locator('[data-feature-locked="accounts_section"]')).toBeVisible();

  // ── Only the Console switches them on (R8, ADR 0092): the client's Settings has no switch; once on, they come back ──
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.locator('[data-menu-sections]')).toHaveCount(0);
  await setFeatures(page, { leads_section: true, accounts_section: true });
  await page.goto('/app/leads');
  await expect(page.locator('[data-feature-locked]')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbound contacts' })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /^Inbound contacts/ })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /^Accounts/ })).toBeVisible();
  await shot(page, '04-sidebar-leads-on');

  // ── No overlapping or cut-off text, light and dark, desktop and tablet; phones get the bottom bar ──
  for (const mode of ['light', 'dark'] as const) {
    await setMode(page, mode);
    for (const size of LAYOUT_SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/app/companies');
      if (size.width >= 1024) {
        await expect(page.locator('[data-shell="sidebar"]')).toBeVisible();
        await expectCleanLayout(page, '[data-shell="sidebar"]');
      } else {
        const bar = page.locator('[data-shell="bottom-nav"]');
        await expect(bar.getByRole('link', { name: 'Companies' })).toBeVisible();
        await expect(bar.getByRole('link', { name: 'Inbound contacts' })).toHaveCount(0);
        await expectCleanLayout(page, '[data-shell="bottom-nav"]');
      }
      await shot(page, `05-nav-${mode}-${size.name}`);
    }
  }
});
