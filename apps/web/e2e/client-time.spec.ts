import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Client time and the best time to connect (ADR 0088): the dual-clock card on company and employee pages, worked out
 * from the address with no typing, the "is now a good time?" check before an email or call, office hours, and my own
 * time zone in Settings. The browser clock is fixed so the times are known.
 */
const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

// Thursday 16 July 2026: 10:00 in New York (EDT) is 19:30 in India.
const NY_10AM = new Date('2026-07-16T14:00:00Z');
// The same Thursday at 23:00 in New York, 08:30 on Friday in India.
const NY_11PM = new Date('2026-07-17T03:00:00Z');
// Saturday 18 July 2026, 11:00 in Los Angeles.
const LA_SATURDAY = new Date('2026-07-18T18:00:00Z');

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include('[data-testid="client-time"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function call(page: Page, method: 'post' | 'patch' | 'put', path: string, data: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string, locator?: string) {
  if (!PREVIEW_DIR) return;
  if (locator) await page.locator(locator).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  if (locator) await page.locator(locator).first().screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  else await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

/** Counts email links that really went through (after the check), without leaving the page. */
async function countMailto(page: Page) {
  await page.evaluate(() => {
    document.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a[href^="mailto:"]');
      if (!a) return;
      const w = window as unknown as { mailtoClicks?: number };
      w.mailtoClicks = (w.mailtoClicks ?? 0) + 1;
      e.preventDefault();
    });
  });
}
const mailtoClicks = (page: Page) => page.evaluate(() => (window as unknown as { mailtoClicks?: number }).mailtoClicks ?? 0);

test('a New York company shows its time next to IST, says when to connect, and checks before an email', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Client Time Org');
  const company = await call(page, 'post', '/companies', { name: 'Hudson Panels', country: 'US', state: 'New York', city: 'New York', address: '350 Fifth Avenue', primaryEmail: 'hello@hudson-panels.example', industry: 'Market research' });

  await page.clock.setFixedTime(NY_10AM);
  await page.goto(`/app/companies/${company.id}`);
  const card = page.getByTestId('client-time');
  await expect(card.getByRole('heading', { name: 'Global contact intelligence' })).toBeVisible();
  await expect(card.getByTestId('client-time-badge')).toHaveText('Perfect timing');
  await expect(card.getByTestId('their-clock')).toContainText('10:00');
  await expect(card.getByTestId('their-clock')).toContainText('EDT');
  await expect(card.getByTestId('my-clock')).toContainText('7:30');
  await expect(card.getByTestId('my-clock')).toContainText('IST');
  await expect(card.getByTestId('time-difference')).toHaveText('+9 h 30 m');
  await expect(card.getByText('You are 9 h 30 m ahead')).toBeVisible();
  await expect(card.getByTestId('client-time-advice')).toContainText('inside their working hours');
  // Everything below came from the address alone.
  await expect(card.getByTestId('iso-codes')).toHaveText('US · USA');
  await expect(card.getByText('Calling code +1')).toBeVisible();
  await expect(card.getByText('North America · Northern America')).toBeVisible();
  await expect(card.getByTestId('currency')).toContainText('$ USD');
  await expect(card.getByTestId('iana-zone')).toHaveText('America/New_York');
  await expect(card.getByTestId('working-hours')).toContainText('09:00–18:00 EDT → 6:30 PM–3:30 AM IST');
  await expect(card.getByText('Usual office day there, estimated')).toBeVisible();
  await expect(card.getByTestId('best-window')).toContainText('IST');
  await axe(page);
  await shot(page, '01-company-perfect-timing', '[data-testid="client-time"]');

  // The email button asks first; "Not now" does nothing, "Yes" goes ahead.
  await countMailto(page);
  await page.getByRole('link', { name: 'Send email' }).click();
  const check = page.getByTestId('connect-check');
  await expect(check.getByRole('heading', { name: 'Email Hudson Panels now?' })).toBeVisible();
  await expect(check.getByText('Perfect timing')).toBeVisible();
  await shot(page, '02-email-check');
  await check.getByRole('button', { name: 'Not now' }).click();
  await expect(check).toBeHidden();
  expect(await mailtoClicks(page)).toBe(0);
  await page.getByRole('link', { name: 'Send email' }).click();
  await page.getByTestId('connect-go').click();
  await expect.poll(() => mailtoClicks(page)).toBe(1);

  // Late at night there: outside working hours, pointing at their next morning in my time.
  await page.clock.setFixedTime(NY_11PM);
  await page.reload();
  await expect(card.getByTestId('client-time-badge')).toHaveText('Outside their working hours');
  await expect(card.getByTestId('client-time-advice')).toContainText('Consider scheduling your call or email for then');
  await shot(page, '03-company-outside-hours', '[data-testid="client-time"]');

  // Office hours typed by the user are kept on the company and shown converted.
  await card.getByRole('button', { name: 'Edit working hours' }).click();
  const dialog = page.getByRole('dialog', { name: 'Working hours of Hudson Panels' });
  await dialog.getByLabel('Starts').fill('08:00');
  await dialog.getByLabel('Ends').fill('17:00');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByTestId('working-hours')).toContainText('08:00–17:00 EDT');
  await expect(card.getByText('Set by you')).toBeVisible();
  const saved = await (await page.request.get(`/api/v1/companies/${company.id}`)).json();
  expect(saved.workingHours).toEqual({ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00', source: 'user' });
});

