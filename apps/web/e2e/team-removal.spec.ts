import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Team Management: an owner removes a person completely (records handed over, password asked, sign-in stopped) and
 * deletes invitation rows for good, whatever their status.
 */

const ORIGIN = 'http://localhost:3000';

async function invite(page: Page, email: string, roleKey = 'member'): Promise<{ id: string; token: string }> {
  const res = await page.request.post('/api/v1/tenants/current/invitations', { data: { email, roleKey }, headers: { origin: ORIGIN } });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { id: string; inviteUrl: string };
  return { id: body.id, token: body.inviteUrl.split('/invite/')[1]! };
}

/** Accepts an invitation in a separate session and gives a lead to the new person. */
async function joinWithLead(token: string, name: string, lead?: string) {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { origin: ORIGIN } });
  expect((await ctx.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' } })).status()).toBe(200);
  if (lead) expect((await ctx.post('/api/v1/leads', { data: { fullName: lead } })).status()).toBe(201);
  return ctx;
}

async function confirmPassword(page: Page, button: string) {
  const dialog = page.getByRole('dialog', { name: 'Confirm deletion' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await dialog.getByRole('button', { name: button }).click();
  await expect(dialog).toBeHidden();
}

test('an owner removes people completely and deletes invitation rows', async ({ page }) => {
  await signUp(page, 'Removal E2E', { autoConfirm: false });
  const id = Math.random().toString(36).slice(2, 8);
  const simranA = `simran.a.${id}@removal.test`;
  const simranB = `simran.b.${id}@removal.test`;
  const manish = `manish.${id}@removal.test`;

  const a = await joinWithLead((await invite(page, simranA)).token, 'Simran A', 'Lead of Simran A');
  await joinWithLead((await invite(page, simranB, 'viewer')).token, 'Simran B');
  const pending = await invite(page, manish);
  expect((await page.request.delete(`/api/v1/tenants/current/invitations/${pending.id}`, { headers: { origin: ORIGIN } })).status()).toBe(204);

  await page.goto('/app/team');
  if (process.env.PREVIEW_DIR) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${process.env.PREVIEW_DIR}/01-team-remove-and-delete-buttons.png`, fullPage: true });
  }
  const members = page.getByRole('table', { name: 'Workspace members' });
  await expect(members.getByRole('row', { name: /Simran A/ })).toBeVisible();
  // Nobody can remove themselves.
  await expect(members.getByRole('row', { name: /Test Person/ }).getByRole('button', { name: /Remove/ })).toHaveCount(0);

  // Remove Simran A: shows what moves, hands it to the owner, asks for the password.
  await members.getByRole('button', { name: 'Remove Simran A' }).click();
  const removeDialog = page.getByRole('dialog', { name: 'Remove Simran A' });
  await expect(removeDialog.locator('[data-impact-records]')).toContainText('1 leads');
  await expect(removeDialog.getByLabel('Who receives their records')).toContainText('Test Person');
  if (process.env.PREVIEW_DIR) {
    await page.screenshot({ path: `${process.env.PREVIEW_DIR}/02-remove-person-dialog.png` });
  }
  await removeDialog.getByRole('button', { name: 'Continue' }).click();
  await confirmPassword(page, 'Remove person');
  await expect(page.locator('[data-member-removed]')).toContainText('Simran A was removed. 1 records and tasks now belong to Test Person.');
  await expect(members.getByRole('row', { name: /Simran A/ })).toHaveCount(0);
  // Their sign-in here stopped, and their invitation row went with them.
  expect((await a.get('/api/v1/leads')).status()).toBe(401);
  const invitations = page.getByRole('table', { name: 'Invitations' });
  await expect(invitations.getByRole('row', { name: new RegExp(simranA.replace(/\./g, '\\.')) })).toHaveCount(0);

  // The lead stayed and is now the owner's.
  await page.goto('/app/leads');
  await expect(page.getByText('Lead of Simran A').first()).toBeVisible();

  // Delete the accepted and revoked invitation rows for good.
  await page.goto('/app/team');
  for (const email of [simranB, manish]) {
    await invitations.getByRole('button', { name: `Delete invitation for ${email}` }).click();
    await confirmPassword(page, 'Confirm delete');
    await expect(invitations.getByRole('row', { name: new RegExp(email.replace(/\./g, '\\.')) })).toHaveCount(0);
  }

  // Simran B (no records) is removed without choosing anyone.
  await members.getByRole('button', { name: 'Remove Simran B' }).click();
  const second = page.getByRole('dialog', { name: 'Remove Simran B' });
  await expect(second.locator('[data-impact-records]')).toHaveText('None');
  await expect(second.getByLabel('Who receives their records')).toHaveCount(0);
  await second.getByRole('button', { name: 'Continue' }).click();
  await confirmPassword(page, 'Remove person');
  await expect(page.locator('[data-member-removed]')).toContainText('Simran B was removed.');
  await expect(members.getByRole('row')).toHaveCount(2);
});
