import { expect, type Page } from '@playwright/test';

export async function signUp(page: Page, org = 'E2E Org') {
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
  return { email, password: 'correcthorse1' };
}

/**
 * Inserts a received email for the signed-in workspace, as mailbox sync would, so screens that read inbound mail can
 * be tested without a real Gmail account. Uses the app role inside the workspace's RLS context.
 */
export async function seedInboundEmail(page: Page, email: { from: string; subject: string; body: string; contactId?: string }) {
  const { execFileSync } = await import('node:child_process');
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const url = process.env.E2E_DATABASE_URL ?? 'postgresql://dealflow_app:dealflow_app_dev@localhost:5432/dealflow';
  const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
  const tenant = q(me.tenant.id);
  const user = q(me.user.id);
  const sql = `BEGIN;
SELECT set_config('app.tenant_id', ${tenant}, true), set_config('app.user_id', ${user}, true);
WITH c AS (
  INSERT INTO integration_connections (tenant_id, user_id, provider, account_email, scopes, credentials_encrypted, updated_at)
  VALUES (${tenant}, ${user}, 'GOOGLE', 'me@seller.test', '{}', 'v1.x.y.z', now())
  ON CONFLICT (tenant_id, user_id, provider) DO UPDATE SET updated_at = now() RETURNING id)
INSERT INTO email_messages (tenant_id, connection_id, provider_message_id, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_text, sent_at, contact_id)
SELECT ${tenant}, c.id, gen_random_uuid()::text, 'INBOUND', ${q(email.from)}, '{me@seller.test}', '{}', ${q(email.subject)}, ${q(email.body.slice(0, 80))}, ${q(email.body)}, now(), ${email.contactId ? `${q(email.contactId)}::uuid` : 'NULL'} FROM c;
COMMIT;`;
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { stdio: 'pipe' });
}
