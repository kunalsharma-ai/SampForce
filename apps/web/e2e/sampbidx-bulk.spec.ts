import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The SampBidx settings page with its step-by-step connection test, and bulk sends of deals and won companies
 * (ADR 0099), in the browser. SampBidx is the stand-in started by playwright.config.ts.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const SBX_URL = 'http://127.0.0.1:4970';
const SBX_KEY = 'sbx_test_key_0123456789';
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function theme(page: Page, t: 'light' | 'dark') {
  await page.evaluate((x) => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: x, motion: 'off' }, version: 0 })), t);
}

async function shotPage(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  const style = await page.addStyleTag({ content: 'header, [data-sticky], .sticky { position: static !important; }' });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 6000) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await style.evaluate((n) => (n as HTMLElement).remove());
}

async function shotDialog(page: Page, dialog: Locator, name: string) {
  if (!PREVIEW_DIR) return;
  const height = await dialog.evaluate((el) => el.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height + 160, 900), 3000) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('SampBidx settings test the connection step by step, and deals and won companies go to SampBidx in bulk', async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, 'Frequent Research Bulk Sends');
  await theme(page, 'light');

  // Not connected: the page says so, and a test of the wrong address stops at the step that fails.
  await page.goto('/app/integrations/sampbidx');
  const status = page.getByRole('region', { name: 'SampBidx connection status' });
  await expect(status).toContainText('Not connected');

  // SampBidx asks for the callback URL and signing secret before it creates a key: SampForce gives them first.
  const setup = page.getByTestId('sampbidx-callback-setup');
  await setup.getByRole('button', { name: 'Show the callback URL and signing secret' }).click();
  const callbackUrl = await setup.getByLabel('Status callback URL').inputValue();
  const callbackSecret = await setup.getByLabel('Callback signing secret').inputValue();
  expect(callbackUrl).toMatch(/^http.*\/api\/v1\/apps\/sampbidx\/callbacks\/[a-f0-9]{24}$/);
  expect(callbackSecret.length).toBeGreaterThanOrEqual(16);
  await expect(setup.getByRole('button', { name: 'Copy the signing secret' })).toBeVisible();
  await expect(status).toContainText('Not connected');
  await axe(page);
  await shotPage(page, '00-callback-before-key-light');
  await page.getByLabel('SampBidx API address').fill(SBX_URL);
  await page.getByLabel('API key', { exact: true }).fill(SBX_KEY);
  await page.getByRole('button', { name: 'Test these details' }).click();
  const steps = page.getByRole('list', { name: 'Connection test steps' }).first();
  await expect(steps.getByRole('listitem').nth(3)).toContainText('GET /v1/ping returned 404');
  await expect(page.getByText('The connection does not work yet.')).toBeVisible();
  await expect(status).toContainText('Not connected');
  await axe(page);
  await shotPage(page, '01-settings-test-fails-light');

  // The right address: every step passes, then Check and save.
  await page.getByLabel('SampBidx API address').fill(`${SBX_URL}/api`);
  await page.getByRole('button', { name: 'Test these details' }).click();
  await expect(page.getByText(/SampBidx accepted the address and the key/)).toBeVisible();
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText('SampBidx accepted the key. It is saved.')).toBeVisible();
  // The same URL and secret as before the key, so what was typed into SampBidx stays right.
  expect(await (await page.request.get('/api/v1/apps/sampbidx/callback-secret')).json()).toEqual({ callbackUrl, secret: callbackSecret });
  await expect(status).toContainText('Connected');
  await expect(status).toContainText('ends in 6789');
  await expect(page.locator('body')).not.toContainText(SBX_KEY);
  await status.getByRole('button', { name: 'Test the saved connection' }).click();
  await expect(status.getByRole('list', { name: 'Connection test steps' }).getByRole('listitem')).toHaveCount(6);
  await expect(status).toContainText('The key is accepted for');
  await shotPage(page, '02-settings-connected-light');

  // Three deals: one ready, one missing the contact's email and an amount, one without a company.
  const pipelines = await (await page.request.get('/api/v1/pipelines')).json();
  const stageId = pipelines.find((p: { isDefault: boolean }) => p.isDefault).stages.find((s: { category: string }) => s.category === 'OPEN').id;
  const acme = await post(page, '/company-leads', { company: { name: 'Acme Panels', country: 'IN', city: 'Pune' }, employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', timezone: 'Asia/Kolkata', emails: [{ value: 'priya@acmepanels.example' }] }] });
  const beta = await post(page, '/company-leads', { company: { name: 'Beta Insights', country: 'AE', city: 'Dubai' }, employees: [{ firstName: 'Omar', lastName: 'Haddad', jobTitle: 'Procurement', timezone: 'Asia/Dubai' }] });
  await post(page, '/deals', { name: 'India B2B tracker', amount: 5000, currency: 'USD', stageId, companyId: acme.company.id, contactId: acme.employeeIds[0], customFields: {} });
  await post(page, '/deals', { name: 'Beta wave 2', amount: 0, currency: 'USD', stageId, companyId: beta.company.id, contactId: beta.employeeIds[0], customFields: {} });
  await post(page, '/deals', { name: 'Walk-in enquiry', amount: 900, currency: 'USD', stageId, customFields: {} });

  await page.goto('/app/deals?view=list');
  for (const name of ['India B2B tracker', 'Beta wave 2', 'Walk-in enquiry']) await page.getByRole('checkbox', { name: `Select ${name}` }).check();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await bar.getByRole('button', { name: 'Send to SampBidx' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send deals to SampBidx' });
  await expect(dialog).toContainText('3 selected');
  const records = dialog.getByRole('list', { name: 'Records to send' });
  await expect(records.getByRole('listitem', { name: 'India B2B tracker' })).toContainText('Ready');
  await expect(records.getByRole('listitem', { name: 'Beta wave 2' })).toContainText('Needs correction');
  await expect(records.getByRole('listitem', { name: 'Walk-in enquiry' })).toContainText('no company');
  await expect(dialog.getByRole('button', { name: 'Send 1 to SampBidx' })).toBeEnabled();
  await axe(page);
  await shotDialog(page, dialog, '03-deals-check-light');

  // The missing details are typed in place, and the deal joins the send.
  await dialog.getByLabel('Email of Omar Haddad').fill('omar@beta.example');
  await dialog.getByLabel('Amount of the deal').fill('1200');
  await expect(records.getByRole('listitem', { name: 'Beta wave 2' })).toContainText('Ready');
  await dialog.getByRole('button', { name: 'Send 2 to SampBidx' }).click();
  await expect(dialog).toContainText('Finished: every record has SampBidx’s answer.', { timeout: 30_000 });
  await expect(dialog).toContainText('3 selected · 2 sent');
  const results = dialog.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('listitem', { name: 'India B2B tracker' })).toContainText(/SampBidx reference DL-/);
  await expect(results.getByRole('listitem', { name: 'Walk-in enquiry' })).toContainText('Skipped');
  await axe(page);
  await shotDialog(page, dialog, '04-deals-result-light');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // What SampBidx really got: each deal linked to its client, and the typed email saved on Omar.
  const deals = await (await page.request.get(`${SBX_URL}/__deals`)).json();
  expect(deals.map((d: { json: { deal: { name: string; amount: number } } }) => `${d.json.deal.name} ${d.json.deal.amount}`).sort()).toEqual(['Beta wave 2 1200', 'India B2B tracker 5000']);
  const omar = await (await page.request.get(`/api/v1/contacts/${beta.employeeIds[0]}`)).json();
  expect(omar.email).toBe('omar@beta.example');

  // Won companies: every won company the person can see, in one go.
  const won = await post(page, '/company-leads', { company: { name: 'Northwind Research', country: 'DE', city: 'Berlin' }, employees: [{ firstName: 'Lena', lastName: 'Fischer', jobTitle: 'Research Director', timezone: 'Europe/Berlin', emails: [{ value: 'lena@northwind.example' }] }] });
  await post(page, '/deals', { name: 'Northwind tracker', amount: 8000, currency: 'EUR', stageId, companyId: won.company.id, contactId: won.employeeIds[0], customFields: {} });
  await post(page, `/companies/${won.company.id}/won`, {});
  await page.goto('/app/companies');
  await page.getByRole('button', { name: 'Send won companies to SampBidx' }).click();
  const wonDialog = page.getByRole('dialog', { name: 'Send won companies to SampBidx' });
  await expect(wonDialog.getByRole('list', { name: 'Records to send' }).getByRole('listitem', { name: 'Northwind Research' })).toContainText('Ready');
  await shotDialog(page, wonDialog, '05-won-companies-check-light');
  await wonDialog.getByRole('button', { name: 'Send 1 to SampBidx' }).click();
  await expect(wonDialog).toContainText('1 selected · 1 sent', { timeout: 30_000 });
  await shotDialog(page, wonDialog, '06-won-companies-result-light');
  await wonDialog.getByRole('button', { name: 'Done' }).click();
  const clients = await (await page.request.get(`${SBX_URL}/__clients`)).json();
  expect(clients.find((c: { externalId: string }) => c.externalId === won.company.id).json.relationship).toMatchObject({ status: 'WON' });

  // The settings page now shows what went: sync counts and the bulk sends with their results.
  await page.goto('/app/integrations/sampbidx');
  const sync = page.getByRole('region', { name: 'Sync status' });
  await expect(sync).toContainText('Deals');
  await expect(sync).toContainText('Clients');
  const batches = page.getByRole('region', { name: 'Bulk sends' });
  await expect(batches.getByRole('button')).toHaveCount(2);
  await batches.getByRole('button').last().click();
  await expect(batches).toContainText('India B2B tracker');
  await expect(page.getByRole('region', { name: 'Field mapping' })).toContainText('deal.amount, deal.currency');
  await axe(page);
  await shotPage(page, '07-settings-after-sends-light');

  // Dark theme.
  await theme(page, 'dark');
  await page.reload();
  await expect(page.getByRole('region', { name: 'SampBidx connection status' })).toContainText('Connected');
  await page.getByRole('region', { name: 'SampBidx connection status' }).getByRole('button', { name: 'Test the saved connection' }).click();
  await expect(page.getByRole('region', { name: 'SampBidx connection status' })).toContainText('The key is accepted for');
  await axe(page);
  await shotPage(page, '08-settings-dark');
  await page.goto('/app/deals?view=list');
  await page.getByRole('checkbox', { name: 'Select India B2B tracker' }).check();
  await page.getByRole('checkbox', { name: 'Select Walk-in enquiry' }).check();
  await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Send to SampBidx' }).click();
  const dark = page.getByRole('dialog', { name: 'Send deals to SampBidx' });
  await expect(dark.getByRole('list', { name: 'Records to send' }).getByRole('listitem', { name: 'India B2B tracker' })).toContainText('In SampBidx');
  await axe(page);
  await shotDialog(page, dark, '09-deals-check-dark');
});
