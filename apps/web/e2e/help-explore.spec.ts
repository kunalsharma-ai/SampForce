import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (sampforce/previews/help-center). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const VIEW = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' as const };
test.use(VIEW);

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  await page.mouse.move(0, 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * The Help & support button in every top bar, its quick panel that answers as you type, and Explore SampForce:
 * every feature with what the plan includes, the plans on offer and the facilities. The Console writes its own
 * feature brief and readers find it (ADR 0073).
 */
test('Help & support from the top bar, Explore SampForce and a feature brief from the Console', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, `Help Explore ${stamp}`, { plan: 'free' });

  // ── The button in the top bar, from any page ──
  await page.goto('/app/deals');
  // Since the header redesign (R1) it is in the account menu.
  await page.getByRole('button', { name: 'Account menu' }).click();
  const button = page.locator('[data-help-support-button="workspace"]');
  await expect(button).toBeVisible();
  await expect(button).toContainText('Help & support');
  await button.click();
  const panel = page.locator('[data-help-panel="workspace"]');
  await expect(panel.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
  await expect(panel.locator('[data-help-panel-action="explore"]')).toBeVisible();
  await expect(panel.locator('[data-help-panel-action="queries"]')).toBeVisible();
  await shot(page, '30-help-support-panel');

  // Answers as you type, the first one open.
  await panel.locator('[data-help-panel-search]').fill('impo');
  await expect(panel.locator('[data-help-panel-faq="data.import"]')).toBeVisible();
  await expect(panel.locator('[data-help-panel-guide="page.import"]')).toBeVisible();
  await shot(page, '31-help-support-panel-answers');
  await panel.locator('[data-help-panel-search]').fill('zzqx nothing');
  await expect(panel.locator('[data-help-panel-empty]')).toBeVisible();
  await axe(page);

  // "Other: raise a query" remembers the page.
  await panel.locator('[data-menu-raise-query]').click();
  await expect(page.getByRole('dialog', { name: 'Raise a query' })).toBeVisible();
  await page.keyboard.press('Escape');

  // ── Explore SampForce ──
  await page.goto('/app/help');
  const explore = page.locator('[data-help-explore]');
  await page.locator('[data-help-way="explore"]').click();
  await expect(explore.getByRole('heading', { level: 2, name: 'Everything SampForce does for your team' })).toBeVisible();
  // A new workspace is on Free: the CRM is in it, quotes, proposals and contracts are not.
  await expect(explore.locator('[data-help-brief="crm"] [data-brief-availability="included"]')).toBeVisible();
  await expect(explore.locator('[data-help-brief="deals"] [data-brief-availability="partial"]')).toBeVisible();
  await expect(explore.locator('[data-help-brief="documents"] [data-brief-availability="not-included"]')).toBeVisible();
  await expect(explore.locator('[data-help-brief="security"]')).toBeVisible();
  await expect(explore.locator('[data-help-plan="free"][data-current]')).toContainText('Your plan');
  if (PREVIEW_DIR) await explore.screenshot({ path: `${PREVIEW_DIR}/32-explore-sampforce.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '29-help-center-top');

  await explore.locator('[data-help-brief="documents"]').click();
  const brief = page.locator('[data-help-brief-dialog="documents"]');
  await expect(brief.getByRole('heading', { name: 'Quotes, proposals and contracts' })).toBeVisible();
  await expect(brief.locator('[data-brief-feature="quotes"] [data-feature-state="not-included"]')).toContainText(/From the .+ plan/);
  // Guides for what the plan leaves out are not offered.
  await expect(brief.locator('[data-brief-guide]')).toHaveCount(0);
  await shot(page, '33-feature-brief-not-in-plan');
  await page.keyboard.press('Escape');

  await explore.locator('[data-help-brief="crm"]').click();
  const crm = page.locator('[data-help-brief-dialog="crm"]');
  await expect(crm.locator('[data-brief-feature="account_management"] [data-feature-state="included"]')).toBeVisible();
  await expect(crm.getByRole('link', { name: /Open page/ })).toBeVisible();
  await shot(page, '33-feature-brief');
  await crm.locator('[data-brief-guide="page.companies"]').click();
  await expect(page.locator('[data-help-guide-dialog="page.companies"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // Searching finds the parts of SampForce too.
  await page.getByRole('searchbox', { name: 'Search help' }).fill('whatsapp');
  await expect(page.locator('[data-help-brief-results] [data-help-brief="apps"]')).toBeVisible();
  await expect(page.locator('[data-help-results] [data-faq="communication.whatsapp"]')).toHaveCount(0); // not on Free
  await page.getByRole('searchbox', { name: 'Search help' }).fill('');

  // ── The Console writes a feature brief ──
  const email = `ops-explore-${stamp}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Asha Admin', OPERATOR_ROLE: 'ADMIN' },
  });
  const opsCtx = await browser.newContext(VIEW);
  const ops = await opsCtx.newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  const opsButton = ops.locator('[data-help-support-button="console"]');
  await expect(opsButton).toBeVisible();
  await opsButton.click();
  const opsPanel = ops.locator('[data-help-panel="console"]');
  await expect(opsPanel.locator('[data-help-panel-action="manage"]')).toBeVisible();
  await expect(opsPanel.locator('[data-help-panel-action="tickets"]')).toBeVisible();
  await shot(ops, '34-console-help-support-panel');
  await opsPanel.locator('[data-help-panel-action="manage"]').click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Manage Help' })).toBeVisible();

  const title = `Field visits ${stamp}`;
  await ops.locator('[data-manage-tab="articles"]').click();
  await ops.locator('[data-new-article]').click();
  const editor = ops.locator('[data-article-editor]');
  await editor.getByLabel('Type', { exact: true }).selectOption('FEATURE');
  await expect(editor.locator('[data-feature-brief-note]')).toBeVisible();
  await editor.getByLabel('Topic', { exact: true }).selectOption('crm');
  await editor.getByLabel('Title', { exact: true }).fill(title);
  await editor.getByLabel('Summary', { exact: true }).fill('Plan visits to clients, log what was agreed and follow up from the company.');
  await editor.getByLabel('Full text (optional)', { exact: true }).fill('## How teams use it\n- Plan the week’s visits\n- Log the outcome on the company');
  await ops.locator('[data-save-article]').click();
  await expect(ops.locator('[data-editor-status="DRAFT"]')).toBeVisible();
  await ops.locator('[data-publish-article]').click();
  await expect(ops.locator('[data-editor-status="PUBLISHED"]')).toBeVisible();
  await shot(ops, '35-console-feature-brief-editor', true);

  // The reader finds it under Explore SampForce.
  await page.reload();
  const own = page.locator('[data-help-explore] [data-help-brief^="article:"]', { hasText: title });
  await expect(own).toBeVisible();
  await own.click();
  await expect(page.getByRole('dialog', { name: title })).toContainText('Plan the week’s visits');
  await page.keyboard.press('Escape');

  // Tidy up: archived, it disappears for readers.
  await ops.locator('[data-archive-article]').click();
  await expect(ops.locator('[data-editor-status="ARCHIVED"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-help-explore]')).toBeVisible();
  await expect(page.locator('[data-help-explore] [data-help-brief^="article:"]', { hasText: title })).toHaveCount(0);
  await opsCtx.close();
});

test('the Help & support button and Explore SampForce on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, `Help Explore Phone ${Date.now()}`);
  await page.goto('/app/help');
  await expect(page.locator('[data-help-explore]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.locator('[data-help-support-button="workspace"]').click();
  await expect(page.locator('[data-help-panel="workspace"]')).toBeVisible();
  await shot(page, '36-help-support-panel-phone');
});
