import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('creates a scoped API key, shows it once, enforces its scopes and revokes it', async ({ page, playwright, baseURL }) => {
  await signUp(page, 'Keys Flow');
  await page.goto('/app/integrations');
  const zapier = page.getByRole('region', { name: /^Zapier/ });
  await expect(zapier.getByText('Pending Configuration')).toBeVisible();
  await expect(zapier.getByText(/not published on this installation yet/)).toBeVisible();

  const keys = page.getByRole('region', { name: 'API keys' });
  await expect(keys.getByText('No API keys yet.')).toBeVisible();
  await keys.getByLabel('Key name').fill('Zapier test');
  // The form starts with lead, contact and deal scopes; this key gets leads and contacts only.
  await expect(keys.getByLabel('Read deals')).toBeChecked();
  await keys.getByLabel('Read deals').uncheck();
  await keys.getByRole('button', { name: 'Create key' }).click();
  const shown = keys.getByLabel('Your new key. Copy it now: it is not shown again.');
  const key = await shown.inputValue();
  expect(key).toMatch(/^dfk_/);

  // The key works from outside the browser (no cookies), only on routes that accept keys and within its scopes.
  const ctx = await playwright.request.newContext({ baseURL });
  const bearer = { authorization: `Bearer ${key}` };
  const me = await ctx.fetch('/api/v1/zapier/me', { headers: bearer });
  expect(me.status()).toBe(200);
  expect((await me.json()).keyName).toBe('Zapier test');
  const made = await ctx.fetch('/api/v1/leads', { method: 'POST', headers: bearer, data: { fullName: 'Kei Zap' } });
  expect(made.status()).toBe(201);
  expect((await ctx.fetch('/api/v1/deals', { headers: bearer })).status()).toBe(403);
  expect((await ctx.fetch('/api/v1/tenants/current/members', { headers: bearer })).status()).toBe(403);

  await keys.getByRole('button', { name: 'Done' }).click();
  await expect(shown).toHaveCount(0);
  const row = keys.getByRole('list', { name: 'API keys' }).getByRole('listitem').filter({ hasText: 'Zapier test' });
  await expect(row.getByText('Active')).toBeVisible();
  await expect(row.getByText(/4 scopes/)).toBeVisible();
  await expect(row.getByText(key)).toHaveCount(0);

  expect((await new AxeBuilder({ page }).include('section[aria-labelledby="api-heading"]').analyze()).violations).toEqual([]);

  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Revoke Zapier test' }).click();
  await expect(row.getByText('Revoked')).toBeVisible();
  expect((await ctx.fetch('/api/v1/zapier/me', { headers: bearer })).status()).toBe(401);
  await ctx.dispose();
});
