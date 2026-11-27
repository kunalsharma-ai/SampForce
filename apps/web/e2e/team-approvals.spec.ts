import { type Browser, expect, type Page, test } from '@playwright/test';
import { autoConfirmDeletion, signUp } from './helpers';

/*
 * Team approvals and Deleted items (ADR 0098), in the browser: the Super Workspace lets the levels below delete, an
 * executive's delete becomes a request to their manager, the manager approves it in Approvals, the executive deletes
 * once, and the Super Workspace brings the company back from Deleted items. Set PREVIEW_DIR for screenshots.
 */
const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const PASSWORD = 'a-long-password-1';

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

/** Creates a workspace from `creator`'s session and signs its person in on a page of their own. */
async function person(browser: Browser, creator: Page, level: 'MANAGER' | 'EXECUTIVE', workspace: string, name: string): Promise<Page> {
  const res = await creator.request.post('/api/v1/workspaces', { data: { level, name: workspace, person: { inviteEmail: `${level.toLowerCase()}.${Date.now()}@example.com` } }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  const created = (await res.json()) as { id: string; inviteUrl: string };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const accept = await page.request.post('/api/v1/auth/invitations/accept', { data: { token: created.inviteUrl.split('/invite/')[1], name, password: PASSWORD }, headers: ORIGIN });
  expect(accept.ok(), await accept.text()).toBe(true);
  await autoConfirmDeletion(page, PASSWORD);
  (page as Page & { workspaceId?: string }).workspaceId = created.id;
  return page;
}

test('an executive asks their manager before deleting, deletes once approved, and the company can be restored', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Approvals Research');

  // Rules: Manager and Executive Workspaces can delete; executives ask first.
  await page.goto('/app/approvals?box=rules');
  // On by default; the Super Workspace can switch either off here.
  await expect(page.getByRole('switch', { name: /Manager and Executive Workspaces can delete/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: /Executives ask before deleting/ })).toBeChecked();
  await page.getByLabel('Move up after (hours, 0 = never)').fill('12');
  await shot(page, '01-rules');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

  const manager = await person(browser, page, 'MANAGER', 'North Sales', 'Meera Kapoor');
  const managerId = (manager as Page & { workspaceId?: string }).workspaceId!;
  expect((await page.request.put(`/api/v1/workspaces/${managerId}/permissions`, { data: { canCreateExecutives: true }, headers: ORIGIN })).ok()).toBe(true);
  const executive = await person(browser, manager, 'EXECUTIVE', 'North Field', 'Esha Rao');
  const created = await executive.request.post('/api/v1/companies', { data: { name: 'Duplicate Panels Pvt', country: 'IN' }, headers: ORIGIN });
  expect(created.ok(), await created.text()).toBe(true);
  const companyId = ((await created.json()) as { id: string }).id;

  // The executive deletes: nothing is deleted, the "Ask your manager" dialog opens instead.
  await executive.goto(`/app/companies/${companyId}`);
  await expect(executive.getByRole('heading', { name: 'Duplicate Panels Pvt', level: 1 })).toBeVisible();
  await executive.getByRole('button', { name: 'Delete company' }).click();
  await executive.getByRole('dialog', { name: 'Delete this company?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  const ask = executive.getByRole('dialog', { name: 'Ask your manager to approve' });
  await expect(ask).toContainText('Company: Duplicate Panels Pvt');
  await ask.getByLabel('Why? Your manager sees this').fill('Same panel company as Duplicate Panels India, entered twice');
  await shot(executive, '02-executive-asks-manager');
  await ask.getByRole('button', { name: 'Send for approval' }).click();
  const sent = executive.getByRole('dialog', { name: 'Sent to your manager' });
  await expect(sent).toBeVisible();
  await shot(executive, '03-sent-to-manager');
  await sent.getByRole('button', { name: 'Close' }).first().click();
  await expect(sent).toBeHidden();
  await expect(executive.getByRole('dialog', { name: 'Delete this company?' })).toBeHidden();
  expect((await executive.request.get(`/api/v1/companies/${companyId}`, { headers: ORIGIN })).ok()).toBe(true);

  // The manager decides in Approvals.
  await manager.goto('/app/approvals');
  await expect(manager.getByRole('tab', { name: /Waiting for you/ })).toHaveAttribute('aria-selected', 'true');
  const request = manager.locator('[data-request-status="PENDING"]').filter({ hasText: 'Duplicate Panels Pvt' });
  await expect(request).toContainText('Esha Rao');
  await expect(request).toContainText('entered twice');
  await shot(manager, '04-manager-waiting-for-you');
  await request.getByLabel('Comment for Esha Rao').fill('Yes, keep the India one.');
  await request.getByRole('button', { name: 'Approve' }).click();
  // Decided, it leaves the manager's waiting list; the executive is told.
  await expect(request).toHaveCount(0);
  await expect(manager.getByText('Nothing is waiting for your decision.')).toBeVisible();

  // The executive finishes it once, from My requests.
  await executive.goto('/app/approvals?box=mine');
  const mine = executive.locator('[data-request-status="APPROVED"]').filter({ hasText: 'Duplicate Panels Pvt' });
  await expect(mine).toContainText('Yes, keep the India one.');
  await shot(executive, '05-executive-approved');
  await mine.getByRole('button', { name: 'Delete now' }).click();
  await expect(executive.locator('[data-request-status="COMPLETED"]').filter({ hasText: 'Duplicate Panels Pvt' })).toBeVisible();
  expect((await executive.request.get(`/api/v1/companies/${companyId}`, { headers: ORIGIN })).status()).toBe(404);
  await shot(executive, '06-executive-completed');

  // The Super Workspace sees it in Deleted items and brings it back.
  await page.goto('/app/approvals?box=deleted');
  const item = page.locator('[data-deleted-item]').filter({ hasText: 'Duplicate Panels Pvt' });
  await expect(item).toContainText('Esha Rao');
  await shot(page, '07-deleted-items');
  await item.getByRole('button', { name: 'Restore' }).click();
  await expect(item.getByRole('status')).toHaveText('Restored.');
  expect((await page.request.get(`/api/v1/companies/${companyId}`, { headers: ORIGIN })).ok()).toBe(true);
  await page.goto('/app/approvals?box=all');
  await expect(page.locator('[data-request-status="COMPLETED"]').filter({ hasText: 'Duplicate Panels Pvt' })).toBeVisible();
  await shot(page, '08-super-all-requests');

  await manager.context().close();
  await executive.context().close();
});
