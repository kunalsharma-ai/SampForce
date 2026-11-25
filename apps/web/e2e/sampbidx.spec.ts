import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { seedInboundEmail, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** The SampBidx stand-in started by playwright.config.ts (apps/api/test/fixtures/sampbidx-fixture.ts). */
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

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector('main')?.scrollHeight ?? 0));
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 2600) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** A dialog taller than the window: grow the window so the whole dialog is in the picture. */
async function shotDialog(page: Page, dialog: Locator, name: string) {
  if (!PREVIEW_DIR) return;
  const height = await dialog.evaluate((el) => el.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height + 120, 900), 3000) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

const EML = [
  'From: Priya Nair <priya@acmepanels.example>',
  'To: bids@frequentresearch.example',
  'Subject: RFQ: Germany B2B healthcare, 200 HCPs',
  'Date: Mon, 16 Nov 2026 10:15:00 +0530',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please quote 200 HCP completes, LOI 20, IR 30%. Questionnaire attached in the original email.',
  '',
].join('\r\n');

test('RFQs go to SampBidx two ways: details and attachments, or the RFQ email itself', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', (d) => void d.accept());
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const main = page.getByRole('main');
  const dialog = page.getByRole('dialog');

  // An admin connects SampBidx: the address and key are checked with SampBidx before saving.
  await page.goto('/app/integrations#app-sampbidx');
  const card = main.getByRole('region', { name: 'SampBidx' });
  await expect(card).toContainText('Not connected');
  await card.getByLabel('SampBidx API address').fill(`${SBX_URL}/api`);
  await card.getByLabel('API key').fill('wrong-key-12345');
  await card.getByRole('button', { name: 'Check and save' }).click();
  await expect(card.getByRole('alert')).toContainText('SampBidx refused the API key');
  await card.getByLabel('API key').fill(SBX_KEY);
  await card.getByRole('button', { name: 'Check and save' }).click();
  await expect(card).toContainText('Connected');
  await expect(card).toContainText('Frequent Research Bids');
  await card.getByRole('button', { name: 'Show the signing secret' }).click();
  await expect(card.getByLabel('Callback signing secret')).toHaveValue(/^sbxcb_/);
  const secret = await card.getByLabel('Callback signing secret').inputValue();
  const callbackUrl = await card.getByLabel('Status callback URL').inputValue();
  await card.scrollIntoViewIfNeeded();
  await axe(page);
  if (PREVIEW_DIR) await card.screenshot({ path: `${PREVIEW_DIR}/34-sampbidx-integration.png` });

  // A company lead with an RFQ that only has its project name so far.
  const lead = await post(page, '/company-leads', {
    company: { name: 'Acme Panels Pvt Ltd', country: 'IN', city: 'Pune' },
    employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead', emails: [{ value: 'priya@acmepanels.example' }] }],
  });
  const companyId = lead.company.id as string;
  const rfq = await post(page, '/rfqs', { companyId, contactId: lead.employeeIds[0], projectName: 'India B2B IT decision makers' });

  // Option 1, step 1: the RFQ says which details SampBidx still needs.
  await page.goto(`/app/rfqs?open=${rfq.id}`);
  const panel = dialog.getByRole('region', { name: 'Send to SampBidx' });
  await expect(panel.getByRole('list', { name: 'Missing details' })).toContainText('Research methodology');
  await expect(panel.getByRole('button', { name: 'Send this RFQ to SampBidx' })).toBeDisabled();
  await shotDialog(page, dialog, '35-rfq-missing-details');

  // Fill them in and save, then attach the questionnaire (step 2).
  await dialog.getByLabel('Research methodology').fill('Online survey');
  await expect(panel).toContainText('Save your changes above first');
  await dialog.getByLabel('Country / market').fill('India');
  await dialog.getByLabel('Country / market').press('Enter');
  await dialog.getByLabel('Target audience').fill('IT decision makers, 500+ employees');
  await dialog.getByLabel('Sample size').fill('400');
  await dialog.getByLabel('LOI (minutes)').fill('15');
  await dialog.getByLabel('IR (%)').fill('20');
  await dialog.getByLabel('CPI', { exact: true }).fill('12.5');
  await dialog.getByLabel('Submission deadline').fill('2031-03-12T18:00');
  await dialog.getByRole('button', { name: 'Save RFQ' }).click();
  await expect(dialog).toBeHidden();
  await page.goto(`/app/rfqs?open=${rfq.id}`);
  await expect(panel).toContainText('Project, methodology, market, sample size and deadline are filled in.');
  await dialog.locator('#rfq-attachments input[type=file]').setInputFiles({ name: 'questionnaire.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 questionnaire') });
  await expect(panel.getByRole('checkbox', { name: /questionnaire\.pdf/ })).toBeChecked();
  await dialog.locator('#rfq-attachments input[type=file]').setInputFiles({ name: 'quota-grid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 quotas') });
  await expect(panel.getByRole('checkbox', { name: /quota-grid\.pdf/ })).toBeChecked();
  await panel.getByLabel('Note for the SampBidx team (optional)').fill('Client wants the quote by Friday.');
  await axe(page);
  await shotDialog(page, dialog, '36-rfq-ready-to-send');

  // Step 3: send. SampBidx answers with its id.
  await panel.getByRole('button', { name: 'Send this RFQ to SampBidx' }).click();
  await expect(panel.getByRole('status')).toContainText('Sent. SampBidx has it as SBX-');
  const sends = panel.getByRole('list', { name: 'Sends of this RFQ' });
  await expect(sends).toContainText('With SampBidx');
  await expect(sends).toContainText('questionnaire.pdf');
  await expect(panel.getByRole('button', { name: 'Send this RFQ to SampBidx' })).toBeDisabled();
  await shotDialog(page, dialog, '37-rfq-sent-to-sampbidx');
  const received = (await (await page.request.get(`${SBX_URL}/__received`)).json()) as Array<{ path: string; json: { rfq?: { number: string; sampleSize: number }; note?: string }; parts: { name: string; filename: string | null }[] }>;
  const got = received.at(-1)!;
  expect(got.path).toBe('/v1/rfqs');
  expect(got.json.rfq).toMatchObject({ number: 'RFQ-0001', sampleSize: 400 });
  expect(got.json.note).toBe('Client wants the quote by Friday.');
  expect(got.parts.filter((p) => p.name === 'files').map((p) => p.filename)).toEqual(['questionnaire.pdf', 'quota-grid.pdf']);

  // SampBidx reports a quote back through the signed callback.
  const body = JSON.stringify({ transferId: (await (await page.request.get(`/api/v1/apps/sampbidx/transfers?rfqId=${rfq.id}`)).json())[0].id, status: 'quoted', note: 'Quoted at USD 11.50 CPI, 400 completes', url: 'https://sampbidx.example/bids/1' });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await page.request.post(new URL(callbackUrl).pathname, {
    data: body,
    headers: { 'content-type': 'application/json', 'x-sampbidx-timestamp': ts, 'x-sampbidx-signature': `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Option 2: transfer the RFQ email itself, from the synced mailbox or as an .eml file.
  await seedInboundEmail(page, { from: 'priya@acmepanels.example', subject: 'RFQ: UK consumer study, 1,000 completes', body: 'Need 1,000 UK adults, LOI 12. Can you quote by Thursday?', contactId: lead.employeeIds[0] });
  await page.goto('/app/rfqs');
  await main.getByRole('button', { name: 'Transfer RFQ email to SampBidx' }).click();
  await expect(dialog.getByRole('heading', { name: 'Transfer an RFQ email to SampBidx' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'From your mailbox' }).click();
  await dialog.getByRole('radio', { name: /UK consumer study/ }).check();
  await axe(page);
  await shotDialog(page, dialog, '38-transfer-email-from-mailbox');
  await dialog.getByRole('button', { name: 'Send email to SampBidx' }).click();
  await expect(dialog.getByRole('list', { name: 'Result' })).toContainText('With SampBidx');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await main.getByRole('button', { name: 'Transfer RFQ email to SampBidx' }).click();
  await dialog.getByRole('tab', { name: 'Upload the email file' }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'RFQ Germany HCPs.eml', mimeType: 'message/rfc822', buffer: Buffer.from(EML) });
  await dialog.getByLabel('Note for the SampBidx team (optional)').fill('Original email with the questionnaire attached.');
  await shotDialog(page, dialog, '39-transfer-email-file');
  await dialog.getByRole('button', { name: 'Send email to SampBidx' }).click();
  await expect(dialog.getByRole('list', { name: 'Result' })).toContainText('RFQ: Germany B2B healthcare, 200 HCPs');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Everything sent, with SampBidx's own status, on the RFQs page.
  await main.getByRole('tab', { name: 'Sent to SampBidx' }).click();
  const all = main.getByRole('list', { name: 'Sent to SampBidx' });
  await expect(all.getByRole('listitem')).toHaveCount(3);
  await expect(all).toContainText('SampBidx: Quoted');
  await expect(all).toContainText('SampBidx says: Quoted at USD 11.50 CPI, 400 completes');
  await expect(all).toContainText('Email from mailbox');
  await expect(all).toContainText('Email file');
  await axe(page);
  await shot(page, '40-sent-to-sampbidx');
});
