import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { setWorkspaceRules, signUp, workspaceAction } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen. */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(target: Page | Locator, name: string) {
  if (!PREVIEW_DIR) return;
  const page = 'page' in target ? target.page() : target;
  await page.waitForTimeout(400);
  await target.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/*
 * The Super Workspace passes on what the Console allows (ADR 0096): every section, action and field it has, never
 * one the Console keeps back from the level, and it may hide or lock fields. The server enforces all of it.
 */
test('the Super Workspace hands everything allowed to a manager, and hides or locks fields', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Frequent Research Panels');
  // The Console keeps Quotes and RFQ pricing back from Manager Workspaces.
  await setWorkspaceRules(page, { managerHiddenSections: ['quotes'], managerHiddenFields: ['rfq.pricing'] });

  await page.goto('/app/settings/workspaces');
  await page.getByRole('button', { name: 'New Manager Workspace' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Workspace name').fill('West India Sales');
  await dialog.getByLabel('Designation').fill('Regional Sales Manager');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Full name').fill('Meera Nair');
  await dialog.getByLabel('Work email').fill(`meera.${Date.now()}@example.com`);
  await expect(dialog.getByText('This email is free to use.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  const token = (await dialog.getByLabel('Invitation link').inputValue()).split('/invite/')[1]!;
  await dialog.getByRole('button', { name: 'Done' }).click();

  await workspaceAction(page, 'West India Sales', 'Permissions');
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-super-rights]')).toContainText('Your Super Workspace always keeps every right');
  // What the Console keeps back is shown, but cannot be ticked.
  const quotes = dialog.locator('[data-withheld="quotes"]');
  await expect(quotes).toContainText('Kept back by SampForce');
  await expect(quotes.getByRole('checkbox')).toBeDisabled();
  await expect(quotes.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.locator('[data-field="rfq.pricing"]')).toContainText('Kept back by SampForce');
  await expect(dialog.getByRole('radio', { name: 'RFQ CPI and quotation: Show' })).toBeDisabled();

  // Everything allowed in one click, then the Super Workspace hides the website and locks the email.
  await dialog.locator('[data-grant-everything]').click();
  await expect(dialog.getByRole('checkbox', { name: 'Delete in CRM' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'RFQs', exact: true })).toBeChecked();
  await shot(page, '01-super-permission-center');
  await shot(dialog.locator('fieldset:has([data-withheld="quotes"])'), '01b-kept-back-section');
  await shot(dialog.locator('[data-field-entity="rfq"]'), '01c-kept-back-field');
  await axe(page);
  await dialog.getByRole('radio', { name: 'Company Website: Hide' }).check();
  await dialog.getByRole('radio', { name: 'Company Email: Lock' }).check();
  await expect(dialog.locator('[data-field-summary]')).toHaveText('24 shown, 1 locked, 2 hidden');
  await dialog.locator('[data-field-access]').scrollIntoViewIfNeeded();
  await shot(page, '02-super-field-access');
  await dialog.getByRole('button', { name: 'Save permissions' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. It applies on its next request.');
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  const west = (await (await page.request.get('/api/v1/workspaces', { headers: ORIGIN })).json()).workspaces.find((w: { name: string }) => w.name === 'West India Sales');
  expect(west.features).not.toContain('quotes');
  expect(west.features).toContain('rfqs');
  expect(west.actions.CRM).toContain('delete');
  expect(west.hiddenFields).toEqual(['company.website']);
  expect(west.lockedFields).toEqual(['company.primaryEmail']);
  expect(west.effectiveHiddenFields).toEqual(['company.website', 'rfq.pricing']);

  // The manager signs in: the website is not there, the email is but cannot be changed.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const manager = await ctx.newPage();
  const accept = await manager.request.post('/api/v1/auth/invitations/accept', { data: { token, name: 'Meera Nair', password: 'a-long-password-1' }, headers: ORIGIN });
  expect(accept.ok(), await accept.text()).toBe(true);
  const meera = (await (await manager.request.get('/api/v1/auth/me')).json()).user.id as string;
  const created = await page.request.post('/api/v1/companies', { data: { name: 'Kite Insights', primaryEmail: 'sales@kite.test', website: 'https://kite.test', industry: 'Market research', ownerId: meera }, headers: ORIGIN });
  expect(created.ok(), await created.text()).toBe(true);
  const company = await created.json();

  const seen = await (await manager.request.get(`/api/v1/companies/${company.id}`)).json();
  expect(seen.website).toBeNull();
  expect(seen.primaryEmail).toBe('sales@kite.test');
  const edit = await manager.request.patch(`/api/v1/companies/${company.id}`, { data: { primaryEmail: 'changed@kite.test', industry: 'Panels' }, headers: ORIGIN });
  expect(edit.ok(), await edit.text()).toBe(true);
  const after = await (await page.request.get(`/api/v1/companies/${company.id}`)).json();
  expect(after.primaryEmail).toBe('sales@kite.test');
  expect(after.industry).toBe('Panels');

  // Its company list works as before.
  await manager.goto('/app/companies');
  await expect(manager.getByRole('link', { name: 'Kite Insights' }).first()).toBeVisible();
  await shot(manager, '03-manager-companies');
  await ctx.close();
});
