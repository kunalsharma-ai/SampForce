import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

/**
 * Workspace redesign W1: every delete asks for the person's password, and the server refuses a delete without a fresh,
 * one-time pass. Wrong passwords and refusals are kept in the audit log as refused attempts.
 */
test('deleting asks for the password, a wrong one deletes nothing, and refused attempts are in the audit log', async ({ page }) => {
  await signUp(page, 'Delete Check', { autoConfirm: false });
  await page.goto('/app/meetings');
  await page.getByLabel('New notes for a call not in your calendar').fill('Call with Globex');
  await page.getByRole('button', { name: 'New meeting notes' }).click();
  const heading = page.getByRole('heading', { name: 'Call with Globex', level: 1 });
  await expect(heading).toBeVisible();

  // The first try opens the password dialog instead of deleting.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm deletion' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('This action will permanently delete the selected data. Please enter your password to continue.');
  await expect(dialog.getByRole('button', { name: 'Confirm delete' })).toBeDisabled();
  await shot(page, '01-confirm-deletion');

  // A wrong password is refused and nothing is deleted.
  await dialog.getByLabel('Password', { exact: true }).fill('not-my-password');
  await dialog.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('That password is not right.');
  await shot(page, '02-wrong-password');

  // Cancel keeps the notes.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(heading).toBeVisible();

  // Single sign-on people can switch to a two-step code instead.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete notes' }).click();
  await dialog.getByRole('button', { name: 'I sign in with single sign-on: use a two-step code' }).click();
  await expect(dialog.getByLabel('Two-step code')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use my password instead' }).click();

  // The right password deletes.
  await dialog.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await dialog.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page).toHaveURL(/\/app\/meetings$/);
  await expect(page.getByText('No meeting notes yet.')).toBeVisible();

  // A delete sent straight to the API without a pass is refused, and logged.
  const res = await page.request.delete('/api/v1/meeting-records/000000000000000000000000', { headers: { origin: 'http://localhost:3000', 'x-password-confirmation': 'made-up' } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');

  // The audit log shows refused attempts on their own.
  await page.goto('/app/administration');
  await page.getByLabel('Result').selectOption('REFUSED');
  const refused = page.locator('[data-audit-outcome="REFUSED"]');
  await expect(refused.first()).toBeVisible();
  await expect(page.locator('[data-audit-entry="security.password_check_failed"]')).toBeVisible();
  await expect(page.locator('[data-audit-entry="security.delete_refused"]')).toBeVisible();
  await expect(page.locator('[data-audit-outcome="DONE"]')).toHaveCount(0);
  await shot(page, '03-audit-refused');
});
