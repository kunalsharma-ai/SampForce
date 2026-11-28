import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: PREVIEW_DIR ? 2 : 1,
});

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  // Next sets the tab title again after a soft navigation; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`),
  ).toEqual([]);
}

/**
 * The Console shell (ADR 0074): the grouped left menu that collapses to an icon rail, breadcrumbs and the client bar,
 * palettes and colour modes saved to the operator, the sound switch, and Ctrl/⌘ K search across clients and people.
 */
test('the Console shell: menu, palettes, sound and global search', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = String(Date.now()).slice(-6);
  const org = `Halcyon Research ${suffix}`;
  const client = await (await browser.newContext()).newPage();
  const { email: clientEmail } = await signUp(client, org, { plan: 'growth' });

  const email = `ops-shell-${suffix}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      OPERATOR_EMAIL: email,
      OPERATOR_PASSWORD: 'operator-password-1',
      OPERATOR_NAME: 'Maya Console',
      OPERATOR_ROLE: 'ADMIN',
    },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // ── The left menu: grouped, with the current page marked and breadcrumbs above the page ──
  const menu = ops.getByRole('navigation', { name: 'Operator' });
  for (const group of ['Command Center', 'Clients', 'Workspaces', 'Integrations', 'Support', 'Platform Management', 'System'])
    await expect(menu.getByRole('heading', { name: group, exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(ops.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Overview');
  // Support is a group of three pages that folds away.
  const support = menu.getByRole('button', { name: 'Support' });
  await expect(support).toHaveAttribute('aria-expanded', 'true');
  await support.click();
  await expect(menu.getByRole('link', { name: 'Support chat' })).toBeHidden();
  await support.click();
  await expect(menu.getByRole('link', { name: 'Support chat' })).toBeVisible();
  await axe(ops);
  await shot(ops, '01-console-shell-overview');

  // ── The header (control-center K1): platform scope, live system status and quick actions ──
  await expect(ops.locator('[data-console-scope]')).toContainText('Platform Console');
  const status = ops.locator('[data-system-status]');
  await expect(status).not.toHaveAttribute('data-system-status', 'loading');
  await status.click();
  await expect(ops.getByRole('dialog').getByText('Background worker')).toBeVisible();
  await expect(ops.getByRole('dialog').getByText('Database')).toBeVisible();
  await shot(ops, '05-console-system-status');
  await ops.keyboard.press('Escape');
  await ops.locator('[data-quick-actions]').click();
  await expect(ops.locator('[data-quick-action="client"]')).toBeVisible();
  await shot(ops, '06-console-quick-actions');
  await ops.locator('[data-quick-action="client"]').click();
  await expect(ops).toHaveURL(/\/operator\/clients\?new=1/);
  await expect(ops.getByRole('dialog')).toBeVisible();
  await ops.keyboard.press('Escape');
  await expect(ops.getByRole('dialog')).toBeHidden();
  await menu.getByRole('link', { name: 'Overview' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // ── Collapsing the menu leaves an icon rail, and the choice is saved to the operator ──
  await ops.getByRole('button', { name: 'Collapse the menu' }).click();
  await expect(ops.locator('[data-console-sidebar="collapsed"]')).toBeVisible();
  await menu.getByRole('link', { name: 'All clients', exact: true }).hover();
  await expect(ops.getByRole('tooltip')).toHaveText('All clients');
  await shot(ops, '02-console-shell-collapsed');
  await ops.reload();
  await expect(ops.locator('[data-console-sidebar="collapsed"]')).toBeVisible();
  await ops.getByRole('button', { name: 'Expand the menu' }).click();
  await expect(ops.locator('[data-console-sidebar="open"]')).toBeVisible();

  // ── Palettes and colour modes repaint the whole Console and follow the operator to a new sign-in ──
  await ops.getByRole('button', { name: 'Appearance' }).click();
  await ops.getByRole('radio', { name: /Indigo Violet/ }).click();
  await ops
    .getByRole('radiogroup', { name: 'Colour mode' })
    .getByRole('radio', { name: 'Dark' })
    .click();
  await expect(ops.locator('html')).toHaveAttribute('data-theme', 'obsidian');
  await expect(ops.locator('html')).toHaveClass(/dark/);
  await shot(ops, '03-console-palettes');
  await ops.keyboard.press('Escape');
  await axe(ops);
  await ops.getByRole('button', { name: 'Appearance' }).click();
  await ops.getByRole('radio', { name: /Emerald/ }).click();
  await ops
    .getByRole('radiogroup', { name: 'Colour mode' })
    .getByRole('radio', { name: 'Light' })
    .click();
  await expect(ops.locator('html')).toHaveAttribute('data-theme', 'emerald');
  await expect(ops.locator('html')).not.toHaveClass(/dark/);
  await ops.keyboard.press('Escape');
  await axe(ops);
  const again = await (await browser.newContext()).newPage();
  await again.goto('/operator/login');
  await again.getByLabel('Email').fill(email);
  await again.getByLabel('Password').fill('operator-password-1');
  await again.getByRole('button', { name: 'Sign in' }).click();
  await expect(again.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(again.locator('html')).toHaveAttribute('data-theme', 'emerald');

  // ── Sound is off until the operator turns it on ──
  const sound = ops.getByRole('button', { name: /Sounds (on|off)/ });
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await ops.reload();
  await expect(ops.getByRole('button', { name: 'Sounds on' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await ops.getByRole('button', { name: 'Sounds on' }).click();
  await expect(ops.getByRole('button', { name: 'Sounds off' })).toBeVisible();

  // ── Ctrl/⌘ K finds a client by name and a person by email, and opens the client inside its context ──
  await ops.keyboard.press('Control+k');
  const palette = ops.getByRole('dialog');
  await palette.getByPlaceholder(/Search clients/).fill(clientEmail);
  await expect(palette.locator('[data-search-hit="user"]')).toContainText(org);
  await palette.getByPlaceholder(/Search clients/).fill(`Halcyon Research ${suffix}`);
  const hit = palette.locator('[data-search-hit="client"]').filter({ hasText: org });
  await expect(hit).toBeVisible();
  await shot(ops, '04-console-search');
  await hit.click();
  await expect(ops).toHaveURL(/\/operator\/clients\//);
  await expect(ops.getByRole('heading', { level: 1, name: org })).toBeVisible();
  await expect(ops.locator('[data-client-context]')).toContainText(org);
  await expect(ops.locator('[data-crumb-current]')).toHaveText(org);
  await ops
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Clients' })
    .click();
  await expect(ops).toHaveURL(/\/operator\/clients$/);

  // Pages and commands are in the palette too.
  await ops.keyboard.press('Control+k');
  await palette.getByPlaceholder(/Search clients/).fill('provid');
  await palette.getByRole('option', { name: /Providers/ }).click();
  await expect(ops).toHaveURL(/\/operator\/providers$/);
  await ops.keyboard.press('Control+k');
  await palette.getByPlaceholder(/Search clients/).fill('nothing-here-zz');
  await expect(palette.locator('[data-search-empty]')).toBeVisible();

  // ── On a tablet the menu opens as a drawer ──
  await palette.getByPlaceholder(/Search clients/).press('Escape');
  await expect(palette).toBeHidden();
  await ops.setViewportSize({ width: 900, height: 900 });
  await ops.getByRole('button', { name: 'Open the menu' }).click();
  await ops.getByRole('dialog').getByRole('link', { name: 'Audit log' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Activity & audit log' })).toBeVisible();
  await expect(ops.getByRole('dialog')).toBeHidden();
});
