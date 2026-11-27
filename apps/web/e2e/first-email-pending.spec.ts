import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * First Email Pending (ADR 0096) in the browser: every new contact waits on the Follow-ups page until their first
 * email goes out, with status tiles, a pending count and filters; marking the email moves the contact to "Sent,
 * waiting"; the Super Workspace sets the period, per company or team too, and how the follow-ups are made.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function call(page: Page, method: 'get' | 'post' | 'put', path: string, data?: object) {
  const res = method === 'get' ? await page.request.get(`/api/v1${path}`) : await page.request[method](`/api/v1${path}`, { data: data ?? {}, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string, el?: Locator) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(300);
  if (el) await el.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  else await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage: true });
}

/** Nothing sticks out sideways: no element wider than the page. */
async function noOverflow(page: Page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(0);
}

test('new contacts wait in First email pending until their first email goes out, with filters and counts', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'First Email Fieldwork Ltd');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  const lead = await call(page, 'post', '/company-leads', {
    company: { name: 'Northwind Panels Ltd', country: 'GB', city: 'London', website: 'https://northwind.example' },
    employees: [
      { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', emails: [{ value: 'priya@northwind.example' }] },
      { firstName: 'Tom', lastName: 'Hale', jobTitle: 'Procurement Manager' },
      { firstName: 'Lena', lastName: 'Ortiz', jobTitle: 'Fieldwork Lead', emails: [{ value: 'lena@northwind.example' }] },
    ],
  });
  const companyId = lead.company.id as string;
  const other = await call(page, 'post', '/companies', { name: 'Contoso Research' });
  await call(page, 'post', '/contacts', { firstName: 'Omar', lastName: 'Haddad', jobTitle: 'Research Manager', email: 'omar@contoso.example', companyId: other.id });

  // The Follow-ups page has two parts; the first-email tab shows the pending count.
  await page.goto('/app/follow-ups');
  await page.getByRole('radio', { name: 'Everyone' }).click();
  const tab = page.getByRole('tab', { name: /First email pending/ });
  await expect(tab).toContainText('4');
  await tab.click();
  await expect(page).toHaveURL(/view=first-email/);
  const panel = page.locator('[data-first-email]');
  await expect(panel.locator('[data-first-email-total]')).toContainText('4');
  await expect(panel.locator('[data-created-today]')).toContainText('4 new today');
  const tile = (s: string) => panel.locator(`[data-status="${s}"]`);
  await expect(tile('PENDING')).toContainText('3');
  await expect(tile('NO_EMAIL')).toContainText('1');
  await expect(tile('SENT')).toContainText('0');
  const item = (name: string) => panel.locator('[data-contact]').filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(item('Priya Nair')).toContainText('Head of Insights');
  await expect(item('Priya Nair')).toContainText('Northwind Panels Ltd');
  await expect(item('Priya Nair')).toContainText('priya@northwind.example');
  await expect(item('Priya Nair')).toContainText('7 days after the first email');
  await expect(item('Priya Nair').getByRole('button', { name: 'Send first email' })).toBeVisible();
  await expect(item('Tom Hale')).toContainText('No email address');
  await expect(item('Tom Hale').getByRole('link', { name: 'Add an email address' })).toBeVisible();
  await axe(page);
  await shot(page, '01-first-email-pending');

  // Filters: a status tile, one company, a search, and creation dates.
  await tile('NO_EMAIL').click();
  await expect(panel.locator('[data-contact]')).toHaveCount(1);
  await tile('NO_EMAIL').click();
  await item('Omar Haddad').getByRole('button', { name: 'Only this company' }).click();
  await expect(panel.locator('[data-contact]')).toHaveCount(1);
  await expect(panel.locator('[data-first-email-total]')).toContainText('pending for these filters');
  await panel.getByRole('button', { name: 'Clear filters' }).click();
  await expect(panel.locator('[data-contact]')).toHaveCount(4);
  await panel.getByPlaceholder('Search contacts or companies').fill('lena');
  await expect(panel.locator('[data-contact]')).toHaveCount(1);
  await panel.getByPlaceholder('Search contacts or companies').fill('');
  await panel.getByRole('radio', { name: 'Yesterday' }).click();
  await expect(panel).toContainText('Every first email has gone out.');
  await panel.getByRole('radio', { name: 'Today' }).click();
  await expect(panel.locator('[data-contact]')).toHaveCount(4);

  // Priya's first email went out from Outlook: mark it. She leaves the pending list and waits.
  await item('Priya Nair').getByRole('button', { name: 'Sent outside SampForce?' }).click();
  await item('Priya Nair').getByRole('button', { name: 'Mark as sent' }).click();
  await expect(item('Priya Nair')).toHaveCount(0);
  await expect(tile('PENDING')).toContainText('2');
  await expect(tile('SENT')).toContainText('1');
  await tile('SENT').click();
  await expect(item('Priya Nair')).toContainText('Sent, waiting');
  await expect(item('Priya Nair')).toContainText('Marked as sent');
  await expect(item('Priya Nair').locator('[data-next-follow-up]')).toContainText('Email on');
  await axe(page);
  await shot(page, '02-sent-waiting', panel);

  // On a phone the list stacks without anything sticking out.
  await tile('SENT').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.locator('[data-contact]').first()).toBeVisible();
  await noOverflow(page);
  await shot(page, '03-phone');

  // Dark mode keeps every colour readable.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'dark', motion: 'off' }, version: 0 })));
  await page.reload();
  await expect(panel.locator('[data-contact]').first()).toBeVisible();
  await axe(page);
  await shot(page, '04-dark');

  // The Super Workspace sets the period, how follow-ups are made, and a rule for one company.
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  await page.goto('/app/settings/crm?section=follow-up-cadence');
  const form = page.locator('[data-cadence-settings]');
  await form.getByLabel('Days after the first email before follow-up 1').fill('5');
  await form.getByLabel('Follow-ups are made by').selectOption('EMAIL');
  await expect(form.locator('[data-cadence-summary]')).toContainText('Follow-up 1 comes 5 days after the first email');
  await form.getByRole('button', { name: 'Add a company rule' }).click();
  const rule = form.locator('[data-cadence-rule="COMPANY"]');
  await rule.getByLabel('Company').fill('Northwind');
  await rule.getByRole('button', { name: 'Northwind Panels Ltd' }).click();
  await rule.getByLabel('Days to follow-up 1').fill('3');
  await rule.getByLabel('Made by').selectOption('CALL');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved.');
  await axe(page);
  await shot(page, '05-cadence-settings', form);
  const saved = await call(page, 'get', '/crm-config/follow-up-cadence');
  expect(saved).toMatchObject({ firstFollowUpDays: 5, rules: [{ scope: 'COMPANY', targetId: companyId, firstFollowUpDays: 3, channel: 'CALL' }] });

  // Lena, at Northwind, now follows the company's rule: a call 3 days after the first email.
  await page.goto('/app/follow-ups?view=first-email');
  await page.getByRole('radio', { name: 'Everyone' }).click();
  await expect(item('Lena Ortiz')).toContainText('3 days after the first email');
  await expect(item('Omar Haddad')).toContainText('5 days after the first email');
});
