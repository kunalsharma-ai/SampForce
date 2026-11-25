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

/** A picture of one element, scrolled below the sticky top bar so nothing overlaps it. */
async function shot(page: Page, el: Locator, name: string) {
  if (!PREVIEW_DIR) return;
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  // Tall cards scroll under the sticky top bar, so hide the app's fixed chrome for the picture.
  const chrome = await page.addStyleTag({ content: 'header, body > div nav.fixed, [class*="sticky"] { visibility: hidden !important; }' });
  await page.waitForTimeout(250);
  await el.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, animations: 'disabled' });
  await chrome.evaluate((n) => (n as Element).remove());
}

/** An RFQ email as Outlook gives it when the whole message is selected and copied. */
const PASTED = [
  'From: Jonas Weber <jonas.weber@bluehill-insights.example>',
  'Sent: Monday, November 23, 2026 9:12 AM',
  'To: Anita Desai <anita@northwind-fieldwork.example>',
  'Cc: projects@bluehill-insights.example',
  'Subject: RFQ: UK grocery shoppers tracker W3 – 1,000 completes',
  '',
  'Hi Anita,',
  '',
  'We are running wave 3 of our UK grocery tracker (CAWI) and would like a quote.',
  '- Audience: UK adults 18+, main or joint grocery shopper',
  '- Completes: n=1,000, nat rep on age, gender and region',
  '- LOI: 12 minutes, expected IR 65%',
  '- Field dates: 8 to 19 December',
  '',
  'Questionnaire and quota grid attached. Could you send CPI and feasibility by Thursday?',
  '',
  'Thanks,',
  'Jonas Weber',
].join('\n');

