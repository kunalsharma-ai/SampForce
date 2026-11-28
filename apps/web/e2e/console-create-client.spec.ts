import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen. */
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

function operator(role: 'ADMIN' | 'SUPPORT'): string {
  const email = `ops-create-${role.toLowerCase()}-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Cara Create', OPERATOR_ROLE: role },
  });
  return email;
}

async function signIn(page: Page, email: string) {
  await page.goto('/operator/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('operator-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Operator' })).toBeVisible();
}

/**
 * Create client (control-center K2): the Console looks the company up with the same auto-fill engine as Create Company
 * (stand-in website from the logo fixture), the operator corrects the details, then approves, and the client keeps
 * them with their sources and the website's logo.
 */
test('Create client finds the company details, lets the operator correct them, and creates the client', async ({ browser }) => {
  test.setTimeout(180_000);
  const ops = await (await browser.newContext()).newPage();
  await signIn(ops, operator('ADMIN'));
  const suffix = String(Date.now()).slice(-5);
  const name = `Northwind Insights ${suffix}`;

  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Create client' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Create client' })).toBeVisible();

  // Step 1: the three required fields are checked before anything is looked up.
  await ops.getByRole('button', { name: 'Find company details' }).click();
  await expect(ops.getByText('Enter the company name.')).toBeVisible();
  await expect(ops.getByText('Enter the website, such as example.com.')).toBeVisible();
  await ops.getByLabel('Company name').fill(name);
  await ops.getByLabel('Company email').fill('info@northwind-insights.example');
  await ops.getByLabel('Website', { exact: true }).fill('northwind-insights.example');
  await ops.getByLabel('Primary contact').fill('Priya Nair');
  await ops.getByLabel('Contact email').fill(`priya-${suffix}@northwind-insights.example`);
  await ops.getByLabel('Contact phone').fill('+91 20 5555 0100');
  await shot(ops, 'k2-01-create-client-company');
  await axe(ops);
  await ops.getByRole('button', { name: 'Find company details' }).click();

  // Step 2: what the website says, each value with its source; the logo found on the website.
  const review = ops.locator('[data-review-fields]');
  await expect(review).toBeVisible({ timeout: 60_000 });
  await expect(ops.locator('[data-found-logo="kept"]')).toBeVisible();
  const founded = review.locator('[data-review-field="foundedYear"]');
  await expect(founded.getByRole('textbox')).toHaveValue('2009');
  await expect(founded.getByText('Company website')).toBeVisible();
  await expect(founded.getByRole('link', { name: /Open the source/ })).toHaveAttribute('href', 'https://www.northwind-insights.example/about-us');
  await expect(review.locator('[data-review-field="industry"]').getByRole('textbox')).toHaveValue('Market research');
  // A field nothing was found for says so instead of guessing.
  await expect(review.locator('[data-review-field="legalName"]').getByText('Not found')).toBeVisible();
  await shot(ops, 'k2-02-create-client-review', true);
  await axe(ops);

  // Correct one value, remove one, add one that was missing.
  await review.locator('[data-review-field="industry"]').getByRole('textbox').fill('Market research and fieldwork');
  await expect(review.locator('[data-review-field="industry"]').getByText('Corrected by you')).toBeVisible();
  await review.locator('[data-review-field="foundedYear"]').getByRole('button', { name: 'Remove Founded' }).click();
  await expect(review.locator('[data-review-field="foundedYear"]').getByText('Removed')).toBeVisible();
  await review.locator('[data-review-field="legalName"]').getByRole('textbox').fill('Northwind Insights Ltd');
  await expect(review.locator('[data-review-field="legalName"]').getByText('Added by you')).toBeVisible();
  await shot(ops, 'k2-03-create-client-review-edited');
  await ops.getByRole('button', { name: 'Approve details' }).click();

  // Step 3: the administrator defaults to the primary contact.
  await expect(ops.getByLabel('Administrator’s name')).toHaveValue('Priya Nair');
  await ops.getByLabel('Seats').fill('12');
  await shot(ops, 'k2-04-create-client-plan');
  await ops.getByRole('button', { name: 'Continue' }).click();

  // Step 4: the summary, then approve.
  await expect(ops.locator('[data-confirm-company]')).toContainText(name);
  await expect(ops.locator('[data-confirm-company]')).toContainText('with the website’s logo');
  await shot(ops, 'k2-05-create-client-confirm');
  await ops.getByRole('button', { name: 'Approve & create client' }).click();
  await expect(ops.locator('[data-client-created]')).toBeVisible();
  await expect(ops.locator('[data-created-customer-id]')).toHaveText(/^SF-\d{6}$/);
  await expect(ops.getByLabel('Administrator invitation link')).toHaveValue(/\/invite\//);
  await shot(ops, 'k2-06-create-client-created');

  await ops.getByRole('button', { name: 'Open client' }).click();
  await expect(ops.getByRole('heading', { level: 1, name })).toBeVisible();
  const id = ops.url().split('/').pop()!;
  const detail = await (await ops.request.get(`/api/v1/operator/clients/${id}`)).json();
  expect(detail.logoUrl).toBeTruthy();
  expect(detail.profile).toMatchObject({ website: 'https://northwind-insights.example', companyEmail: 'info@northwind-insights.example', industry: 'Market research and fieldwork', contactName: 'Priya Nair' });
  expect(detail.profile.details.values.foundedYear).toBeUndefined();
  expect(detail.profile.details.values.legalName).toBe('Northwind Insights Ltd');
  expect(detail.profile.details.sources.legalName).toEqual({ source: 'USER', url: null });
  expect(detail.profile.details.sources.industry).toEqual({ source: 'USER', url: null });
  expect(detail.profile.details.sources.city.source).not.toBe('USER');
});

test('an operator whose role cannot create clients does not see Create client', async ({ browser }) => {
  const ops = await (await browser.newContext()).newPage();
  await signIn(ops, operator('SUPPORT'));
  await expect(ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Create client' })).toHaveCount(0);
  await ops.goto('/operator/clients/new');
  await expect(ops.locator('[data-console-state="denied"]')).toBeVisible();
});
