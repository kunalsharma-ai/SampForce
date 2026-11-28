import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** "Delete all" on lists that are not tables: RFQs past their page, and tasks past the list's 200 (ADR 0096). Set PREVIEW_DIR for screenshots. */
const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('deletes every RFQ in the register and every open task at once', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Clean Sweep Research');
  const company = await page.request.post('/api/v1/companies', { data: { name: 'Sweep Panels' }, headers: ORIGIN });
  const companyId = (await company.json()).id as string;
  for (let i = 0; i < 60; i++) {
    const res = await page.request.post('/api/v1/rfqs', { data: { companyId, projectName: `Sweep study ${String(i + 1).padStart(2, '0')}` }, headers: ORIGIN });
    expect(res.ok(), await res.text()).toBe(true);
  }
  for (let i = 0; i < 205; i++) {
    const res = await page.request.post('/api/v1/tasks', { data: { title: `Sweep task ${i + 1}` }, headers: ORIGIN });
    expect(res.ok(), await res.text()).toBe(true);
  }

  // RFQs: the register shows 50 at a time; "Delete all" counts and deletes all 60.
  await page.goto('/app/rfqs');
  const main = page.getByRole('main');
  await expect(main.getByText('60 RFQs')).toBeVisible();
  await main.getByRole('button', { name: 'Delete all' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete everything in this list?' });
  await expect(dialog).toContainText('This deletes all 60 records this list shows with its current filters');
  await shot(page, '04-rfqs-delete-all-confirm');
  await dialog.getByRole('button', { name: 'Delete all 60' }).click();
  // The password is asked once for all of them (signUp confirms it).
  await expect(main.getByText('No RFQs yet. Add one from a company page.')).toBeVisible();
  await shot(page, '05-rfqs-after-delete-all');

  // Tasks: the list shows 200; all 205 open tasks go.
  await page.goto('/app/activities');
  await expect(main.getByText('Sweep task 1', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Delete all' }).first().click();
  dialog = page.getByRole('dialog', { name: 'Delete everything in this list?' });
  await expect(dialog).toContainText('This deletes all 205 records');
  await shot(page, '06-tasks-delete-all-confirm');
  await dialog.getByRole('button', { name: 'Delete all 205' }).click();
  await expect(main.getByText('Nothing to do. Nice work.')).toBeVisible();
  await shot(page, '07-tasks-after-delete-all');
});

test('deletes the whole call history and a company interactions log at once', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Call Sweep Research');
  const company = await page.request.post('/api/v1/companies', { data: { name: 'Sweep Dialling Ltd', primaryPhone: '+44 20 7946 0000' }, headers: ORIGIN });
  const companyId = (await company.json()).id as string;
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post('/api/v1/calls', { data: { companyId, numberSource: 'COMPANY' }, headers: ORIGIN });
    expect(res.ok(), await res.text()).toBe(true);
  }
  for (let i = 0; i < 4; i++) {
    const res = await page.request.post('/api/v1/interactions', { data: { companyId, kind: 'EMAIL_SENT', subject: `Sweep email ${i + 1}` }, headers: ORIGIN });
    expect(res.ok(), await res.text()).toBe(true);
  }

  await page.goto('/app/calls');
  const main = page.getByRole('main');
  await expect(main.getByTestId('call-row')).toHaveCount(3);
  await main.getByRole('button', { name: 'Delete all' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete everything in this list?' });
  await expect(dialog).toContainText('This deletes all 3 records');
  await shot(page, '08-calls-delete-all-confirm');
  await dialog.getByRole('button', { name: 'Delete all 3' }).click();
  await expect(main.getByText('No calls here yet.')).toBeVisible();

  await page.goto(`/app/companies/${companyId}`);
  const log = main.locator('#company-interactions');
  await expect(log.getByText('Sweep email 4')).toBeVisible();
  await log.getByRole('button', { name: 'Delete all' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete everything in this list?' });
  await expect(dialog).toContainText('This deletes all 4 records');
  await shot(page, '09-interactions-delete-all-confirm');
  await dialog.getByRole('button', { name: 'Delete all 4' }).click();
  await expect(log.getByText('Sweep email 4')).toHaveCount(0);
});
