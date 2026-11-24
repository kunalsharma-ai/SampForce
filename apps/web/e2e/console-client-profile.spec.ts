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
  // Next sets the tab title again after a soft navigation; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** A 300 × 150 SVG: the browser draws it to a PNG before upload, so the API only ever sees pixels. */
const LOGO_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#0f766e"/><circle cx="150" cy="75" r="52" fill="#fbbf24"/><text x="150" y="88" font-family="sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#0f172a">HM</text></svg>',
);

/**
 * The client profile in the Console (ADR 0074, C4): a customer ID for every client, company details and location
 * edited with before and after kept in the audit log, a logo cropped in the browser, and a city the shipped list is
 * missing added on the Locations page and offered in the picker straight away.
 */
test('Console client profile: customer ID, company details, location, logo and the Locations page', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-profile-${suffix}@platform.test`;
  const org = `Heron Mills ${suffix}`;
  const city = `Navapur ${suffix}`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Asha Profile', OPERATOR_ROLE: 'ADMIN' },
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

  // ── Locations: the shipped list is missing a city; the operator adds it and renames another ──
  await nav.getByRole('link', { name: 'Locations' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Locations' })).toBeVisible();
  await expect(ops.getByLabel('Country')).toHaveValue('India');
  await ops.getByLabel('State / province').selectOption('MH');
  await ops.getByLabel('Search cities').fill('Pune');
  await expect(ops.locator('[data-console-cities] [data-city="Pune"]')).toBeVisible();
  await ops.getByLabel('Search cities').fill(city);
  await expect(ops.getByText('No city matches.')).toBeVisible();

  await ops.getByRole('button', { name: 'Add a city' }).click();
  const add = ops.getByRole('dialog');
  await expect(add.getByLabel('State / province')).toHaveValue('MH');
  await add.getByLabel('City').fill(city);
  await shot(ops, '20-console-locations-add');
  await add.getByRole('button', { name: 'Add city' }).click();
  await expect(add).toBeHidden();
  const row = ops.locator(`[data-console-cities] [data-city="${city}"]`);
  await expect(row).toContainText('Added');
  await expect(ops.locator('[data-location-changes]')).toContainText(`Added in Maharashtra by Asha Profile`);

  // The same name again is refused.
  await ops.getByRole('button', { name: 'Add a city' }).click();
  await ops.getByRole('dialog').getByLabel('City').fill(city.toUpperCase());
  await ops.getByRole('dialog').getByRole('button', { name: 'Add city' }).click();
  await expect(ops.getByRole('dialog')).toContainText('That city is already in the list.');
  await ops.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await axe(ops);
  await shot(ops, '21-console-locations');

  // ── The client: a customer ID in the list and on its page ──
  await nav.getByRole('link', { name: 'Clients' }).click();
  await ops.getByLabel('Search clients').fill(org);
  const listRow = ops.locator('[data-console-clients] tr', { hasText: org });
  await expect(listRow.locator('[data-customer-id]')).toHaveText(/^SF-\d{6}$/);
  const customerId = (await listRow.locator('[data-customer-id]').textContent())!;
  // Searching by the customer ID finds the same client.
  await ops.getByLabel('Search clients').fill(customerId);
  await expect(ops.locator('[data-console-clients] tbody tr')).toHaveCount(1);
  await expect(listRow).toBeVisible();
  await listRow.getByRole('link', { name: org }).click();
  await expect(ops.getByRole('heading', { level: 1, name: org })).toBeVisible();
  await expect(ops.getByText(customerId).first()).toBeVisible();

  // ── Company details and location, with the added city offered in the picker ──
  const company = ops.locator('[data-client-company]');
  await company.getByRole('button', { name: 'Edit details' }).click();
  const dlg = ops.getByRole('dialog', { name: 'Company information' });
  await dlg.getByLabel('Legal name').fill(`${org} Private Limited`);
  await dlg.getByLabel('Website').fill('heronmills.example');
  await dlg.getByLabel('Industry').fill('Market research');
  await dlg.getByLabel('Country').fill('India');
  await dlg.getByLabel('Country').press('Enter');
  await dlg.getByLabel('State / province').selectOption('MH');
  await dlg.getByLabel('City').fill(city.slice(0, 6));
  await expect(dlg.locator(`#profile-city-list option[value="${city}"]`)).toHaveCount(1);
  await dlg.getByLabel('City').fill(city);
  await dlg.getByLabel('Address line 1').fill('12 Mill Road');
  await dlg.getByLabel('Postal code').fill('425418');
  await dlg.getByLabel('Contact name').fill('Kavya Iyer');
  await dlg.getByLabel('Contact email').fill('Kavya@HeronMills.example');
  await dlg.getByLabel('Contact phone').fill('not a phone');
  await dlg.getByRole('button', { name: 'Save details' }).click();
  await expect(dlg.locator('#profile-contactPhone')).toHaveAttribute('aria-invalid', 'true');
  await dlg.getByLabel('Contact phone').fill('+91 98200 12345');
  await shot(ops, '22-console-client-edit-details');
  await dlg.getByRole('button', { name: 'Save details' }).click();
  await expect(dlg).toBeHidden();
  await expect(company).toContainText(`${org} Private Limited`);
  await expect(company.getByRole('link', { name: 'heronmills.example', exact: true })).toHaveAttribute('href', 'https://heronmills.example');
  await expect(company).toContainText(`${city}, Maharashtra, India`);
  await expect(company).toContainText('kavya@heronmills.example');

  // ── Logo: pick an image, zoom it in the cropper, save; it shows on the page, the context bar and the list ──
  await ops.getByRole('button', { name: 'Add a logo' }).click();
  const logo = ops.getByRole('dialog', { name: 'Client logo' });
  await logo.locator('input[type="file"]').setInputFiles({ name: 'heron.svg', mimeType: 'image/svg+xml', buffer: LOGO_SVG });
  await expect(logo.locator('[data-logo-preview]')).toBeVisible();
  await logo.getByLabel('Zoom').fill('1.4');
  await shot(ops, '23-console-client-logo-crop');
  const saved = ops.waitForResponse((r) => r.url().includes('/logo') && r.request().method() === 'PUT');
  await logo.getByRole('button', { name: 'Save logo' }).click();
  expect((await saved).status()).toBe(200);
  await expect(logo).toBeHidden();
  await expect(ops.getByRole('button', { name: 'Change the logo' }).locator('[data-client-logo]')).toBeVisible();
  const src = await ops.getByRole('button', { name: 'Change the logo' }).locator('img').getAttribute('src');
  const img = await ops.request.get(src!);
  expect(img.headers()['content-type']).toBe('image/png');
  await expect(ops.locator('[data-client-context] [data-client-logo]')).toBeVisible();
  await axe(ops);
  await shot(ops, '24-console-client-profile', true);

  // ── Everything is in the audit log with before and after ──
  const log = (await (await ops.request.get(`/api/v1/operator/audit-log?targetType=client&action=client.profile_updated&limit=5`, { headers: ORIGIN })).json()) as {
    target: { label: string } | null;
    after: Record<string, unknown>;
    before: Record<string, unknown>;
  }[];
  const entry = log.find((l) => l.target?.label === org)!;
  expect(entry.after).toMatchObject({ city, regionCode: 'MH', countryCode: 'IN', contactEmail: 'kavya@heronmills.example' });
  expect(entry.before).toMatchObject({ city: null });

  await nav.getByRole('link', { name: 'Clients' }).click();
  await ops.getByLabel('Search clients').fill(org);
  await expect(ops.locator('[data-console-clients] tr', { hasText: org }).locator('[data-client-logo]')).toBeVisible();
  await expect(ops.locator('[data-console-clients] tr', { hasText: org })).toContainText(city);
  await shot(ops, '25-console-clients-with-logos');

  // ── Removing the added city keeps the client's city as typed; removing the logo brings back the initials ──
  await nav.getByRole('link', { name: 'Locations' }).click();
  await ops.getByRole('button', { name: `Remove ${city}` }).click();
  await expect(ops.locator('[data-location-changes]')).not.toContainText(city);
  await ops.goBack();
  await ops.goBack();
  await expect(ops.getByRole('heading', { level: 1, name: org })).toBeVisible();
  await expect(company).toContainText(city);
  await ops.getByRole('button', { name: 'Change the logo' }).click();
  await ops.getByRole('dialog', { name: 'Client logo' }).getByRole('button', { name: 'Remove logo' }).click();
  await expect(ops.getByRole('button', { name: 'Add a logo' })).toBeVisible();
});
