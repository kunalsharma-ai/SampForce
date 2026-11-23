import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { approveMobile, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the app at phone size (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const APP = 'http://localhost:8090';
const API = 'http://localhost:4000';
const ORIGIN = 'http://localhost:3000';

const shot = async (page: Page, name: string) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
};

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * The SampForce app itself (ADR 0072, M3), from its web export at phone size against the real API: sign-in, the
 * organisation's published branding and tabs, More with Help (no Recent list), a question to support, and sign-out.
 */
test('the app signs in, follows the published configuration, and raises a question from Help', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const org = `Phone Org ${Date.now().toString(36)}`;
  const owner = await signUp(page, org);
  await approveMobile(page);

  // The Super Workspace names the app and colours it, and publishes (the screens are tested in mobile-config.spec.ts).
  const center = await (await page.request.get('/api/v1/mobile-config')).json();
  const draft = { ...center.draft, branding: { ...center.draft.branding, appName: 'Field Force', primaryColor: '#E11D48' } };
  expect((await page.request.put('/api/v1/mobile-config/draft', { data: draft, headers: { origin: ORIGIN } })).status()).toBe(200);
  expect((await page.request.post('/api/v1/mobile-config/publish', { data: { note: 'App test' }, headers: { origin: ORIGIN } })).status()).toBe(200);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB' })).newPage();
  await phone.goto(APP);
  await expect(phone.getByText('Sign in with your SampForce account.')).toBeVisible();
  await phone.getByLabel('Email').fill(owner.email);
  await phone.getByLabel('Password').fill(owner.password);
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await shot(phone, '10-app-sign-in');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Home: the published name and the owner's level, with the dashboard cards for it.
  await expect(phone.getByText(/^Good (morning|afternoon|evening), Test$/)).toBeVisible();
  await expect(phone.getByText('Field Force')).toBeVisible();
  await expect(phone.getByText(`${org} · Super Workspace`)).toBeVisible();
  await expect(phone.getByText('Organisation performance')).toBeVisible();
  await shot(phone, '11-app-home');
  await expectNoA11yViolations(phone);

  // More: the modules without a tab, then Help. There is no Recent list anywhere.
  await phone.getByRole('tab', { name: /More/ }).click();
  await expect(phone.getByRole('button', { name: /^Help/ })).toBeVisible();
  await expect(phone.getByText(/Recent/i)).toHaveCount(0);
  await shot(phone, '12-app-more');

  await phone.getByRole('button', { name: /^Help/ }).click();
  await expect(phone.getByLabel('Search help')).toBeVisible();
  await expect(phone.getByText('Questions', { exact: true })).toBeVisible();
  await shot(phone, '13-app-help');

  // A question to support, from the phone.
  await phone.getByRole('button', { name: 'Ask a question' }).click();
  await phone.getByLabel('Subject').fill('Logging a visit from the phone');
  await phone.getByLabel('Your question').fill('Where do I add notes after a client visit?');
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(phone.getByText('Where do I add notes after a client visit?')).toBeVisible();
  await expect(phone.getByText(/^#\d+ · Submitted/)).toBeVisible();
  await shot(phone, '14-app-question');
  // The web sees the same ticket, marked as raised from the phone.
  const tickets = (await (await page.request.get('/api/v1/support/tickets')).json()) as { subject: string; source: string }[];
  expect(tickets.find((x) => x.subject === 'Logging a visit from the phone')?.source).toBe('mobile');

  // The organisation sees the signed-in device; signing out ends its session on the server, not only on the phone.
  const devices = async () => JSON.stringify(await (await page.request.get('/api/v1/mobile-access/devices')).json());
  expect(await devices()).toContain('"WEB"');
  await phone.getByRole('tab', { name: /More/ }).click();
  await phone.getByRole('button', { name: 'Sign out' }).click();
  await expect(phone.getByLabel('Password')).toBeVisible();
  expect(await devices()).not.toContain('"WEB"');
});

/**
 * Records on the phone (ADR 0072, M4): a lead added, edited and given a contact and a follow-up from the phone, a task
 * added and finished, all through the real API, and the web sees the same records.
 */
test('the app adds and edits leads, contacts, follow-ups and tasks', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const org = `Records Org ${Date.now().toString(36)}`;
  const owner = await signUp(page, org);
  await approveMobile(page);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London' })).newPage();
  await phone.goto(APP);
  await phone.getByLabel('Email').fill(owner.email);
  await phone.getByLabel('Password').fill(owner.password);
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phone.getByText('Organisation performance')).toBeVisible();

  // A new lead from the Leads tab.
  await phone.getByRole('tab', { name: /Leads and companies/ }).click();
  await expect(phone.getByText('Nothing here yet.')).toBeVisible();
  await phone.getByRole('button', { name: 'Add Lead' }).click();
  await phone.getByLabel('Company name *').fill('Harbour Labs');
  await phone.getByLabel('City').fill('Leeds');
  await phone.getByLabel('Phone number').fill('+44 113 496 0000');
  await phone.getByRole('radiogroup', { name: 'Lead status' }).getByRole('radio').first().click();
  await shot(phone, '15-app-lead-form');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Save', exact: true }).click();

  // Its page: the fields, a call button, and the lead's contacts.
  await expect(phone.getByText('Leeds')).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Call' })).toBeVisible();
  await expect(phone.getByText('No contacts yet.')).toBeVisible();
  await shot(phone, '16-app-lead');
  await expectNoA11yViolations(phone);

  await phone.getByRole('button', { name: 'Edit', exact: true }).click();
  await phone.getByLabel('City').fill('York');
  await phone.getByRole('button', { name: 'Save changes' }).click();
  await expect(phone.getByText('York')).toBeVisible();

  // A contact added from the lead's page belongs to the lead.
  await phone.getByRole('button', { name: 'Add Contact' }).click();
  await expect(phone.getByRole('button', { name: 'Change Company' })).toBeVisible();
  await phone.getByLabel('First name *').fill('Priya');
  await phone.getByLabel('Last name').fill('Shah');
  await phone.getByLabel('Job title').fill('Head of buying');
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByText('Head of buying')).toBeVisible();

  // The web sees the same lead and contact.
  const leads = (await (await page.request.get('/api/v1/companies?q=Harbour')).json()) as { items: { id: string; city: string }[] };
  expect(leads.items[0]?.city).toBe('York');
  const contacts = (await (await page.request.get(`/api/v1/contacts?companyId=${leads.items[0]!.id}`)).json()) as { items: { firstName: string }[] };
  expect(contacts.items.map((c) => c.firstName)).toEqual(['Priya']);

  // A follow-up for the lead, planned for tomorrow, then done with its outcome.
  await phone.goto(`${APP}/companies/${leads.items[0]!.id}`);
  await phone.getByRole('button', { name: 'Plan a follow-up' }).click();
  await phone.getByLabel('Follow-up *').fill('Site visit');
  await phone.getByRole('radiogroup', { name: 'Type *' }).getByRole('radio').first().click();
  await phone.getByRole('button', { name: 'Tomorrow' }).click();
  await shot(phone, '17-app-follow-up-form');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Mark done' })).toBeVisible();
  await phone.getByRole('button', { name: 'Mark done' }).click();
  await phone.getByLabel('Outcome').fill('Met the buyer, sending a quote');
  await phone.getByRole('button', { name: 'Mark done' }).click();
  await expect(phone.getByText('Met the buyer, sending a quote')).toBeVisible();
  await expect(phone.getByText('Done', { exact: true })).toBeVisible();

  // Tasks: added from More, listed as open, then finished.
  await phone.goto(`${APP}/tasks`);
  await phone.getByRole('button', { name: 'Add Task' }).click();
  await phone.getByLabel('Task *').fill('Send the brochure');
  await phone.getByRole('radiogroup', { name: 'Priority' }).getByRole('radio', { name: 'High' }).click();
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'Send the brochure' })).toBeVisible();
  await phone.getByRole('button', { name: 'Mark done' }).click();
  await expect(phone.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await phone.goto(`${APP}/tasks`);
  await expect(phone.getByText('Nothing here yet.')).toBeVisible();
  await phone.getByRole('radio', { name: 'Done' }).click();
  await expect(phone.getByRole('button', { name: /Send the brochure/ })).toBeVisible();
  await shot(phone, '18-app-tasks');
  await expectNoA11yViolations(phone);

  // The lead list finds it by name.
  await phone.goto(`${APP}/companies`);
  await phone.getByLabel('Search leads and companies').fill('Harb');
  await expect(phone.getByRole('button', { name: /Harbour Labs/ })).toBeVisible();
  await shot(phone, '19-app-leads');
});
