import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

// The finder reads made-up company websites from a local stand-in (apps/api/test/fixtures/finder-fixture.ts).
test('finds a company’s addresses and a person’s likely address, then saves them as leads', async ({ page }) => {
  await signUp(page, 'Finder Flow');
  await page.goto('/app/finder');
  await expect(page.getByRole('heading', { level: 1, name: 'Email Finder' })).toBeVisible();
  await expect(page.getByText(/0 of 50 lookups used/)).toBeVisible();

  await page.getByLabel('Company name or website').fill('Kestrel Analytics');
  await page.getByLabel(/First name/).fill('Owen');
  await page.getByLabel(/Last name/).fill('Price');
  await page.getByRole('button', { name: 'Find emails' }).click();

  await expect(page.getByText('kestrel-analytics.com (from a website that matches the company name)')).toBeVisible();
  await expect(page.getByText('yes, it has a mail server')).toBeVisible();
  await expect(page.getByText('first.last@kestrel-analytics.com (from 3 published addresses)')).toBeVisible();
  const list = page.getByRole('list', { name: 'Addresses found' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await expect(list.getByRole('listitem').first()).toContainText('owen.price@kestrel-analytics.com');
  await expect(list.getByRole('listitem').first()).toContainText('Matches their pattern');
  await expect(list.getByRole('listitem').nth(1)).toContainText('On their website');
  // Named people are ticked; the shared projects@ mailbox is not.
  await expect(page.getByRole('checkbox', { name: /projects@kestrel-analytics.com/ })).not.toBeChecked();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole('button', { name: 'Save 4 as leads' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved 4 new leads.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Already a lead: Owen Price' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Kestrel Analytics/ })).toBeVisible();

  const leads = await (await page.request.get('/api/v1/leads?q=kestrel')).json();
  expect(leads.items.map((l: { fullName: string }) => l.fullName).sort()).toEqual(['Hannah Cole', 'Owen Price', 'Priya Raman', 'Tomás Herrera']);
  expect(leads.items[0]).toMatchObject({ source: 'Email finder', companyName: 'Kestrel Analytics' });
});
