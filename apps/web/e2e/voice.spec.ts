import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const post = async (page: Page, path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN })).json();

test('a typed voice note becomes a task and a note only after the person confirms them', async ({ page }) => {
  await signUp(page, 'Voice Notes');
  const lead = (await post(page, '/leads', { fullName: 'Priya Shah', companyName: 'Acme', email: 'priya@acme.test' })).lead;

  await page.goto(`/app/leads/${lead.id}`);
  await expect(page.getByRole('button', { name: 'Quick voice note' })).toBeVisible();
  const card = page.getByText('No voice notes yet.');
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'New voice note' }).click();

  const dialog = page.getByRole('dialog', { name: 'Voice note' });
  await expect(dialog.getByText('For Priya Shah.')).toBeVisible();

  // No Deepgram key here, so recording is shown as not set up and cannot start.
  await dialog.getByRole('tab', { name: 'Record' }).click();
  await expect(dialog.getByLabel('Recording transcription status').getByText('Pending Configuration')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start recording' })).toBeDisabled();

  await dialog.getByRole('tab', { name: 'Type' }).click();
  await dialog
    .getByLabel('Your note')
    .fill('Follow up tomorrow at 3 pm with the revised quote. Note that they want a 12 month contract. Send an email to their whole team.');
  await dialog.getByRole('button', { name: 'Suggest actions' }).click();

  await expect(dialog.getByText('AI suggestion')).toBeVisible();
  const list = dialog.getByRole('list', { name: 'Suggested actions' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(dialog.getByLabel('Task', { exact: true })).toHaveValue('Follow up');
  await expect(dialog.getByLabel('Time', { exact: true })).toHaveValue('15:00');
  await expect(dialog.getByLabel('Note', { exact: true })).toHaveValue(/12 month contract/);
  const notDone = dialog.getByRole('region', { name: 'Not done' });
  await expect(notDone.getByText('Send an email to their whole team')).toBeVisible();

  await page.waitForTimeout(300);
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await dialog.getByLabel('Task', { exact: true }).fill('Send the revised quote');
  await dialog.getByRole('button', { name: 'Save 2 selected' }).click();
  await expect(dialog.getByRole('link', { name: 'Saved' })).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Change the note' })).toHaveCount(0);

  const tasks = (await (await page.request.get('/api/v1/tasks')).json()) as { title: string; description: string | null }[];
  expect(tasks.find((t) => t.title === 'Send the revised quote')).toBeTruthy();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Voice notes' }).getByText('2 saved')).toBeVisible();
});
