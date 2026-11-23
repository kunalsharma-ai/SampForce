import { expect, type Page, test } from '@playwright/test';
import { autoConfirmDeletion, signUp, workspaceAction } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

/**
 * Workspace redesign W2: Delete is off for every new Manager and Executive Workspace. Its people see no delete buttons
 * until the workspace above turns Delete on in the Permission Center.
 */
test('a new Manager Workspace cannot delete until the Super Workspace turns Delete on', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, 'Delete Rights Ltd');
  const created = await (
    await page.request.post('/api/v1/workspaces', { data: { level: 'MANAGER', name: 'North Sales', person: { inviteEmail: `north.${Date.now()}@example.com` } }, headers: ORIGIN })
  ).json();
  const token = (created.inviteUrl as string).split('/invite/')[1]!;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const manager = await ctx.newPage();
  const accept = await manager.request.post('/api/v1/auth/invitations/accept', { data: { token, name: 'Neha Kapoor', password: 'a-long-password-1' }, headers: ORIGIN });
  expect(accept.ok(), await accept.text()).toBe(true);
  await autoConfirmDeletion(manager, 'a-long-password-1');
  const lead = (await (await manager.request.post('/api/v1/leads', { data: { fullName: 'Ravi Menon', email: 'ravi@buyer.test' }, headers: ORIGIN })).json()).lead;

  // No delete button, and the API refuses a delete sent anyway.
  await manager.goto(`/app/leads/${lead.id}`);
  await expect(manager.getByRole('heading', { name: 'Ravi Menon', level: 1 })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Delete lead' })).toHaveCount(0);
  await shot(manager, '04-manager-sees-no-delete');
  const direct = await manager.request.delete(`/api/v1/leads/${lead.id}`, { headers: ORIGIN });
  expect(direct.status()).toBe(403);
  expect((await direct.json()).error.code).toBe('ACTION_NOT_GRANTED');

  // The Permission Center shows Delete off by default; the Super Workspace turns it on.
  await page.goto('/app/settings/workspaces');
  await workspaceAction(page, 'North Sales', 'Permissions');
  const dialog = page.getByRole('dialog');
  const deleteInCrm = dialog.getByRole('checkbox', { name: 'Delete in CRM' });
  await expect(deleteInCrm).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Edit in CRM' })).toBeChecked();
  await deleteInCrm.scrollIntoViewIfNeeded();
  await shot(page, '05-delete-off-by-default');
  await deleteInCrm.check();
  await dialog.getByRole('button', { name: 'Save permissions' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. It applies on its next request.');

  // The manager now sees the button, and deleting still asks for the password.
  await manager.reload();
  await manager.getByRole('button', { name: 'Delete lead' }).click();
  await manager.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(manager).toHaveURL(/\/app\/leads$/);
  expect((await manager.request.get(`/api/v1/leads/${lead.id}`, { headers: ORIGIN })).status()).toBe(404);
  await ctx.close();
});
