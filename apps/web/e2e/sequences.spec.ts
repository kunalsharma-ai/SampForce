import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

async function apiCall(page: Page, method: 'post' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.json();
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('writes a template, previews it for a lead, and builds and starts a sequence', async ({ page }) => {
  await signUp(page, 'Sequence Flow');
  await apiCall(page, 'post', '/leads', { fullName: 'Ana Buyer', email: 'ana@buyer.test', companyName: 'Buyer Co' });

  await page.goto('/app/sequences');
  await expect(page.getByRole('heading', { level: 1, name: 'Email Sequences' })).toBeVisible();
  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByLabel('Name').fill('Intro');
  await page.getByLabel('Subject').fill('Hello from us');
  await page.getByLabel('Email', { exact: true }).fill('Hi ');
  await page.getByRole('button', { name: 'First name', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('Hi {{first_name|there}}');
  // The insert puts the cursor back in the box after the field.
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.getByLabel('Email', { exact: true }).fill('Hi {{first_name|there}}, a note for {{company}}.');
  await page.getByLabel('Preview for a lead').fill('Ana');
  await page.getByRole('option', { name: /Ana Buyer/ }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('Hi Ana, a note for Buyer Co.')).toBeVisible();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('heading', { name: 'Intro' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('tab', { name: 'Sequences' }).click();
  await page.getByRole('button', { name: 'New sequence' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /New sequence/ })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Outbound test');
  await page.getByLabel('Template').first().selectOption({ label: 'Intro' });
  await page.getByLabel('Subject').first().fill('');
  await page.getByLabel('Email', { exact: true }).first().fill('');
  // A/B test the first email: version B gets its own subject and text.
  await page.getByRole('button', { name: 'A/B test this email' }).first().click();
  await expect(page.getByRole('button', { name: 'Version B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Subject').first().fill('A different hello for {{company|your team}}');
  await page.getByLabel('Email', { exact: true }).first().fill('Hi {{first_name|there}}, version B.');
  await page.getByRole('button', { name: 'Version A', exact: true }).click();
  await expect(page.getByLabel('Template').first()).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Add check' }).click();
  await expect(page.getByLabel('Has the person')).toHaveValue('replied');

  await page.getByRole('tab', { name: 'When they respond' }).click();
  await page.getByLabel('Create a task for the sender').first().check();
  await page.getByRole('tab', { name: 'Sending' }).click();
  await page.getByLabel('Emails per sender per day').fill('25');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Outbound test/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start sequence' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Version B', exact: true }).click();
  await expect(page.getByLabel('Subject').first()).toHaveValue('A different hello for {{company|your team}}');
  await expectNoA11yViolations(page);
  // A test goes to the sender's own mailbox, which this workspace has not connected.
  await page.getByRole('button', { name: 'Send me a test' }).first().click();
  await expect(page.getByRole('alert').filter({ hasText: 'to send yourself a test' })).toBeVisible();

  // Enrolling needs the sender's own mailbox, which this test workspace has not connected.
  await page.getByRole('tab', { name: /People/ }).click();
  await page.getByLabel('A lead').fill('Ana');
  await page.getByRole('option', { name: /Ana Buyer/ }).click();
  await page.getByRole('button', { name: 'Enrol', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Connect your Google or Microsoft mailbox' })).toBeVisible();
});

test('shows a clear message for an invalid unsubscribe link', async ({ page }) => {
  await page.goto('/unsubscribe/not-a-real-token');
  await expect(page.getByText('This unsubscribe link is not valid.')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('workspace variables and custom fields fill templates, templates group by category and duplicate, and results show estimates honestly', async ({ page }) => {
  await signUp(page, 'Template Flow');
  await apiCall(page, 'post', '/custom-fields', { entity: 'LEAD', key: 'region', label: 'Region', type: 'TEXT' });
  await apiCall(page, 'post', '/leads', { fullName: 'Rhea North', email: 'rhea@buyer.test', customFields: { region: 'Nordics' } });

  await page.goto('/app/sequences');
  await page.getByRole('tab', { name: 'Variables' }).click();
  await expect(page.getByText(/No variables yet/)).toBeVisible();
  await page.getByLabel('Key', { exact: true }).fill('booking_link');
  await page.getByLabel('Label').fill('Booking link');
  await page.getByLabel('Value').fill('https://cal.example.com/rep');
  await page.getByRole('button', { name: 'Save variable' }).click();
  await expect(page.getByText('{{var.booking_link}}')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByLabel('Name').fill('Regional opener');
  await page.getByLabel('Subject').fill('News for ');
  await page.getByLabel('Insert a custom field or workspace variable').selectOption('custom.region');
  await expect(page.getByLabel('Subject')).toHaveValue('News for {{custom.region}}');
  await page.getByLabel('Email', { exact: true }).fill('Pick a time: ');
  await page.getByLabel('Insert a custom field or workspace variable').selectOption('var.booking_link');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('Pick a time: {{var.booking_link}}');
  await page.getByLabel('Category').fill('Cold outreach');
  await page.getByLabel('Preview for a lead').fill('Rhea');
  await page.getByRole('option', { name: /Rhea North/ }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('News for Nordics')).toBeVisible();
  await expect(page.getByText('Pick a time: https://cal.example.com/rep')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('heading', { name: /Regional opener/ })).toBeVisible();

  await page.getByRole('button', { name: 'Duplicate Regional opener' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Regional opener (copy)');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: /Regional opener \(copy\)/ })).toBeVisible();
  await page.getByLabel('Category', { exact: true }).selectOption('Cold outreach');
  await expect(page.getByRole('heading', { name: /Regional opener/ })).toHaveCount(2);

  // A variable that templates use cannot be deleted.
  await page.getByRole('tab', { name: 'Variables' }).click();
  await page.getByRole('button', { name: 'Delete Booking link' }).click();
  await expect(page.getByText(/is used in 2 template/)).toBeVisible();

  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByText('Emails sent')).toBeVisible();
  await expect(page.getByText(/Opens are estimates/)).toBeVisible();
  await expect(page.getByText('Nothing sent in this period.').first()).toBeVisible();
  await page.getByLabel('Whose emails').selectOption('team');
  await expect(page.getByText('Emails sent')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoA11yViolations(page);
});
