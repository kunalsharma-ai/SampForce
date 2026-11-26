import { expect, type Page } from '@playwright/test';

/**
 * Signs up a new workspace. The owner opens on the Super Workspace's organisation overview (ADR 0071 part 6); the
 * senior management dashboard is at /app?view=senior and the analytics layout at /app?view=analytics. It starts on Free like any real sign-up; unless `plan` says otherwise it is then moved to
 * Enterprise Plus, so specs can reach every feature (ADR 0057). Pass `{ plan: 'free' }` to test the Free plan itself.
 */
/**
 * Deleting asks for the password (workspace redesign W1). Suites that test something else answer the Confirm deletion
 * dialog whenever it opens with this person's password; password-confirmation.spec.ts tests the dialog itself.
 */
export async function autoConfirmDeletion(page: Page, password: string) {
  const dialog = page.getByRole('dialog', { name: 'Confirm deletion' });
  await page.addLocatorHandler(dialog, async () => {
    await dialog.getByLabel('Password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(dialog).toBeHidden();
  });
}

export async function signUp(page: Page, org = 'E2E Org', { plan = 'enterprise_plus', autoConfirm = true }: { plan?: string; autoConfirm?: boolean } = {}) {
  const id = Math.random().toString(36).slice(2, 10);
  const email = `e2e-${id}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Test Person');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await page.getByLabel('Organization name').fill(org);
  await page.getByRole('button', { name: 'Start free' }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole('heading', { name: 'Organisation overview', level: 1 })).toBeVisible();
  if (plan !== 'free') {
    await setPlan(page, plan);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Organisation overview', level: 1 })).toBeVisible();
  }
  if (autoConfirm) await autoConfirmDeletion(page, 'correcthorse1');
  return { email, password: 'correcthorse1' };
}

/** Default database of the end-to-end stack (see playwright.config.ts). */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'mongodb://localhost:27017/sampforce?replicaSet=rs0&directConnection=true';

/** Writes test data through the API's own database client, inside the workspace (apps/api/scripts/e2e-fixture.ts). */
async function fixture(input: Record<string, unknown>) {
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/e2e-fixture.ts', JSON.stringify(input)], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });
}

/** Moves the signed-in workspace to a plan (active, 10 seats), as a paid subscription or an operator would. */
export async function setPlan(page: Page, planCode: string) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await fixture({ action: 'setPlan', tenantId: me.tenant.id, planCode });
}

/**
 * Stores a received email for the signed-in workspace, as mailbox sync would, so screens that read inbound mail can
 * be tested without a real Gmail account. It joins its inbox conversation like synced mail.
 */
export async function seedInboundEmail(page: Page, email: { from: string; subject: string; body: string; contactId?: string }) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await fixture({ action: 'inboundEmail', tenantId: me.tenant.id, userId: me.user.id, ...email });
}

/** Grants (or withholds) one feature for the signed-in organisation, as the Console Admin does on its client page. */
export async function setFeature(page: Page, feature: string, enabled: boolean) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await fixture({ action: 'featureOverride', tenantId: me.tenant.id, feature, enabled });
}

/** Approves the signed-in workspace for the mobile app and switches it on (ADR 0072). */
export async function approveMobile(page: Page) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await fixture({ action: 'mobileApproved', tenantId: me.tenant.id });
}

/** Inserts a calendar meeting as if it had been synced from Google Calendar. */
export async function seedMeeting(page: Page, m: { title: string; hoursFromNow: number; contactId: string; attendee: string; joinUrl?: string }) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await fixture({ action: 'meeting', tenantId: me.tenant.id, userId: me.user.id, ...m });
}

/** Opens a workspace's Actions menu on the hierarchy page and picks one (Edit, Permissions, Deactivate, Reactivate, Delete). */
export async function workspaceAction(page: Page, workspace: string, action: 'Edit' | 'Permissions' | 'Deactivate' | 'Blacklist for a while' | 'Reactivate' | 'Delete') {
  await page.getByRole('button', { name: `Actions for ${workspace}`, exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

/** Opens the header's account menu (redesign R1: Copilot, favourites, theme, help and Quick create live there). */
export async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/** Opens Copilot from the account menu. */
export async function openCopilot(page: Page) {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Copilot' }).click();
}
