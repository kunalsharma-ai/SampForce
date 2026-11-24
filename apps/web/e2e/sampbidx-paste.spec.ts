import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

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
  'We are running wave 3 of our UK grocery tracker and would like a quote.',
  '- Audience: UK adults 18+, main or joint grocery shopper',
  '- Completes: n=1,000, nat rep on age, gender and region',
  '- LOI: 12 minutes, expected IR 65%',
  '- Field dates: 8 to 19 December',
  '',
  'Could you send CPI and feasibility by Thursday?',
  '',
  'Thanks,',
  'Jonas Weber',
].join('\n');

test('an RFQ email pasted on the company page goes to SampBidx in one click and is logged as received', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Northwind Fieldwork Ltd');
  const main = page.getByRole('main');
  await post(page, '/apps/sampbidx/keys', { baseUrl: `${SBX_URL}/api`, apiKey: SBX_KEY });
  const lead = await post(page, '/company-leads', {
    company: { name: 'Bluehill Insights GmbH', country: 'DE', city: 'Hamburg' },
    employees: [
      { firstName: 'Jonas', lastName: 'Weber', jobTitle: 'Research Director', emails: [{ value: 'jonas.weber@bluehill-insights.example' }] },
      { firstName: 'Lena', lastName: 'Vogel', jobTitle: 'Project Manager', emails: [{ value: 'lena.vogel@bluehill-insights.example' }] },
    ],
  });
  const companyId = lead.company.id as string;

  await page.goto(`/app/companies/${companyId}`);
  const box = main.getByRole('region', { name: 'Paste an RFQ email and send it to SampBidx' });
  await box.scrollIntoViewIfNeeded();
  await expect(box.getByRole('button', { name: 'Send to SampBidx' })).toBeDisabled();
  if (PREVIEW_DIR) await main.locator('#company-interactions').screenshot({ path: `${PREVIEW_DIR}/01-paste-box-empty.png` });

  // Paste: subject, sender and date are read from the text, and the sender is matched to the employee.
  await box.getByLabel('RFQ email text').fill(PASTED);
  await expect(box.getByLabel('Subject')).toHaveValue('RFQ: UK grocery shoppers tracker W3 – 1,000 completes');
  await expect(box.getByLabel('Sent by')).toHaveValue(lead.employeeIds[0]);
  await expect(box.getByTestId('sbx-paste-detected')).toContainText('From Jonas Weber <jonas.weber@bluehill-insights.example>');
  await expect(box.getByTestId('sbx-paste-detected')).toContainText('Matched to Jonas Weber');
  await expect(box.getByLabel('Also log it in Interactions as “RFQ received”')).toBeChecked();
  await axe(page);
  if (PREVIEW_DIR) await main.locator('#company-interactions').screenshot({ path: `${PREVIEW_DIR}/02-paste-box-filled.png` });

  // One click sends it.
  await box.getByRole('button', { name: 'Send to SampBidx' }).click();
  const result = box.getByRole('list', { name: 'Result' });
  await expect(result).toContainText('With SampBidx');
  await expect(result).toContainText('SampBidx id SBX-');
  await expect(result).toContainText('Pasted email');
  await expect(box.getByLabel('RFQ email text')).toHaveValue('');

  // SampBidx got the whole text, the company and the employee.
  const received = (await (await page.request.get(`${SBX_URL}/__received`)).json()) as Array<{ path: string; json: Record<string, unknown> }>;
  const got = received.at(-1)!;
  expect(got.path).toBe('/v1/rfq-emails');
  expect(got.json).toMatchObject({
    source: 'pasted',
    workspace: 'Northwind Fieldwork Ltd',
    company: { id: companyId, name: 'Bluehill Insights GmbH' },
    contact: { id: lead.employeeIds[0], name: 'Jonas Weber' },
    email: { subject: 'RFQ: UK grocery shoppers tracker W3 – 1,000 completes', from: 'Jonas Weber <jonas.weber@bluehill-insights.example>', cc: ['projects@bluehill-insights.example'], text: PASTED },
  });

  // It is in the communication log as "RFQ received" from Jonas.
  const log = main.getByRole('list', { name: 'Interactions' });
  await expect(log).toContainText('RFQ: UK grocery shoppers tracker W3 – 1,000 completes');
  await expect(log).toContainText('RFQ received');
  await axe(page);
  if (PREVIEW_DIR) await main.locator('#company-interactions').screenshot({ path: `${PREVIEW_DIR}/03-paste-sent-and-logged.png` });

  // Pasting the same email again is caught; a second copy is a deliberate extra click.
  await box.getByLabel('RFQ email text').fill(PASTED);
  await box.getByRole('button', { name: 'Send to SampBidx' }).click();
  await expect(box.getByRole('alert')).toContainText('This email is already with SampBidx');
  await expect(box.getByRole('button', { name: 'Send another copy to SampBidx' })).toBeVisible();
  if (PREVIEW_DIR) await main.locator('#company-interactions').screenshot({ path: `${PREVIEW_DIR}/04-paste-duplicate.png` });
  await box.getByRole('button', { name: 'Clear' }).click();

  // A plain body with no header lines: the person picks the employee and types a subject.
  await box.getByLabel('RFQ email text').fill('Hello, could you quote 300 German IT decision makers, LOI 15, IR 10%? Field in January. Thanks, Lena');
  await expect(box.getByTestId('sbx-paste-detected')).toContainText('No sender found in the text.');
  await box.getByLabel('Sent by').selectOption(lead.employeeIds[1]);
  await box.getByLabel('Subject').fill('Germany ITDM quote, January');
  await box.getByRole('button', { name: 'Send to SampBidx' }).click();
  await expect(box.getByRole('list', { name: 'Result' })).toContainText('Germany ITDM quote, January');
  await expect(log).toContainText('Germany ITDM quote, January');

  // Both are under RFQs, Sent to SampBidx.
  await page.goto('/app/rfqs?tab=sampbidx');
  const all = main.getByRole('list', { name: 'Sent to SampBidx' });
  await expect(all.getByRole('listitem')).toHaveCount(2);
  await expect(all).toContainText('Pasted email');
});
