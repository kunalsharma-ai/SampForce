import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** RFC 6238 code for a base32 secret, `offset` steps from now. */
function totp(secret: string, offset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/\s/g, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac('sha1', key).update(msg).digest();
  const o = mac[mac.length - 1]! & 15;
  return ((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('turn on two-step verification, then sign in with a code and with a recovery code', async ({ page, context }) => {
  const cspViolations: string[] = [];
  page.on('console', (m) => m.text().includes('Content Security Policy') && cspViolations.push(m.text()));
  const { email, password } = await signUp(page, 'Two Step Co');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Account security' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account security' })).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('img', { name: /QR code for your authenticator app/ })).toBeVisible();
  await expectNoA11yViolations(page);
  const secret = (await page.getByLabel(/^Key /).textContent())!.replace(/\s/g, '');
  await page.getByLabel('Code from your app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  const items = page.getByRole('region', { name: 'Recovery codes' }).getByRole('listitem');
  await expect(items).toHaveCount(10);
  const codes = await items.allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'I have saved them' }).click();
  await expect(page.getByText('10 of 10 recovery codes left.')).toBeVisible();

  // Sign out, then back in: the password leads to the code step.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByLabel('Authentication code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code is not valid')).toBeVisible();
  await page.getByLabel('Authentication code').fill(totp(secret, 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/app$/);

  // A recovery code works once.
  await context.clearCookies();
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await page.getByLabel('Recovery code').fill(codes[0]!);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/account/security');
  await expect(page.getByText('9 of 10 recovery codes left.')).toBeVisible();
  expect(cspViolations).toEqual([]);
});

test('workspace security page offers single sign-on and SCIM on Free, and explains the two-step policy', async ({ page }) => {
  await signUp(page, 'Policy Co');
  await page.goto('/app/administration');
  await page.getByRole('link', { name: /Workspace security/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace security' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Require for everyone' })).toBeDisabled();
  await expect(page.getByText('Turn it on for your own account first')).toBeVisible();
  await expect(page.getByLabel('Client secret')).toBeVisible();
  await expect(page.getByText('SCIM provisioning', { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('SSO sign-in page reports a workspace that does not use single sign-on', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in with SSO' }).click();
  await page.getByLabel('Workspace sign-in name').fill('no-such-workspace');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/sso_error=unknown_workspace/);
  await expect(page.getByText('No workspace uses that single sign-on name')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('pages carry a nonce-based content security policy and 3D views run under it', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => m.text().includes('Content Security Policy') && violations.push(m.text()));
  const res = await page.goto('/login');
  expect(res!.headers()['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  await signUp(page, 'CSP Co');
  for (const path of ['/app', '/app/reports/galaxy', '/app/reports/globe', '/app/reports/flow', '/app/deals', '/pricing']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(violations).toEqual([]);
});
