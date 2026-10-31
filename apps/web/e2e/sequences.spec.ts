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
  await expectNoA11yViolations(page);

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