test('an employee’s own location wins, weekends are spotted, and my own zone and the check live in Settings', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Employee Time Org');
  const company = await call(page, 'post', '/companies', { name: 'Cint', country: 'SE', city: 'Stockholm', address: 'Drottninggatan 32', primaryEmail: 'info@cint.example' });
  const person = await call(page, 'post', '/contacts', { firstName: 'Lena', lastName: 'Ortiz', email: 'lena@cint.example', companyId: company.id, country: 'US', state: 'California', city: 'San Francisco' });

  await page.clock.setFixedTime(LA_SATURDAY);
  await page.goto(`/app/contacts/${person.id}`);
  const card = page.getByTestId('client-time');
  await expect(card.getByTestId('iana-zone')).toHaveText('America/Los_Angeles');
  await expect(card.getByText(/From the employee’s location/)).toBeVisible();
  await expect(card.getByTestId('client-time-badge')).toHaveText('Weekend there');
  await expect(card.getByTestId('client-time-advice')).toContainText('their weekend');
  await axe(page);
  await shot(page, '04-employee-weekend', '[data-testid="client-time"]');

  // Stockholm, from the company page: Sweden, SEK, Europe, one zone.
  await page.goto(`/app/companies/${company.id}`);
  await expect(card.getByTestId('iana-zone')).toHaveText('Europe/Stockholm');
  await expect(card.getByTestId('iso-codes')).toHaveText('SE · SWE');
  await expect(card.getByTestId('currency')).toContainText('SEK');
  await shot(page, '05-company-stockholm', '[data-testid="client-time"]');

  // Settings: my own zone and the check before contacting.
  await page.goto('/app/settings');
  const settings = page.getByTestId('contact-times-settings');
  await expect(settings.getByLabel('Your time zone')).toHaveValue('Asia/Kolkata');
  await settings.getByLabel('Your time zone').selectOption('Europe/London');
  await settings.getByLabel('Ask “is now a good time?” before I email or call a client').uncheck();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings.getByRole('status')).toHaveText('Saved.');
  await shot(page, '06-settings', '[data-testid="contact-times-settings"]');

  await page.goto(`/app/companies/${company.id}`);
  await expect(card.getByTestId('my-clock')).toContainText('BST');
  await countMailto(page);
  await page.getByRole('link', { name: 'Send email' }).click();
  await expect.poll(() => mailtoClicks(page)).toBe(1);
  await expect(page.getByTestId('connect-check')).toHaveCount(0);
});

test('a company with no country asks for one instead of guessing', async ({ page }) => {
  await signUp(page, 'No Country Org');
  const company = await call(page, 'post', '/companies', { name: 'Somewhere Ltd' });
  await page.goto(`/app/companies/${company.id}`);
  await expect(page.getByTestId('client-time')).toContainText('Add the country of the headquarters');
});
