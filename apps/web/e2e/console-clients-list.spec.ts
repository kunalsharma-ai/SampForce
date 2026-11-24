import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL } from './helpers';

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
  // Next sets the tab title again after a soft navigation; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * The Console clients list (ADR 0074, C4b): filters kept in the address, sorting, selection and bulk actions with
 * CONFIRM before access is taken away, a CSV of what the filters show, and the client's timeline of what happened.
 */
test('Console clients list: filters, sort, bulk actions, export and the client timeline', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-list-${suffix}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Lena Lists', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15_000 });

  // Three clients on a paid plan; two get a country.
  const plans = (await (await ops.request.get('/api/v1/operator/console-plans')).json()) as { code: string }[];
  const names = [`Aster Insights ${suffix}`, `Birch Panels ${suffix}`, `Cedar Surveys ${suffix}`];
  const ids: string[] = [];
  for (const [i, name] of names.entries()) {
    const res = await ops.request.post('/api/v1/operator/clients', {
      headers: ORIGIN,
      data: { organisation: { name }, administrator: { name: `Admin ${i}`, email: `admin-${i}-${suffix}@client.test` }, planCode: plans[0]!.code, seats: 10, paymentStatus: i === 2 ? 'OVERDUE' : 'PAID' },
    });
    expect(res.ok(), await res.text()).toBe(true);
    ids.push(((await res.json()) as { client: { id: string } }).client.id);
  }
  const place = { legalName: null, website: null, industry: null, regionCode: null, city: null, addressLine1: null, addressLine2: null, postalCode: null, contactName: null, contactEmail: null, contactPhone: null };
  for (const [i, countryCode] of [['IN'], ['GB']].map((c, i) => [i, c[0]] as const)) {
    const res = await ops.request.patch(`/api/v1/operator/clients/${ids[i]}/profile`, { headers: ORIGIN, data: { ...place, name: names[i], countryCode } });
    expect(res.ok(), await res.text()).toBe(true);
  }

  // ── Filters: kept in the address, so the list can be shared ──
  const nav = ops.getByRole('navigation', { name: 'Operator' });
  await nav.getByRole('link', { name: 'Clients' }).click();
  await ops.getByLabel('Search clients').fill(suffix);
  const rows = ops.locator('[data-console-clients] tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(ops).toHaveURL(new RegExp(`search=${suffix}`));
  await ops.getByLabel('Payment').selectOption('OVERDUE');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names[2]!);
  await ops.getByLabel('Payment').selectOption('');
  await ops.getByLabel('Country').fill('India');
  await ops.getByLabel('Country').press('Enter');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('India');
  await ops.reload();
  await expect(rows).toHaveCount(1);
  await ops.getByRole('button', { name: 'Clear filters' }).click();
  await ops.getByLabel('Search clients').fill(suffix);
  await expect(rows).toHaveCount(3);

  // ── Sort: by name both ways ──
  await ops.getByRole('button', { name: 'Client', exact: true }).click();
  await expect(ops.locator('th[aria-sort="ascending"]')).toContainText('Client');
  await expect(rows.nth(0)).toContainText(names[0]!);
  await expect(rows.nth(2)).toContainText(names[2]!);
  await ops.getByRole('button', { name: 'Client', exact: true }).click();
  await expect(rows.nth(0)).toContainText(names[2]!);
  await ops.getByRole('button', { name: 'Client', exact: true }).click();

  // ── Bulk: suspend two, which needs CONFIRM ──
  await ops.getByRole('checkbox', { name: `Select ${names[0]}` }).check();
  await ops.getByRole('checkbox', { name: `Select ${names[1]}` }).check();
  const bar = ops.locator('[data-bulk-bar]');
  await expect(bar).toContainText('2 selected');
  await axe(ops);
  await shot(ops, '26-console-clients-list-selected');
  await bar.getByRole('button', { name: 'Change status' }).click();
  const dlg = ops.getByRole('dialog', { name: 'Change status' });
  await dlg.getByLabel('New status').selectOption('SUSPENDED');
  await dlg.getByLabel('Reason').fill('Unpaid since last quarter');
  const go = dlg.getByRole('button', { name: 'Change status for 2 clients' });
  await expect(go).toBeDisabled();
  await dlg.getByLabel('Type CONFIRM to continue').fill('CONFIRM');
  await shot(ops, '27-console-clients-bulk-confirm');
  await go.click();
  await expect(dlg.locator('[data-bulk-result]')).toContainText('2 changed');
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(bar).toBeHidden();
  await ops.getByLabel('Status').selectOption('SUSPENDED');
  await expect(rows).toHaveCount(2);
  await ops.getByLabel('Status').selectOption('');

  // ── Bulk: extend every subscription on the page; one renewal moves 30 days ──
  const before = ((await (await ops.request.get(`/api/v1/operator/clients/${ids[2]}`)).json()) as { subscription: { renewsOn: string } }).subscription.renewsOn;
  await ops.getByRole('checkbox', { name: 'Select every client on this page' }).check();
  await expect(bar).toContainText('3 selected');
  await bar.getByRole('button', { name: 'Extend subscriptions' }).click();
  const ext = ops.getByRole('dialog', { name: 'Extend subscriptions' });
  await ext.getByLabel('Days to add to the renewal date').fill('30');
  await ext.getByLabel('Reason').fill('Goodwill after the March outage');
  await ext.getByRole('button', { name: 'Extend subscriptions for 3 clients' }).click();
  await expect(ext.locator('[data-bulk-result]')).toContainText('3 changed');
  await ext.getByRole('button', { name: 'Done' }).click();
  const after = ((await (await ops.request.get(`/api/v1/operator/clients/${ids[2]}`)).json()) as { subscription: { renewsOn: string } }).subscription.renewsOn;
  expect((new Date(after).getTime() - new Date(before).getTime()) / 86_400_000).toBe(30);

  // ── Export: the CSV has what the list shows ──
  const download = ops.waitForEvent('download');
  await ops.getByRole('button', { name: 'Export CSV' }).click();
  const csv = readFileSync(await (await download).path(), 'utf8');
  for (const n of names) expect(csv).toContain(n);
  expect(csv.trim().split('\r\n')).toHaveLength(4);
  await shot(ops, '28-console-clients-list');

  // ── The client's timeline shows the bulk changes ──
  await rows.filter({ hasText: names[0]! }).getByRole('link', { name: names[0]! }).click();
  await expect(ops.getByRole('heading', { level: 1, name: names[0]! })).toBeVisible();
  const timeline = ops.locator('[data-client-timeline]');
  await expect(timeline).toContainText('Lena Lists: Extended a subscription');
  await expect(timeline).toContainText('Lena Lists: Changed a client’s status');
  await timeline.scrollIntoViewIfNeeded();
  await shot(ops, '29-console-client-timeline');
  await timeline.getByRole('button', { name: 'Clients', exact: true }).click();
  await expect(timeline.locator('[data-category]').first()).toHaveAttribute('data-category', 'clients');
  await axe(ops);
});
