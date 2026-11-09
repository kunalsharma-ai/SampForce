import { expect, type Page } from '@playwright/test';

/**
 * Signs up a new workspace. It starts on Free like any real sign-up; unless `plan` says otherwise it is then moved to
 * Enterprise Plus, so specs can reach every feature (ADR 0057). Pass `{ plan: 'free' }` to test the Free plan itself.
 */
export async function signUp(page: Page, org = 'E2E Org', { plan = 'enterprise_plus' }: { plan?: string } = {}) {
  const id = Math.random().toString(36).slice(2, 10);
  const email = `e2e-${id}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Test Person');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await page.getByLabel('Organization name').fill(org);
  await page.getByRole('button', { name: 'Start free' }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole('heading', { name: 'Welcome, Test' })).toBeVisible();
  if (plan !== 'free') {
    await setPlan(page, plan);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome, Test' })).toBeVisible();
  }
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

/** Inserts a calendar meeting as if it had been synced from Google Calendar. */
export async function seedMeeting(page: Page, m: { title: string; hoursFromNow: number; contactId: string; attendee: string; joinUrl?: string }) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await fixture({ action: 'meeting', tenantId: me.tenant.id, userId: me.user.id, ...m });
}
