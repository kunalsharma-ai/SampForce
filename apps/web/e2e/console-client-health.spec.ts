import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * Client health score (ADR 0074, C5): the score on the client page with every signal and the figure behind it, a
 * fresh measurement after the client uses the CRM, the score in the clients list with its filter, and the weights in
 * Settings.
 */
test('Console client health: breakdown, measure now, list filter and the weights in Settings', async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-health-${suffix}@platform.test`;
  const org = `Kestrel Panels ${suffix}`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Hana Health', OPERATOR_ROLE: 'ADMIN' },
  });
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, org);

  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15_000 });
  const nav = ops.getByRole('navigation', { name: 'Operator' });

  // ── The client page: a fresh measurement shows every signal with its points and figure ──
  await nav.getByRole('link', { name: 'Clients' }).click();
  await ops.getByLabel('Search clients').fill(org);
  // Wait for the search to settle so the row is not re-drawn under the click.
  await expect(ops.locator('[data-console-clients] tbody tr')).toHaveCount(1);
  await ops.locator('[data-console-clients] tr', { hasText: org }).getByRole('link', { name: org }).click();
  await expect(ops.getByRole('heading', { level: 1, name: org })).toBeVisible();
  const card = ops.locator('[data-client-health]');
  await card.getByRole('button', { name: 'Measure now' }).click();
  const signals = card.locator('[data-health-signals]');
  await expect(signals.locator('[data-signal="login"]')).toContainText('1 of 1 person signed in in the last 14 days');
  await expect(signals.locator('[data-signal="features"]')).toContainText('0 of 6 parts of the CRM used in the last 30 days');
  await expect(signals.locator('[data-signal="mobile"]')).toContainText('Mobile access off');
  await expect(signals.locator('[data-signal="support"]')).toContainText('No open tickets');
  const ring = card.getByRole('img', { name: /Health score \d+ out of 100/ });
  const before = Number((await ring.getAttribute('aria-label'))!.match(/\d+/)![0]);

  // The client starts using the CRM; measuring again counts it.
  const added = await owner.request.post('/api/v1/contacts', { headers: ORIGIN, data: { firstName: 'Meera', lastName: 'Shah' } });
  expect(added.status()).toBe(201);
  await card.getByRole('button', { name: 'Measure now' }).click();
  await expect(signals.locator('[data-signal="features"]')).toContainText('1 of 6 parts of the CRM');
  const after = Number((await ring.getAttribute('aria-label'))!.match(/\d+/)![0]);
  expect(after).toBeGreaterThan(before);
  // The header shows the band and score next to the status.
  await expect(ops.locator('main [data-health-band]').first()).toContainText(`· ${after}`);
  await axe(ops);
  await card.scrollIntoViewIfNeeded();
  await shot(ops, '30-console-client-health');

  // ── The clients list shows the score and filters by band ──
  await nav.getByRole('link', { name: 'Clients' }).click();
  await ops.getByLabel('Search clients').fill(org);
  const row = ops.locator('[data-console-clients] tr', { hasText: org });
  await expect(row.locator('[data-health-band]')).toContainText(String(after));
  const band = (await row.locator('[data-health-band]').getAttribute('data-health-band'))!;
  const other = band === 'HEALTHY' ? 'CRITICAL' : 'HEALTHY';
  await ops.getByLabel('Health', { exact: true }).selectOption(other);
  await expect(ops.getByText('No clients match.')).toBeVisible();
  await ops.getByLabel('Health', { exact: true }).selectOption(band);
  await expect(row).toBeVisible();
  await shot(ops, '31-console-clients-health-filter');

  // ── Settings: the weights are checked and saved, and the change is in the audit log ──
  await nav.getByRole('link', { name: 'Settings' }).click();
  const settings = ops.locator('[data-health-settings]');
  await settings.getByLabel('At risk from').fill('80');
  await expect(settings.getByRole('alert')).toHaveText('The At risk score must be lower than the Healthy score.');
  await expect(settings.getByRole('button', { name: 'Save health score settings' })).toBeDisabled();
  await settings.getByLabel('At risk from').fill('40');
  await settings.getByLabel('Feature adoption weight').fill('25');
  await expect(settings).toContainText('Weights add up to 110');
  await settings.getByRole('button', { name: 'Save health score settings' }).click();
  await expect(settings.getByRole('status')).toContainText('Every client is measured again');
  await expect(settings).toContainText('Last changed by Hana Health');
  await axe(ops);
  await settings.scrollIntoViewIfNeeded();
  await shot(ops, '32-console-settings-health');
  const log = (await (await ops.request.get('/api/v1/operator/audit-log?action=settings.health_updated&limit=1', { headers: ORIGIN })).json()) as { after: Record<string, unknown> }[];
  expect(log[0]!.after).toMatchObject({ 'weight.features': 25 });
  // Put the defaults back for the rest of the suite.
  await settings.getByRole('button', { name: 'Use the defaults' }).click();
  await settings.getByRole('button', { name: 'Save health score settings' }).click();
  await expect(settings.getByRole('status')).toBeVisible();
});
