import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

test.use({ reducedMotion: 'reduce' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

test('the lead form uses searchable country and currency pickers, a phone field and tag chips', async ({ page }) => {
  await signUp(page, 'Form Library');
  await page.goto('/app/leads');
  await page.getByRole('button', { name: 'New lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name *').fill('Ada Lovelace');

  // Country: fuzzy search, keyboard selection.
  const country = dialog.getByRole('combobox', { name: 'Country' });
  await country.fill('unkin');
  await expect(dialog.getByRole('option', { name: /United Kingdom/ })).toBeVisible();
  await country.press('ArrowDown');
  await country.press('ArrowUp');
  await country.press('Enter');
  await expect(country).toHaveValue('United Kingdom');

  // Currency and money.
  await dialog.getByRole('combobox', { name: 'Currency' }).fill('british pound');
  await dialog.getByRole('option', { name: /GBP/ }).click();
  await dialog.getByLabel('Estimated value').fill('24000');
  await dialog.getByLabel('Full name *').focus();
  await expect(dialog.getByLabel('Estimated value')).toHaveValue('24,000');
  await expect(dialog.getByText('£', { exact: true })).toBeVisible();

  // Phone: an incomplete number is explained, then fixed.
  await dialog.getByLabel('Calling code').selectOption('GB');
  await dialog.getByLabel('Phone', { exact: true }).fill('020 7946');
  // Tags: Enter and comma both add chips; Backspace removes the last one.
  const tags = dialog.getByRole('combobox', { name: 'Tags' });
  await tags.fill('enterprise');
  await tags.press('Enter');
  await tags.pressSequentially('uk,spare,');
  await expect(dialog.getByRole('button', { name: 'Remove tag spare' })).toBeVisible();
  await tags.press('Backspace');
  await expect(dialog.getByRole('button', { name: 'Remove tag spare' })).toHaveCount(0);
  await axe(page);

  await dialog.getByRole('button', { name: 'Create lead' }).click();
  await expect(dialog.getByText('This is not a valid +44 number. Check the digits.')).toBeVisible();
  await expect(dialog.getByLabel('Phone', { exact: true })).toBeFocused();
  await dialog.getByLabel('Phone', { exact: true }).fill('020 7946 0958');
  await dialog.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Ada Lovelace/ })).toBeVisible();

  const id = page.url().split('/').pop()!;
  const lead = await (await page.request.get(`/api/v1/leads/${id}`)).json();
  expect(lead).toMatchObject({ phone: '+442079460958', country: 'GB', currency: 'GBP', estimatedValue: 24000, tags: ['enterprise', 'uk'] });
});

test('the deal form steps probability, sets priority and recovers an unsaved draft', async ({ page }) => {
  await signUp(page, 'Draft Recovery');
  await page.goto('/app/deals');
  await page.getByRole('button', { name: 'New deal' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Deal name *').fill('Contoso expansion');
  await dialog.getByLabel('Amount').fill('1.5e');
  await dialog.getByLabel('Amount').fill('50000');
  await page.waitForTimeout(600); // the draft is kept after a short pause
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: 'New deal' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/You have an unsaved deal from/)).toBeVisible();
  await expect(dialog.getByLabel('Deal name *')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Restore draft' }).click();
  await expect(dialog.getByLabel('Deal name *')).toHaveValue('Contoso expansion');

  const probability = dialog.getByRole('spinbutton', { name: 'Probability override (%)' });
  await dialog.getByRole('button', { name: 'Increase probability override' }).click();
  await expect(probability).toHaveValue('5');
  await probability.press('ArrowUp');
  await probability.press('ArrowUp');
  await expect(probability).toHaveValue('15');
  await probability.fill('140');
  await dialog.getByLabel('Deal name *').focus();
  await expect(probability).toHaveValue('100');
  await probability.fill('60');
  await dialog.getByRole('group', { name: 'Priority' }).getByText('High').click();
  await dialog.getByRole('combobox', { name: 'Currency' }).fill('EUR');
  await dialog.getByRole('option', { name: /^EUR/ }).click();
  await expect(dialog.getByText('€', { exact: true })).toBeVisible();
  await axe(page);
  await dialog.getByRole('button', { name: 'Create deal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contoso expansion' })).toBeVisible();
  const id = page.url().split('/').pop()!;
  const deal = await (await page.request.get(`/api/v1/deals/${id}`)).json();
  expect(deal).toMatchObject({ amount: 50000, currency: 'EUR', probability: 60, priority: 'HIGH' });

  // The draft is gone once the deal is saved.
  await page.goto('/app/deals');
  await page.getByRole('button', { name: 'New deal' }).click();
  await expect(page.getByRole('dialog').getByLabel('Deal name *')).toBeVisible();
  await expect(page.getByText(/You have an unsaved deal/)).toHaveCount(0);
});

test('sign-in uses floating labels and the import upload zone checks the file', async ({ page }) => {
  await page.goto('/login');
  const email = page.getByLabel('Work email');
  await expect(email).toBeVisible();
  await email.fill('someone@example.test');
  await expect(page.locator('label[for="email"]')).toHaveClass(/peer-/);
  await axe(page);

  await signUp(page, 'Upload Zone');
  await page.goto('/app/settings/import');
  await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('notes.txt is not a supported file. Use CSV.')).toBeVisible();
  await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from('Full name,Email\nAda,ada@example.test\n') });
  await expect(page.getByText('leads.csv', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2. Match columns' })).toBeVisible();
  await axe(page);
});
