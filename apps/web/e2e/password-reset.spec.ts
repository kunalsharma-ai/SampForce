import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Messages caught by the local stand-in email service (see playwright.config.ts). */
const MAILBOX = 'http://127.0.0.1:4401/messages';

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('forgot password: email a link, choose a new password, sign in with it', async ({ page, browser, request }) => {
  const { email, password } = await signUp(page, 'Forgetful Co');

  // A fresh browser that is not signed in.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto('/login');
  await guest.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(guest.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expectNoA11yViolations(guest);
  await guest.getByLabel('Work email').fill(email);
  await guest.getByRole('button', { name: 'Send reset link' }).click();
  await expect(guest.getByRole('status')).toContainText('Check your email');

  let link = '';
  await expect
    .poll(async () => {
      const mail = (await (await request.get(MAILBOX)).json()) as { to: string[]; subject: string; text: string }[];
      const m = mail.findLast((x) => x.to.includes(email) && x.subject === 'Reset your DealFlow password');
      link = /(http\S+reset-password#token=[\w-]+)/.exec(m?.text ?? '')?.[1] ?? '';
      return link;
    })
    .not.toBe('');

  await guest.goto(link);
  await expect(guest.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  // The token leaves the address bar as soon as the page reads it.
  await expect.poll(() => guest.url()).not.toContain('token=');
  await expectNoA11yViolations(guest);
  await guest.getByLabel('New password').fill('fresh-passphrase-42');
  await guest.getByLabel('Type it again').fill('fresh-passphrase-4');
  await guest.getByRole('button', { name: 'Save new password' }).click();
  await expect(guest.getByText('The passwords do not match')).toBeVisible();
  await guest.getByLabel('Type it again').fill('fresh-passphrase-42');
  await guest.getByRole('button', { name: 'Save new password' }).click();
  await expect(guest.getByRole('status')).toContainText('Your password was changed');

  // The link works once only.
  await guest.goto(link);
  await guest.getByLabel('New password').fill('another-passphrase-9');
  await guest.getByLabel('Type it again').fill('another-passphrase-9');
  await guest.getByRole('button', { name: 'Save new password' }).click();
  await expect(guest.getByRole('alert').filter({ hasText: 'reset link is invalid' })).toBeVisible();

  // Old password fails, new one signs in.
  await guest.goto('/login');
  await guest.getByLabel('Work email').fill(email);
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(guest.getByRole('alert').filter({ hasText: /password/i })).toBeVisible();
  await guest.getByLabel('Password').fill('fresh-passphrase-42');
  await guest.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(guest).toHaveURL(/\/app/);
});

test('reset page without a link explains what to do', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByRole('alert').filter({ hasText: 'needs the link from your reset email' })).toBeVisible();
  await page.getByRole('link', { name: 'Ask for a new link' }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
});
