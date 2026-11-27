import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The Calls section (ADR 0088): a Call button on the company page brings the company and employee details across,
 * "Add my dialer" sets up a custom dialer link, the call hands the details to it, and logging the call keeps the
 * outcome, remarks and next call in the history and on the company's interactions.
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

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

test('calls an employee from the company page through my dialer, then logs the outcome, remarks and next call', async ({ page }) => {
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

  // The company page has a Call button for the company and for each employee.
  await page.goto(`/app/companies/${companyId}`);
  await expect(page.getByRole('link', { name: 'Call Acme Panels from Calls' })).toBeVisible();
  const priyaCall = page.getByRole('link', { name: 'Call Priya Nair from Calls' }).first();
  await priyaCall.scrollIntoViewIfNeeded();
  await shot(page, '06-company-page-call-buttons');
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
  await axe(page);
  await shot(page, '01-calls-call-card');

  // Add my dialer: a custom link with the call details in it.
  await page.getByRole('button', { name: 'Add my dialer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add my dialer' });
  await dialog.getByRole('button', { name: /^My dialer \(custom link\)/ }).click();
  await dialog.getByLabel('Dialer name').fill('Office dialer');
  await dialog.getByLabel('Link your dialer opens').fill('https://dialer.example.com/call?to=');
  await dialog.getByRole('button', { name: '{phoneE164}' }).click();
  const field = dialog.getByLabel('Link your dialer opens');
  await field.press('End');
  await field.pressSequentially('&name=');
  await dialog.getByRole('button', { name: '{employeeName}' }).click();
  await field.press('End');
  await field.pressSequentially('&company=');
  await dialog.getByRole('button', { name: '{companyName}' }).click();
  await field.press('End');
  await field.pressSequentially('&title=');
  await dialog.getByRole('button', { name: '{designation}' }).click();
  await expect(field).toHaveValue('https://dialer.example.com/call?to={phoneE164}&name={employeeName}&company={companyName}&title={designation}');
  await shot(page, '04-add-my-dialer');
  await dialog.getByRole('button', { name: 'Save dialer' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('radio', { name: /Office dialer/ })).toHaveAttribute('aria-checked', 'true');
  await expect(card.getByText('Calls with Office dialer')).toBeVisible();

  // The call opens my dialer with the employee's details.
  await card.getByRole('button', { name: 'Call Priya' }).click();
  const active = page.getByTestId('active-call');
  await expect(active.getByRole('heading', { name: 'Call with Priya Nair' })).toBeVisible();
  const dialled = await page.evaluate(() => (window as unknown as { __dialled: string[] }).__dialled);
  expect(dialled).toHaveLength(1);
  expect(Object.fromEntries(new URL(dialled[0]!).searchParams)).toEqual({ to: '+919820012345', name: 'Priya Nair', company: 'Acme Panels', title: 'Procurement Lead' });

  // Log it: outcome, remarks, talk time and the next call.
  await active.getByRole('button', { name: 'Connected' }).click();
  await active.getByLabel('Remarks').fill('Wants India B2B feasibility by Friday. Send the panel book.');
  await active.getByLabel('Talk time (minutes)').fill('4');
  await active.getByLabel('How did they respond?').selectOption('POSITIVE');
  await active.getByRole('button', { name: 'Tomorrow 10:00' }).click();
  await active.getByLabel('What the next call is for').fill('Share feasibility');
  await shot(page, '02-calls-log-the-call');
  await active.getByRole('button', { name: 'Save call' }).click();
  await expect(active).toBeHidden();

  // History, stats and the card now show it.
  const row = page.getByTestId('call-row').first();
  await expect(row).toContainText('Priya Nair');
  await expect(row).toContainText('Connected');
  await expect(row).toContainText('Wants India B2B feasibility by Friday.');
  await expect(row).toContainText('4:00');
  await expect(row).toContainText('Next call');
  await expect(page.getByTestId('calls-today')).toContainText('1');
  await expect(card.getByText('Share feasibility')).toBeVisible();
  await page.getByRole('tab', { name: 'Next calls' }).click();
  await page.getByRole('radio', { name: 'Upcoming' }).click();
  await expect(page.getByRole('list', { name: 'Next calls' }).getByText('Share feasibility')).toBeVisible();
  await page.getByRole('tab', { name: 'Call history' }).click();
  await row.scrollIntoViewIfNeeded();
  await shot(page, '03-calls-history', true);

  // Dial any number on the keypad with the phone app.
  await page.getByRole('radio', { name: /Phone app/ }).click();
  await page.getByLabel('Number to call').fill('+44 20 7946 0018');
  await page.getByRole('button', { name: 'Call this number' }).click();
  await expect(active.getByRole('heading', { name: 'Call with +44 20 7946 0018' })).toBeVisible();
  await active.getByRole('button', { name: 'Left voicemail' }).click();
  await active.getByRole('button', { name: 'Save call' }).click();
  await expect(page.getByTestId('call-row').first()).toContainText('Left voicemail');

  // The call is on the company's interactions too.
  await card.getByRole('link', { name: /Open company/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/companies/${companyId}`));
  const interactions = page.locator('#company-interactions');
  await expect(interactions.getByText('Call with Priya Nair: Connected')).toBeVisible();
  await expect(interactions.getByText('Wants India B2B feasibility by Friday. Send the panel book.')).toBeVisible();

  // Dark mode.
  if (PREVIEW_DIR) {
    await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'dark', motion: 'off' }, version: 0 })));
    await page.goto(`/app/calls?company=${companyId}&contact=${lead.employeeIds[1]}`);
    await expect(page.getByTestId('call-card').getByRole('heading', { name: 'Ravi Kumar' })).toBeVisible();
    await shot(page, '05-calls-dark');
  }
});
