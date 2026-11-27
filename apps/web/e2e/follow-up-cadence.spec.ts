import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The follow-up cadence (redesign R3, ADR 0083) in the browser: the Super Workspace sets how many follow-ups and how
 * far apart, new employees start in Fresh Email Pending, marking the initial email plans follow-up 1, each completed
 * follow-up plans the next, and a reply stops it.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function call(page: Page, method: 'get' | 'post', path: string, data?: object) {
  const res = method === 'get' ? await page.request.get(`/api/v1${path}`) : await page.request.post(`/api/v1${path}`, { data: data ?? {}, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shotOf(page: Page, el: Locator, name: string) {
  if (!PREVIEW_DIR) return;
  const style = await page.addStyleTag({ content: 'header, [data-sticky], .sticky { position: static !important; }' });
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await el.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await style.evaluate((n) => (n as HTMLElement).remove());
}

const row = (section: Locator, name: string) => section.getByRole('row').filter({ has: section.page().getByRole('link', { name, exact: true }) });

test('the Super Workspace sets the cadence, and each employee moves from Fresh Email Pending through the follow-ups until they answer', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Cadence Fieldwork Ltd');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));

  // The setting: 5 follow-ups 7 days apart until changed; the Super Workspace's administrator sets 3, 2 days apart.
  await page.goto('/app/settings/crm?section=follow-up-cadence');
  const form = page.locator('[data-cadence-settings]');
  const count = form.getByLabel('Follow-ups after the initial email');
  const days = form.getByLabel('Days between follow-ups');
  await expect(count).toHaveValue('5');
  await expect(days).toHaveValue('7');
  await expect(form.locator('[data-cadence-summary]')).toContainText('the last one is due 35 days after the initial email');
  await count.fill('0');
  await expect(form.getByRole('alert')).toContainText('Choose 1 to 20 follow-ups');
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
  await count.fill('3');
  await days.fill('2');
  await expect(form.locator('[data-cadence-summary]')).toContainText('3 follow-ups, one every 2 days: the last one is due 6 days after the initial email.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved.');
  await expect(form).toContainText('Last changed by');
  await axe(page);
  await shotOf(page, form, '01-cadence-settings');
  await page.reload();
  await expect(page.locator('[data-cadence-settings]').getByLabel('Follow-ups after the initial email')).toHaveValue('3');

  // New employees start in Fresh Email Pending.
  const lead = await call(page, 'post', '/company-leads', {
    company: { name: 'Northwind Panels Ltd', country: 'GB', city: 'London', website: 'https://northwind.example' },
    employees: [
      { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', emails: [{ value: 'priya@northwind.example' }] },
      { firstName: 'Tom', lastName: 'Hale', jobTitle: 'Procurement Manager', emails: [{ value: 'tom@northwind.example' }] },
    ],
  });
  const companyId = lead.company.id as string;
  const [priya, tom] = lead.employeeIds as string[];
  await page.goto(`/app/companies/${companyId}`);
  const section = page.locator('#employee-activity');
  for (const name of ['Priya Nair', 'Tom Hale']) {
    await expect(row(section, name)).toContainText('Fresh Email Pending');
    await expect(row(section, name)).toContainText('Initial email pending');
  }

  // The initial email went out from Outlook: mark it, and follow-up 1 is planned 2 days later.
  await row(section, 'Priya Nair').getByRole('button', { name: 'Mark initial email as sent' }).click();
  await expect(row(section, 'Priya Nair')).toContainText('Initial Email Sent');
  await expect(row(section, 'Priya Nair')).toContainText('Follow-up 1 of 3, due');
  await expect(row(section, 'Priya Nair').getByRole('button', { name: 'Mark initial email as sent' })).toHaveCount(0);
  await expect(row(section, 'Tom Hale')).toContainText('Initial email pending');
  await axe(page);
  await shotOf(page, section, '02-employees-cadence');

  // Follow-up 1 done: Priya moves to Follow-up 1 and follow-up 2 is planned.
  const c1 = await call(page, 'get', `/contacts/${priya}/cadence`);
  await call(page, 'post', `/follow-ups/${c1.next.taskId}/complete`, { outcome: 'Sent the reminder' });
  await page.reload();
  await expect(row(section, 'Priya Nair')).toContainText('Follow-up 2 of 3, due');

  // It is a real follow-up task on the Follow-ups page, for the employee owner.
  await page.goto('/app/follow-ups');
  await page.getByRole('tab', { name: /Upcoming follow-ups/ }).click();
  await expect(page.getByText('Follow-up 2 of 3: Priya Nair').first()).toBeVisible();
  await axe(page);
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/03-follow-ups-page.png` });

  // Tom: the email goes out, then he replies. The cadence stops and the planned follow-up is cancelled.
  await call(page, 'post', `/contacts/${tom}/initial-email`, {});
  await call(page, 'post', '/interactions', { companyId, contactId: tom, kind: 'EMAIL_RECEIVED', subject: 'Re: Introduction' });
  await page.goto(`/app/contacts/${tom}`);
  const card = page.locator('#communication-stage');
  await expect(card).toContainText('Cadence stopped: the contact replied');
  await expect(card).toContainText('Discussion in Progress');
  await axe(page);
  await shotOf(page, card, '04-contact-cadence-stopped');
});
