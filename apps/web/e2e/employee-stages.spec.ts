import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Employee communication stages, RFQ contributors and sending a company to SampBidx (ADR 0080), in the browser.
 * SampBidx is the stand-in started by playwright.config.ts (apps/api/test/fixtures/sampbidx-fixture.ts).
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

async function shotOf(page: Page, el: Locator, name: string) {
  if (!PREVIEW_DIR) return;
  // The sticky top bar would sit over a tall element's picture.
  const style = await page.addStyleTag({ content: 'header, [data-sticky], .sticky { position: static !important; }' });
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await el.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
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

const row = (section: Locator, name: string) => section.getByRole('row').filter({ has: section.page().getByRole('link', { name, exact: true }) });

test('employees get communication stages and RFQ contributor marks, and a company goes to SampBidx with the employee who shared the RFQ', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  await post(page, '/apps/sampbidx/keys', { baseUrl: `${SBX_URL}/api`, apiKey: SBX_KEY });
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));

  // Priya is the first (primary) employee; Bilal is the one who actually shares RFQs. Bilal has no time zone yet.
  const lead = await post(page, '/company-leads', {
    company: { name: 'Northwind Insights Ltd', country: 'IN', city: 'Mumbai', website: 'https://northwind.example', industry: 'Market research' },
    employees: [
      { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', timezone: 'Asia/Kolkata', emails: [{ value: 'priya@northwind.example' }] },
      { firstName: 'Bilal', lastName: 'Khan', jobTitle: 'Procurement Manager', emails: [{ value: 'bilal@northwind.example' }] },
      { firstName: 'Chen', lastName: 'Wei', jobTitle: 'Research Analyst', timezone: 'Asia/Kolkata', emails: [{ value: 'chen@northwind.example' }] },
    ],
  });
  const companyId = lead.company.id as string;
  const [, bilal] = lead.employeeIds as string[];
  const rfq = await post(page, '/rfqs', {
    companyId,
    contactId: bilal,
    projectName: 'Multi-country streaming study',
    methodology: 'Online survey',
    market: 'GB',
    sampleSize: 800,
    serviceCategory: 'QUANTITATIVE',
    service: 'CAWI',
    currency: 'GBP',
    deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    lines: [
      { country: 'GB', targetGroup: 'Gen pop 18+', quota: 500, loi: 15, ir: 30 },
      { country: 'DE', targetGroup: 'Gen pop 18+', quota: 300, loi: 15, ir: 25 },
    ],
  });

  // The company page: every employee with their stage, contributor status and RFQ counts.
  await page.goto(`/app/companies/${companyId}`);
  const section = page.locator('#employee-activity');
  await expect(section).toContainText('Employee RFQ activity');
  await expect(row(section, 'Bilal Khan')).toContainText('RFQ Received');
  await expect(row(section, 'Bilal Khan')).toContainText('Active RFQ Contributor');
  await expect(row(section, 'Priya Nair')).toContainText('No RFQ Received');

  // Chen sent an RFQ by phone that was never recorded: mark by hand.
  await row(section, 'Chen Wei').getByRole('button', { name: 'Mark as RFQ contributor' }).click();
  await expect(row(section, 'Chen Wei')).toContainText('RFQ Contributor');

  // Priya replied about a project: move her stage by hand, with a note for the history.
  await section.getByRole('button', { name: 'Change the communication stage of Priya Nair' }).click();
  await page.getByPlaceholder('Note for the history (optional)').fill('Replied about the Q3 tracker');
  await page.getByRole('button', { name: 'Discussion in Progress' }).click();
  await expect(row(section, 'Priya Nair')).toContainText('Discussion in Progress');
  await expect(row(section, 'Priya Nair').getByRole('status')).toContainText('Stage updated');

  // Filters.
  await section.getByRole('button', { name: /In discussion/ }).click();
  await expect(section).toContainText('1 of 3 employees');
  await section.getByRole('button', { name: /RFQ contributors/ }).click();
  await expect(section).toContainText('2 of 3 employees');
  await section.getByRole('button', { name: 'Clear filters' }).click();
  await expect(section).toContainText('3 of 3 employees');
  await axe(page);
  await shotOf(page, section, '01-employee-rfq-activity');

  // Priya's history shows the hand change and its note.
  await row(section, 'Priya Nair').getByRole('button', { name: 'History of Priya Nair' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Changed by hand');
  await expect(sheet).toContainText('Replied about the Q3 tracker');
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/02-employee-history.png` });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Send to SampBidx: Bilal is picked as the one who shared the RFQ, not Priya.
  await page.getByRole('button', { name: 'Send to SampBidx' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: /^Bilal Khan/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio', { name: /^Priya Nair/ })).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('radio', { name: /Multi-country streaming study/ }).click();
  await axe(page);
  await shotDialog(page, dialog, '03-send-choose');

  await dialog.getByRole('button', { name: 'Review what SampBidx gets' }).click();
  await expect(dialog).toContainText('Bilal Khan: Time zone is required by SampBidx.');
  await expect(dialog.getByRole('button', { name: 'Send client and RFQ' })).toBeDisabled();
  await expect(dialog).toContainText('Set by the bid manager in SampBidx');
  await expect(dialog).toContainText('Gen pop 18+');
  await shotDialog(page, dialog, '04-send-review-missing');
  await dialog.getByRole('combobox', { name: 'Time zone of Bilal Khan' }).fill('Kolkata');
  await dialog.getByRole('combobox', { name: 'Time zone of Bilal Khan' }).press('Enter');
  await expect(dialog).toContainText('Everything SampBidx requires is filled in.');
  await axe(page);
  await shotDialog(page, dialog, '05-send-review-ready');

  await dialog.getByRole('button', { name: 'Send client and RFQ' }).click();
  await expect(dialog).toContainText('SampBidx created or updated the client');
  await expect(dialog).toContainText('SampBidx accepted the RFQ');
  await expect(dialog).toContainText('SampBidx reference');
  await expect(dialog).toContainText('Sending to SampBidx does not mark the RFQ as won or accepted.');
  await shotDialog(page, dialog, '06-send-result');

  // What SampBidx got: the client with Bilal (time zone saved), and the RFQ with Bilal as its contact.
  const clients = (await (await page.request.get(`${SBX_URL}/__clients`)).json()) as { json: { company: { name: string }; contacts: { name: string; timeZone: string }[] } }[];
  const client = clients.find((c) => c.json.company.name === 'Northwind Insights Ltd')!;
  expect(client.json.contacts).toEqual([expect.objectContaining({ name: 'Bilal Khan', timeZone: 'Asia/Kolkata' })]);
  const received = (await (await page.request.get(`${SBX_URL}/__received`)).json()) as { path: string; json: { rfq?: { projectName: string; lines?: unknown[] }; contact?: { name: string } } }[];
  const sent = received.filter((r) => r.path === '/v1/rfqs' && r.json.rfq?.projectName === 'Multi-country streaming study').at(-1)!;
  expect(sent.json.contact?.name).toBe('Bilal Khan');
  expect(sent.json.rfq?.lines).toHaveLength(2);
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Bilal's stage moved; the RFQ itself is still just received.
  await expect(row(section, 'Bilal Khan')).toContainText('RFQ Sent to SampBidx');
  const r = await (await page.request.get(`/api/v1/rfqs/${rfq.id}`)).json();
  expect(r.status).toBe('RECEIVED');

  // Bilal's own page: the stage card and the whole timeline.
  await page.goto(`/app/contacts/${bilal}`);
  const card = page.locator('#communication-stage');
  await expect(card).toContainText('RFQ Sent to SampBidx');
  await expect(card).toContainText('Accepted by SampBidx');
  await expect(card).toContainText('An RFQ arrived');
  await axe(page);
  await shotOf(page, card, '07-contact-communication');

  // The RFQ form keeps one row per country and target group.
  await page.goto(`/app/rfqs?open=${rfq.id}`);
  const form = page.getByRole('dialog');
  await expect(form.getByRole('list', { name: 'Country rows' }).getByRole('listitem')).toHaveCount(2);
  await form.getByRole('button', { name: 'Add a country row' }).click();
  await expect(form.getByRole('list', { name: 'Country rows' }).getByRole('listitem')).toHaveCount(3);
  await form.getByRole('button', { name: 'Remove row 3' }).click();
  await shotDialog(page, form, '08-rfq-country-rows');
  await page.keyboard.press('Escape');

  // The workspace adds its own stage in CRM settings.
  await page.goto('/app/settings/crm?section=stages');
  const list = page.getByRole('list', { name: 'Communication stages' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await page.getByLabel('Name').fill('Pilot running');
  await page.getByLabel('Part of').selectOption('NEGOTIATION');
  await page.getByRole('button', { name: 'Add status' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(21);
  await expect(list).toContainText('Pilot running');
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/09-crm-stages.png`, fullPage: true });

  // Dark theme: the same screens stay readable.
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'dark', motion: 'off' }, version: 0 })));
  await page.goto(`/app/companies/${companyId}`);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(section).toContainText('RFQ Sent to SampBidx');
  await axe(page);
  await shotOf(page, section, '10-employee-rfq-activity-dark');
  await section.getByRole('button', { name: 'Change the communication stage of Chen Wei' }).click();
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/11-stage-picker-dark.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Send to SampBidx' }).first().click();
  await dialog.getByRole('button', { name: 'Review what SampBidx gets' }).click();
  await expect(dialog).toContainText('Client contact information');
  await shotDialog(page, dialog, '12-send-review-dark');
});
