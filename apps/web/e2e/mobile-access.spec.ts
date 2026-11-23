import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the new screens (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

const shot = async (page: Page, name: string) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
};

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * Mobile access (ADR 0072), through the screens: the Super Workspace asks, the Console Admin approves, the Super
 * Workspace switches it on, a phone signs in, and the Console's suspension stops it while the web carries on.
 */
test('the Console approves mobile access, the Super Workspace switches it on, and phones follow both', async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const org = `Field Sales ${Date.now().toString(36)}`;
  const owner = await signUp(page, org);
  const phoneLogin = (installId: string) =>
    request.post('/api/v1/mobile/auth/login', { data: { email: owner.email, password: owner.password, device: { platform: 'IOS', installId, model: 'iPhone 17 Pro', osVersion: '26.1', appVersion: '1.0.0' } } });

  // Before anything: phones are refused, and the settings page says what is missing.
  expect((await phoneLogin('e2e-install-1')).status()).toBe(403);
  await page.goto('/app/settings');
  await page.getByRole('link', { name: /Mobile app/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mobile app' })).toBeVisible();
  await expect(page.getByText('Not requested')).toBeVisible();
  await page.getByLabel('Ask the SampForce team for mobile access').fill('Twelve field sales executives visit clients every day.');
  await shot(page, '01-super-request-mobile-access');
  await page.getByRole('button', { name: 'Request mobile access' }).click();
  await expect(page.getByText('Your request was sent.')).toBeVisible();
  await expectNoA11yViolations(page);

  // The Console Admin sees the request first and approves it with a reason.
  const email = `ops-mobile-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Mobile Ops', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('link', { name: 'Mobile app' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Mobile app' })).toBeVisible();
  const row = ops.getByRole('row').filter({ hasText: org });
  await expect(row.getByText('Requested')).toBeVisible();
  await expect(row.getByText('Twelve field sales executives')).toBeVisible();
  await shot(ops, '02-console-mobile-requests');
  await expectNoA11yViolations(ops);
  await row.getByRole('link', { name: org }).click();
  await expect(ops.getByRole('heading', { level: 1, name: `${org}: mobile app` })).toBeVisible();
  await ops.getByLabel(/^Reason \(the client/).fill('Approved for the field sales team');
  await ops.getByRole('button', { name: 'Approve request' }).click();
  await expect(ops.getByText('Phones cannot sign in')).toBeVisible();
  await expect(ops.getByText('Approved, but not switched on yet.')).toBeVisible();
  await expectNoA11yViolations(ops);

  // Approved, but phones still wait for the Super Workspace.
  expect((await phoneLogin('e2e-install-1')).status()).toBe(403);
  await page.reload();
  await page.getByRole('button', { name: 'Switch mobile access on' }).click();
  await expect(page.getByText('Your people can sign in')).toBeVisible();

  // A phone signs in with the same account and shows up in the organisation's list.
  const signedIn = await phoneLogin('e2e-install-1');
  expect(signedIn.status()).toBe(200);
  const tokens = (await signedIn.json()) as { accessToken: string };
  const session = await request.get('/api/v1/mobile/session', { headers: { authorization: `Bearer ${tokens.accessToken}` } });
  expect(await session.json()).toMatchObject({ organisation: { name: org }, level: 'SUPER' });
  await page.reload();
  await expect(page.getByRole('list', { name: 'Phones signed in' }).getByText('iPhone 17 Pro')).toBeVisible();
  await shot(page, '03-super-mobile-on-with-phone');
  await expectNoA11yViolations(page);

  // The Console sees the phone without the person's name (no support access), then suspends.
  await ops.reload();
  await expect(ops.getByRole('row').filter({ hasText: 'iPhone 17 Pro' }).getByText('hidden')).toBeVisible();
  await shot(ops, '04-console-mobile-organisation');
  await ops.getByLabel(/^Reason \(the client/).fill('Invoice overdue');
  await ops.getByRole('button', { name: 'Suspend' }).click();
  await expect(ops.getByText('Suspended by the SampForce team.')).toBeVisible();
  const refused = await request.get('/api/v1/mobile/session', { headers: { authorization: `Bearer ${tokens.accessToken}` } });
  expect(refused.status()).toBe(403);

  // The web carries on; the settings page shows the suspension and its reason.
  await page.reload();
  await expect(page.getByText('Reason from the SampForce team: “Invoice overdue”')).toBeVisible();
  await page.goto('/app/companies');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
