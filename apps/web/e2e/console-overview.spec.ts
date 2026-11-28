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

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`),
  ).toEqual([]);
}

/**
 * The Console Overview (ADR 0074, C5b): the greeting and platform status, Action Required, 18 figures that follow
 * the platform (a new client shows up on the cards), the charts, and quick actions and cards that open the right list.
 */
test('Console Overview: figures follow the platform, charts, Action Required and quick actions', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-overview-${suffix}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      OPERATOR_EMAIL: email,
      OPERATOR_PASSWORD: 'operator-password-1',
      OPERATOR_NAME: 'Ola Overview',
      OPERATOR_ROLE: 'ADMIN',
    },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({
    timeout: 15_000,
  });

  // ── Hero: greeting, date and status, quick actions ──
  await expect(ops.locator('[data-welcome-hello]')).toHaveText(
    /^(Good (morning|afternoon|evening)|Working late), Ola/,
  );
  await expect(ops.locator('[data-overview-status]')).toHaveText(
    /All systems normal|providers? needs? attention/,
  );
  const quick = ops.getByRole('navigation', { name: 'Quick actions' });
  await expect(quick.getByRole('link')).toHaveText(['New client', 'New plan', 'Record payment']);
  await expect(ops.getByRole('heading', { name: 'Action required' })).toBeVisible();

  // ── 18 cards, each with its change against 30 days ago; every chart is drawn ──
  const cards = ops.locator('[data-kpi]');
  await expect(cards).toHaveCount(18);
  for (const chart of ['growth', 'workspaces', 'revenue'])
    await expect(ops.locator(`[data-chart="${chart}"]`)).toBeVisible();
  await expect(ops.getByRole('heading', { name: 'Plans sold' })).toBeVisible();
  await expect(ops.locator('[data-utilisation="Manager Workspaces"]')).toBeVisible();
  await expect(ops.locator('[data-overview-mobile]')).toBeVisible();
  await expect(ops.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  const figure = (key: string) => ops.locator(`[data-kpi="${key}"] [data-kpi-value] .sr-only`);
  const number = async (key: string) =>
    Number((await figure(key).textContent())!.replace(/[^\d]/g, ''));
  const clients = await number('clients.total');
  const people = await number('people.users');
  await axe(ops);
  await shot(ops, '33-console-overview', true);

  // ── A client signing up shows on the cards ──
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, `Overview Owl ${suffix}`);
  await expect
    .poll(
      async () => {
        await ops.reload();
        await expect(cards).toHaveCount(18);
        return number('clients.total');
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(clients);
  expect(await number('people.users')).toBeGreaterThan(people);
  await expect(ops.locator('[data-kpi="workspaces.super"] [data-kpi-value] .sr-only')).toHaveText(
    (await figure('clients.total').textContent()) ?? '',
  );

  // ── A card opens its list ──
  await ops.locator('[data-kpi="clients.suspended"]').click();
  await expect(ops).toHaveURL(/\/operator\/clients\?state=SUSPENDED/);
  await expect(ops.locator('#op-state')).toHaveValue('SUSPENDED');

  // ── New client opens the new client form; closing it leaves the list as it was ──
  await ops
    .getByRole('navigation', { name: 'Operator' })
    .getByRole('link', { name: 'Overview' })
    .click();
  await quick.getByRole('link', { name: 'New client' }).click();
  await expect(ops).toHaveURL(/\/operator\/clients\/new$/);
  await expect(ops.getByRole('heading', { level: 1, name: 'Create client' })).toBeVisible();
  await shot(ops, '34-console-overview-new-client');
  // An old link with ?new=1 lands on Create client too.
  await ops.goto('/operator/clients?new=1');
  await expect(ops).toHaveURL(/\/operator\/clients\/new$/);
});
