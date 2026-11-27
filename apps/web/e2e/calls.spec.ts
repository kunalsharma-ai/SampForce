import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The Calls section (ADR 0088, redesigned in ADR 0101): a Call button on the company page brings the company and
 * employee details across; Dialer settings adds a dialer from the provider gallery; the call hands the details to it,
 * shows what the dialer can and cannot do, and logging the call keeps the outcome, notes and follow-up in the history
 * (table and activity views), on the company's interactions, and a recording uploaded for it in Recordings.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string, fullPage = false) {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

/** A short silent WAV file, for uploading a recording. */
function wav(seconds = 1) {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b;
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

test('calls an employee from the company page through a dialer from the gallery, then logs the outcome, notes and follow-up', async ({ page }) => {
  test.setTimeout(180_000);
  // Dialer links are caught here instead of leaving the browser.
  await page.addInitScript(() => {
    (window as unknown as { __dialled: string[] }).__dialled = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __dialled: string[] }).__dialled.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await signUp(page, 'Calls Fieldwork');
  const lead = await post(page, '/company-leads', {
    company: { name: 'Acme Panels', country: 'IN', city: 'Mumbai', timezone: 'Asia/Kolkata', primaryPhone: '+91 22 4000 1000', primaryEmail: 'hello@acmepanels.example' },
    employees: [
      { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead', email: 'priya@acmepanels.example', phone: '+91 98200 12345' },
      { firstName: 'Ravi', lastName: 'Kumar', jobTitle: 'Research Director', email: 'ravi@acmepanels.example', phone: '+91 98200 67890' },
    ],
  });
  const companyId: string = lead.company.id;

  // Dialer settings: add a dialer from the gallery. Only providers that really work are offered.
  await page.goto('/app/calls?tab=settings');
  await expect(page.getByRole('tab', { name: 'Dialer settings' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Add a dialer' }).click();
  const gallery = page.getByRole('dialog', { name: 'Add a dialer' });
  await expect(gallery.locator('[data-provider="api"]')).toBeVisible();
  await expect(gallery.locator('[data-provider="twilio"]')).toBeDisabled();
  await expect(gallery.locator('[data-provider="sim"]')).toHaveCount(0);
  await shot(page, '04-dialer-gallery');
  await gallery.locator('[data-provider="custom"]').click();
  const dialog = page.getByRole('dialog', { name: 'Add My own link' });
  await dialog.getByLabel('Dialer name').fill('Office dialer');
  const field = dialog.getByLabel('Link your dialer opens');
  await field.fill('https://dialer.example.com/call?to={phoneE164}&name={employeeName}&company={companyName}&title={designation}');
  await shot(page, '05-dialer-setup');
  // The buttons stay in view and nothing overlaps the form.
  const save = dialog.getByRole('button', { name: 'Save dialer' });
  await expect(save).toBeInViewport();
  await save.click();
  await expect(dialog).toBeHidden();
  const dialerCard = page.getByTestId('dialer-card').filter({ hasText: 'Office dialer' });
  await expect(dialerCard).toBeVisible();
  await expect(dialerCard.getByTestId('dialer-status')).toBeVisible();
  await axe(page);
  await shot(page, '06-dialer-settings', true);

  // The company page has a Call button for the company and for each employee.
  await page.goto(`/app/companies/${companyId}`);
  await expect(page.getByRole('link', { name: 'Call Acme Panels from Calls' })).toBeVisible();
  const priyaCall = page.getByRole('link', { name: 'Call Priya Nair from Calls' }).first();
  await priyaCall.scrollIntoViewIfNeeded();
  await priyaCall.click();

  // Everything about the call comes across: nothing to retype.
  await expect(page).toHaveURL(new RegExp(`/app/calls\\?company=${companyId}&contact=`));
  const card = page.getByTestId('call-card');
  await expect(card.getByRole('heading', { name: 'Priya Nair' })).toBeVisible();
  const details = card.getByRole('list', { name: 'Details for the call' }).or(card.locator('dl'));
  for (const text of ['Acme Panels', 'Priya Nair', 'Procurement Lead', 'priya@acmepanels.example', '+91 98200 12345', '+91 22 4000 1000']) await expect(details.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(card.getByRole('link', { name: /Open company/ })).toHaveAttribute('href', `/app/companies/${companyId}`);
  await expect(card.getByTestId('call-local-time')).toContainText('Asia/Kolkata');
  await expect(card.getByRole('button', { name: 'Ravi Kumar · Research Director' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Calls', exact: true })).toBeVisible();
  // The new dialer is the default one.
  await expect(page.getByLabel('Call with')).toHaveValue(/.+/);
  await expect(page.getByLabel('Call with').locator('option:checked')).toHaveText(/Office dialer/);
  await axe(page);
  await shot(page, '01-calls-dialer-and-card');

  // The call opens the dialer with the employee's details.
  await card.getByRole('button', { name: 'Call Priya' }).click();
  const active = page.getByTestId('active-call');
  await expect(active.getByRole('heading', { name: 'Call with Priya Nair' })).toBeVisible();
  await expect(active.getByTestId('call-status')).toHaveText('In your dialer');
  await expect(active.getByTestId('call-timer')).toBeVisible();
  // A link dialer cannot mute or hold, so those controls are not shown, and the call says so.
  await expect(active.getByRole('button', { name: 'Mute' })).toHaveCount(0);
  await expect(active.getByRole('button', { name: 'Hold' })).toHaveCount(0);
  await expect(active.getByTestId('not-available')).toContainText('Office dialer');
  const dialled = await page.evaluate(() => (window as unknown as { __dialled: string[] }).__dialled);
  expect(dialled).toHaveLength(1);
  expect(Object.fromEntries(new URL(dialled[0]!).searchParams)).toEqual({ to: '+919820012345', name: 'Priya Nair', company: 'Acme Panels', title: 'Procurement Lead' });

  // Upload a recording of the call: Office dialer does not send recordings itself.
  await expect(active.getByText('Office dialer does not send recordings to SampForce. You can upload one after the call.')).toBeVisible();
  await active.getByTestId('recording-upload').setInputFiles({ name: 'priya.wav', mimeType: 'audio/wav', buffer: wav(2) });
  await expect(active.getByText('A recording is saved with this call.')).toBeVisible();

  // Log it: outcome, notes, talk time and the follow-up the outcome suggests.
  await active.locator('[data-outcome="CONNECTED"]').click();
  await active.getByLabel('Notes').fill('Wants India B2B feasibility by Friday. Send the panel book.');
  await active.getByLabel('Talk time (minutes)').fill('4');
  await active.getByLabel('How did they respond?').selectOption('POSITIVE');
  // "Completed" suggests no follow-up on its own; plan one anyway.
  await active.getByRole('checkbox', { name: 'Plan a follow-up' }).check();
  await active.getByRole('radio', { name: 'Call again' }).click();
  await active.getByRole('button', { name: 'Tomorrow 10:00' }).click();
  await active.getByLabel('What it is for').fill('Share feasibility');
  await shot(page, '02-calls-log-the-call');
  await active.getByRole('button', { name: 'Save call' }).click();
  await expect(active).toBeHidden();
  await expect(page.getByTestId('calls-today')).toContainText('1');
  await expect(card.getByText('Share feasibility')).toBeVisible();

  // Dial any number on the keypad with the phone app.
  await page.getByLabel('Call with').selectOption('phone');
  await page.getByLabel('Number to call').fill('+44 20 7946 0018');
  await page.getByRole('button', { name: 'Call this number' }).click();
  await expect(active.getByRole('heading', { name: 'Call with +44 20 7946 0018' })).toBeVisible();
  await active.locator('[data-outcome="VOICEMAIL"]').click();
  await active.getByRole('button', { name: 'Save call' }).click();
  await expect(active).toBeHidden();

  // History: the table has every column, and the activity view shows the same calls by day.
  await page.getByRole('tab', { name: 'Call history' }).click();
  const table = page.getByRole('table', { name: 'Call history' });
  for (const col of ['Date and time', 'Company', 'Contact', 'Phone', 'Called by', 'Dialer', 'Talk time', 'Status', 'Outcome', 'Next follow-up']) await expect(table.getByRole('columnheader', { name: col })).toBeVisible();
  const row = page.getByTestId('call-row').filter({ hasText: 'Priya Nair' });
  await expect(row).toContainText('Acme Panels');
  await expect(row).toContainText('Office dialer');
  await expect(row).toContainText('4:00');
  await expect(row.locator('[data-outcome="CONNECTED"]')).toBeVisible();
  await expect(row).toContainText('Wants India B2B feasibility by Friday.');
  await expect(page.getByTestId('call-row')).toHaveCount(2);
  await expect(page.getByTestId('call-row').filter({ hasText: '+44 20 7946 0018' })).toContainText('Phone app');
  await page.getByLabel('Outcome').selectOption('CONNECTED');
  await expect(page.getByTestId('call-row')).toHaveCount(1);
  await axe(page);
  await shot(page, '03-calls-history-table', true);
  await page.getByRole('radio', { name: 'Activity' }).click();
  await expect(page.getByTestId('call-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByTestId('call-row')).toHaveCount(2);
  await shot(page, '07-calls-history-activity', true);
  await page.getByRole('radio', { name: 'Table' }).click();

  // Next calls has the follow-up.
  await page.getByRole('tab', { name: 'Next calls' }).click();
  await page.getByRole('radio', { name: 'Upcoming' }).click();
  await expect(page.getByRole('list', { name: 'Next calls' }).getByText('Share feasibility')).toBeVisible();

  // Recordings: the uploaded recording plays here, with notes.
  await page.getByRole('tab', { name: 'Recordings' }).click();
  const rec = page.getByTestId('recording-row');
  await expect(rec).toHaveCount(1);
  await expect(rec).toContainText('Priya Nair');
  await expect(rec.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(rec.getByLabel('Position')).toBeVisible();
  await expect(rec.getByRole('link', { name: 'Download' })).toBeVisible();
  await rec.getByRole('button', { name: 'Add notes' }).click();
  await rec.getByLabel('Notes').fill('Good objection handling at 0:30.');
  await rec.getByRole('button', { name: 'Save notes' }).click();
  await expect(rec.getByText('Good objection handling at 0:30.')).toBeVisible();
  const audio = await page.request.get(await rec.getByRole('link', { name: 'Download' }).getAttribute('href').then((h) => h!));
  expect(audio.status()).toBe(200);
  expect(audio.headers()['content-type']).toContain('audio/wav');
  await axe(page);
  await shot(page, '08-calls-recordings');

  // The call is on the company's interactions too.
  await page.goto(`/app/companies/${companyId}`);
  const interactions = page.locator('#company-interactions');
  await expect(interactions.getByText('Call with Priya Nair: Call completed successfully')).toBeVisible();
  await expect(interactions.getByText('Wants India B2B feasibility by Friday. Send the panel book.')).toBeVisible();

  // Dark mode.
  if (PREVIEW_DIR) {
    await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'dark', motion: 'off' }, version: 0 })));
    await page.goto(`/app/calls?company=${companyId}&contact=${lead.employeeIds[1]}`);
    await expect(page.getByTestId('call-card').getByRole('heading', { name: 'Ravi Kumar' })).toBeVisible();
    await shot(page, '09-calls-dark');
    await page.goto('/app/calls?tab=history');
    await expect(page.getByTestId('call-row').first()).toBeVisible();
    await shot(page, '10-calls-history-dark', true);
  }
});