test('an RFQ email is captured and sent to SampBidx in one click wherever the client is', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Northwind Fieldwork Ltd');
  const main = page.getByRole('main');
  await post(page, '/apps/sampbidx/keys', { baseUrl: `${SBX_URL}/api`, apiKey: SBX_KEY });
  const lead = await post(page, '/company-leads', {
    company: { name: 'Bluehill Insights GmbH', country: 'DE', city: 'Hamburg', website: 'https://bluehill-insights.example' },
    employees: [
      { firstName: 'Jonas', lastName: 'Weber', jobTitle: 'Research Director', emails: [{ value: 'jonas.weber@bluehill-insights.example' }] },
      { firstName: 'Lena', lastName: 'Vogel', jobTitle: 'Project Manager', emails: [{ value: 'lena.vogel@bluehill-insights.example' }] },
    ],
  });
  const companyId = lead.company.id as string;

  // 1. The company page: the capture card sits in Interactions, where the team logs client communication.
  await page.goto(`/app/companies/${companyId}`);
  const card = main.locator('#company-interactions').getByRole('region', { name: 'Capture RFQ & send to SampBidx' });
  await expect(card.getByTestId('rfq-capture-status')).toHaveText('Waiting for an email');
  await expect(card.getByRole('button', { name: 'Send RFQ to SampBidx' })).toBeDisabled();
  await shot(page, card, '01-capture-empty');

  // Paste: subject, sender and date are read, and the client is linked by the sender's address.
  await card.getByLabel('RFQ email text').fill(PASTED);
  await expect(card.getByTestId('rfq-capture-status')).toHaveText('Ready to send');
  await expect(card.getByTestId('rfq-capture-from')).toHaveText('Jonas Weber <jonas.weber@bluehill-insights.example>');
  await expect(card.getByLabel('Subject')).toHaveValue('RFQ: UK grocery shoppers tracker W3 – 1,000 completes');
  await expect(card.getByLabel('Contact person')).toHaveValue(lead.employeeIds[0]);
  // The email mentions attachments: SampForce says so, and the files can be added next to the text.
  await expect(card.getByTestId('rfq-capture-attachment-hint')).toBeVisible();
  await card.locator('input[type=file]').setInputFiles([
    { name: 'Grocery_Tracker_W3_Questionnaire.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('questionnaire') },
    { name: 'W3_quota_grid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('quotas') },
  ]);
  await expect(card.getByRole('button', { name: 'Remove W3_quota_grid.xlsx' })).toBeVisible();
  await expect(card.getByTestId('rfq-capture-attachment-hint')).toBeHidden();
  await axe(page);
  await shot(page, card, '02-capture-ready');

  // One click.
  await card.getByRole('button', { name: 'Send RFQ to SampBidx' }).click();
  await expect(card.getByTestId('rfq-capture-status')).toHaveText('Sent to SampBidx');
  const ok = card.getByTestId('rfq-capture-sent');
  await expect(ok).toContainText('SampBidx received “RFQ: UK grocery shoppers tracker W3 – 1,000 completes” as SBX-');
  await expect(ok).toContainText('Sent by Test Person');
  await expect(ok).toContainText('Jonas Weber');
  await expect(ok).toContainText('2 files');
  const log = main.getByRole('list', { name: 'Interactions' });
  await expect(log).toContainText('RFQ received');
  await axe(page);
  await shot(page, card, '03-capture-sent');

  // SampBidx got the whole text, the files, the client, the sender and the source page.
  const received = (await (await page.request.get(`${SBX_URL}/__received`)).json()) as Array<{ path: string; json: Record<string, unknown>; parts: { name: string; filename: string | null }[] }>;
  const got = received.at(-1)!;
  expect(got.path).toBe('/v1/rfq-emails');
  expect(got.json).toMatchObject({
    source: 'pasted',
    workspace: 'Northwind Fieldwork Ltd',
    sentBy: { name: 'Test Person' },
    company: { id: companyId, name: 'Bluehill Insights GmbH' },
    contact: { id: lead.employeeIds[0], name: 'Jonas Weber' },
    sourceReference: { type: 'company', id: companyId, url: `http://localhost:3000/app/companies/${companyId}` },
    email: { subject: 'RFQ: UK grocery shoppers tracker W3 – 1,000 completes', cc: ['projects@bluehill-insights.example'], text: PASTED, attachmentsIncluded: true },
  });
  expect(got.parts.filter((p) => p.name === 'files').map((p) => p.filename)).toEqual(['Grocery_Tracker_W3_Questionnaire.docx', 'W3_quota_grid.xlsx']);

  // 2. The same email pasted again, here or anywhere, is flagged as a duplicate before sending.
  await card.getByRole('button', { name: 'Capture another RFQ' }).click();
  await card.getByLabel('RFQ email text').fill(PASTED.replace(/\n/g, '\r\n'));
  await expect(card.getByTestId('rfq-capture-status')).toHaveText('Duplicate RFQ detected');
  await expect(card.getByTestId('rfq-capture-duplicate')).toContainText('already sent');
  await expect(card.getByRole('button', { name: 'Send another copy anyway' })).toBeVisible();
  await shot(page, card, '04-capture-duplicate');
  await card.getByRole('button', { name: 'Clear' }).click();

  // 3. A failed transfer keeps the pasted email, and Try again sends it with the same key.
  await page.request.post(`${SBX_URL}/__fail`, { data: { count: 1 } });
  await card.getByLabel('RFQ email text').fill(PASTED.replace('wave 3', 'wave 4').replace('W3', 'W4'));
  await expect(card.getByTestId('rfq-capture-status')).toHaveText('Ready to send');
  await card.getByRole('button', { name: 'Send RFQ to SampBidx' }).click();
  await expect(card.getByTestId('rfq-capture-status')).toHaveText('Transfer failed');
  await expect(card.getByRole('alert')).toContainText('Your pasted email is kept.');
  await expect(card.getByLabel('RFQ email text')).toHaveValue(/wave 4/);
  await shot(page, card, '05-capture-failed');
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.getByTestId('rfq-capture-status')).toHaveText('Sent to SampBidx');

  // 4. A contact's page: same card, linked to the contact and company.
  await page.goto(`/app/contacts/${lead.employeeIds[1]}`);
  const onContact = main.getByRole('region', { name: 'Capture RFQ & send to SampBidx' });
  await onContact.getByLabel('RFQ email text').fill('Hi, could you quote 300 German IT decision makers, LOI 15, IR 10%? Field in January. Thanks, Lena');
  await expect(onContact.getByLabel('Contact person')).toHaveValue(lead.employeeIds[1]);
  await onContact.getByLabel('Subject').fill('Germany ITDM quote, January');
  await onContact.getByRole('button', { name: 'Send RFQ to SampBidx' }).click();
  await expect(onContact.getByTestId('rfq-capture-sent')).toContainText('Lena Vogel');

  // 5. An email in the inbox: one button opens the card with that email already in it.
  await seedInboundEmail(page, { from: 'jonas.weber@bluehill-insights.example', subject: 'RFQ: Healthcare HCP CATI, Germany', body: 'Please quote 150 CATI interviews with cardiologists in Germany, LOI 20.', contactId: lead.employeeIds[0] });
  await page.goto('/app/communication');
  await main.getByRole('button', { name: /RFQ: Healthcare HCP CATI, Germany/ }).first().click();
  await main.getByRole('button', { name: 'Send RFQ to SampBidx' }).first().click();
  const inInbox = main.getByRole('region', { name: 'Capture RFQ & send to SampBidx' });
  await expect(inInbox.getByLabel('RFQ email text')).toHaveValue(/Subject: RFQ: Healthcare HCP CATI, Germany/);
  await expect(inInbox.getByTestId('rfq-capture-status')).toHaveText('Ready to send');
  await shot(page, inInbox, '06-capture-from-inbox');
  await inInbox.getByRole('button', { name: 'Send RFQ to SampBidx' }).click();
  await expect(inInbox.getByTestId('rfq-capture-status')).toHaveText('Sent to SampBidx');
  expect(((await (await page.request.get(`${SBX_URL}/__received`)).json()) as Array<{ json: { sourceReference?: { type: string } } }>).at(-1)!.json.sourceReference).toMatchObject({ type: 'email' });

  // 6. The RFQs page, not tied to a client: someone new at a known domain is only a suggestion to check.
  await page.goto('/app/rfqs');
  await main.getByRole('button', { name: 'Transfer RFQ email to SampBidx' }).click();
  const dialog = page.getByRole('dialog');
  const inDialog = dialog.getByRole('region', { name: 'Capture RFQ & send to SampBidx' });
  await inDialog.getByLabel('RFQ email text').fill(PASTED.replace('Jonas Weber <jonas.weber@', 'Mia Braun <mia.braun@').replace('wave 3', 'wave 9'));
  await expect(inDialog.getByTestId('rfq-capture-status')).toHaveText('Check the client');
  await expect(inDialog.getByTestId('rfq-capture-client')).toContainText('Suggested from the email domain');
  await expect(inDialog.getByRole('button', { name: 'Send RFQ to SampBidx' })).toBeDisabled();
  await shot(page, dialog, '07-capture-check-the-client');
  await inDialog.getByRole('button', { name: 'This client is right' }).click();
  await expect(inDialog.getByTestId('rfq-capture-status')).toHaveText('Ready to send');
  await inDialog.getByRole('button', { name: 'Send RFQ to SampBidx' }).click();
  await expect(inDialog.getByTestId('rfq-capture-sent')).toContainText('Bluehill Insights GmbH');
  await page.keyboard.press('Escape');

  // Every send is listed with who sent it, where it came from and the client.
  await main.getByRole('tab', { name: 'Sent to SampBidx' }).click();
  const all = main.getByRole('list', { name: 'Sent to SampBidx' });
  await expect(all.getByRole('listitem')).toHaveCount(5);
  await expect(all).toContainText('Pasted email');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the capture card fits a phone screen', async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, 'Northwind Mobile');
    await post(page, '/apps/sampbidx/keys', { baseUrl: `${SBX_URL}/api`, apiKey: SBX_KEY });
    const lead = await post(page, '/company-leads', { company: { name: 'Bluehill Mobile GmbH', country: 'DE' }, employees: [{ firstName: 'Jonas', lastName: 'Weber', emails: [{ value: 'jonas.weber@bluehill-mobile.example' }] }] });
    await page.goto(`/app/companies/${lead.company.id}`);
    const card = page.getByRole('main').locator('#company-interactions').getByRole('region', { name: 'Capture RFQ & send to SampBidx' });
    await card.getByLabel('RFQ email text').fill(PASTED.replace(/bluehill-insights/g, 'bluehill-mobile'));
    await expect(card.getByTestId('rfq-capture-status')).toHaveText('Ready to send');
    // Nothing wider than the screen.
    // One pixel of slack for sub-pixel rounding, as the other phone checks allow.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(page, card, '08-capture-phone');
    await card.getByRole('button', { name: 'Send RFQ to SampBidx' }).click();
    await expect(card.getByTestId('rfq-capture-status')).toHaveText('Sent to SampBidx');
  });
});
