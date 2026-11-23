import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

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

/**
 * Console sign-in security (ADR 0074): the split sign-in page, two-step verification set up from the account page and
 * asked for at the next sign-in, open sessions that can be signed out, and the Security page with the sign-in history.
 */
test('Console sign-in: new sign-in page, two-step verification, sessions and the Security page', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = String(Date.now()).slice(-6);
  const email = `ops-signin-${suffix}@platform.test`;
  const password = 'operator-password-1';
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: password, OPERATOR_NAME: 'Noor Secure', OPERATOR_ROLE: 'ADMIN' },
  });

  // ── The sign-in page: a wrong password, then in, keeping the session for a week ──
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await expect(ops.getByRole('heading', { level: 1, name: 'Operator sign-in' })).toBeVisible();
  await expect(ops.getByText('The control center for every SampForce client.')).toBeVisible();
  await axe(ops);
  await shot(ops, '10-console-sign-in');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('not-the-password');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByText('Email or password is incorrect.')).toBeVisible();
  await ops.getByLabel('Password').fill(password);
  await ops.getByLabel('Keep me signed in for 7 days').check();
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // A second browser, to sign out from the first.
  const other = await (await browser.newContext()).newPage();
  await other.goto('/operator/login');
  await other.getByLabel('Email').fill(email);
  await other.getByLabel('Password').fill(password);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // ── Account & security: sessions and two-step verification ──
  await ops.getByRole('button', { name: 'Account: Noor Secure' }).click();
  await ops.getByRole('menuitem', { name: 'Account & security' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Account & security' })).toBeVisible();
  await expect(ops.locator('[data-account-role]')).toHaveText('Super Admin');
  await expect(ops.locator('[data-session="current"]')).toContainText('This browser');
  await expect(ops.locator('[data-session="other"]')).toHaveCount(1);
  await ops.getByRole('button', { name: 'Sign out everywhere else' }).click();
  await expect(ops.locator('[data-session="other"]')).toHaveCount(0);
  await other.reload();
  await expect(other.getByRole('heading', { level: 1, name: 'Operator sign-in' })).toBeVisible();

  await ops.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await ops.getByLabel('Password', { exact: true }).fill(password);
  await ops.getByRole('button', { name: 'Continue' }).click();
  await expect(ops.getByRole('img', { name: /QR code for your authenticator app/ })).toBeVisible();
  const secret = (await ops.getByLabel(/^Key /).textContent())!.replace(/\s/g, '');
  await ops.getByLabel('Code from your app').fill(totp(secret));
  await ops.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(ops.getByRole('region', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
  await axe(ops);
  await shot(ops, '11-console-account-security');
  await ops.getByRole('button', { name: 'I have saved them' }).click();
  await expect(ops.getByText('10 of 10 recovery codes left.')).toBeVisible();

  // ── Signing in again asks for the code ──
  await ops.getByRole('button', { name: 'Account: Noor Secure' }).click();
  await ops.getByRole('menuitem', { name: 'Sign out' }).click();
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill(password);
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Two-step verification' })).toBeVisible();
  await axe(ops);
  await shot(ops, '12-console-sign-in-code');
  await ops.getByLabel('Authentication code').fill('000000');
  await ops.getByRole('button', { name: 'Verify' }).click();
  await expect(ops.getByText('That code is not valid')).toBeVisible();
  await ops.getByLabel('Authentication code').fill(totp(secret, 1));
  await ops.getByRole('button', { name: 'Verify' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // ── Security: the policy, every open session and the sign-in history ──
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Security' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
  await expect(ops.locator('[data-policy="requireMfa"]')).toBeVisible();
  await expect(ops.getByLabel('End a session after')).toBeVisible();
  await expect(ops.locator('[data-session-list] [data-session="current"]')).toContainText('Noor Secure');
  const history = ops.locator('[data-login-history]');
  await expect(history.locator('tr', { hasText: email }).first()).toBeVisible();
  await expect(history.locator('[data-login="wrong_password"]', { hasText: email }).first()).toBeVisible();
  await axe(ops);
  await shot(ops, '13-console-security');
  await ops.getByRole('button', { name: 'Only unusual sign-ins' }).click();
  await expect(ops.getByRole('button', { name: 'Only unusual sign-ins' })).toHaveAttribute('aria-pressed', 'true');
  await expect(ops.locator('[data-login-history] [data-suspicious="no"]')).toHaveCount(0);
});
